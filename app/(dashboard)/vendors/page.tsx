"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { Building2, Search, TrendingUp, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function VendorsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(1);

  const { data: summary } = trpc.vendor.summary.useQuery();
  const { data, isLoading } = trpc.vendor.list.useQuery({
    search:   search || undefined,
    page,
    pageSize: 50,
  });

  const vendors = data?.vendors ?? [];

  return (
    <>
      <TopBar title="Vendors" />

      <div className="flex-1 p-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Vendors",      value: summary?.total ?? 0,          icon: <Building2 className="w-4 h-4 text-blue-600" />,   bg: "bg-blue-50" },
            { label: "With Exceptions",    value: summary?.withExceptions ?? 0,  icon: <AlertTriangle className="w-4 h-4 text-amber-600" />, bg: "bg-amber-50" },
            { label: "High Risk (>10%)",   value: summary?.highRisk ?? 0,        icon: <TrendingUp className="w-4 h-4 text-red-600" />,    bg: "bg-red-50" },
          ].map(({ label, value, icon, bg }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium">{label}</span>
                <div className={`${bg} rounded-lg p-1.5`}>{icon}</div>
              </div>
              <div className="text-2xl font-bold text-slate-900">{value}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search vendor name or supplier #"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 text-left font-semibold">Vendor Name</th>
                <th className="px-5 py-3 text-left font-semibold">Oracle Supplier #</th>
                <th className="px-5 py-3 text-left font-semibold">Country</th>
                <th className="px-5 py-3 text-left font-semibold">Payment Terms</th>
                <th className="px-5 py-3 text-left font-semibold">Currency</th>
                <th className="px-5 py-3 text-left font-semibold">Invoices</th>
                <th className="px-5 py-3 text-left font-semibold">Exception Rate</th>
                <th className="px-5 py-3 text-left font-semibold">Last Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {!isLoading && vendors.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={<Building2 className="w-12 h-12" />}
                      title="No vendors found"
                      description={search ? "Try a different search term." : "Vendors will appear after invoices are processed."}
                    />
                  </td>
                </tr>
              )}
              {vendors.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-900">
                    <Link
                      href={`/invoices?vendorId=${v.id}`}
                      className="hover:text-blue-700 hover:underline"
                    >
                      {v.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-500 font-mono text-xs">{v.oracleSupplierNum}</td>
                  <td className="px-5 py-3 text-slate-500">{v.country ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-500">{v.paymentTerms ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-500">{v.defaultCurrency}</td>
                  <td className="px-5 py-3 text-slate-700 font-medium">{v._count.invoices}</td>
                  <td className="px-5 py-3">
                    <span className={
                      v.exceptionRate > 0.1 ? "text-red-600 font-semibold" :
                      v.exceptionRate > 0   ? "text-amber-600 font-medium" :
                      "text-emerald-600 font-medium"
                    }>
                      {(v.exceptionRate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">
                    {v.lastInvoiceAt ? formatDate(v.lastInvoiceAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data && data.total > 50 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200">
              <span className="text-xs text-slate-500">{data.total} vendors total</span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-700 px-2">Page {page} of {data.pages}</span>
                <button
                  disabled={page >= data.pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"
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
