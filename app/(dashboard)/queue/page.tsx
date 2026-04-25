"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  Inbox, Clock, AlertTriangle, Play, CheckCircle2, BellOff,
  CornerUpLeft, ChevronLeft, ChevronRight, ExternalLink,
} from "lucide-react";

type QueueItemStatus = "UNASSIGNED" | "ASSIGNED" | "IN_PROGRESS" | "SNOOZED" | "ON_HOLD" | "COMPLETED" | "ESCALATED" | "RETURNED";
type QueuePriority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

const PRIORITY_BADGE: Record<QueuePriority, string> = {
  CRITICAL: "bg-red-100 text-red-700 border border-red-200",
  HIGH:     "bg-orange-100 text-orange-700 border border-orange-200",
  NORMAL:   "bg-blue-100 text-blue-700 border border-blue-200",
  LOW:      "bg-slate-100 text-slate-600 border border-slate-200",
};

const STATUS_BADGE: Record<string, string> = {
  UNASSIGNED:  "bg-slate-100 text-slate-500",
  ASSIGNED:    "bg-sky-100 text-sky-700",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700",
  SNOOZED:     "bg-yellow-100 text-yellow-700",
  ON_HOLD:     "bg-amber-100 text-amber-700",
  ESCALATED:   "bg-red-100 text-red-700",
  COMPLETED:   "bg-green-100 text-green-700",
  RETURNED:    "bg-slate-100 text-slate-500",
};

function formatTat(ms: number | null | undefined): string {
  if (!ms) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function SlaTag({ slaDeadline, slaBreached }: { slaDeadline?: Date | string | null; slaBreached?: boolean }) {
  if (!slaDeadline) return <span className="text-slate-300">—</span>;
  const deadline = new Date(slaDeadline);
  const now = new Date();
  const minsLeft = Math.floor((deadline.getTime() - now.getTime()) / 60_000);

  if (slaBreached || minsLeft <= 0) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-md">
        <AlertTriangle className="w-3 h-3" /> SLA breached
      </span>
    );
  }
  if (minsLeft <= 120) {
    const display = minsLeft < 60 ? `${minsLeft}m` : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`;
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md">
        <Clock className="w-3 h-3" /> {display} left
      </span>
    );
  }
  const hrs = Math.floor(minsLeft / 60);
  const display = hrs < 24 ? `${hrs}h left` : `${Math.floor(hrs / 24)}d left`;
  return <span className="text-xs text-slate-400">{display}</span>;
}

export default function MyQueuePage() {
  const [page, setPage] = useState(1);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [returnId, setReturnId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");

  const { data, isLoading, refetch } = trpc.queue.myItems.useQuery(
    { page, pageSize: 20 },
    { refetchInterval: 30_000 }
  );
  const { data: stats } = trpc.queue.stats.useQuery(undefined, { refetchInterval: 30_000 });

  const claim     = trpc.queue.claim.useMutation({ onSuccess: () => refetch() });
  const start     = trpc.queue.start.useMutation({ onSuccess: () => refetch() });
  const complete  = trpc.queue.complete.useMutation({ onSuccess: () => refetch() });
  const snooze    = trpc.queue.snooze.useMutation({ onSuccess: () => { setSnoozeId(null); refetch(); } });
  const returnItem = trpc.queue.returnItem.useMutation({ onSuccess: () => { setReturnId(null); refetch(); } });

  const items = data?.items ?? [];

  return (
    <>
      <TopBar
        title="My Queue"
        actions={
          <Link href="/queue/manage">
            <Button variant="outline" size="sm">Manage All</Button>
          </Link>
        }
      />

      <div className="flex-1 p-6 space-y-4">
        {/* Summary cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">My Open</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{stats.myOpen}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">SLA Overdue</p>
              <p className={`text-2xl font-bold mt-1 ${stats.myOverdue > 0 ? "text-red-600" : "text-slate-900"}`}>
                {stats.myOverdue}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Avg TAT</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{formatTat(stats.avgTatMs)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Unassigned (all)</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {(stats.byStatus as Record<string, number>)["UNASSIGNED"] ?? 0}
              </p>
            </div>
          </div>
        )}

        {/* Queue table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Invoice</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">SLA</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <Inbox className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-500">Your queue is empty</p>
                    <p className="text-xs text-slate-400 mt-1">New assignments will appear here automatically</p>
                  </td>
                </tr>
              )}
              {items.map((item) => {
                const inv = item.invoice as any;
                const vendorName = inv?.vendor?.name
                  ?? inv?.fields?.[0]?.confirmedValue
                  ?? inv?.fields?.[0]?.extractedValue
                  ?? "Unknown";
                const invoiceRef = inv?.externalInvoiceNum ?? inv?.originalFilename ?? item.invoiceId.slice(0, 8);

                return (
                  <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${item.slaBreached ? "bg-red-50/30" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/invoices/${item.invoiceId}`} className="font-mono text-xs text-blue-600 hover:underline flex items-center gap-1">
                        {invoiceRef} <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 max-w-[160px] truncate">{vendorName}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {inv?.grossAmount ? formatCurrency(Number(inv.grossAmount), inv.currency ?? "USD") : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{item.queueType}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${PRIORITY_BADGE[item.priority as QueuePriority]}`}>
                        {item.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <SlaTag slaDeadline={item.slaDeadline} slaBreached={item.slaBreached} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${STATUS_BADGE[item.status] ?? ""}`}>
                        {item.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {item.status === "UNASSIGNED" && (
                          <button
                            title="Claim"
                            onClick={() => claim.mutate({ itemId: item.id })}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                          >
                            <Inbox className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {item.status === "ASSIGNED" && (
                          <button
                            title="Start working"
                            onClick={() => start.mutate({ itemId: item.id })}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(item.status === "ASSIGNED" || item.status === "IN_PROGRESS") && (
                          <>
                            <button
                              title="Mark complete"
                              onClick={() => complete.mutate({ itemId: item.id })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title="Snooze"
                              onClick={() => { setSnoozeId(item.id); setSnoozeUntil(""); setSnoozeReason(""); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-600 hover:bg-yellow-50 transition-colors"
                            >
                              <BellOff className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title="Return to pool"
                              onClick={() => { setReturnId(item.id); setReturnReason(""); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                            >
                              <CornerUpLeft className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {data && data.total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                {((page - 1) * 20) + 1}–{Math.min(page * 20, data.total)} of {data.total} items
              </span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-700 px-2">Page {page} of {data.pages}</span>
                <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Snooze modal */}
      {snoozeId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-semibold text-slate-900">Snooze item</h3>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium">Snooze until</label>
              <input
                type="datetime-local"
                value={snoozeUntil}
                onChange={(e) => setSnoozeUntil(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium">Reason</label>
              <input
                type="text"
                value={snoozeReason}
                onChange={(e) => setSnoozeReason(e.target.value)}
                placeholder="Waiting for vendor response…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSnoozeId(null)}>Cancel</Button>
              <Button
                disabled={!snoozeUntil || !snoozeReason}
                loading={snooze.isPending}
                onClick={() => snooze.mutate({ itemId: snoozeId, until: new Date(snoozeUntil).toISOString(), reason: snoozeReason })}
              >
                Snooze
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Return modal */}
      {returnId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-semibold text-slate-900">Return to pool</h3>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium">Reason</label>
              <input
                type="text"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Outside my expertise, reassign to senior"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReturnId(null)}>Cancel</Button>
              <Button
                disabled={returnReason.length < 3}
                loading={returnItem.isPending}
                onClick={() => returnItem.mutate({ itemId: returnId, reason: returnReason })}
              >
                Return
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
