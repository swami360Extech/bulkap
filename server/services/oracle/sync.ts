/**
 * Oracle Fusion AP invoice status sync
 *
 * Queries Oracle's REST API for the current status of submitted invoices
 * and maps them back to our InvoiceStatus enum.
 */

import type { OracleRestClient } from "./client";

interface OracleInvoiceStatus {
  InvoiceId:      string;
  InvoiceNumber:  string;
  Status:         string;   // VALIDATED, NEEDS_VALIDATION, CANCELLED
  ApprovalStatus: string;   // MANUALLY APPROVED, NOT REQUIRED, REQUIRED
  PaymentStatus:  string;   // Paid, Partially Paid, Unpaid
  HoldCode:       string | null;
  HoldReason:     string | null;
  PaymentReference: string | null;
  ApprovedDate:   string | null;
  PaymentDate:    string | null;
}

export type SyncedStatus = "ORACLE_PROCESSING" | "APPROVED" | "PAID" | "CANCELLED" | "ORACLE_ERROR";

export interface InvoiceSyncResult {
  oracleInvoiceId: string;
  status:          SyncedStatus;
  oracleStatus:    string;
  holdReason:      string | null;
  paymentRef:      string | null;
  approvedAt:      Date | null;
  paidAt:          Date | null;
}

function mapOracleStatus(inv: OracleInvoiceStatus): SyncedStatus {
  if (inv.Status === "CANCELLED") return "CANCELLED";
  if (inv.HoldCode)               return "ORACLE_ERROR";
  if (inv.PaymentStatus === "Paid" || inv.PaymentStatus === "PAID") return "PAID";
  if (inv.ApprovalStatus === "MANUALLY APPROVED" || inv.ApprovalStatus === "NOT REQUIRED") return "APPROVED";
  return "ORACLE_PROCESSING";
}

export async function fetchOracleInvoiceStatus(
  client: OracleRestClient,
  oracleInvoiceId: string
): Promise<InvoiceSyncResult> {
  const res = await client.get<{ items: OracleInvoiceStatus[] }>(
    "/fscmRestApi/resources/11.13.18.05/invoices",
    {
      q:      `InvoiceId=${oracleInvoiceId}`,
      fields: "InvoiceId,InvoiceNumber,Status,ApprovalStatus,PaymentStatus,HoldCode,HoldReason,PaymentReference,ApprovedDate,PaymentDate",
      limit:  1,
    }
  );

  const inv = res.items?.[0];
  if (!inv) throw new Error(`Oracle invoice ${oracleInvoiceId} not found`);

  return {
    oracleInvoiceId,
    status:      mapOracleStatus(inv),
    oracleStatus: inv.Status,
    holdReason:  inv.HoldReason ?? null,
    paymentRef:  inv.PaymentReference ?? null,
    approvedAt:  inv.ApprovedDate ? new Date(inv.ApprovedDate) : null,
    paidAt:      inv.PaymentDate  ? new Date(inv.PaymentDate)  : null,
  };
}

// ── Dev-mode simulation ───────────────────────────────────────────────────────
// Steps through SUBMITTED → ORACLE_PROCESSING → APPROVED on successive calls.

export function simulateSyncResult(currentStatus: string, submittedAt: Date | null): InvoiceSyncResult {
  const ageMs = submittedAt ? Date.now() - submittedAt.getTime() : 0;

  let status: SyncedStatus;
  if (currentStatus === "SUBMITTED") {
    status = "ORACLE_PROCESSING";
  } else if (currentStatus === "ORACLE_PROCESSING") {
    // After 30 seconds in demo, show as APPROVED
    status = ageMs > 30_000 ? "APPROVED" : "ORACLE_PROCESSING";
  } else {
    status = currentStatus as SyncedStatus;
  }

  return {
    oracleInvoiceId: `DEMO-${Date.now()}`,
    status,
    oracleStatus:    status === "APPROVED" ? "VALIDATED" : "VALIDATED",
    holdReason:      null,
    paymentRef:      status === "APPROVED" ? `PAY-REF-${Math.floor(Math.random() * 90000) + 10000}` : null,
    approvedAt:      status === "APPROVED" ? new Date() : null,
    paidAt:          null,
  };
}
