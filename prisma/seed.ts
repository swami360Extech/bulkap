import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/bulkap?schema=public",
});
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  // Tenant
  const tenant = await db.tenant.upsert({
    where: { slug: "acme" },
    update: {
      oracleBaseUrl:  "https://fa-eqhy-dev7-saasfademo1.ds-fa.oraclepdemos.com",
      oracleUsername: "ROGER.BOLTON",
      oraclePassword: "tJ8yu%3%",
    },
    create: {
      name: "Acme Corp",
      slug: "acme",
      oracleBaseUrl:  "https://fa-eqhy-dev7-saasfademo1.ds-fa.oraclepdemos.com",
      oracleUsername: "ROGER.BOLTON",
      oraclePassword: "tJ8yu%3%",
      defaultCurrency: "USD",
      legislationCode: "US",
    },
  });

  // Business Unit — matches Oracle demo "US1 Business Unit"
  const bu = await db.businessUnit.upsert({
    where: { tenantId_oracleBuId: { tenantId: tenant.id, oracleBuId: "US1_BU_ID" } },
    update: { name: "US1 Business Unit" },
    create: {
      tenantId: tenant.id,
      name: "US1 Business Unit",
      oracleBuId: "US1_BU_ID",
      ledgerCurrency: "USD",
      legislationCode: "US",
    },
  });

  // Admin user
  const adminHash = await bcrypt.hash("Admin@123", 12);
  await db.user.upsert({
    where: { email: "admin@acme.com" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "admin@acme.com",
      name: "Admin User",
      passwordHash: adminHash,
      role: "ADMIN",
    },
  });

  // AP Clerk
  const clerkHash = await bcrypt.hash("Clerk@123", 12);
  await db.user.upsert({
    where: { email: "clerk@acme.com" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "clerk@acme.com",
      name: "AP Clerk",
      passwordHash: clerkHash,
      role: "AP_CLERK",
    },
  });

  // Vendors — mapped to real Oracle FA demo suppliers (fa-eqhy-dev7)
  const vendorDefs = [
    { name: "Lee Supplies",      oracleSupplierId: "300000047414503", oracleSupplierNum: "1252", oracleSupplierSite: "Lee US1"      },
    { name: "JGA",               oracleSupplierId: "300000047414635", oracleSupplierNum: "1254", oracleSupplierSite: "JGA US1"      },
    { name: "ABC Consulting",    oracleSupplierId: "300000075039541", oracleSupplierNum: "1288", oracleSupplierSite: "ABC US1"      },
    { name: "AllPros Consulting",oracleSupplierId: "300000047414571", oracleSupplierNum: "1253", oracleSupplierSite: "Staffing US1" },
  ];

  for (const v of vendorDefs) {
    await db.vendor.upsert({
      where: { tenantId_oracleSupplierId: { tenantId: tenant.id, oracleSupplierId: v.oracleSupplierId } },
      update: { name: v.name, oracleSupplierNum: v.oracleSupplierNum, oracleSupplierSite: v.oracleSupplierSite },
      create: { tenantId: tenant.id, ...v, defaultCurrency: "USD", exceptionRate: 0 },
    });
  }

  const vendor = await db.vendor.findFirst({
    where: { tenantId: tenant.id, oracleSupplierId: "300000001001" },
  });
  if (!vendor) throw new Error("Vendor not found after seeding");

  // Invoice 1 — newly received
  const inv1 = await db.invoice.create({
    data: {
      tenantId: tenant.id,
      buId: bu.id,
      vendorId: vendor.id,
      sourceChannel: "MANUAL_UPLOAD",
      status: "RECEIVED",
      documentUrl: "s3://bulkap-dev/invoices/inv-2024-001.pdf",
      documentMimeType: "application/pdf",
      originalFilename: "INV-2024-001.pdf",
      externalInvoiceNum: "INV-2024-001",
      invoiceDate: new Date("2024-03-15"),
      dueDate: new Date("2024-04-15"),
      currency: "USD",
      netAmount: 9500,
      taxAmount: 500,
      grossAmount: 10000,
      paymentTerms: "NET30",
      invoiceType: "STANDARD_PO",
    },
  });

  await db.auditEvent.create({
    data: {
      tenantId: tenant.id,
      invoiceId: inv1.id,
      actorType: "system",
      eventType: "invoice.received",
      description: "Invoice received via manual upload",
    },
  });

  // Invoice 2 — review required, has exceptions and AI extraction fields
  const inv2 = await db.invoice.create({
    data: {
      tenantId: tenant.id,
      buId: bu.id,
      vendorId: vendor.id,
      sourceChannel: "EMAIL",
      status: "REVIEW_REQUIRED",
      documentUrl: "s3://bulkap-dev/invoices/inv-2024-002.pdf",
      documentMimeType: "application/pdf",
      originalFilename: "INV-2024-002.pdf",
      externalInvoiceNum: "INV-2024-002",
      invoiceDate: new Date("2024-03-20"),
      dueDate: new Date("2024-04-20"),
      currency: "USD",
      netAmount: 19000,
      taxAmount: 1000,
      grossAmount: 20000,
      paymentTerms: "NET30",
      invoiceType: "NON_PO_SERVICE",
      reviewRequired: true,
      extractionAvgConf: 0.72,
      earlyPayDiscountPct: 0.02,
      earlyPayDiscountDate: new Date("2024-04-05"),
      extractedAt: new Date(),
    },
  });

  await db.invoiceField.createMany({
    data: [
      { invoiceId: inv2.id, fieldName: "vendor_name",    extractedValue: "TechSupply Inc", confidence: 0.95 },
      { invoiceId: inv2.id, fieldName: "invoice_number", extractedValue: "INV-2024-002",   confidence: 0.92 },
      { invoiceId: inv2.id, fieldName: "invoice_date",   extractedValue: "2024-03-20",     confidence: 0.88 },
      { invoiceId: inv2.id, fieldName: "gross_amount",   extractedValue: "20000.00",       confidence: 0.62 },
      { invoiceId: inv2.id, fieldName: "tax_amount",     extractedValue: "1000.00",        confidence: 0.55 },
      { invoiceId: inv2.id, fieldName: "po_number",      extractedValue: "PO-2024-0042",   confidence: 0.48 },
    ],
  });

  await db.invoiceLine.createMany({
    data: [
      { invoiceId: inv2.id, lineNumber: 1, description: "Cloud Infrastructure Q1", quantity: 1, unitPrice: 15000, lineAmount: 15000 },
      { invoiceId: inv2.id, lineNumber: 2, description: "Support & Maintenance",   quantity: 1, unitPrice: 4000,  lineAmount: 4000  },
    ],
  });

  await db.exception.create({
    data: {
      invoiceId: inv2.id,
      type: "LOW_CONFIDENCE_EXTRACTION",
      severity: "WARNING",
      status: "OPEN",
      description: "Average extraction confidence is 72% — 3 fields need review",
      aiSuggestion: "Review gross_amount, tax_amount, and po_number fields before Oracle submission.",
    },
  });

  await db.auditEvent.createMany({
    data: [
      {
        tenantId: tenant.id,
        invoiceId: inv2.id,
        actorType: "system",
        eventType: "invoice.received",
        description: "Invoice received via email",
      },
      {
        tenantId: tenant.id,
        invoiceId: inv2.id,
        actorType: "system",
        eventType: "invoice.extracted",
        description: "AI extraction complete — 6 fields, avg confidence 72%",
      },
    ],
  });

  // Invoice 3 — ready for submission
  const inv3 = await db.invoice.create({
    data: {
      tenantId: tenant.id,
      buId: bu.id,
      vendorId: vendor.id,
      sourceChannel: "API",
      status: "READY_FOR_SUBMISSION",
      documentUrl: "s3://bulkap-dev/invoices/inv-2024-003.pdf",
      documentMimeType: "application/pdf",
      originalFilename: "INV-2024-003.pdf",
      externalInvoiceNum: "INV-2024-003",
      invoiceDate: new Date("2024-03-25"),
      dueDate: new Date("2024-04-25"),
      currency: "USD",
      netAmount: 4750,
      taxAmount: 250,
      grossAmount: 5000,
      paymentTerms: "NET30",
      invoiceType: "STANDARD_PO",
      extractionAvgConf: 0.96,
      extractedAt: new Date(),
      validatedAt: new Date(),
    },
  });

  await db.invoiceValidation.createMany({
    data: [
      { invoiceId: inv3.id, check: "SUPPLIER_EXISTS",  result: "PASS", message: "Supplier verified in Oracle" },
      { invoiceId: inv3.id, check: "SUPPLIER_ACTIVE",  result: "PASS", message: null },
      { invoiceId: inv3.id, check: "PO_EXISTS",         result: "PASS", message: "PO-2024-0039 found" },
      { invoiceId: inv3.id, check: "PO_OPEN",           result: "PASS", message: null },
      { invoiceId: inv3.id, check: "GL_ACCOUNT_VALID",  result: "PASS", message: null },
      { invoiceId: inv3.id, check: "PERIOD_OPEN",       result: "PASS", message: "Mar-2024 is open" },
      { invoiceId: inv3.id, check: "DUPLICATE_CHECK",   result: "PASS", message: "No duplicates found" },
    ],
  });

  await db.auditEvent.createMany({
    data: [
      { tenantId: tenant.id, invoiceId: inv3.id, actorType: "system", eventType: "invoice.received",  description: "Invoice received via API" },
      { tenantId: tenant.id, invoiceId: inv3.id, actorType: "system", eventType: "invoice.extracted", description: "AI extraction complete — 8 fields, avg confidence 96%" },
      { tenantId: tenant.id, invoiceId: inv3.id, actorType: "system", eventType: "invoice.validated", description: "All Oracle validations passed" },
    ],
  });

  console.log("\nSeed complete.");
  console.log("  Tenant:  Acme Corp (slug: acme)");
  console.log("  Login credentials:");
  console.log("    admin@acme.com  / Admin@123  (ADMIN)");
  console.log("    clerk@acme.com  / Clerk@123  (AP_CLERK)");
  console.log("  Sample data: 3 invoices, 1 exception, validation results");
}

main().catch(console.error).finally(() => db.$disconnect());
