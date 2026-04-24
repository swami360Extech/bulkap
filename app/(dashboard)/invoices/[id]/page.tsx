"use client";

import { use } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { InvoiceStatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExtractionCard, LineItemsCard, ValidationCard,
  ExceptionsCard, AuditCard, OracleCard,
} from "@/components/invoice/InvoiceDetailPanels";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";
import { ChevronLeft, Zap } from "lucide-react";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: invoice, isLoading } = trpc.invoice.byId.useQuery({ id });

  if (isLoading) {
    return (
      <>
        <TopBar title="Invoice Detail" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-slate-400">Loading…</p>
        </div>
      </>
    );
  }

  if (!invoice) {
    return (
      <>
        <TopBar title="Invoice Detail" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-red-500">Invoice not found.</p>
        </div>
      </>
    );
  }

  const currency = invoice.currency ?? "USD";

  // Cast to plain object to break the deep Prisma+tRPC generic inference chain
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = invoice as any;

  const fields = (raw.fields as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id),
    fieldName: String(f.fieldName),
    extractedValue: f.extractedValue != null ? String(f.extractedValue) : null,
    confirmedValue: f.confirmedValue != null ? String(f.confirmedValue) : null,
    confidence: Number(f.confidence),
    manuallyReviewed: Boolean(f.manuallyReviewed),
  }));

  const lines = (raw.lines as Array<Record<string, unknown>>).map((l) => ({
    id: String(l.id),
    lineNumber: Number(l.lineNumber),
    description: l.description != null ? String(l.description) : null,
    quantity: l.quantity != null ? String(l.quantity) : null,
    unitPrice: l.unitPrice != null ? String(l.unitPrice) : null,
    lineAmount: String(l.lineAmount),
    matchStatus: l.matchStatus != null ? String(l.matchStatus) : null,
  }));

  const validations = (raw.validations as Array<Record<string, unknown>>).map((v) => ({
    id: String(v.id),
    result: String(v.result),
    check: String(v.check),
    message: v.message != null ? String(v.message) : null,
  }));

  const exceptions = (raw.exceptions as Array<Record<string, unknown>>).map((e) => ({
    id: String(e.id),
    type: String(e.type),
    severity: String(e.severity),
    description: String(e.description),
    aiSuggestion: e.aiSuggestion != null ? String(e.aiSuggestion) : null,
    oracleHoldName: e.oracleHoldName != null ? String(e.oracleHoldName) : null,
    status: String(e.status),
    assignedUser: e.assignedUser as { name: string; email: string } | null,
  }));

  const auditEvents = (raw.auditEvents as Array<Record<string, unknown>>).map((a) => ({
    id: String(a.id),
    description: String(a.description),
    createdAt: a.createdAt as Date | string,
  }));

  return (
    <>
      <TopBar
        title={invoice.externalInvoiceNum ?? invoice.id.slice(0, 8)}
        actions={
          <div className="flex items-center gap-2">
            <InvoiceStatusBadge status={invoice.status} />
            {invoice.status === "READY_FOR_SUBMISSION" && (
              <Button size="sm">Submit to Oracle</Button>
            )}
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        <Link href="/invoices" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to invoices
        </Link>

        {/* Early pay alert */}
        {invoice.earlyPayDiscountDate && invoice.earlyPayDiscountPct && (
          <div className="flex items-center gap-3 px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl">
            <Zap className="w-4 h-4 text-violet-600 shrink-0" />
            <p className="text-sm text-violet-700">
              <span className="font-semibold text-violet-900">Early pay discount: </span>
              {formatPercent(Number(invoice.earlyPayDiscountPct))} if paid by {formatDate(invoice.earlyPayDiscountDate)}.
              Save {formatCurrency(Number(invoice.grossAmount ?? 0) * Number(invoice.earlyPayDiscountPct), currency)}.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left — main content */}
          <div className="lg:col-span-2 space-y-5">
            {/* Summary */}
            <Card>
              <CardHeader><CardTitle>Invoice Summary</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {([
                    ["Vendor",        invoice.vendor?.name ?? "—"],
                    ["Invoice #",     invoice.externalInvoiceNum ?? "—"],
                    ["Invoice Date",  formatDate(invoice.invoiceDate ?? null)],
                    ["Due Date",      formatDate(invoice.dueDate ?? null)],
                    ["Currency",      currency],
                    ["Payment Terms", invoice.paymentTerms ?? "—"],
                    ["PO Reference",  invoice.poNumber ?? "—"],
                    ["Source",        invoice.sourceChannel.replace(/_/g, " ")],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-sm font-medium text-slate-900 mt-0.5">{value}</p>
                    </div>
                  ))}
                  <div className="col-span-2 pt-3 border-t border-slate-100 grid grid-cols-3 gap-4">
                    {([
                      ["Net Amount",   formatCurrency(Number(invoice.netAmount ?? 0), currency)],
                      ["Tax Amount",   formatCurrency(Number(invoice.taxAmount ?? 0), currency)],
                      ["Gross Amount", formatCurrency(Number(invoice.grossAmount ?? 0), currency)],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="text-sm font-bold text-slate-900 mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <ExtractionCard fields={fields} avgConf={invoice.extractionAvgConf ?? 0} />
            <LineItemsCard  lines={lines} currency={currency} />
          </div>

          {/* Right — status panels */}
          <div className="space-y-5">
            <ValidationCard  validations={validations} />
            <ExceptionsCard  exceptions={exceptions} />
            <AuditCard       events={auditEvents} />
            {invoice.oracleInvoiceId && <OracleCard data={invoice} />}
          </div>
        </div>
      </div>
    </>
  );
}
