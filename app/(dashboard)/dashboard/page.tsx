"use client";

import { TopBar } from "@/components/layout/TopBar";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { FileText, AlertTriangle, TrendingUp, DollarSign, Upload } from "lucide-react";
import Link from "next/link";
import { subDays } from "date-fns";

const STATUS_STAGES = [
  "RECEIVED",
  "EXTRACTING",
  "VALIDATING",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "APPROVED",
] as const;

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Received",
  CLASSIFYING: "Classifying",
  EXTRACTING: "Extracting",
  REVIEW_REQUIRED: "Review",
  VALIDATING: "Validating",
  VALIDATION_FAILED: "Failed",
  READY_FOR_SUBMISSION: "Ready",
  SUBMITTING: "Submitting",
  SUBMITTED: "Submitted",
  ORACLE_PROCESSING: "Processing",
  ORACLE_ERROR: "Error",
  APPROVED: "Approved",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  DUPLICATE: "Duplicate",
};

export default function DashboardPage() {
  const dateFrom = subDays(new Date(), 7);
  const dateTo = new Date();

  const { data: pipeline } = trpc.invoice.pipelineCounts.useQuery();
  const { data: metrics } = trpc.invoice.metrics.useQuery({ dateFrom, dateTo });
  const { data: exceptions } = trpc.exception.counts.useQuery();

  const totalInPipeline = Object.values(pipeline ?? {}).reduce((a, b) => a + b, 0);

  return (
    <>
      <TopBar
        title="AP Command Center"
        actions={
          <Link
            href="/invoices/upload"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-800 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Invoices
          </Link>
        }
      />

      <div className="flex-1 p-6 space-y-6">
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
            highlight={exceptions && exceptions.blocking > 0}
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
              View all invoices →
            </Link>
          </div>
          <div className="grid grid-cols-6 gap-3">
            {STATUS_STAGES.map((status) => {
              const count = pipeline?.[status] ?? 0;
              const pct = totalInPipeline > 0 ? count / totalInPipeline : 0;
              return (
                <div key={status} className="flex flex-col gap-1.5">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                  <div className="text-xl font-bold text-slate-900">{count}</div>
                  <div className="text-xs text-slate-500">{STATUS_LABELS[status]}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Exceptions Alert */}
        {exceptions && exceptions.blocking > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
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
          </div>
        )}

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Exception Summary</h2>
            <div className="space-y-2">
              {[
                { label: "Blocking", count: exceptions?.blocking ?? 0, color: "bg-red-500" },
                { label: "Warnings", count: exceptions?.warning ?? 0, color: "bg-amber-400" },
                { label: "Informational", count: exceptions?.informational ?? 0, color: "bg-blue-400" },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${color}`} />
                    <span className="text-sm text-slate-700">{label}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Invoice Status Breakdown</h2>
            <div className="space-y-2">
              {Object.entries(pipeline ?? {}).slice(0, 5).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{STATUS_LABELS[status] ?? status}</span>
                  <span className="text-sm font-semibold text-slate-900">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function KPICard({
  label,
  value,
  icon,
  bg,
  highlight,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  bg: string;
  highlight?: boolean;
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
