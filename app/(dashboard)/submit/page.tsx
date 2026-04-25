"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  Send, CheckCircle2, AlertTriangle, FileText,
  ChevronLeft, ChevronRight, Download, RefreshCw,
} from "lucide-react";

const BATCH_STATUS_LABELS: Record<string, string> = {
  ASSEMBLING:       "Assembling",
  UPLOADED_TO_UCM:  "Uploaded to UCM",
  JOB_SUBMITTED:    "Job Submitted",
  JOB_RUNNING:      "Running",
  JOB_COMPLETED:    "Completed",
  JOB_FAILED:       "Failed",
  PARTIALLY_FAILED: "Partial Failure",
};

const BATCH_STATUS_COLOR: Record<string, string> = {
  JOB_COMPLETED:  "text-emerald-700 bg-emerald-50 border-emerald-200",
  JOB_FAILED:     "text-red-700 bg-red-50 border-red-200",
  JOB_RUNNING:    "text-blue-700 bg-blue-50 border-blue-200",
  JOB_SUBMITTED:  "text-blue-700 bg-blue-50 border-blue-200",
  ASSEMBLING:     "text-slate-700 bg-slate-50 border-slate-200",
  UPLOADED_TO_UCM:"text-violet-700 bg-violet-50 border-violet-200",
  PARTIALLY_FAILED:"text-amber-700 bg-amber-50 border-amber-200",
};

export default function SubmitPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successBatchId, setSuccessBatchId] = useState<string | null>(null);
  const [batchPage, setBatchPage] = useState(1);

  const { data: ready, refetch: refetchReady } = trpc.submission.readyInvoices.useQuery({});
  const { data: batchData, refetch: refetchBatches } = trpc.submission.batches.useQuery({
    page: batchPage, pageSize: 10,
  });

  const submitBatch = trpc.submission.submitBatch.useMutation({
    onSuccess: (result) => {
      setConfirmOpen(false);
      setSelectedIds(new Set());
      setSuccessBatchId(result.batchId);
      refetchReady();
      refetchBatches();
    },
  });

  const syncStatus = trpc.submission.syncBatchStatus.useMutation({
    onSuccess: () => refetchBatches(),
  });

  const generateFBDI = trpc.submission.generateFBDI.useMutation({
    onSuccess: (data) => {
      // Trigger CSV download in the browser
      const blob = new Blob(
        [`=== AP_INVOICES_INTERFACE ===\n${data.headerCsv}\n\n=== AP_INVOICE_LINES_INTERFACE ===\n${data.linesCsv}`],
        { type: "text/csv" }
      );
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url;
      a.download = `APINVOICES_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const invoices = ready?.invoices ?? [];
  const allSelected = invoices.length > 0 && invoices.every((i) => selectedIds.has(i.id));

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(invoices.map((i) => i.id)));
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedInvoices = invoices.filter((i) => selectedIds.has(i.id));
  const selectedTotal    = selectedInvoices.reduce((s, i) => s + Number(i.grossAmount ?? 0), 0);

  const kpis = useMemo(() => ({
    count:   invoices.length,
    total:   ready?.total ?? 0,
    vendors: new Set(invoices.map((i) => i.vendorId).filter(Boolean)).size,
  }), [invoices, ready]);

  return (
    <>
      <TopBar title="Submit to Oracle" />

      <div className="flex-1 p-6 space-y-5">

        {/* Success banner */}
        {successBatchId && (
          <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-800">
                Batch {successBatchId.slice(0, 8).toUpperCase()} submitted successfully
              </span>
            </div>
            <button onClick={() => setSuccessBatchId(null)} className="text-xs text-emerald-600 hover:underline">Dismiss</button>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Ready for Submission", value: kpis.count,              color: "text-blue-600",   bg: "bg-blue-50",   icon: <FileText className="w-4 h-4 text-blue-600" /> },
            { label: "Total Invoice Value",  value: formatCurrency(kpis.total), color: "text-emerald-600", bg: "bg-emerald-50", icon: <Send className="w-4 h-4 text-emerald-600" /> },
            { label: "Unique Vendors",       value: kpis.vendors,             color: "text-violet-600", bg: "bg-violet-50", icon: <CheckCircle2 className="w-4 h-4 text-violet-600" /> },
          ].map(({ label, value, color, bg, icon }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium">{label}</span>
                <div className={`${bg} rounded-lg p-1.5`}>{icon}</div>
              </div>
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Invoice selection table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Ready for Submission</h2>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs text-slate-500">
                    {selectedIds.size} selected · {formatCurrency(selectedTotal)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => generateFBDI.mutate({ invoiceIds: [...selectedIds] })}
                    loading={generateFBDI.isPending}
                  >
                    <Download className="w-3.5 h-3.5" /> Download FBDI
                  </Button>
                  <Button size="sm" onClick={() => setConfirmOpen(true)}>
                    <Send className="w-3.5 h-3.5" /> Submit {selectedIds.size} Invoice{selectedIds.size > 1 ? "s" : ""}
                  </Button>
                </>
              )}
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="px-4 py-3 text-left font-semibold">Invoice #</th>
                <th className="px-4 py-3 text-left font-semibold">Vendor</th>
                <th className="px-4 py-3 text-left font-semibold">Business Unit</th>
                <th className="px-4 py-3 text-left font-semibold">Invoice Date</th>
                <th className="px-4 py-3 text-left font-semibold">Due Date</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<CheckCircle2 className="w-12 h-12" />}
                      title="No invoices ready"
                      description="Invoices that pass all validations will appear here."
                    />
                  </td>
                </tr>
              )}
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className={`cursor-pointer transition-colors ${selectedIds.has(inv.id) ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                  onClick={() => toggle(inv.id)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(inv.id)}
                      onChange={() => toggle(inv.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-medium text-blue-700 hover:underline font-mono text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {inv.externalInvoiceNum ?? inv.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{inv.vendor?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{inv.businessUnit?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {inv.grossAmount != null ? formatCurrency(Number(inv.grossAmount), inv.currency ?? "USD") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Batch history */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Submission History</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!batchData?.batches?.length ? (
              <p className="px-5 py-6 text-xs text-slate-400 italic text-center">No batches submitted yet.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-xs text-slate-500 uppercase tracking-wide">
                      <th className="px-5 py-2.5 text-left font-semibold">Batch ID</th>
                      <th className="px-5 py-2.5 text-left font-semibold">Status</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Invoices</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Success</th>
                      <th className="px-5 py-2.5 text-left font-semibold">Submitted</th>
                      <th className="px-5 py-2.5 text-left font-semibold">Completed</th>
                      <th className="px-5 py-2.5 text-right font-semibold w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchData.batches.map((batch) => (
                      <tr key={batch.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-mono text-xs text-slate-700">
                          {batch.id.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${BATCH_STATUS_COLOR[batch.status] ?? "text-slate-700 bg-slate-50 border-slate-200"}`}>
                            {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700">{batch.invoiceCount}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={batch.failureCount > 0 ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>
                            {batch.successCount}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {batch.submittedAt ? formatDate(batch.submittedAt) : "—"}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {batch.completedAt ? formatDate(batch.completedAt) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {batch.oracleJobId && batch.status === "JOB_SUBMITTED" && (
                            <button
                              onClick={() => syncStatus.mutate({ batchId: batch.id })}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                              title="Sync Oracle status"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.isPending ? "animate-spin" : ""}`} />
                            </button>
                          )}
                          {batch.status === "JOB_FAILED" && batch.errorLog && (
                            <span title={batch.errorLog}>
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {batchData.total > 10 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200">
                    <span className="text-xs text-slate-500">{batchData.total} batches total</span>
                    <div className="flex items-center gap-1">
                      <button disabled={batchPage <= 1} onClick={() => setBatchPage((p) => p - 1)}
                        className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-xs text-slate-700 px-2">Page {batchPage} of {batchData.pages}</span>
                      <button disabled={batchPage >= batchData.pages} onClick={() => setBatchPage((p) => p + 1)}
                        className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Submit confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title="Submit to Oracle"
          description={`Submit ${selectedIds.size} invoice${selectedIds.size > 1 ? "s" : ""} totalling ${formatCurrency(selectedTotal)} to Oracle Fusion AP?`}
        >
          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
            {selectedInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100">
                <span className="font-mono text-slate-600">{inv.externalInvoiceNum ?? inv.id.slice(0,8)}</span>
                <span className="text-slate-500">{inv.vendor?.name}</span>
                <span className="font-semibold text-slate-900">
                  {inv.grossAmount != null ? formatCurrency(Number(inv.grossAmount), inv.currency ?? "USD") : "—"}
                </span>
              </div>
            ))}
          </div>
          {submitBatch.isError && (
            <p className="mt-3 text-xs text-red-600 bg-red-50 rounded px-3 py-2">
              {submitBatch.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              loading={submitBatch.isPending}
              onClick={() => submitBatch.mutate({ invoiceIds: [...selectedIds] })}
            >
              <Send className="w-3.5 h-3.5" /> Confirm Submission
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
