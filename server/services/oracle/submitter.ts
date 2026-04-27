/**
 * Oracle Fusion AP submission service
 *
 * Two submission paths:
 *  1. Direct REST API  — single invoice, immediate (no UCM/ESS required)
 *  2. FBDI/UCM + ESS  — batch of invoices via Oracle's bulk import mechanism
 *
 * Both paths are skipped in dev mode; they return a mocked response.
 */

import type { OracleRestClient } from "./client";

// ── Direct REST API submission (single invoice) ───────────────────────────────

export interface OracleInvoicePayload {
  InvoiceNumber:   string;
  InvoiceType:     string;
  BusinessUnit:    string;
  Supplier:        string;
  SupplierSite:    string;
  InvoiceDate:     string;   // "YYYY-MM-DD"
  InvoiceCurrency: string;
  InvoiceAmount:   number;
  PaymentTerms?:   string;
  Description?:    string;
  invoiceLines?:   OracleInvoiceLine[];
}

export interface OracleInvoiceLine {
  LineNumber:    number;
  LineType:      string;
  LineAmount:    number;   // Oracle field name — NOT "Amount"
  Description?:  string;
  Quantity?:     number;
  UnitPrice?:    number;
  PONumber?:     string;
}

export interface OracleSubmitResult {
  oracleInvoiceId:  string;
  oracleInvoiceNum: string;
  oracleStatus:     string;
}

export async function submitInvoiceDirect(
  client: OracleRestClient,
  payload: OracleInvoicePayload
): Promise<OracleSubmitResult> {
  const res = await client.post<{ InvoiceId: number | string; InvoiceNumber: string; Status: string }>(
    "/fscmRestApi/resources/11.13.18.05/invoices",
    payload
  );
  return {
    oracleInvoiceId:  String(res.InvoiceId),   // Oracle returns numeric ID; schema expects String
    oracleInvoiceNum: res.InvoiceNumber,
    oracleStatus:     res.Status ?? "NEEDS_VALIDATION",
  };
}

// ── FBDI batch via UCM + ESS ──────────────────────────────────────────────────

export interface UCMUploadResult {
  ucmDocId:    string;
  documentName: string;
}

export async function uploadFBDIToUCM(
  client: OracleRestClient,
  headerCsv: string,
  linesCsv:  string,
  batchId:   string
): Promise<UCMUploadResult> {
  // Oracle expects a zip containing both CSV files.
  // We encode each CSV as base64 and send them via the ERP Integrations REST API.
  // In production you'd zip them first; for the initial implementation we upload
  // via the single-file endpoint — Oracle accepts the headers CSV directly.
  const docName = `APINVOICES_${batchId.slice(0, 8).toUpperCase()}_HDR.csv`;
  const content = Buffer.from(headerCsv, "utf-8").toString("base64");

  const res = await client.post<{ DocumentId: string }>(
    "/fscmRestApi/resources/11.13.18.05/erpintegrations",
    {
      OperationName:   "uploadFileToUCM",
      DocumentContent: content,
      DocumentName:    docName,
      ContentType:     "csv",
      FileType:        "csv",
      UCMAccount:      "fin$/payables$/import$",
    }
  );

  // Upload lines CSV separately
  const linesDocName = `APINVOICES_${batchId.slice(0, 8).toUpperCase()}_LNS.csv`;
  const linesContent = Buffer.from(linesCsv, "utf-8").toString("base64");
  await client.post(
    "/fscmRestApi/resources/11.13.18.05/erpintegrations",
    {
      OperationName:   "uploadFileToUCM",
      DocumentContent: linesContent,
      DocumentName:    linesDocName,
      ContentType:     "csv",
      FileType:        "csv",
      UCMAccount:      "fin$/payables$/import$",
    }
  );

  return { ucmDocId: res.DocumentId, documentName: docName };
}

export interface ESSJobResult {
  oracleJobId: string;
  status:      string;
}

export async function submitESSJob(
  client: OracleRestClient,
  ucmDocId: string,
  buId: string,
  batchId: string
): Promise<ESSJobResult> {
  const res = await client.post<{ ReqstId: string; status: string }>(
    "/fscmRestApi/resources/11.13.18.05/erpintegrations",
    {
      OperationName:  "submitESSJobRequest",
      JobPackageName: "oracle/apps/ess/financials/payables/invoices/processes",
      JobDefName:     "APImportBatchEss",
      ESSParameters:  `${ucmDocId},${buId},BulkAP,,,,,,,,,${batchId}`,
      ReqstId:        null,
    }
  );
  return { oracleJobId: String(res.ReqstId), status: res.status ?? "RUNNING" };
}

// ── Job status poll ───────────────────────────────────────────────────────────

export async function pollESSJobStatus(
  client: OracleRestClient,
  jobId: string
): Promise<"RUNNING" | "SUCCEEDED" | "FAILED"> {
  const res = await client.get<{ requestStatus: string }>(
    `/fscmRestApi/resources/11.13.18.05/erpintegrations`,
    { ReqstId: jobId }
  );
  const s = (res.requestStatus ?? "").toUpperCase();
  if (s === "SUCCEEDED" || s === "COMPLETED") return "SUCCEEDED";
  if (s === "FAILED"    || s === "ERROR")     return "FAILED";
  return "RUNNING";
}
