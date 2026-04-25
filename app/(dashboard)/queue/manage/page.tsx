"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import {
  AlertTriangle, Clock, Users, RefreshCw, BarChart2,
  ChevronLeft, ChevronRight, ExternalLink, Zap,
} from "lucide-react";

type QueuePriority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
type QueueType = "REVIEW" | "EXCEPTION" | "APPROVAL";

const PRIORITY_BADGE: Record<QueuePriority, string> = {
  CRITICAL: "bg-red-100 text-red-700",
  HIGH:     "bg-orange-100 text-orange-700",
  NORMAL:   "bg-blue-100 text-blue-700",
  LOW:      "bg-slate-100 text-slate-600",
};

export default function QueueManagePage() {
  const [page, setPage]               = useState(1);
  const [queueType, setQueueType]     = useState<QueueType | "">("");
  const [priority, setPriority]       = useState<QueuePriority | "">("");
  const [slaBreached, setSlaBreached] = useState<"" | "true" | "false">("");
  const [assignTarget, setAssignTarget] = useState<{ itemId: string; userId: string } | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<{ itemId: string } | null>(null);
  const [escalateNote, setEscalateNote] = useState("");

  const { data, isLoading, refetch } = trpc.queue.allItems.useQuery({
    page,
    pageSize: 25,
    ...(queueType && { queueType }),
    ...(priority && { priority }),
    ...(slaBreached !== "" && { slaBreached: slaBreached === "true" }),
  }, { refetchInterval: 30_000 });

  const { data: stats, refetch: refetchStats } = trpc.queue.stats.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: users } = trpc.team.list.useQuery();

  const autoAssign = trpc.queue.autoAssign.useMutation({ onSuccess: () => { refetch(); refetchStats(); } });
  const assign     = trpc.queue.assign.useMutation({ onSuccess: () => { setAssignTarget(null); refetch(); } });
  const escalate   = trpc.queue.escalate.useMutation({ onSuccess: () => { setEscalateTarget(null); setEscalateNote(""); refetch(); } });

  const items = data?.items ?? [];

  return (
    <>
      <TopBar
        title="Queue Management"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/queue/analytics">
              <Button variant="outline" size="sm"><BarChart2 className="w-3.5 h-3.5" /> Analytics</Button>
            </Link>
            <Button
              size="sm"
              loading={autoAssign.isPending}
              onClick={() => autoAssign.mutate({})}
            >
              <Zap className="w-3.5 h-3.5" /> Auto-Assign All
            </Button>
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-4">
        {/* Summary strip */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Unassigned", value: (stats.byStatus as any)["UNASSIGNED"] ?? 0, color: "text-slate-900" },
              { label: "In Progress", value: (stats.byStatus as any)["IN_PROGRESS"] ?? 0, color: "text-indigo-700" },
              { label: "SLA Breached", value: stats.slaBreached, color: stats.slaBreached > 0 ? "text-red-600" : "text-slate-900" },
              { label: "Critical", value: (stats.byPriority as any)["CRITICAL"] ?? 0, color: "text-red-600" },
              { label: "Avg TAT", value: formatTat(stats.avgTatMs), color: "text-slate-900" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
                <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={queueType}
            onChange={(e) => { setQueueType(e.target.value as QueueType | ""); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All types</option>
            <option value="REVIEW">Review</option>
            <option value="EXCEPTION">Exception</option>
            <option value="APPROVAL">Approval</option>
          </select>
          <select
            value={priority}
            onChange={(e) => { setPriority(e.target.value as QueuePriority | ""); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low</option>
          </select>
          <select
            value={slaBreached}
            onChange={(e) => { setSlaBreached(e.target.value as "" | "true" | "false"); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">SLA: All</option>
            <option value="true">SLA Breached</option>
            <option value="false">SLA OK</option>
          </select>
          <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-slate-100 transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Invoice</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Vendor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Assigned To</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">SLA</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
                )}
                {!isLoading && items.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">No items match the current filters.</td></tr>
                )}
                {items.map((item) => {
                  const inv = item.invoice as any;
                  const vendorName = inv?.vendor?.name
                    ?? inv?.fields?.[0]?.confirmedValue
                    ?? inv?.fields?.[0]?.extractedValue
                    ?? "Unknown";
                  const invoiceRef = inv?.externalInvoiceNum ?? inv?.originalFilename ?? item.invoiceId.slice(0, 8);
                  const assignedUser = (item as any).assignedUser as { name: string; email: string } | null;

                  return (
                    <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${item.slaBreached ? "bg-red-50/30" : ""}`}>
                      <td className="px-4 py-3">
                        <Link href={`/invoices/${item.invoiceId}`} className="font-mono text-xs text-blue-600 hover:underline flex items-center gap-1">
                          {invoiceRef} <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 max-w-[140px] truncate">{vendorName}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {inv?.grossAmount ? formatCurrency(Number(inv.grossAmount), inv.currency ?? "USD") : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{item.queueType}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${PRIORITY_BADGE[item.priority as QueuePriority]}`}>
                          {item.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {assignedUser ? assignedUser.name : <span className="text-slate-400 italic">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                          {item.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {item.slaBreached ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                            <AlertTriangle className="w-3 h-3" /> Breached
                          </span>
                        ) : item.slaDeadline ? (
                          <span className="text-xs text-slate-400">
                            {new Date(item.slaDeadline).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            title="Assign to user"
                            onClick={() => setAssignTarget({ itemId: item.id, userId: "" })}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                          >
                            <Users className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title="Escalate"
                            onClick={() => { setEscalateTarget({ itemId: item.id }); setEscalateNote(""); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data && data.total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                {((page - 1) * 25) + 1}–{Math.min(page * 25, data.total)} of {data.total} items
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

      {/* Assign modal */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-semibold text-slate-900">Assign to user</h3>
            <select
              value={assignTarget.userId}
              onChange={(e) => setAssignTarget({ ...assignTarget, userId: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a user…</option>
              {(Array.isArray(users) ? users : []).map((u: any) => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
              <Button
                disabled={!assignTarget.userId}
                loading={assign.isPending}
                onClick={() => assign.mutate({ itemId: assignTarget.itemId, userId: assignTarget.userId })}
              >
                Assign
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Escalate modal */}
      {escalateTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Escalate item
            </h3>
            <p className="text-xs text-slate-500">This will mark the item as CRITICAL and flag it for immediate attention.</p>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium">Escalation note</label>
              <textarea
                value={escalateNote}
                onChange={(e) => setEscalateNote(e.target.value)}
                placeholder="Describe why this requires immediate escalation…"
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEscalateTarget(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={escalateNote.length < 3}
                loading={escalate.isPending}
                onClick={() => escalate.mutate({ itemId: escalateTarget.itemId, note: escalateNote })}
              >
                Escalate
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatTat(ms: number | null | undefined): string {
  if (!ms) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}
