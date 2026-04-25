"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { ArrowLeft, TrendingUp, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  NORMAL: "#3b82f6",
  LOW: "#94a3b8",
};

function formatTat(ms: number): string {
  if (!ms) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export default function QueueAnalyticsPage() {
  const [range, setRange] = useState<"7" | "30" | "90">("30");

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - parseInt(range));
  const dateTo = new Date();

  const { data, isLoading } = trpc.queue.analytics.useQuery({
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  });

  const { data: users } = trpc.team.list.useQuery();

  const byPriorityData = data
    ? Object.entries(data.byPriority).map(([priority, d]) => ({
        priority,
        completed: d.count,
        avgTat: Math.round(d.avgTatMs / 60_000),
      }))
    : [];

  const userMap = new Map(
    (Array.isArray(users) ? users : []).map((u: any) => [u.id, u.name])
  );

  return (
    <>
      <TopBar
        title="Queue Analytics"
        actions={
          <Link href="/queue/manage">
            <Button variant="outline" size="sm"><ArrowLeft className="w-3.5 h-3.5" /> Back to Queue</Button>
          </Link>
        }
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Range picker */}
        <div className="flex items-center gap-2">
          {(["7", "30", "90"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Last {r} days
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="text-center py-12 text-sm text-slate-400">Loading analytics…</div>
        )}

        {data && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Completed</p>
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                </div>
                <p className="text-3xl font-bold text-slate-900">{data.totalCompleted}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Avg TAT</p>
                  <Clock className="w-4 h-4 text-blue-500" />
                </div>
                <p className="text-3xl font-bold text-slate-900">{formatTat(data.avgTatMs)}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">SLA Compliance</p>
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                </div>
                <p className="text-3xl font-bold text-slate-900">
                  {Math.round(data.slaComplianceRate * 100)}%
                </p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">SLA Breaches</p>
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                </div>
                <p className={`text-3xl font-bold ${data.slaBreaches > 0 ? "text-red-600" : "text-slate-900"}`}>
                  {data.slaBreaches}
                </p>
              </div>
            </div>

            {/* Throughput chart */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Daily Throughput</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.throughput} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="received" stroke="#3b82f6" strokeWidth={2} dot={false} name="Received" />
                  <Line type="monotone" dataKey="completed" stroke="#22c55e" strokeWidth={2} dot={false} name="Completed" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* By priority + user grids */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* By Priority */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Completed by Priority</h3>
                {byPriorityData.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No completed items yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={byPriorityData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <XAxis dataKey="priority" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                      <Bar dataKey="completed" name="Completed" radius={[4, 4, 0, 0]}>
                        {byPriorityData.map((entry) => (
                          <rect key={entry.priority} fill={PRIORITY_COLORS[entry.priority] ?? "#94a3b8"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* By User */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">User Performance</h3>
                {data.byUser.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No completed items yet</p>
                ) : (
                  <div className="space-y-3 overflow-y-auto max-h-[180px]">
                    {data.byUser
                      .sort((a, b) => b.completed - a.completed)
                      .map((u) => (
                        <div key={u.userId ?? "unassigned"} className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {u.userId ? (userMap.get(u.userId) ?? u.userId?.slice(0, 8)) : "Unassigned"}
                            </p>
                            <p className="text-xs text-slate-400">Avg TAT: {formatTat(u.avgTatMs)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-slate-900">{u.completed}</p>
                            <p className="text-xs text-slate-400">completed</p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Priority avg TAT table */}
            {byPriorityData.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Avg TAT by Priority (minutes)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-2 text-xs font-semibold text-slate-500 uppercase">Priority</th>
                        <th className="text-right py-2 text-xs font-semibold text-slate-500 uppercase">Completed</th>
                        <th className="text-right py-2 text-xs font-semibold text-slate-500 uppercase">Avg TAT (min)</th>
                        <th className="text-right py-2 text-xs font-semibold text-slate-500 uppercase">Avg TAT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {byPriorityData.map((row) => (
                        <tr key={row.priority}>
                          <td className="py-2">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-md`}
                              style={{ background: PRIORITY_COLORS[row.priority] + "20", color: PRIORITY_COLORS[row.priority] }}>
                              {row.priority}
                            </span>
                          </td>
                          <td className="py-2 text-right text-slate-700 font-medium">{row.completed}</td>
                          <td className="py-2 text-right text-slate-500">{row.avgTat}</td>
                          <td className="py-2 text-right text-slate-700">{formatTat(row.avgTat * 60_000)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
