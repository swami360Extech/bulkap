import { db } from "@/lib/db";
import type { Invoice } from "@prisma/client";
import crypto from "crypto";

// Supported MIME types and their invoice-friendly names
const MIME_MAP: Record<string, string> = {
  "application/pdf":  "PDF",
  "image/jpeg":       "IMAGE",
  "image/png":        "IMAGE",
  "text/csv":         "CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "EXCEL",
  "application/vnd.ms-excel": "EXCEL",
  "text/xml":         "XML",
  "application/xml":  "XML",
};

export type DocumentFormat = "PDF" | "IMAGE" | "CSV" | "EXCEL" | "XML" | "UNKNOWN";

export function detectFormat(mimeType: string): DocumentFormat {
  return (MIME_MAP[mimeType] as DocumentFormat) ?? "UNKNOWN";
}

// Stub extraction result — real impl calls Azure Document Intelligence
export interface ExtractionResult {
  fields: Array<{ name: string; value: string | null; confidence: number }>;
  lines: Array<{
    lineNumber: number;
    description: string | null;
    quantity: number | null;
    unitPrice: number | null;
    lineAmount: number;
    poNumber: string | null;
    glAccount: string | null;
  }>;
  invoiceType: string;
  contentHash: string;
}

export async function runExtractionPipeline(invoiceId: string): Promise<void> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return;

  await db.invoice.update({ where: { id: invoiceId }, data: { status: "EXTRACTING", extractedAt: new Date() } });

  try {
    const result = await extractDocument(invoice);

    // Compute content hash for duplicate detection
    const hashInput = `${invoice.vendorId}:${result.fields.find((f) => f.name === "gross_amount")?.value}:${result.fields.find((f) => f.name === "invoice_date")?.value}`;
    const contentHash = crypto.createHash("sha256").update(hashInput).digest("hex");

    // Check for duplicates before writing
    const duplicate = await db.invoice.findFirst({
      where: { contentHash, tenantId: invoice.tenantId, id: { not: invoiceId } },
    });

    if (duplicate) {
      await db.invoice.update({ where: { id: invoiceId }, data: { status: "DUPLICATE", contentHash } });
      await db.exception.create({
        data: {
          invoiceId,
          type: "DUPLICATE",
          severity: "BLOCKING",
          description: `Possible duplicate of invoice ${duplicate.externalInvoiceNum ?? duplicate.id.slice(0, 8)} submitted on ${duplicate.receivedAt.toDateString()}`,
          aiSuggestion: "Verify with vendor if this is a resubmission or a correction before proceeding.",
        },
      });
      return;
    }

    // Persist extracted fields
    const avgConf = result.fields.length > 0
      ? result.fields.reduce((s, f) => s + f.confidence, 0) / result.fields.length
      : 0;

    await db.$transaction([
      ...result.fields.map((f) =>
        db.invoiceField.upsert({
          where: { invoiceId_fieldName: { invoiceId, fieldName: f.name } },
          create: { invoiceId, fieldName: f.name, extractedValue: f.value, confidence: f.confidence },
          update: { extractedValue: f.value, confidence: f.confidence },
        })
      ),
      ...result.lines.map((l) =>
        db.invoiceLine.create({
          data: {
            invoiceId,
            lineNumber: l.lineNumber,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineAmount: l.lineAmount,
            poNumber: l.poNumber,
            glAccount: l.glAccount,
          },
        })
      ),
      db.invoice.update({
        where: { id: invoiceId },
        data: {
          extractionAvgConf: avgConf,
          contentHash,
          reviewRequired: avgConf < 0.80,
          status: avgConf < 0.80 ? "REVIEW_REQUIRED" : "VALIDATING",
        },
      }),
    ]);

    await db.auditEvent.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId,
        actorType: "system",
        eventType: "invoice.extracted",
        description: `AI extraction complete — ${result.fields.length} fields, avg confidence ${Math.round(avgConf * 100)}%`,
      },
    });

    if (avgConf < 0.80) {
      await db.exception.create({
        data: {
          invoiceId,
          type: "LOW_CONFIDENCE_EXTRACTION",
          severity: "WARNING",
          description: `Average extraction confidence is ${Math.round(avgConf * 100)}% — ${result.fields.filter((f) => f.confidence < 0.80).length} fields need review`,
          aiSuggestion: "Review highlighted low-confidence fields and confirm or correct values before Oracle submission.",
        },
      });
    }
  } catch (err) {
    await db.invoice.update({ where: { id: invoiceId }, data: { status: "VALIDATION_FAILED" } });
    await db.auditEvent.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId,
        actorType: "system",
        eventType: "invoice.extraction_failed",
        description: `Extraction failed: ${String(err)}`,
      },
    });
  }
}

// Stub — replace with Azure Document Intelligence call in Sprint 3
async function extractDocument(_invoice: Invoice): Promise<ExtractionResult> {
  // In production: call Azure Document Intelligence prebuilt-invoice model
  // const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key))
  // const poller = await client.beginAnalyzeDocument("prebuilt-invoice", documentStream)
  // const result = await poller.pollUntilDone()

  return {
    fields: [
      { name: "vendor_name",   value: null, confidence: 0.5 },
      { name: "invoice_number",value: null, confidence: 0.5 },
      { name: "invoice_date",  value: null, confidence: 0.5 },
      { name: "gross_amount",  value: null, confidence: 0.5 },
    ],
    lines: [],
    invoiceType: "UNKNOWN",
    contentHash: "",
  };
}
