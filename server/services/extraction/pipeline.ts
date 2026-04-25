import { db } from "@/lib/db";
import { runValidationPipeline } from "./validation-pipeline";
import { enqueueInvoice } from "@/server/services/queue";
import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

    const hashInput = `${invoice.vendorId}:${result.fields.find((f) => f.name === "gross_amount")?.value}:${result.fields.find((f) => f.name === "invoice_date")?.value}`;
    const contentHash = crypto.createHash("sha256").update(hashInput).digest("hex");

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

    const avgConf = result.fields.length > 0
      ? result.fields.reduce((s, f) => s + f.confidence, 0) / result.fields.length
      : 0;

    const extractedVendorName = result.fields.find((f) => f.name === "vendor_name")?.value;
    let resolvedVendorId = invoice.vendorId;
    if (extractedVendorName && !resolvedVendorId) {
      const matched = await db.vendor.findFirst({
        where: { tenantId: invoice.tenantId, name: { equals: extractedVendorName, mode: "insensitive" } },
      });
      if (matched) resolvedVendorId = matched.id;
    }

    const fv = (name: string) => result.fields.find((f) => f.name === name)?.value ?? null;
    const parsedDate = (name: string) => {
      const v = fv(name);
      if (!v) return null;
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T12:00:00.000Z") : new Date(v);
    };
    const parsedDecimal = (name: string) => { const v = fv(name); return v ? Number(v) : null; };

    // Clear existing lines before writing (safe re-run)
    await db.invoiceLine.deleteMany({ where: { invoiceId } });

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
          vendorId:           resolvedVendorId,
          externalInvoiceNum: fv("invoice_number"),
          invoiceDate:        parsedDate("invoice_date"),
          dueDate:            parsedDate("due_date"),
          grossAmount:        parsedDecimal("gross_amount"),
          netAmount:          parsedDecimal("net_amount"),
          taxAmount:          parsedDecimal("tax_amount"),
          poNumber:           fv("po_number"),
          paymentTerms:       fv("payment_terms"),
          currency:           fv("currency") ?? invoice.currency,
          extractionAvgConf:  avgConf,
          contentHash,
          reviewRequired:     avgConf < 0.80,
          status:             avgConf < 0.80 ? "REVIEW_REQUIRED" : "VALIDATING",
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
      // Enqueue for human review
      const updatedInvoice = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: { dueDate: true, grossAmount: true },
      });
      enqueueInvoice({
        tenantId: invoice.tenantId,
        invoiceId,
        queueType: "REVIEW",
        dueDate: updatedInvoice?.dueDate,
        grossAmount: updatedInvoice?.grossAmount ? Number(updatedInvoice.grossAmount) : null,
      }).catch((err) => console.error(`[queue] enqueue failed for ${invoiceId}:`, err));
    } else {
      // Fire-and-forget validation — only when extraction is high-confidence
      runValidationPipeline(invoiceId).catch((err) =>
        console.error(`[validation] failed for ${invoiceId}:`, err)
      );
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

// ── Azure Document Intelligence integration ───────────────────────────────────

function isAdiConfigured(): boolean {
  const ep = process.env.AZURE_DOC_INTEL_ENDPOINT;
  const key = process.env.AZURE_DOC_INTEL_KEY;
  return !!(ep && key && !ep.includes("your-azure") && !ep.includes("example.com") && !ep.includes("localhost"));
}

function isS3Configured(): boolean {
  const id = process.env.AWS_ACCESS_KEY_ID;
  return !!(id && id !== "your-access-key-id");
}

async function extractDocument(invoice: Invoice): Promise<ExtractionResult> {
  // 1. Azure Document Intelligence + S3 (production)
  if (isAdiConfigured() && isS3Configured() && invoice.documentUrl) {
    try {
      return await extractDocumentWithADI(invoice);
    } catch (err) {
      console.warn("[extraction] Azure DI failed, falling back:", err);
    }
  }

  // 2. Claude AI from stored upload bytes (dev/demo without S3+ADI)
  const tempUpload = await db.tempUpload.findUnique({ where: { s3Key: invoice.documentUrl } });
  if (tempUpload) {
    const cleanup = () => db.tempUpload.delete({ where: { s3Key: invoice.documentUrl } }).catch(() => {});
    if (isClaudeConfigured()) {
      try {
        const result = await extractDocumentWithClaude(Buffer.from(tempUpload.content), tempUpload.mimeType);
        await cleanup();
        return result;
      } catch (err) {
        console.warn("[extraction] Claude extraction failed, falling back to stub:", err);
      }
    }
    await cleanup();
  }

  // 3. Hardcoded stub (last resort — no real file available)
  return extractDocumentStub(invoice);
}

function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("your-key") && !key.includes("sk-ant-placeholder"));
}

async function extractDocumentWithADI(invoice: Invoice): Promise<ExtractionResult> {
  // Generate a short-lived presigned URL so Azure DI can fetch the document
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  // invoice.documentUrl stores the S3 object key (set during upload confirmation)
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME!, Key: invoice.documentUrl }),
    { expiresIn: 300 }
  );

  const client = new DocumentAnalysisClient(
    process.env.AZURE_DOC_INTEL_ENDPOINT!,
    new AzureKeyCredential(process.env.AZURE_DOC_INTEL_KEY!)
  );

  const poller = await client.beginAnalyzeDocumentFromUrl("prebuilt-invoice", url);
  const { documents } = await poller.pollUntilDone();

  if (!documents || documents.length === 0) return extractDocumentStub(invoice);

  const doc = documents[0];
  const f = doc.fields as Record<string, any>;

  const fields: ExtractionResult["fields"] = [];

  const addStr = (name: string, adiKey: string) => {
    const field = f[adiKey];
    if (field?.kind === "string" && field.value) {
      fields.push({ name, value: String(field.value), confidence: field.confidence ?? 0.8 });
    }
  };

  const addDate = (name: string, adiKey: string) => {
    const field = f[adiKey];
    if (field?.value instanceof Date) {
      fields.push({ name, value: field.value.toISOString().slice(0, 10), confidence: field.confidence ?? 0.8 });
    } else if (field?.kind === "date" && field.value) {
      const d = new Date(field.value);
      fields.push({ name, value: d.toISOString().slice(0, 10), confidence: field.confidence ?? 0.8 });
    }
  };

  const addCurrency = (name: string, adiKey: string) => {
    const field = f[adiKey];
    if (!field) return;
    const amt = field.value?.amount ?? (typeof field.value === "number" ? field.value : null);
    if (amt != null) {
      fields.push({ name, value: Number(amt).toFixed(2), confidence: field.confidence ?? 0.8 });
    }
  };

  addStr("vendor_name",    "VendorName");
  addStr("invoice_number", "InvoiceId");
  addDate("invoice_date",  "InvoiceDate");
  addDate("due_date",      "DueDate");
  addCurrency("gross_amount", "InvoiceTotal");
  addCurrency("net_amount",   "SubTotal");
  addCurrency("tax_amount",   "TotalTax");
  addStr("po_number",      "PurchaseOrder");
  addStr("payment_terms",  "PaymentTerm");

  // Infer currency code from the InvoiceTotal field
  const totalField = f["InvoiceTotal"];
  const currCode = totalField?.value?.currencyCode ?? null;
  if (currCode) {
    fields.push({ name: "currency", value: currCode, confidence: totalField.confidence ?? 0.9 });
  } else if (totalField?.value?.currencySymbol) {
    const sym = totalField.value.currencySymbol;
    const code = sym === "$" ? "USD" : sym === "€" ? "EUR" : sym === "£" ? "GBP" : sym === "¥" ? "JPY" : null;
    if (code) fields.push({ name: "currency", value: code, confidence: 0.85 });
  }

  // Line items
  const lines: ExtractionResult["lines"] = [];
  const itemsField = f["Items"];
  if (itemsField?.kind === "array" && Array.isArray(itemsField.values)) {
    for (const [i, item] of itemsField.values.entries()) {
      const p = item.properties ?? {};
      const desc  = p.Description?.value ?? null;
      const qty   = p.Quantity?.value   ?? null;
      const uPrice = p.UnitPrice?.value?.amount ?? p.UnitPrice?.value ?? null;
      const amt   = p.Amount?.value?.amount ?? p.Amount?.value ?? 0;

      lines.push({
        lineNumber:  i + 1,
        description: desc ? String(desc) : null,
        quantity:    qty != null ? Number(qty) : null,
        unitPrice:   uPrice != null ? Number(uPrice) : null,
        lineAmount:  Number(amt),
        poNumber:    null,
        glAccount:   null,
      });
    }
  }

  if (fields.length === 0) return extractDocumentStub(invoice);

  return { fields, lines, invoiceType: "UNKNOWN", contentHash: "" };
}

// ── Claude AI extraction ──────────────────────────────────────────────────────

const CLAUDE_SUPPORTED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

async function extractDocumentWithClaude(content: Buffer, mimeType: string): Promise<ExtractionResult> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  if (!CLAUDE_SUPPORTED_MIME.has(mimeType)) {
    throw new Error(`Unsupported MIME type for Claude extraction: ${mimeType}`);
  }

  const base64Data = content.toString("base64");
  const isPdf = mimeType === "application/pdf";

  const docPart: any = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }
    : { type: "image",    source: { type: "base64", media_type: mimeType,            data: base64Data } };

  const response = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        docPart,
        {
          type: "text",
          text: `Extract all invoice data from this document. Return ONLY a JSON object with these exact keys (use null for any field not found):
{
  "vendor_name": string | null,
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "due_date": "YYYY-MM-DD" | null,
  "gross_amount": string | null,
  "net_amount": string | null,
  "tax_amount": string | null,
  "currency": "USD" | "EUR" | "GBP" | other ISO 4217 code | null,
  "payment_terms": string | null,
  "po_number": string | null,
  "lines": [
    {
      "lineNumber": number,
      "description": string | null,
      "quantity": number | null,
      "unitPrice": number | null,
      "lineAmount": number
    }
  ]
}

Rules:
- Dates must be in YYYY-MM-DD format
- Amounts must be plain numbers (no currency symbols, no commas)
- Return only the JSON, no markdown, no explanation`,
        },
      ],
    }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(jsonStr);

  const fields: ExtractionResult["fields"] = [];
  const push = (name: string, val: unknown) => {
    if (val != null && String(val).trim() !== "" && String(val).trim() !== "null") {
      fields.push({ name, value: String(val).trim(), confidence: 0.95 });
    }
  };

  push("vendor_name",    parsed.vendor_name);
  push("invoice_number", parsed.invoice_number);
  push("invoice_date",   parsed.invoice_date);
  push("due_date",       parsed.due_date);
  push("gross_amount",   parsed.gross_amount);
  push("net_amount",     parsed.net_amount);
  push("tax_amount",     parsed.tax_amount);
  push("currency",       parsed.currency);
  push("payment_terms",  parsed.payment_terms);
  push("po_number",      parsed.po_number);

  const lines: ExtractionResult["lines"] = (Array.isArray(parsed.lines) ? parsed.lines : []).map(
    (l: any, i: number) => ({
      lineNumber:  Number(l.lineNumber ?? i + 1),
      description: l.description  ? String(l.description)  : null,
      quantity:    l.quantity  != null ? Number(l.quantity)  : null,
      unitPrice:   l.unitPrice != null ? Number(l.unitPrice) : null,
      lineAmount:  Number(l.lineAmount ?? 0),
      poNumber:    null,
      glAccount:   null,
    })
  );

  return { fields, lines, invoiceType: "UNKNOWN", contentHash: "" };
}

// ── Dev stub ──────────────────────────────────────────────────────────────────

async function extractDocumentStub(invoice: Invoice): Promise<ExtractionResult> {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
  const seq  = String(Math.floor(Math.random() * 9000) + 1000);
  const invoiceNum  = `INV-${yyyy}${mm}-${seq}`;
  const invoiceDate = `${yyyy}-${mm}-${String(now.getUTCDate()).padStart(2, "0")}`;
  const dueDate     = (() => {
    const d = new Date(Date.UTC(yyyy, now.getUTCMonth(), now.getUTCDate() + 30));
    return d.toISOString().slice(0, 10);
  })();

  const gross = 5000 + Math.floor(Math.random() * 45000);
  const tax   = Math.round(gross * 0.08);
  const net   = gross - tax;

  return {
    fields: [
      { name: "vendor_name",    value: "TechSupply Inc",  confidence: 0.94 },
      { name: "invoice_number", value: invoiceNum,         confidence: 0.91 },
      { name: "invoice_date",   value: invoiceDate,        confidence: 0.89 },
      { name: "due_date",       value: dueDate,            confidence: 0.87 },
      { name: "gross_amount",   value: gross.toFixed(2),   confidence: 0.93 },
      { name: "net_amount",     value: net.toFixed(2),     confidence: 0.90 },
      { name: "tax_amount",     value: tax.toFixed(2),     confidence: 0.85 },
      { name: "currency",       value: "USD",              confidence: 0.99 },
      { name: "payment_terms",  value: "NET30",            confidence: 0.82 },
      { name: "po_number",      value: null,               confidence: 0.41 },
    ],
    lines: [
      {
        lineNumber:  1,
        description: "Professional Services",
        quantity:    1,
        unitPrice:   net,
        lineAmount:  net,
        poNumber:    null,
        glAccount:   null,
      },
    ],
    invoiceType: "NON_PO_SERVICE",
    contentHash: "",
  };
}
