import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "@/server/trpc";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, S3_BUCKET } from "@/server/services/s3";
import { SourceChannel } from "@prisma/client";
import { runExtractionPipeline } from "@/server/services/extraction/pipeline";
import { pollSftp, getSftpConfigFromEnv } from "@/server/services/ingestion/sftp";
import crypto from "crypto";

export const ingestionRouter = router({
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        mimeType: z.string(),
        fileSize: z.number().max(50 * 1024 * 1024),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const ext = input.filename.split(".").pop() ?? "bin";
      const s3Key = `invoices/${tenantId}/${crypto.randomUUID()}.${ext}`;

      // In dev (no real S3 configured), route uploads through a local API endpoint
      const isDev = !process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID === "your-access-key-id";
      if (isDev) {
        return {
          uploadUrl: `/api/upload-local?key=${encodeURIComponent(s3Key)}`,
          s3Key,
          expiresAt: new Date(Date.now() + 900_000),
        };
      }

      const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        ContentType: input.mimeType,
        ContentLength: input.fileSize,
        Metadata: { tenantId, uploadedBy: ctx.session.user.id },
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
      return { uploadUrl, s3Key, expiresAt: new Date(Date.now() + 900_000) };
    }),

  confirmUpload: protectedProcedure
    .input(
      z.object({
        s3Key: z.string(),
        originalFilename: z.string(),
        mimeType: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      const invoice = await ctx.db.invoice.create({
        data: {
          tenantId,
          sourceChannel: SourceChannel.MANUAL_UPLOAD,
          documentUrl: input.s3Key,
          documentMimeType: input.mimeType,
          originalFilename: input.originalFilename,
          status: "RECEIVED",
          receivedAt: new Date(),
        },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          actorType: "user",
          actorId: ctx.session.user.id,
          eventType: "invoice.received",
          description: `Invoice uploaded: ${input.originalFilename}`,
        },
      });

      // Kick off extraction pipeline server-side (fire and forget)
      runExtractionPipeline(invoice.id).catch((err) =>
        console.error(`[pipeline] extraction failed for ${invoice.id}:`, err)
      );

      return { invoiceId: invoice.id, status: invoice.status };
    }),

  bulkUpload: protectedProcedure
    .input(
      z.object({
        files: z
          .array(z.object({ s3Key: z.string(), originalFilename: z.string(), mimeType: z.string() }))
          .max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const batchJobId = crypto.randomUUID();

      // Create all invoice records in one transaction
      await ctx.db.$transaction(
        input.files.map((file) =>
          ctx.db.invoice.create({
            data: {
              tenantId,
              sourceChannel: SourceChannel.MANUAL_UPLOAD,
              sourceRef: batchJobId,
              documentUrl: file.s3Key,
              documentMimeType: file.mimeType,
              originalFilename: file.originalFilename,
              status: "RECEIVED",
              receivedAt: new Date(),
            },
          })
        )
      );

      return { batchJobId, count: input.files.length };
    }),

  batchStatus: protectedProcedure
    .input(z.object({ batchJobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const invoices = await ctx.db.invoice.findMany({
        where: { tenantId, sourceRef: input.batchJobId },
        select: { status: true },
      });

      const counts = invoices.reduce(
        (acc, inv) => {
          if (inv.status === "RECEIVED") acc.received++;
          else if (inv.status === "EXTRACTING" || inv.status === "CLASSIFYING") acc.extracting++;
          else if (inv.status === "REVIEW_REQUIRED") acc.review++;
          else if (inv.status === "VALIDATION_FAILED" || inv.status === "ORACLE_ERROR") acc.errors++;
          return acc;
        },
        { received: 0, extracting: 0, review: 0, errors: 0 }
      );

      return {
        total: invoices.length,
        ...counts,
        complete: invoices.every((i) => !["RECEIVED", "EXTRACTING", "CLASSIFYING", "VALIDATING"].includes(i.status)),
      };
    }),

  // ── Manual SFTP poll trigger (managers only) ──────────────────────────────
  pollSftp: managerProcedure
    .input(z.object({
      host:        z.string().optional(),
      port:        z.number().int().default(22),
      username:    z.string().optional(),
      password:    z.string().optional(),
      remotePath:  z.string().default("/invoices/incoming"),
      archivePath: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      // Use provided values or fall back to env vars
      const envConfig = getSftpConfigFromEnv();
      const config = {
        host:        input.host        ?? envConfig?.host        ?? "",
        port:        input.port        ?? envConfig?.port        ?? 22,
        username:    input.username    ?? envConfig?.username    ?? "",
        password:    input.password    ?? envConfig?.password,
        remotePath:  input.remotePath  ?? envConfig?.remotePath  ?? "/invoices/incoming",
        archivePath: input.archivePath ?? envConfig?.archivePath,
      };

      if (!config.host || !config.username) {
        throw new Error("SFTP host and username are required. Configure SFTP_HOST and SFTP_USERNAME env vars.");
      }

      const result = await pollSftp(tenantId, config);

      await ctx.db.auditEvent.create({
        data: {
          tenantId,
          actorType:   "user",
          actorId:     ctx.session.user.id,
          eventType:   "sftp.polled",
          description: `SFTP poll by ${ctx.session.user.name}: ${result.processed} files ingested, ${result.errors.length} errors`,
        },
      });

      return result;
    }),
});
