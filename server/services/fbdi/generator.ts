/**
 * Oracle AP FBDI CSV Generator
 *
 * Generates the two CSV files required by Oracle's FBDI AP invoice import:
 *   - AP_INVOICES_INTERFACE  (invoice headers)
 *   - AP_INVOICE_LINES_INTERFACE  (invoice lines)
 *
 * Oracle date format expected: DD-MON-YYYY (e.g. 15-APR-2025)
 */

import type { Invoice, Vendor, BusinessUnit, InvoiceLine } from "@prisma/client";

type InvoiceWithRelations = Invoice & {
  vendor:       Vendor | null;
  businessUnit: BusinessUnit | null;
  lines:        InvoiceLine[];
};

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function oraDate(d: Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  return `${String(dt.getUTCDate()).padStart(2,"0")}-${MONTHS[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields
    .map((v) => {
      const s = v == null ? "" : String(v);
      // Wrap in quotes if the value contains commas, quotes, or newlines
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(",");
}

function invoiceTypeCode(type: string): string {
  const map: Record<string, string> = {
    STANDARD_PO:        "STANDARD",
    NON_PO_SERVICE:     "STANDARD",
    CREDIT_MEMO:        "CREDIT",
    DEBIT_MEMO:         "DEBIT",
    PREPAYMENT:         "PREPAYMENT",
    RECURRING:          "STANDARD",
    FREIGHT:            "STANDARD",
    CAPITAL_EXPENDITURE:"STANDARD",
    INTERCOMPANY:       "STANDARD",
    FOREIGN_CURRENCY:   "STANDARD",
    TAX_ONLY:           "STANDARD",
    UNKNOWN:            "STANDARD",
  };
  return map[type] ?? "STANDARD";
}

export interface FBDIBundle {
  headerCsv: string;
  linesCsv:  string;
  rowCount:  number;
}

export function generateFBDI(invoices: InvoiceWithRelations[], batchId: string, source = "BulkAP"): FBDIBundle {
  const HEADER_COLS = [
    "INVOICE_INTERFACE_HEADER_ID",
    "INVOICE_NUM",
    "INVOICE_TYPE_LOOKUP_CODE",
    "INVOICE_DATE",
    "VENDOR_NUM",
    "VENDOR_SITE_CODE",
    "INVOICE_CURRENCY_CODE",
    "INVOICE_AMOUNT",
    "TERMS_NAME",
    "DESCRIPTION",
    "SOURCE",
    "ORG_ID",
    "GROUP_ID",
    "PO_NUMBER",
  ];

  const LINES_COLS = [
    "INVOICE_INTERFACE_HEADER_ID",
    "INVOICE_NUM",
    "LINE_NUMBER",
    "LINE_TYPE_LOOKUP_CODE",
    "AMOUNT",
    "DESCRIPTION",
    "QUANTITY_INVOICED",
    "UNIT_PRICE",
    "PO_NUMBER",
    "PO_LINE_NUMBER",
  ];

  const headerRows: string[] = [HEADER_COLS.join(",")];
  const lineRows:   string[] = [LINES_COLS.join(",")];

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    const headerId = i + 1; // sequential numeric ID for linking header ↔ lines

    headerRows.push(csvRow([
      headerId,
      inv.externalInvoiceNum ?? `BULKAP-${inv.id.slice(0, 8).toUpperCase()}`,
      invoiceTypeCode(inv.invoiceType),
      oraDate(inv.invoiceDate),
      inv.vendor?.oracleSupplierNum ?? "",
      "",  // VENDOR_SITE_CODE — omit, Oracle will use primary site
      inv.currency ?? "USD",
      inv.grossAmount != null ? Number(inv.grossAmount).toFixed(2) : "0.00",
      inv.paymentTerms ?? "NET30",
      `Imported via BulkAP batch ${batchId.slice(0, 8)}`,
      source,
      inv.businessUnit?.oracleBuId ?? "",
      batchId,
      inv.poNumber ?? "",
    ]));

    if (inv.lines.length === 0) {
      // Single synthetic line for invoices without extracted line detail
      lineRows.push(csvRow([
        headerId,
        inv.externalInvoiceNum ?? `BULKAP-${inv.id.slice(0, 8).toUpperCase()}`,
        1,
        "ITEM",
        inv.netAmount != null ? Number(inv.netAmount).toFixed(2) : Number(inv.grossAmount ?? 0).toFixed(2),
        "Invoice line",
        1,
        inv.netAmount != null ? Number(inv.netAmount).toFixed(2) : Number(inv.grossAmount ?? 0).toFixed(2),
        inv.poNumber ?? "",
        "",
      ]));

      if (inv.taxAmount && Number(inv.taxAmount) > 0) {
        lineRows.push(csvRow([
          headerId,
          inv.externalInvoiceNum ?? `BULKAP-${inv.id.slice(0, 8).toUpperCase()}`,
          2,
          "TAX",
          Number(inv.taxAmount).toFixed(2),
          "Tax",
          "",
          "",
          "",
          "",
        ]));
      }
    } else {
      for (const line of inv.lines) {
        lineRows.push(csvRow([
          headerId,
          inv.externalInvoiceNum ?? `BULKAP-${inv.id.slice(0, 8).toUpperCase()}`,
          line.lineNumber,
          "ITEM",
          Number(line.lineAmount).toFixed(2),
          line.description ?? "",
          line.quantity != null ? Number(line.quantity).toString() : "",
          line.unitPrice != null ? Number(line.unitPrice).toFixed(2) : "",
          line.poNumber ?? inv.poNumber ?? "",
          line.poLineNumber ?? "",
        ]));
      }
    }
  }

  return {
    headerCsv: headerRows.join("\r\n"),
    linesCsv:  lineRows.join("\r\n"),
    rowCount:  invoices.length,
  };
}
