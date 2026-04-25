import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import { generateFBDI } from "@/server/services/fbdi/generator";
import { getOracleClient } from "@/server/services/oracle/client";
import {
  submitInvoiceDirect,
  uploadFBDIToUCM,
  submitESSJob,
  pollESSJobStatus,
} from "@/server/services/oracle/submitter";
import {
  fetchOracleInvoiceStatus,
  simulateSyncResult,
  type SyncedStatus,
} from "@/server/services/oracle/sync";

const DEV_URLS = ["example.com", "your-oracle", "localhost"];
const isOracleConfigured = (url: string) => !DEV_URLS.some((p) => url.includes(p));

export const submissionRouter = router({
  // ── List invoices ready for submission ──────────────────────────────────────

  readyInvoices: protectedProcedure
    .input(z.object({ buId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const invoices = await ctx.db.invoice.findMany({
        where: {
          tenantId,
          status: "READY_FOR_SUBMISSION",
          ...(input.buId && { buId: input.buId }),
        },
        include: {
          vendor: { select: { name: true, oracleSupplierNum: true } },
          businessUnit: { select: { name: true, oracleBuId: true } },
        },
        orderBy: { receivedAt: "asc" },
      });

      const total = invoices.reduce((sum, inv) => sum + Number(inv.grossAmount ?? 0), 0);
      return { invoices, total };
    }),

  // ── Submit a batch to Oracle ────────────────────────────────────────────────

  submitBatch: managerProcedure
    .input(
      z.object({
        invoiceIds: z.array(z.string().uuid()).min(1).max(500),
        buId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      // Verify all invoices are READY_FOR_SUBMISSION and belong to this tenant
      const invoices = await ctx.db.invoice.findMany({
        where: {
          id: { in: input.invoiceIds },
          tenantId,
          status: "READY_FOR_SUBMISSION",
        },
        include: {
          vendor: true,
          businessUnit: true,
          lines: { orderBy: { lineNumber: "asc" } },
        },
      });

      if (invoices.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No eligible invoices found" });
      }

      // Determine the business unit (must be consistent across the batch)
      const buId = input.buId ?? invoices.find((i) => i.buId)?.buId ?? null;
      const bu = buId ? await ctx.db.businessUnit.findUnique({ where: { id: buId } }) : null;

      // Create the FBDIBatch record
      const batch = await ctx.db.fBDIBatch.create({
        data: {
          tenantId,
          buId: buId ?? invoices[0].buId ?? "",
          status: "ASSEMBLING",
          invoiceCount: invoices.length,
        },
      });

      // Generate FBDI CSVs
      const fbdi = generateFBDI(invoices as any, batch.id);

      // Mark invoices as SUBMITTING immediately so they can't be double-submitted
      await ctx.db.invoice.updateMany({
        where: { id: { in: invoices.map((i) => i.id) } },
        data: { status: "SUBMITTING", fbdiBatchId: batch.id, submittedAt: new Date() },
      });

      const tenant = await ctx.db.tenant.findUnique({ where: { id: tenantId } });
      const devMode = !tenant || !isOracleConfigured(tenant.oracleBaseUrl);

      try {
        if (devMode) {
          // Simulate Oracle processing in dev mode
          await ctx.db.fBDIBatch.update({
            where: { id: batch.id },
            data: {
              status: "JOB_COMPLETED",
              successCount: invoices.length,
              assembledAt: new Date(),
              uploadedAt: new Date(),
              submittedAt: new Date(),
              completedAt: new Date(),
            },
          });

          await ctx.db.invoice.updateMany({
            where: { id: { in: invoices.map((i) => i.id) } },
            data: {
              status: "SUBMITTED",
              oracleStatus: "VALIDATED",
            },
          });

          for (const inv of invoices) {
            await ctx.db.auditEvent.create({
              data: {
                tenantId,
                invoiceId: inv.id,
                actorType: "user",
                actorId: ctx.session.user.id,
                eventType: "invoice.submitted",
                description: `Submitted to Oracle via batch ${batch.id.slice(0, 8)} (demo mode)`,
              },
            });
          }
        } else {
          // Production path — FBDI upload to Oracle UCM then ESS job
          const oracleClient = getOracleClient(tenantId, {
            baseUrl:  tenant.oracleBaseUrl,
            username: tenant.oracleUsername,
            password: tenant.oraclePassword,
          });

          await ctx.db.fBDIBatch.update({
            where: { id: batch.id },
            data: { status: "ASSEMBLING", assembledAt: new Date() },
          });

          const ucm = await uploadFBDIToUCM(oracleClient, fbdi.headerCsv, fbdi.linesCsv, batch.id);

          await ctx.db.fBDIBatch.update({
            where: { id: batch.id },
            data: { status: "UPLOADED_TO_UCM", ucmDocId: ucm.ucmDocId, uploadedAt: new Date() },
          });

          const ess = await submitESSJob(
            oracleClient,
            ucm.ucmDocId,
            bu?.oracleBuId ?? "",
            batch.id
          );

          await ctx.db.fBDIBatch.update({
            where: { id: batch.id },
            data: {
              status: "JOB_SUBMITTED",
              oracleJobId: ess.oracleJobId,
              submittedAt: new Date(),
            },
          });

          await ctx.db.invoice.updateMany({
            where: { id: { in: invoices.map((i) => i.id) } },
            data: { status: "SUBMITTED" },
          });
        }

        await ctx.db.auditEvent.create({
          data: {
            tenantId,
            actorType: "user",
            actorId: ctx.session.user.id,
            eventType: "batch.submitted",
            description: `Batch ${batch.id.slice(0, 8)} — ${invoices.length} invoices submitted${devMode ? " (demo mode)" : ""}`,
          },
        });

        return { batchId: batch.id, count: invoices.length, devMode };
      } catch (err) {
        // Roll back statuses on failure
        await ctx.db.fBDIBatch.update({
          where: { id: batch.id },
          data: { status: "JOB_FAILED", errorLog: String(err) },
        });
        await ctx.db.invoice.updateMany({
          where: { id: { in: invoices.map((i) => i.id) } },
          data: { status: "READY_FOR_SUBMISSION", fbdiBatchId: null, submittedAt: null },
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Oracle submission failed: ${String(err)}` });
      }
    }),

  // ── FBDI download (returns CSV text) ───────────────────────────────────────

  generateFBDI: managerProcedure
    .input(z.object({ invoiceIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const invoices = await ctx.db.invoice.findMany({
        where: { id: { in: input.invoiceIds }, tenantId },
        include: { vendor: true, businessUnit: true, lines: { orderBy: { lineNumber: "asc" } } },
      });

      const fbdi = generateFBDI(invoices as any, "PREVIEW");
      return { headerCsv: fbdi.headerCsv, linesCsv: fbdi.linesCsv, count: fbdi.rowCount };
    }),

  // ── Batch history ───────────────────────────────────────────────────────────

  batches: protectedProcedure
    .input(
      z.object({
        page:     z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const [batches, total] = await Promise.all([
        ctx.db.fBDIBatch.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.db.fBDIBatch.count({ where: { tenantId } }),
      ]);
      return { batches, total, pages: Math.ceil(total / input.pageSize) };
    }),

  // ── Sync individual invoice statuses from Oracle ────────────────────────────

  syncInvoiceStatuses: managerProcedure
    .input(z.object({ invoiceIds: z.array(z.string().uuid()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      const invoices = await ctx.db.invoice.findMany({
        where: {
          tenantId,
          status: { in: ["SUBMITTED", "ORACLE_PROCESSING"] },
          ...(input.invoiceIds?.length && { id: { in: input.invoiceIds } }),
        },
        select: { id: true, oracleInvoiceId: true, status: true, submittedAt: true },
      });

      if (invoices.length === 0) return { synced: 0, results: [] };

      const tenant = await ctx.db.tenant.findUnique({ where: { id: tenantId } });
      const devMode = !tenant || !isOracleConfigured(tenant.oracleBaseUrl);

      const results: { invoiceId: string; from: string; to: string }[] = [];

      for (const inv of invoices) {
        try {
          let syncResult;
          if (devMode) {
            syncResult = simulateSyncResult(inv.status, inv.submittedAt);
          } else {
            if (!inv.oracleInvoiceId) continue;
            const oracle = getOracleClient(tenantId, {
              baseUrl:  tenant!.oracleBaseUrl,
              username: tenant!.oracleUsername,
              password: tenant!.oraclePassword,
            });
            syncResult = await fetchOracleInvoiceStatus(oracle, inv.oracleInvoiceId);
          }

          const newStatus: Record<SyncedStatus, string> = {
            ORACLE_PROCESSING: "ORACLE_PROCESSING",
            APPROVED:          "APPROVED",
            PAID:              "PAID",
            CANCELLED:         "CANCELLED",
            ORACLE_ERROR:      "ORACLE_ERROR",
          };

          if (syncResult.status !== inv.status) {
            await ctx.db.invoice.update({
              where: { id: inv.id },
              data: {
                status:          newStatus[syncResult.status] as any,
                oracleStatus:    syncResult.oracleStatus,
                oracleHoldReason: syncResult.holdReason,
                oraclePaymentRef: syncResult.paymentRef,
                oracleApprovedAt: syncResult.approvedAt,
              },
            });

            await ctx.db.auditEvent.create({
              data: {
                tenantId,
                invoiceId: inv.id,
                actorType: "system",
                eventType: "invoice.oracle_status_synced",
                description: `Oracle status updated: ${inv.status} → ${syncResult.status}${syncResult.holdReason ? ` (hold: ${syncResult.holdReason})` : ""}`,
              },
            });

            if (syncResult.status === "ORACLE_ERROR" && syncResult.holdReason) {
              await ctx.db.exception.create({
                data: {
                  invoiceId:   inv.id,
                  type:        "ORACLE_IMPORT_ERROR",
                  severity:    "BLOCKING",
                  status:      "OPEN",
                  description: `Oracle placed invoice on hold: ${syncResult.holdReason}`,
                  aiSuggestion: "Review the hold reason in Oracle and take corrective action before resubmitting.",
                },
              });
            }

            results.push({ invoiceId: inv.id, from: inv.status, to: syncResult.status });
          }
        } catch (err) {
          console.error(`[sync] failed for invoice ${inv.id}:`, err);
        }
      }

      return { synced: results.length, results };
    }),

  // ── Poll Oracle ESS job status (managers only) ──────────────────────────────

  syncBatchStatus: managerProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const batch = await ctx.db.fBDIBatch.findFirst({
        where: { id: input.batchId, tenantId },
      });
      if (!batch || !batch.oracleJobId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found or no job ID" });
      }

      const tenant = await ctx.db.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant || !isOracleConfigured(tenant.oracleBaseUrl)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Oracle not configured" });
      }

      const oracle = getOracleClient(tenantId, {
        baseUrl:  tenant.oracleBaseUrl,
        username: tenant.oracleUsername,
        password: tenant.oraclePassword,
      });

      const jobStatus = await pollESSJobStatus(oracle, batch.oracleJobId);

      const newBatchStatus =
        jobStatus === "SUCCEEDED" ? "JOB_COMPLETED" :
        jobStatus === "FAILED"    ? "JOB_FAILED"    : "JOB_RUNNING";

      await ctx.db.fBDIBatch.update({
        where: { id: batch.id },
        data: {
          oracleJobStatus: jobStatus,
          status: newBatchStatus,
          ...(jobStatus === "SUCCEEDED" && { completedAt: new Date(), successCount: batch.invoiceCount }),
          ...(jobStatus === "FAILED"    && { completedAt: new Date(), failureCount: batch.invoiceCount }),
        },
      });

      if (jobStatus === "SUCCEEDED") {
        await ctx.db.invoice.updateMany({
          where: { fbdiBatchId: batch.id },
          data: { status: "ORACLE_PROCESSING" },
        });
      }

      return { jobStatus, batchStatus: newBatchStatus };
    }),
});
