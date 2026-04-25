import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "@/server/trpc";
import { InvoiceStatus, InvoiceType, SourceChannel } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { runValidationPipeline } from "@/server/services/extraction/validation-pipeline";

export const invoiceRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.nativeEnum(InvoiceStatus).optional(),
        vendorId: z.string().uuid().optional(),
        invoiceType: z.nativeEnum(InvoiceType).optional(),
        buId: z.string().uuid().optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(500).default(50),
        sortBy: z
          .enum(["receivedAt", "dueDate", "grossAmount", "status"])
          .default("receivedAt"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const { page, pageSize, sortBy, sortDir, search, ...filters } = input;

      const where = {
        tenantId,
        ...(filters.status && { status: filters.status }),
        ...(filters.vendorId && { vendorId: filters.vendorId }),
        ...(filters.invoiceType && { invoiceType: filters.invoiceType }),
        ...(filters.buId && { buId: filters.buId }),
        ...(filters.dateFrom && { receivedAt: { gte: filters.dateFrom } }),
        ...(filters.dateTo && { receivedAt: { lte: filters.dateTo } }),
        ...(search && {
          OR: [
            { externalInvoiceNum: { contains: search, mode: "insensitive" as const } },
            { vendor: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }),
      };

      const [invoices, total] = await Promise.all([
        ctx.db.invoice.findMany({
          where,
          include: {
            vendor:     { select: { name: true } },
            exceptions: { where: { status: "OPEN" } },
            fields:     { where: { fieldName: "vendor_name" }, select: { extractedValue: true, confirmedValue: true } },
          },
          orderBy: { [sortBy]: sortDir },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        ctx.db.invoice.count({ where }),
      ]);

      return { invoices, total, pages: Math.ceil(total / pageSize) };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.id, tenantId: ctx.session.user.tenantId },
        include: {
          vendor: true,
          businessUnit: true,
          fields: { orderBy: { fieldName: "asc" } },
          lines: { orderBy: { lineNumber: "asc" } },
          validations: { orderBy: { checkedAt: "desc" } },
          exceptions: { include: { assignedUser: { select: { name: true, email: true } } } },
          auditEvents: { orderBy: { createdAt: "desc" }, take: 50 },
        },
      });

      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
      return invoice;
    }),

  confirmFields: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        fields: z.array(z.object({ fieldName: z.string(), confirmedValue: z.string() })),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, tenantId: ctx.session.user.tenantId },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

      await Promise.all(
        input.fields.map((f) =>
          ctx.db.invoiceField.update({
            where: { invoiceId_fieldName: { invoiceId: input.invoiceId, fieldName: f.fieldName } },
            data: {
              confirmedValue: f.confirmedValue,
              confirmedAt: new Date(),
              confirmedBy: ctx.session.user.id,
              manuallyReviewed: true,
            },
          })
        )
      );

      await ctx.db.auditEvent.create({
        data: {
          tenantId: ctx.session.user.tenantId,
          invoiceId: input.invoiceId,
          actorType: "user",
          actorId: ctx.session.user.id,
          eventType: "invoice.fields_confirmed",
          description: `${input.fields.length} fields confirmed by ${ctx.session.user.name}`,
        },
      });

      return { success: true };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        status: z.nativeEnum(InvoiceStatus),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, tenantId: ctx.session.user.tenantId },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

      const updated = await ctx.db.invoice.update({
        where: { id: input.invoiceId },
        data: { status: input.status, updatedAt: new Date() },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId: ctx.session.user.tenantId,
          invoiceId: input.invoiceId,
          actorType: "user",
          actorId: ctx.session.user.id,
          eventType: "invoice.status_changed",
          description: `Status changed to ${input.status}`,
          beforeState: { status: invoice.status },
          afterState: { status: input.status },
        },
      });

      return updated;
    }),

  // Advance a REVIEW_REQUIRED invoice back into the validation pipeline
  runValidation: protectedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, tenantId: ctx.session.user.tenantId, status: "REVIEW_REQUIRED" },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found or not in REVIEW_REQUIRED status" });

      await ctx.db.invoice.update({ where: { id: input.invoiceId }, data: { status: "VALIDATING" } });

      await ctx.db.auditEvent.create({
        data: {
          tenantId: ctx.session.user.tenantId,
          invoiceId: input.invoiceId,
          actorType: "user",
          actorId: ctx.session.user.id,
          eventType: "invoice.validation_triggered",
          description: `Validation re-triggered by ${ctx.session.user.name} after field review`,
        },
      });

      runValidationPipeline(input.invoiceId).catch((err) =>
        console.error(`[validation] re-trigger failed for ${input.invoiceId}:`, err)
      );

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, tenantId: ctx.session.user.tenantId },
      });
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

      const submittedStatuses: InvoiceStatus[] = ["SUBMITTED", "ORACLE_PROCESSING", "APPROVED", "PAID"];
      if (submittedStatuses.includes(invoice.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete a submitted invoice" });
      }

      await ctx.db.invoice.delete({ where: { id: input.invoiceId } });
      return { success: true };
    }),

  pipelineCounts: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.session.user.tenantId;
    const counts = await ctx.db.invoice.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { status: true },
    });
    return Object.fromEntries(counts.map((c) => [c.status, c._count.status])) as Record<InvoiceStatus, number>;
  }),

  // 7-day daily throughput for dashboard trend chart
  trend: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.session.user.tenantId;
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - 6); // last 7 days inclusive

    const invoices = await ctx.db.invoice.findMany({
      where: { tenantId, receivedAt: { gte: from } },
      select: { receivedAt: true, validatedAt: true, submittedAt: true, status: true },
    });

    const POST_VALIDATION = new Set(["READY_FOR_SUBMISSION","SUBMITTING","SUBMITTED","ORACLE_PROCESSING","APPROVED","PAID"]);
    const POST_SUBMISSION  = new Set(["SUBMITTED","ORACLE_PROCESSING","APPROVED","PAID"]);

    const result = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(from);
      day.setUTCDate(from.getUTCDate() + i);
      const dayEnd = new Date(day);
      dayEnd.setUTCDate(day.getUTCDate() + 1);

      const dayInvoices = invoices.filter((inv) => {
        const d = new Date(inv.receivedAt);
        return d >= day && d < dayEnd;
      });

      result.push({
        date:      day.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
        received:  dayInvoices.length,
        validated: dayInvoices.filter((i) => POST_VALIDATION.has(i.status)).length,
        submitted: dayInvoices.filter((i) => POST_SUBMISSION.has(i.status)).length,
      });
    }
    return result;
  }),

  metrics: protectedProcedure
    .input(z.object({ dateFrom: z.date(), dateTo: z.date() }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const where = { tenantId, receivedAt: { gte: input.dateFrom, lte: input.dateTo } };

      const [total, autoProcessed, openExceptions, earlyPay] = await Promise.all([
        ctx.db.invoice.count({ where }),
        ctx.db.invoice.count({ where: { ...where, reviewRequired: false } }),
        ctx.db.exception.count({ where: { invoice: { tenantId }, status: "OPEN" } }),
        ctx.db.invoice.findMany({
          where: {
            ...where,
            earlyPayDiscountDate: { gte: new Date() },
            earlyPayDiscountPct: { not: null },
            status: { in: ["READY_FOR_SUBMISSION", "SUBMITTED", "ORACLE_PROCESSING"] },
          },
          select: { grossAmount: true, earlyPayDiscountPct: true },
        }),
      ]);

      const earlyPayOpportunity = earlyPay.reduce((sum, inv) => {
        const amount = Number(inv.grossAmount ?? 0);
        const pct = Number(inv.earlyPayDiscountPct ?? 0);
        return sum + amount * pct;
      }, 0);

      return {
        totalReceived: total,
        straightThroughRate: total > 0 ? autoProcessed / total : 0,
        exceptionsOpen: openExceptions,
        earlyPayOpportunity,
      };
    }),
});
