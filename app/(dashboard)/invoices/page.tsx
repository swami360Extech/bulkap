"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { InvoiceStatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { type InvoiceStatus } from "@prisma/client";
import {
  Upload, Search, Filter, FileText, Trash2,
  ChevronLeft, ChevronRight, ArrowUpDown, Play, Send,
} from "lucide-react";
import { useRouter } from "next/navigation";

const INVOICE_TYPE_LABELS: Record<string, string> = {
  STANDARD_PO:         "Standard PO",
  NON_PO_SERVICE:      "Non-PO Service",
  CREDIT_MEMO:         "Credit Memo",
  DEBIT_MEMO:          "Debit Memo",
  PREPAYMENT:          "Prepayment",
  RECURRING:           "Recurring",
  FREIGHT:             "Freight",
  CAPITAL_EXPENDITURE: "Capital Expenditure",
  INTERCOMPANY:        "Intercompany",
  FOREIGN_CURRENCY:    "Foreign Currency",
  TAX_ONLY:            "Tax Only",
  UNKNOWN:             "Unknown",
};

const STATUS_OPTIONS: { value: InvoiceStatus | ""; label: string }[] = [
  { value: "",                    label: "All statuses" },
  { value: "RECEIVED",            label: "Received" },
  { value: "REVIEW_REQUIRED",     label: "Review Required" },
  { value: "VALIDATING",          label: "Validating" },
  { value: "READY_FOR_SUBMISSION",label: "Ready" },
  { value: "SUBMITTED",           label: "Submitted" },
  { value: "ORACLE_PROCESSING",   label: "Processing" },
  { value: "APPROVED",            label: "Approved" },
  { value: "PAID",                label: "Paid" },
  { value: "REJECTED",            label: "Rejected" },
  { value: "DUPLICATE",           label: "Duplicate" },
  { value: "ORACLE_ERROR",        label: "Oracle Error" },
];

export default function InvoicesPage() {
  const router = useRouter();
  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState<InvoiceStatus | "">("");
  const [page, setPage]       = useState(1);
  const [sortBy, setSortBy]   = useState<"receivedAt" | "dueDate" | "grossAmount">("receivedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const PROCESSING = new Set(["RECEIVED", "CLASSIFYING", "EXTRACTING", "VALIDATING"]);
  const { data, isLoading, refetch } = trpc.invoice.list.useQuery(
    { search: search || undefined, status: status || undefined, page, pageSize: 50, sortBy, sortDir },
    { refetchInterval: (query) => query.state.data?.invoices.some((i) => PROCESSING.has(i.status)) ? 3000 : false }
  );
  const deleteInvoice   = trpc.invoice.delete.useMutation({ onSuccess: () => refetch() });
  const runValidation   = trpc.invoice.runValidation.useMutation({ onSuccess: () => refetch() });

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!data) return;
    const allIds = data.invoices.map((i) => i.id);
    if (allIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  const invoices = data?.invoices ?? [];
  const allSelected = invoices.length > 0 && invoices.every((i) => selected.has(i.id));

  return (
    <>
      <TopBar
        title="Invoices"
        actions={
          <Link href="/invoices/upload">
            <Button size="sm">
              <Upload className="w-3.5 h-3.5" /> Upload
            </Button>
          </Link>
        }
      />

      <div className="flex-1 p-6 space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search vendor or invoice #"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value as InvoiceStatus | ""); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-slate-600">{selected.size} selected</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/submit")}
              >
                <Send className="w-3.5 h-3.5" /> Submit to Oracle
              </Button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Vendor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Invoice #</th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700"
                    onClick={() => toggleSort("grossAmount")}
                  >
                    <span className="flex items-center gap-1">Amount <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700"
                    onClick={() => toggleSort("receivedAt")}
                  >
                    <span className="flex items-center gap-1">Received <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700"
                    onClick={() => toggleSort("dueDate")}
                  >
                    <span className="flex items-center gap-1">Due <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Exceptions</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
                )}
                {!isLoading && invoices.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={<FileText className="w-12 h-12" />}
                        title="No invoices yet"
                        description="Upload your first batch of invoices to get started."
                        action={
                          <Link href="/invoices/upload">
                            <Button size="sm"><Upload className="w-3.5 h-3.5" /> Upload Invoices</Button>
                          </Link>
                        }
                      />
                    </td>
                  </tr>
                )}
                {invoices.map((inv) => {
                  const openExceptions = inv.exceptions?.length ?? 0;
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(inv.id)}
                          onChange={() => toggleSelect(inv.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {(() => {
                          const inv_ = inv as any;
                          const name = inv_.vendor?.name
                            ?? inv_.fields?.[0]?.confirmedValue
                            ?? inv_.fields?.[0]?.extractedValue;
                          return name ?? <span className="text-slate-400 italic">Unknown</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        <Link href={`/invoices/${inv.id}`} className="hover:text-blue-700 hover:underline">
                          {inv.externalInvoiceNum ?? inv.originalFilename ?? inv.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        {inv.grossAmount ? formatCurrency(Number(inv.grossAmount), inv.currency ?? "USD") : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {INVOICE_TYPE_LABELS[inv.invoiceType] ?? inv.invoiceType}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(inv.receivedAt)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {inv.dueDate ? (
                          <span className={new Date(inv.dueDate) < new Date() ? "text-red-600 font-medium" : ""}>
                            {formatDate(inv.dueDate)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3">
                        {openExceptions > 0 ? (
                          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-md">
                            {openExceptions} open
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {inv.status === "REVIEW_REQUIRED" && (
                            <button
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Run Validation"
                              onClick={() => runValidation.mutate({ invoiceId: inv.id })}
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!["SUBMITTED","ORACLE_PROCESSING","APPROVED","PAID"].includes(inv.status) && (
                            <Dialog>
                              <DialogTrigger asChild>
                                <button className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </DialogTrigger>
                              <DialogContent
                                title="Delete Invoice"
                                description={`Delete "${inv.externalInvoiceNum ?? inv.originalFilename ?? inv.id.slice(0,8)}"? This cannot be undone.`}
                              >
                                <div className="flex justify-end gap-2 mt-2">
                                  <Button variant="secondary">Cancel</Button>
                                  <Button
                                    variant="destructive"
                                    loading={deleteInvoice.isPending && deleteInvoice.variables?.invoiceId === inv.id}
                                    onClick={() => deleteInvoice.mutate({ invoiceId: inv.id })}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                {((page - 1) * 50) + 1}–{Math.min(page * 50, data.total)} of {data.total} invoices
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-700 px-2">Page {page} of {data.pages}</span>
                <button
                  disabled={page >= data.pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
