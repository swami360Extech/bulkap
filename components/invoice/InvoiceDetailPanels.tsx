"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertTriangle, Clock, Pencil, Check, X } from "lucide-react";

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

// ─── Label maps ───────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  vendor_name:     "Vendor Name",
  invoice_number:  "Invoice Number",
  invoice_date:    "Invoice Date",
  due_date:        "Due Date",
  gross_amount:    "Gross Amount",
  net_amount:      "Net Amount",
  tax_amount:      "Tax Amount",
  currency:        "Currency",
  payment_terms:   "Payment Terms",
  po_number:       "PO Number",
  gl_account:      "GL Account",
  remit_to_bank:   "Remit-To Bank",
  tax_id:          "Tax ID",
};

function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const VALIDATION_CHECK_LABELS: Record<string, string> = {
  SUPPLIER_EXISTS:       "Supplier Exists",
  SUPPLIER_ACTIVE:       "Supplier Active",
  SUPPLIER_SITE_VALID:   "Supplier Site Valid",
  PO_EXISTS:             "PO Exists",
  PO_OPEN:               "PO Open",
  PO_AMOUNT_SUFFICIENT:  "PO Amount Sufficient",
  RECEIPT_EXISTS:        "Receipt Exists",
  THREE_WAY_MATCH:       "3-Way Match",
  GL_ACCOUNT_VALID:      "GL Account Valid",
  TAX_CODE_VALID:        "Tax Code Valid",
  PERIOD_OPEN:           "Period Open",
  CURRENCY_VALID:        "Currency Valid",
  DUPLICATE_CHECK:       "Duplicate Check",
  CROSS_BU_DUPLICATE:    "Cross-BU Duplicate",
  AMOUNT_ANOMALY:        "Amount Anomaly",
  BANK_CHANGE_DETECTED:  "Bank Account Change",
};

const MATCH_STATUS_LABELS: Record<string, string> = {
  MATCHED:           "Matched",
  TOLERANCE_BREACH:  "Tolerance Breach",
  PRICE_MISMATCH:    "Price Mismatch",
  QTY_MISMATCH:      "Qty Mismatch",
  RECEIPT_PENDING:   "Receipt Pending",
  NO_PO:             "No PO",
};

// ─── Validation icons ─────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  PASS:    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  FAIL:    <XCircle      className="w-3.5 h-3.5 text-red-500" />,
  WARNING: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
  SKIPPED: <Clock        className="w-3.5 h-3.5 text-slate-300" />,
};

function confColor(c: number) {
  if (c >= 0.9) return "text-emerald-600";
  if (c >= 0.8) return "text-amber-500";
  return "text-red-500";
}

// ─── Components ───────────────────────────────────────────────────────────────

export function ExtractionCard({
  fields,
  avgConf,
  invoiceId,
  onSaved,
}: {
  fields: FieldRow[];
  avgConf: number;
  invoiceId?: string;
  onSaved?: () => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draftValue, setDraftValue]     = useState("");
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});

  const confirmFields = trpc.invoice.confirmFields.useMutation({
    onSuccess: () => {
      setPendingEdits({});
      setEditingField(null);
      onSaved?.();
    },
  });

  const startEdit = (field: FieldRow) => {
    setEditingField(field.fieldName);
    setDraftValue(pendingEdits[field.fieldName] ?? field.confirmedValue ?? field.extractedValue ?? "");
  };

  const commitEdit = (fieldName: string) => {
    if (draftValue.trim()) {
      setPendingEdits((prev) => ({ ...prev, [fieldName]: draftValue.trim() }));
    }
    setEditingField(null);
  };

  const cancelEdit = () => setEditingField(null);

  const hasPendingEdits = Object.keys(pendingEdits).length > 0;
  const editable = !!invoiceId;

  if (fields.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Extraction</CardTitle>
          <div className="flex items-center gap-3">
            <span className={cn("text-xs font-semibold", confColor(avgConf))}>
              {Math.round(avgConf * 100)}% avg confidence
            </span>
            {hasPendingEdits && (
              <Button
                size="sm"
                loading={confirmFields.isPending}
                onClick={() =>
                  confirmFields.mutate({
                    invoiceId: invoiceId!,
                    fields: Object.entries(pendingEdits).map(([fieldName, confirmedValue]) => ({
                      fieldName,
                      confirmedValue,
                    })),
                  })
                }
              >
                <Check className="w-3.5 h-3.5" /> Confirm {Object.keys(pendingEdits).length} field{Object.keys(pendingEdits).length > 1 ? "s" : ""}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-xs text-slate-500 uppercase tracking-wide">
              <th className="px-5 py-2.5 text-left font-semibold w-44">Field</th>
              <th className="px-5 py-2.5 text-left font-semibold">Extracted Value</th>
              <th className="px-5 py-2.5 text-right font-semibold">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fields.map((field) => {
              const displayValue = pendingEdits[field.fieldName] ?? field.confirmedValue ?? field.extractedValue;
              const isEditing = editingField === field.fieldName;
              const isPending = !!pendingEdits[field.fieldName];

              return (
                <tr key={field.id} className={cn("group", isEditing && "bg-blue-50/40")}>
                  <td className="px-5 py-2.5 text-xs text-slate-500">
                    {fieldLabel(field.fieldName)}
                  </td>
                  <td className="px-5 py-2">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={draftValue}
                          onChange={(e) => setDraftValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit(field.fieldName);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="flex-1 text-sm border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => commitEdit(field.fieldName)}
                          className="p-1 rounded hover:bg-emerald-100 text-emerald-600"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 rounded hover:bg-red-100 text-red-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={cn("font-medium", displayValue ? "text-slate-900" : "text-slate-300 italic")}>
                          {displayValue ?? "not extracted"}
                        </span>
                        {field.manuallyReviewed && !isPending && (
                          <Badge variant="secondary" className="text-xs">confirmed</Badge>
                        )}
                        {isPending && (
                          <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700 border-amber-200">pending</Badge>
                        )}
                        {editable && (
                          <button
                            onClick={() => startEdit(field)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className={cn("text-xs font-semibold", confColor(isPending ? 1.0 : field.confidence))}>
                      {isPending ? "edited" : `${Math.round(field.confidence * 100)}%`}
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
                      {MATCH_STATUS_LABELS[line.matchStatus] ?? line.matchStatus}
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
                <p className="text-xs font-medium text-slate-700">
                  {VALIDATION_CHECK_LABELS[v.check] ?? v.check}
                </p>
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
              <AlertTriangle className={cn(
                "w-3.5 h-3.5",
                ex.severity === "BLOCKING" ? "text-red-500" : "text-amber-500"
              )} />
              <span className="text-xs font-semibold text-slate-800">
                {ex.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
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
                <p className="text-xs text-slate-400">
                  {formatDate(evt.createdAt instanceof Date ? evt.createdAt : new Date(evt.createdAt))}
                </p>
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
