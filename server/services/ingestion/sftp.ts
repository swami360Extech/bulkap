/**
 * SFTP ingestion poller
 *
 * Connects to a remote SFTP server, lists new invoice files, downloads them,
 * and feeds them through the extraction pipeline.
 *
 * Requires: npm install ssh2-sftp-client
 *
 * Configuration (env vars):
 *   SFTP_HOST, SFTP_PORT, SFTP_USERNAME, SFTP_PASSWORD (or SFTP_PRIVATE_KEY),
 *   SFTP_REMOTE_PATH, SFTP_ARCHIVE_PATH (optional — move processed files here)
 */

import { db } from "@/lib/db";
import { runExtractionPipeline } from "@/server/services/extraction/pipeline";
import { s3Client, S3_BUCKET } from "@/server/services/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

export interface SftpConfig {
  host:        string;
  port:        number;
  username:    string;
  password?:   string;
  privateKey?: string;
  remotePath:  string;
  archivePath?: string;
}

export interface SftpPollResult {
  processed:  number;
  skipped:    number;
  errors:     string[];
  invoiceIds: string[];
}

const INVOICE_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".xml"]);

const MIME_BY_EXT: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls":  "application/vnd.ms-excel",
  ".csv":  "text/csv",
  ".xml":  "application/xml",
};

const DEV_S3 = !process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID === "your-access-key-id";

export async function pollSftp(tenantId: string, config: SftpConfig): Promise<SftpPollResult> {
  const result: SftpPollResult = { processed: 0, skipped: 0, errors: [], invoiceIds: [] };

  // Dynamic import — requires npm install ssh2-sftp-client
  let SftpClient: any;
  try {
    const mod = await import("ssh2-sftp-client" as any);
    SftpClient = mod.default;
  } catch {
    throw new Error(
      "ssh2-sftp-client is not installed. Run: npm install ssh2-sftp-client"
    );
  }

  const client = new SftpClient();
  try {
    await client.connect({
      host:       config.host,
      port:       config.port,
      username:   config.username,
      password:   config.password,
      privateKey: config.privateKey,
    });

    const fileList: { name: string; type: string }[] = await client.list(config.remotePath);
    const invoiceFiles = fileList.filter((f) => {
      if (f.type !== "-") return false; // directories
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      return INVOICE_EXTENSIONS.has(ext);
    });

    result.skipped = fileList.length - invoiceFiles.length;

    for (const file of invoiceFiles) {
      try {
        const remotePath = `${config.remotePath}/${file.name}`;
        const ext        = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
        const mimeType   = MIME_BY_EXT[ext] ?? "application/octet-stream";

        // Download file into Buffer
        const chunks: Buffer[] = [];
        const stream = await client.get(remotePath);
        await new Promise<void>((resolve, reject) => {
          stream.on("data",  (chunk: Buffer) => chunks.push(chunk));
          stream.on("end",   resolve);
          stream.on("error", reject);
        });
        const content = Buffer.concat(chunks);

        const s3Key  = `invoices/${tenantId}/sftp/${crypto.randomUUID()}${ext}`;
        let   docUrl = s3Key;

        if (!DEV_S3) {
          await s3Client.send(
            new PutObjectCommand({
              Bucket:      S3_BUCKET,
              Key:         s3Key,
              Body:        content,
              ContentType: mimeType,
              Metadata:    { tenantId, source: "sftp", originalFile: file.name },
            })
          );
        }

        const invoice = await db.invoice.create({
          data: {
            tenantId,
            sourceChannel:    "SFTP",
            sourceRef:        config.host,
            documentUrl:      docUrl,
            documentMimeType: mimeType,
            originalFilename: file.name,
            status:           "RECEIVED",
            receivedAt:       new Date(),
          },
        });

        await db.auditEvent.create({
          data: {
            tenantId,
            invoiceId:   invoice.id,
            actorType:   "system",
            eventType:   "invoice.received_sftp",
            description: `Invoice received via SFTP from ${config.host}: ${file.name}`,
          },
        });

        runExtractionPipeline(invoice.id).catch((err) =>
          console.error(`[sftp] extraction failed for ${invoice.id}:`, err)
        );

        // Archive processed file if archive path configured
        if (config.archivePath) {
          const archiveDest = `${config.archivePath}/${Date.now()}_${file.name}`;
          await client.rename(remotePath, archiveDest).catch(() => {
            // Non-fatal — log and continue
            console.warn(`[sftp] Could not archive ${file.name}`);
          });
        }

        result.invoiceIds.push(invoice.id);
        result.processed++;
      } catch (err) {
        result.errors.push(`${file.name}: ${String(err)}`);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  return result;
}

export function getSftpConfigFromEnv(): SftpConfig | null {
  const host = process.env.SFTP_HOST;
  if (!host) return null;
  return {
    host,
    port:        Number(process.env.SFTP_PORT ?? 22),
    username:    process.env.SFTP_USERNAME ?? "",
    password:    process.env.SFTP_PASSWORD,
    privateKey:  process.env.SFTP_PRIVATE_KEY,
    remotePath:  process.env.SFTP_REMOTE_PATH ?? "/invoices/incoming",
    archivePath: process.env.SFTP_ARCHIVE_PATH,
  };
}
