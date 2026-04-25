"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { InvoiceStatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Download, AlertTriangle, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const BUCKETS = [
  { key: "current", label: "Current",    color: "#10b981", textColor: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  { key: "d1_30",   label: "1–30 Days",  color: "#f59e0b", textColor: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200"  },
  { key: "d31_60",  label: "31–60 Days", color: "#f97316", textColor: "text-orange-700",  bg: "bg-orange-50",  border: "border-orange-200" },
  { key: "d61_90",  label: "61–90 Days", color: "#ef4444", textColor: "text-red-700",     bg: "bg-red-50",     border: "border-red-200"    },
  { key: "d90plus", label: "90+ Days",   color: "#7f1d1d", textColor: "text-red-900",     bg: "bg-red-100",    border: "border-red-300"    },
] as const;

type BucketKey = typeof BUCKETS[number]["key"];

export default function AgingReportPage() {
  const [activeBucket, setActiveBucket] = useState<BucketKey | "all">("all");

  const { data, isLoading } = trpc.reports.aging.useQuery();
  const exportCsv = trpc.reports.agingCsv.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `ap-aging-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const chartData = BUCKETS.map((b) => ({
    name:   b.label,
    color:  b.color,
    total:  data?.[b.key]?.total ?? 0,
    count:  data?.[b.key]?.count ?? 0,
  }));

  const totalOverdue = (data?.d1_30?.total ?? 0) + (data?.d31_60?.total ?? 0) +
                       (data?.d61_90?.total ?? 0) + (data?.d90plus?.total ?? 0);
  const overdueCount = (data?.d1_30?.count ?? 0) + (data?.d31_60?.count ?? 0) +
                       (data?.d61_90?.count ?? 0) + (data?.d90plus?.count ?? 0);

  // Build the detail rows based on active filter
  const allInvoices = BUCKETS.flatMap((b) => data?.[b.key]?.invoices ?? []);
  const filteredInvoices = activeBucket === "all"
    ? allInvoices
    : data?.[activeBucket]?.invoices ?? [];
  const sortedInvoices = [...filteredInvoices].sort((a, b) =>
    (b.daysPastDue ?? -1) - (a.daysPastDue ?? -1)
  );

  return (
    <>
      <TopBar
        title="AP Aging Report"
        actions={
          <Button
            size="sm"
            variant="secondary"
            loading={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Report header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">
              As of {data ? new Date(data.asOf).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }) : "—"} ·{" "}
              {data?.total ?? 0} outstanding invoices
            </p>
            {overdueCount > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                <span className="text-sm font-semibold text-red-700">
                  {overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""} totalling {formatCurrency(totalOverdue)}
                </span>
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Total Outstanding</p>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(data?.outstanding ?? 0)}</p>
          </div>
        </div>

        {/* Bucket summary cards */}
        <div className="grid grid-cols-5 gap-3">
          {BUCKETS.map((b) => {
            const bucket = data?.[b.key];
            const isActive = activeBucket === b.key;
            return (
              <button
                key={b.key}
                onClick={() => setActiveBucket(isActive ? "all" : b.key)}
                className={`text-left rounded-xl border p-4 transition-all ${b.bg} ${b.border} ${isActive ? "ring-2 ring-offset-1 ring-blue-500" : "hover:opacity-90"}`}
              >
                <p className={`text-2xl font-bold ${b.textColor}`}>
                  {isLoading ? "…" : (bucket?.count ?? 0)}
                </p>
                <p className="text-xs font-semibold text-slate-600 mt-0.5">{b.label}</p>
                <p className={`text-xs font-medium mt-1 ${b.textColor}`}>
                  {isLoading ? "…" : formatCurrency(bucket?.total ?? 0)}
                </p>
              </button>
            );
          })}
        </div>

        {/* Aging chart + overdue alert */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Outstanding by Aging Bucket</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`}
                />
                <Tooltip
                  formatter={(v, _, props) => [
                    formatCurrency(Number(v)),
                    `${props.payload?.count ?? 0} invoice${props.payload?.count !== 1 ? "s" : ""}`,
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Bar dataKey="total" name="Total" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Aging Summary</h2>
            <div className="space-y-3">
              {BUCKETS.map((b) => {
                const bucket = data?.[b.key];
                const pct = data?.outstanding
                  ? ((bucket?.total ?? 0) / data.outstanding) * 100
                  : 0;
                return (
                  <div key={b.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-600">{b.label}</span>
                      <span className={`text-xs font-semibold ${b.textColor}`}>
                        {formatCurrency(bucket?.total ?? 0)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: b.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <TrendingUp className="w-3.5 h-3.5" />
                {data?.d90plus?.count ?? 0} invoice{(data?.d90plus?.count ?? 0) !== 1 ? "s" : ""} past 90 days
              </div>
            </div>
          </div>
        </div>

        {/* Detailed table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Invoice Detail
              {activeBucket !== "all" && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  — filtered: {BUCKETS.find((b) => b.key === activeBucket)?.label}
                </span>
              )}
            </h2>
            {activeBucket !== "all" && (
              <button onClick={() => setActiveBucket("all")} className="text-xs text-blue-600 hover:underline">
                Show all
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-5 py-2.5 text-left font-semibold">Invoice #</th>
                  <th className="px-5 py-2.5 text-left font-semibold">Vendor</th>
                  <th className="px-5 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-5 py-2.5 text-left font-semibold">Due Date</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Days Overdue</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
                )}
                {!isLoading && sortedInvoices.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400 italic">No invoices in this bucket.</td></tr>
                )}
                {sortedInvoices.map((inv) => {
                  const dpd = inv.daysPastDue ?? 0;
                  const dpdBucket = BUCKETS.find((b) => {
                    if (b.key === "current")  return dpd <= 0;
                    if (b.key === "d1_30")    return dpd > 0  && dpd <= 30;
                    if (b.key === "d31_60")   return dpd > 30 && dpd <= 60;
                    if (b.key === "d61_90")   return dpd > 60 && dpd <= 90;
                    if (b.key === "d90plus")  return dpd > 90;
                    return false;
                  });
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs">
                        <Link href={`/invoices/${inv.id}`} className="text-blue-700 hover:underline">
                          {inv.externalInvoiceNum ?? inv.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-800 font-medium">{inv.vendorName}</td>
                      <td className="px-5 py-3">
                        <InvoiceStatusBadge status={inv.status as any} />
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {dpd > 0 ? (
                          <span className={`text-xs font-semibold ${dpdBucket?.textColor ?? "text-slate-700"}`}>
                            {dpd}d
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-600 font-medium">Current</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(inv.grossAmount, inv.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
