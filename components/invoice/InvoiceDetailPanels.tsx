"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";

// ─── Plain types — breaks the deep Prisma/tRPC generic chain ─────────────────

export type FieldRow = {
  id: string;
  fieldName: string;
  extractedValue: string | null;
  confirmedValue: string | null;
  confidence: number;
  manuallyReviewed: boolean;
};

export type LineRow = {
  id: string;
  lineNumber: number;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  lineAmount: string;
  matchStatus: string | null;
};

export type ValidationRow = {
  id: string;
  result: string;
  check: string;
  message: string | null;
};

export type AuditRow = {
  id: string;
  description: string;
  createdAt: Date | string;
};

export type ExceptionRow = {
  id: string;
  type: string;
  severity: string;
  description: string;
  aiSuggestion: string | null;
  oracleHoldName: string | null;
  status: string;
  assignedUser: { name: string; email: string } | null;
};

// ─── Validation icons ─────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  PASS:    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  FAIL:    <XCircle className="w-3.5 h-3.5 text-red-500" />,
  WARNING: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
  SKIPPED: <Clock className="w-3.5 h-3.5 text-slate-300" />,
};

function confColor(c: number) {
  if (c >= 0.9) return "text-emerald-600";
  if (c >= 0.8) return "text-amber-500";
  return "text-red-500";
}

// ─── Components ───────────────────────────────────────────────────────────────

export function ExtractionCard({ fields, avgConf }: { fields: FieldRow[]; avgConf: number }) {
  if (fields.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Extraction</CardTitle>
          <span className={cn("text-xs font-semibold", confColor(avgConf))}>
            {Math.round(avgConf * 100)}% avg confidence
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {fields.map((field) => {
              const value = field.confirmedValue ?? field.extractedValue;
              return (
                <tr key={field.id}>
                  <td className="px-5 py-2.5 text-xs text-slate-500 w-48">
                    {field.fieldName.replace(/_/g, " ")}
                  </td>
                  <td className="px-5 py-2.5 font-medium text-slate-900">
                    {value ?? <span className="text-slate-300 italic">not extracted</span>}
                    {field.manuallyReviewed && <Badge variant="secondary" className="ml-2 text-xs">edited</Badge>}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className={cn("text-xs font-semibold", confColor(field.confidence))}>
                      {Math.round(field.confidence * 100)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function LineItemsCard({ lines, currency }: { lines: LineRow[]; currency: string }) {
  if (lines.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-xs text-slate-500 uppercase tracking-wide">
              {["#", "Description", "Qty", "Unit Price", "Amount", "Match"].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-5 py-3 text-slate-500">{line.lineNumber}</td>
                <td className="px-5 py-3 text-slate-800">{line.description ?? "—"}</td>
                <td className="px-5 py-3 text-slate-600">{line.quantity ?? "—"}</td>
                <td className="px-5 py-3 text-slate-600">
                  {line.unitPrice ? formatCurrency(Number(line.unitPrice), currency) : "—"}
                </td>
                <td className="px-5 py-3 font-semibold text-slate-900">
                  {formatCurrency(Number(line.lineAmount), currency)}
                </td>
                <td className="px-5 py-3">
                  {line.matchStatus ? (
                    <Badge variant={line.matchStatus === "MATCHED" ? "success" : "warning"}>
                      {line.matchStatus.replace(/_/g, " ")}
                    </Badge>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function ValidationCard({ validations }: { validations: ValidationRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Oracle Validation</CardTitle></CardHeader>
      <CardContent className="space-y-2.5">
        {validations.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Not yet validated</p>
        ) : (
          validations.map((v) => (
            <div key={v.id} className="flex items-start gap-2">
              <div className="mt-0.5">{ICONS[v.result]}</div>
              <div>
                <p className="text-xs font-medium text-slate-700">{v.check.replace(/_/g, " ")}</p>
                {v.message && <p className="text-xs text-slate-500">{v.message}</p>}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function ExceptionsCard({ exceptions }: { exceptions: ExceptionRow[] }) {
  const open = exceptions.filter((e) => e.status === "OPEN");
  if (open.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Exceptions</CardTitle>
          <Badge variant="destructive">{open.length} open</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {open.map((ex) => (
          <div key={ex.id} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className={cn("w-3.5 h-3.5", ex.severity === "BLOCKING" ? "text-red-500" : "text-amber-500")} />
              <span className="text-xs font-semibold text-slate-800">{ex.type.replace(/_/g, " ")}</span>
            </div>
            <p className="text-xs text-slate-600">{ex.description}</p>
            {ex.aiSuggestion && (
              <p className="text-xs text-blue-700 mt-1.5 bg-blue-50 rounded px-2 py-1">
                AI: {ex.aiSuggestion}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AuditCard({ events }: { events: AuditRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {events.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No events yet</p>
        ) : (
          events.map((evt) => (
            <div key={evt.id} className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
              <div>
                <p className="text-xs text-slate-700">{evt.description}</p>
                <p className="text-xs text-slate-400">{formatDate(evt.createdAt instanceof Date ? evt.createdAt : new Date(evt.createdAt))}</p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function OracleCard({ data }: {
  data: {
    oracleInvoiceId: string | null;
    oracleStatus: string | null;
    submittedAt: Date | string | null;
    oracleApprovedAt: Date | string | null;
    oraclePaymentRef: string | null;
  }
}) {
  const rows: [string, string][] = [
    ["Oracle Invoice ID", data.oracleInvoiceId ?? "—"],
    ["Oracle Status",     data.oracleStatus ?? "—"],
    ["Submitted At",      data.submittedAt ? formatDate(new Date(data.submittedAt)) : "—"],
    ["Approved At",       data.oracleApprovedAt ? formatDate(new Date(data.oracleApprovedAt)) : "—"],
    ["Payment Ref",       data.oraclePaymentRef ?? "—"],
  ];
  return (
    <Card>
      <CardHeader><CardTitle>Oracle Details</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-slate-500">{label}</span>
            <span className="font-medium text-slate-900">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
