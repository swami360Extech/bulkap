import { Badge } from "./badge";
import type { InvoiceStatus, ExceptionSeverity, ExceptionStatus } from "@prisma/client";

const invoiceStatusConfig: Record<InvoiceStatus, { label: string; variant: "default" | "success" | "warning" | "destructive" | "secondary" | "outline" }> = {
  RECEIVED:             { label: "Received",      variant: "secondary" },
  CLASSIFYING:          { label: "Classifying",   variant: "secondary" },
  EXTRACTING:           { label: "Extracting",    variant: "default" },
  REVIEW_REQUIRED:      { label: "Review",        variant: "warning" },
  VALIDATING:           { label: "Validating",    variant: "default" },
  VALIDATION_FAILED:    { label: "Failed",        variant: "destructive" },
  READY_FOR_SUBMISSION: { label: "Ready",         variant: "success" },
  SUBMITTING:           { label: "Submitting",    variant: "default" },
  SUBMITTED:            { label: "Submitted",     variant: "default" },
  ORACLE_PROCESSING:    { label: "Processing",    variant: "default" },
  ORACLE_ERROR:         { label: "Oracle Error",  variant: "destructive" },
  APPROVED:             { label: "Approved",      variant: "success" },
  PAID:                 { label: "Paid",          variant: "success" },
  CANCELLED:            { label: "Cancelled",     variant: "outline" },
  REJECTED:             { label: "Rejected",      variant: "destructive" },
  DUPLICATE:            { label: "Duplicate",     variant: "warning" },
};

const severityConfig: Record<ExceptionSeverity, { label: string; variant: "destructive" | "warning" | "default" }> = {
  BLOCKING:      { label: "Blocking",      variant: "destructive" },
  WARNING:       { label: "Warning",       variant: "warning" },
  INFORMATIONAL: { label: "Informational", variant: "default" },
};

const exceptionStatusConfig: Record<ExceptionStatus, { label: string; variant: "destructive" | "warning" | "success" | "secondary" | "outline" }> = {
  OPEN:          { label: "Open",          variant: "destructive" },
  IN_REVIEW:     { label: "In Review",     variant: "warning" },
  RESOLVED:      { label: "Resolved",      variant: "success" },
  WAIVED:        { label: "Waived",        variant: "outline" },
  AUTO_RESOLVED: { label: "Auto-resolved", variant: "secondary" },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const config = invoiceStatusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: ExceptionSeverity }) {
  const config = severityConfig[severity];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function ExceptionStatusBadge({ status }: { status: ExceptionStatus }) {
  const config = exceptionStatusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
