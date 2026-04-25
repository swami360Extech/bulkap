/**
 * Email ingestion service
 *
 * Parses attachments from inbound-email webhooks (SendGrid, Mailgun, AWS SES/SNS)
 * and creates Invoice records that feed the extraction pipeline.
 */

import { db } from "@/lib/db";
import { runExtractionPipeline } from "@/server/services/extraction/pipeline";
import { s3Client, S3_BUCKET } from "@/server/services/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/xml",
  "text/xml",
]);

export interface EmailAttachment {
  filename:    string;
  mimeType:    string;
  content:     Buffer;  // raw bytes
}

export interface EmailIngestionResult {
  processed: number;
  skipped:   number;
  invoiceIds: string[];
  errors:    string[];
}

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime.split(";")[0].trim().toLowerCase());
}

const DEV_S3 = !process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID === "your-access-key-id";

export async function ingestEmailAttachments(
  tenantId:    string,
  fromAddress: string,
  subject:     string,
  attachments: EmailAttachment[]
): Promise<EmailIngestionResult> {
  const result: EmailIngestionResult = { processed: 0, skipped: 0, invoiceIds: [], errors: [] };

  const invoiceAttachments = attachments.filter((a) => isAllowedMime(a.mimeType));
  result.skipped = attachments.length - invoiceAttachments.length;

  for (const att of invoiceAttachments) {
    try {
      const ext    = att.filename.split(".").pop() ?? "bin";
      const s3Key  = `invoices/${tenantId}/email/${crypto.randomUUID()}.${ext}`;
      let   docUrl = s3Key;

      if (!DEV_S3) {
        await s3Client.send(
          new PutObjectCommand({
            Bucket:      S3_BUCKET,
            Key:         s3Key,
            Body:        att.content,
            ContentType: att.mimeType,
            Metadata:    { tenantId, source: "email", from: fromAddress },
          })
        );
      }
      // In dev mode: docUrl stays as the s3Key placeholder (no actual S3 upload)

      const invoice = await db.invoice.create({
        data: {
          tenantId,
          sourceChannel:    "EMAIL",
          sourceRef:        fromAddress,
          documentUrl:      docUrl,
          documentMimeType: att.mimeType,
          originalFilename: att.filename,
          status:           "RECEIVED",
          receivedAt:       new Date(),
        },
      });

      await db.auditEvent.create({
        data: {
          tenantId,
          invoiceId:   invoice.id,
          actorType:   "system",
          eventType:   "invoice.received_email",
          description: `Invoice received via email from ${fromAddress}: ${att.filename}`,
        },
      });

      runExtractionPipeline(invoice.id).catch((err) =>
        console.error(`[email] extraction failed for ${invoice.id}:`, err)
      );

      result.invoiceIds.push(invoice.id);
      result.processed++;
    } catch (err) {
      result.errors.push(`${att.filename}: ${String(err)}`);
    }
  }

  return result;
}

// ── Parse SendGrid Inbound Parse multipart fields ─────────────────────────────

export function parseAttachmentsFromFormData(formData: FormData): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];

  // SendGrid sends attachments as attachment1, attachment2, ...
  // Also check a generic "attachment" key
  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File)) continue;
    if (!key.startsWith("attachment") && key !== "file") continue;

    attachments.push({
      filename: value.name || "attachment.pdf",
      mimeType: value.type || "application/pdf",
      content:  Buffer.from([]), // will be filled async below
    });
  }

  return attachments;
}

export async function parseAttachmentsFromFormDataAsync(formData: FormData): Promise<EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];

  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File)) continue;
    if (!key.startsWith("attachment") && key !== "file" && key !== "files[]") continue;
    if (!isAllowedMime(value.type)) continue;

    const bytes = await value.arrayBuffer();
    attachments.push({
      filename: value.name || "invoice.pdf",
      mimeType: value.type || "application/octet-stream",
      content:  Buffer.from(bytes),
    });
  }

  return attachments;
}
