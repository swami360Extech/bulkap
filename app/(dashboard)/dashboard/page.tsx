"use client";

import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { FileText, AlertTriangle, TrendingUp, DollarSign, Upload, RefreshCw } from "lucide-react";
import Link from "next/link";
import { subDays } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const STATUS_STAGES = [
  "RECEIVED", "EXTRACTING", "VALIDATING",
  "READY_FOR_SUBMISSION", "SUBMITTED", "APPROVED",
] as const;

const STATUS_LABELS: Record<string, string> = {
  RECEIVED:              "Received",
  CLASSIFYING:           "Classifying",
  EXTRACTING:            "Extracting",
  REVIEW_REQUIRED:       "Review",
  VALIDATING:            "Validating",
  VALIDATION_FAILED:     "Failed",
  READY_FOR_SUBMISSION:  "Ready",
  SUBMITTING:            "Submitting",
  SUBMITTED:             "Submitted",
  ORACLE_PROCESSING:     "Processing",
  ORACLE_ERROR:          "Error",
  APPROVED:              "Approved",
  PAID:                  "Paid",
  CANCELLED:             "Cancelled",
  REJECTED:              "Rejected",
  DUPLICATE:             "Duplicate",
};

const CHART_COLORS = {
  received:  "#3b82f6",
  validated: "#10b981",
  submitted: "#8b5cf6",
};

export default function DashboardPage() {
  const dateFrom = subDays(new Date(), 7);
  const dateTo   = new Date();

  const { data: pipeline }   = trpc.invoice.pipelineCounts.useQuery();
  const { data: metrics }    = trpc.invoice.metrics.useQuery({ dateFrom, dateTo });
  const { data: exceptions } = trpc.exception.counts.useQuery();
  const { data: trend }      = trpc.invoice.trend.useQuery();
  const { data: vendors }    = trpc.vendor.list.useQuery({ pageSize: 8 });

  const syncStatuses = trpc.submission.syncInvoiceStatuses.useMutation();

  const totalInPipeline = Object.values(pipeline ?? {}).reduce((a, b) => a + b, 0);

  // Top vendors by exception rate for bar chart
  const vendorChartData = (vendors?.vendors ?? [])
    .filter((v) => v.exceptionRate > 0)
    .sort((a, b) => b.exceptionRate - a.exceptionRate)
    .slice(0, 6)
    .map((v) => ({
      name:          v.name.length > 14 ? v.name.slice(0, 12) + "…" : v.name,
      exceptionRate: Number((v.exceptionRate * 100).toFixed(1)),
    }));

  return (
    <>
      <TopBar
        title="AP Command Center"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={syncStatuses.isPending}
              onClick={() => syncStatuses.mutate({})}
              title="Sync Oracle status for all submitted invoices"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync Oracle
            </Button>
            <Link
              href="/invoices/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-800 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Invoices
            </Link>
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-5">

        {/* Sync result banner */}
        {syncStatuses.isSuccess && syncStatuses.data.synced > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
            <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
            Synced {syncStatuses.data.synced} invoice{syncStatuses.data.synced > 1 ? "s" : ""} from Oracle —
            {syncStatuses.data.results.map((r) => ` ${STATUS_LABELS[r.from]} → ${STATUS_LABELS[r.to]}`).join(", ")}
          </div>
        )}
        {syncStatuses.isSuccess && syncStatuses.data.synced === 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
            <RefreshCw className="w-3.5 h-3.5" /> No status changes — all submitted invoices are up to date.
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Invoices This Week"
            value={metrics?.totalReceived ?? 0}
            icon={<FileText className="w-4 h-4 text-blue-600" />}
            bg="bg-blue-50"
          />
          <KPICard
            label="Open Exceptions"
            value={exceptions ? exceptions.blocking + exceptions.warning : 0}
            icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
            bg="bg-amber-50"
            highlight={!!(exceptions && exceptions.blocking > 0)}
          />
          <KPICard
            label="STP Rate"
            value={metrics ? formatPercent(metrics.straightThroughRate) : "—"}
            icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
            bg="bg-emerald-50"
          />
          <KPICard
            label="Early Pay Opportunity"
            value={metrics ? formatCurrency(metrics.earlyPayOpportunity) : "—"}
            icon={<DollarSign className="w-4 h-4 text-violet-600" />}
            bg="bg-violet-50"
          />
        </div>

        {/* Pipeline Health */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Pipeline Health</h2>
            <Link href="/invoices" className="text-xs text-blue-700 hover:underline">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-6 gap-3">
            {STATUS_STAGES.map((status) => {
              const count = pipeline?.[status] ?? 0;
              const pct   = totalInPipeline > 0 ? count / totalInPipeline : 0;
              return (
                <div key={status} className="flex flex-col gap-1.5">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct * 100}%` }} />
                  </div>
                  <div className="text-xl font-bold text-slate-900">{count}</div>
                  <div className="text-xs text-slate-500">{STATUS_LABELS[status]}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Blocking exception alert */}
        {exceptions && exceptions.blocking > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-sm font-semibold text-red-900">
                {exceptions.blocking} blocking exception{exceptions.blocking > 1 ? "s" : ""} require immediate attention
              </span>
            </div>
            <Link href="/exceptions" className="text-sm text-red-700 font-medium hover:underline">
              Resolve now →
            </Link>
          </div>
        )}

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* 7-day throughput area chart */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">7-Day Invoice Throughput</h2>
            {trend && trend.some((d) => d.received > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gReceived"  x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={CHART_COLORS.received}  stopOpacity={0.15} />
                      <stop offset="95%" stopColor={CHART_COLORS.received}  stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gValidated" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={CHART_COLORS.validated} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={CHART_COLORS.validated} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gSubmitted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={CHART_COLORS.submitted} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={CHART_COLORS.submitted} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Area type="monotone" dataKey="received"  name="Received"  stroke={CHART_COLORS.received}  fill="url(#gReceived)"  strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="validated" name="Validated" stroke={CHART_COLORS.validated} fill="url(#gValidated)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="submitted" name="Submitted" stroke={CHART_COLORS.submitted} fill="url(#gSubmitted)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-xs text-slate-400 italic">
                No invoice activity in the last 7 days
              </div>
            )}
          </div>

          {/* Vendor exception rate bar chart */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Vendor Exception Rates</h2>
              <Link href="/vendors" className="text-xs text-blue-700 hover:underline">View all →</Link>
            </div>
            {vendorChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={vendorChartData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={72} />
                  <Tooltip
                    formatter={(v) => [`${v}%`, "Exception Rate"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                  <Bar dataKey="exceptionRate" name="Exception Rate" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-xs text-slate-400 italic">
                No exception data yet
              </div>
            )}
          </div>
        </div>

        {/* Exception summary + status breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Open Exceptions</h2>
              <Link href="/exceptions" className="text-xs text-blue-700 hover:underline">View all →</Link>
            </div>
            <div className="space-y-2.5">
              {[
                { label: "Blocking",      count: exceptions?.blocking ?? 0,      color: "bg-red-500",   text: "text-red-700" },
                { label: "Warnings",      count: exceptions?.warning ?? 0,       color: "bg-amber-400", text: "text-amber-700" },
                { label: "Informational", count: exceptions?.informational ?? 0, color: "bg-blue-400",  text: "text-blue-700" },
              ].map(({ label, count, color, text }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${color}`} />
                    <span className="text-sm text-slate-700">{label}</span>
                  </div>
                  <span className={`text-sm font-bold ${count > 0 ? text : "text-slate-400"}`}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Invoice Status Breakdown</h2>
              <Link href="/invoices" className="text-xs text-blue-700 hover:underline">View all →</Link>
            </div>
            <div className="space-y-2">
              {Object.entries(pipeline ?? {})
                .filter(([, count]) => count > 0)
                .slice(0, 6)
                .map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{STATUS_LABELS[status] ?? status}</span>
                    <span className="text-sm font-semibold text-slate-900">{count}</span>
                  </div>
                ))}
              {Object.values(pipeline ?? {}).every((v) => v === 0) && (
                <p className="text-xs text-slate-400 italic">No invoices yet</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}

function KPICard({
  label, value, icon, bg, highlight,
}: {
  label: string; value: string | number; icon: React.ReactNode; bg: string; highlight?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border ${highlight ? "border-red-300" : "border-slate-200"} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        <div className={`${bg} rounded-lg p-1.5`}>{icon}</div>
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
