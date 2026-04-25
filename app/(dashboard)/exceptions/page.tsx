"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { SeverityBadge, ExceptionStatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { ExceptionSeverity, ExceptionStatus, ExceptionType } from "@prisma/client";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Filter } from "lucide-react";

const SEVERITY_OPTIONS: { value: ExceptionSeverity | ""; label: string }[] = [
  { value: "",             label: "All severities" },
  { value: "BLOCKING",     label: "Blocking" },
  { value: "WARNING",      label: "Warning" },
  { value: "INFORMATIONAL",label: "Informational" },
];

const STATUS_OPTIONS: { value: ExceptionStatus | ""; label: string }[] = [
  { value: "",            label: "All statuses" },
  { value: "OPEN",        label: "Open" },
  { value: "IN_REVIEW",   label: "In Review" },
  { value: "RESOLVED",    label: "Resolved" },
  { value: "WAIVED",      label: "Waived" },
];

const TYPE_LABELS: Record<ExceptionType, string> = {
  DUPLICATE:                "Duplicate Invoice",
  CROSS_BU_DUPLICATE:       "Cross-BU Duplicate",
  PO_MISMATCH:              "PO Mismatch",
  PO_AMOUNT_EXCEEDED:       "PO Amount Exceeded",
  RECEIPT_PENDING:          "Receipt Not Created",
  GL_INVALID:               "Invalid GL Account",
  TAX_ERROR:                "Tax Code Error",
  BANK_ACCOUNT_CHANGE:      "Bank Account Change",
  AMOUNT_ANOMALY:           "Amount Anomaly",
  SUPPLIER_INACTIVE:        "Supplier Inactive",
  PERIOD_CLOSED:            "Period Closed",
  LOW_CONFIDENCE_EXTRACTION:"Low Confidence Extraction",
  ORACLE_IMPORT_ERROR:      "Oracle Import Error",
};

function ResolveDialog({ exceptionId, onSuccess }: { exceptionId: string; onSuccess: () => void }) {
  const [action, setAction] = useState("");
  const [open, setOpen] = useState(false);
  const resolve = trpc.exception.resolve.useMutation({ onSuccess: () => { setOpen(false); onSuccess(); } });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Resolve</Button>
      </DialogTrigger>
      <DialogContent title="Resolve Exception" description="Describe the action taken to resolve this exception.">
        <textarea
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="e.g. Contacted vendor to correct invoice, receipt created, PO amended…"
          rows={4}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={action.length < 5}
            loading={resolve.isPending}
            onClick={() => resolve.mutate({ exceptionId, resolutionAction: action, releaseHold: true })}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Mark Resolved
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WaiveDialog({ exceptionId, onSuccess }: { exceptionId: string; onSuccess: () => void }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const waive = trpc.exception.waive.useMutation({ onSuccess: () => { setOpen(false); onSuccess(); } });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">Waive</Button>
      </DialogTrigger>
      <DialogContent title="Waive Exception" description="Provide a business justification (minimum 10 characters).">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Approved by CFO — one-time exception for strategic vendor…"
          rows={3}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="secondary"
            disabled={reason.length < 10}
            loading={waive.isPending}
            onClick={() => waive.mutate({ exceptionId, waivedReason: reason })}
          >
            Waive Exception
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TYPE_OPTIONS: { value: ExceptionType | ""; label: string }[] = [
  { value: "", label: "All types" },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value: value as ExceptionType, label })),
];

export default function ExceptionsPage() {
  const [severity, setSeverity] = useState<ExceptionSeverity | "">("");
  const [status,   setStatus]   = useState<ExceptionStatus | "">("");
  const [type,     setType]     = useState<ExceptionType | "">("");
  const [page, setPage] = useState(1);

  const { data: counts } = trpc.exception.counts.useQuery();
  const { data, isLoading, refetch } = trpc.exception.list.useQuery({
    severity: severity || undefined,
    status:   status   || undefined,
    type:     type     || undefined,
    page,
    pageSize: 50,
  });

  const exceptions = data?.exceptions ?? [];

  return (
    <>
      <TopBar title="Exceptions" />

      <div className="flex-1 p-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Blocking",      count: counts?.blocking ?? 0,      color: "text-red-600",   bg: "bg-red-50",   border: "border-red-200" },
            { label: "Warnings",      count: counts?.warning ?? 0,       color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
            { label: "Informational", count: counts?.informational ?? 0, color: "text-blue-600",  bg: "bg-blue-50",  border: "border-blue-200" },
          ].map(({ label, count, color, bg, border }) => (
            <div key={label} className={`${bg} border ${border} rounded-xl p-4`}>
              <p className={`text-2xl font-bold ${color}`}>{count}</p>
              <p className="text-xs text-slate-600 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={severity}
            onChange={(e) => { setSeverity(e.target.value as ExceptionSeverity | ""); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as ExceptionStatus | ""); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={type}
            onChange={(e) => { setType(e.target.value as ExceptionType | ""); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Exception cards */}
        <div className="space-y-3">
          {isLoading && <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>}
          {!isLoading && exceptions.length === 0 && (
            <EmptyState
              icon={<AlertTriangle className="w-12 h-12" />}
              title="No exceptions found"
              description="Great — no open exceptions matching your filters."
            />
          )}
          {exceptions.map((ex) => (
            <div
              key={ex.id}
              className={`bg-white rounded-xl border p-4 ${
                ex.severity === "BLOCKING" ? "border-red-200" :
                ex.severity === "WARNING"  ? "border-amber-200" : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${
                    ex.severity === "BLOCKING" ? "text-red-500" :
                    ex.severity === "WARNING"  ? "text-amber-500" : "text-blue-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        {TYPE_LABELS[ex.type]}
                      </span>
                      <SeverityBadge severity={ex.severity} />
                      <ExceptionStatusBadge status={ex.status} />
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{ex.description}</p>

                    {ex.aiSuggestion && (
                      <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
                        <span className="font-semibold">AI suggestion:</span> {ex.aiSuggestion}
                      </div>
                    )}

                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                      {ex.invoice && (
                        <Link href={`/invoices/${ex.invoiceId}`} className="hover:text-blue-600 hover:underline">
                          {ex.invoice.vendor?.name ?? "Unknown vendor"} · {ex.invoice.externalInvoiceNum ?? ex.invoiceId?.slice(0, 8)}
                          {ex.invoice.grossAmount && ` · ${formatCurrency(Number(ex.invoice.grossAmount))}`}
                        </Link>
                      )}
                      <span>{formatDate(ex.createdAt)}</span>
                      {ex.assignedUser && <span>Assigned to {ex.assignedUser.name}</span>}
                    </div>

                    {ex.oracleHoldName && (
                      <p className="text-xs text-slate-500 mt-1">
                        Oracle hold: <span className="font-medium">{ex.oracleHoldName}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions — only for open/in-review */}
                {(ex.status === "OPEN" || ex.status === "IN_REVIEW") && (
                  <div className="flex items-center gap-2 shrink-0">
                    <ResolveDialog exceptionId={ex.id} onSuccess={() => refetch()} />
                    <WaiveDialog   exceptionId={ex.id} onSuccess={() => refetch()} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {data && data.total > 50 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{data.total} exceptions total</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-700 px-2">Page {page} of {data.pages}</span>
              <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
