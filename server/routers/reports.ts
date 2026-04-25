import { z } from "zod";
import { router, protectedProcedure } from "@/server/trpc";
import type { InvoiceStatus } from "@prisma/client";

const EXCLUDED_STATUSES: InvoiceStatus[] = ["PAID", "CANCELLED", "REJECTED", "DUPLICATE"];

type AgingInvoice = {
  id: string;
  externalInvoiceNum: string | null;
  vendorName: string;
  currency: string;
  grossAmount: number;
  status: string;
  dueDate: Date | null;
  receivedAt: Date;
  daysPastDue: number | null;
};

type AgingBucket = { count: number; total: number; invoices: AgingInvoice[] };

function summarise(rows: AgingInvoice[]): AgingBucket {
  return {
    count:    rows.length,
    total:    rows.reduce((s, i) => s + i.grossAmount, 0),
    invoices: rows,
  };
}

export const reportsRouter = router({
  // ── AP Aging report ──────────────────────────────────────────────────────────
  aging: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.session.user.tenantId;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const raw = await ctx.db.invoice.findMany({
      where: { tenantId, status: { notIn: EXCLUDED_STATUSES } },
      include: { vendor: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 2000,
    });

    const invoices: AgingInvoice[] = raw.map((inv) => {
      const dpd = inv.dueDate
        ? Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000)
        : null;
      return {
        id:                 inv.id,
        externalInvoiceNum: inv.externalInvoiceNum,
        vendorName:         inv.vendor?.name ?? "Unknown",
        currency:           inv.currency ?? "USD",
        grossAmount:        Number(inv.grossAmount ?? 0),
        status:             inv.status,
        dueDate:            inv.dueDate,
        receivedAt:         inv.receivedAt,
        daysPastDue:        dpd,
      };
    });

    const current = invoices.filter((i) => i.daysPastDue === null || i.daysPastDue <= 0);
    const d1_30   = invoices.filter((i) => i.daysPastDue !== null && i.daysPastDue > 0  && i.daysPastDue <= 30);
    const d31_60  = invoices.filter((i) => i.daysPastDue !== null && i.daysPastDue > 30 && i.daysPastDue <= 60);
    const d61_90  = invoices.filter((i) => i.daysPastDue !== null && i.daysPastDue > 60 && i.daysPastDue <= 90);
    const d90plus = invoices.filter((i) => i.daysPastDue !== null && i.daysPastDue > 90);

    const totalOutstanding = invoices.reduce((s, i) => s + i.grossAmount, 0);

    return {
      asOf:        today.toISOString(),
      total:       invoices.length,
      outstanding: totalOutstanding,
      current:     summarise(current),
      d1_30:       summarise(d1_30),
      d31_60:      summarise(d31_60),
      d61_90:      summarise(d61_90),
      d90plus:     summarise(d90plus),
    };
  }),

  // ── CSV export ───────────────────────────────────────────────────────────────
  agingCsv: protectedProcedure.mutation(async ({ ctx }) => {
    const tenantId = ctx.session.user.tenantId;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const raw = await ctx.db.invoice.findMany({
      where: { tenantId, status: { notIn: EXCLUDED_STATUSES } },
      include: { vendor: { select: { name: true } }, businessUnit: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }, { receivedAt: "asc" }],
    });

    const header = [
      "Invoice #", "Vendor", "Business Unit", "Currency", "Amount",
      "Invoice Date", "Due Date", "Days Past Due", "Aging Bucket", "Status",
    ].join(",");

    const bucket = (dpd: number | null) => {
      if (dpd === null) return "No Due Date";
      if (dpd <= 0)     return "Current";
      if (dpd <= 30)    return "1-30 Days";
      if (dpd <= 60)    return "31-60 Days";
      if (dpd <= 90)    return "61-90 Days";
      return "90+ Days";
    };

    const rows = raw.map((inv) => {
      const dpd = inv.dueDate
        ? Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000)
        : null;
      const fmt = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return [
        fmt(inv.externalInvoiceNum ?? inv.id.slice(0, 8)),
        fmt(inv.vendor?.name ?? "Unknown"),
        fmt(inv.businessUnit?.name ?? "—"),
        inv.currency ?? "USD",
        Number(inv.grossAmount ?? 0).toFixed(2),
        inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : "",
        inv.dueDate     ? new Date(inv.dueDate).toISOString().slice(0, 10)     : "",
        dpd !== null && dpd > 0 ? dpd : "",
        bucket(dpd),
        inv.status,
      ].join(",");
    });

    return { csv: [header, ...rows].join("\r\n"), count: rows.length };
  }),

  // ── Invoice activity export ──────────────────────────────────────────────────
  activityCsv: protectedProcedure
    .input(z.object({
      dateFrom: z.date().optional(),
      dateTo:   z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const invoices = await ctx.db.invoice.findMany({
        where: {
          tenantId,
          ...(input.dateFrom && { receivedAt: { gte: input.dateFrom } }),
          ...(input.dateTo   && { receivedAt: { lte: input.dateTo   } }),
        },
        include: { vendor: { select: { name: true } } },
        orderBy: { receivedAt: "desc" },
        take: 5000,
      });

      const header = [
        "Invoice #", "Vendor", "Currency", "Amount", "Status",
        "Invoice Date", "Due Date", "Received At", "Validated At", "Submitted At",
        "Source", "Invoice Type",
      ].join(",");

      const fmt = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const rows = invoices.map((inv) => [
        fmt(inv.externalInvoiceNum ?? inv.id.slice(0, 8)),
        fmt(inv.vendor?.name ?? "Unknown"),
        inv.currency ?? "USD",
        Number(inv.grossAmount ?? 0).toFixed(2),
        inv.status,
        inv.invoiceDate  ? new Date(inv.invoiceDate).toISOString().slice(0, 10)  : "",
        inv.dueDate      ? new Date(inv.dueDate).toISOString().slice(0, 10)      : "",
        new Date(inv.receivedAt).toISOString().slice(0, 10),
        inv.validatedAt  ? new Date(inv.validatedAt).toISOString().slice(0, 10)  : "",
        inv.submittedAt  ? new Date(inv.submittedAt).toISOString().slice(0, 10)  : "",
        inv.sourceChannel,
        inv.invoiceType,
      ].join(","));

      return { csv: [header, ...rows].join("\r\n"), count: rows.length };
    }),
});
