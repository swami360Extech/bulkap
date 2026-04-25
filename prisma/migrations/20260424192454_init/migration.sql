-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AP_MANAGER', 'AP_CLERK', 'APPROVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('STANDARD_PO', 'NON_PO_SERVICE', 'CREDIT_MEMO', 'DEBIT_MEMO', 'PREPAYMENT', 'RECURRING', 'FREIGHT', 'CAPITAL_EXPENDITURE', 'INTERCOMPANY', 'FOREIGN_CURRENCY', 'TAX_ONLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('RECEIVED', 'CLASSIFYING', 'EXTRACTING', 'REVIEW_REQUIRED', 'VALIDATING', 'VALIDATION_FAILED', 'READY_FOR_SUBMISSION', 'SUBMITTING', 'SUBMITTED', 'ORACLE_PROCESSING', 'ORACLE_ERROR', 'APPROVED', 'PAID', 'CANCELLED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "SourceChannel" AS ENUM ('MANUAL_UPLOAD', 'EMAIL', 'SFTP', 'API', 'EDI');

-- CreateEnum
CREATE TYPE "LineMatchStatus" AS ENUM ('MATCHED', 'TOLERANCE_BREACH', 'PRICE_MISMATCH', 'QTY_MISMATCH', 'RECEIPT_PENDING', 'NO_PO');

-- CreateEnum
CREATE TYPE "ValidationCheck" AS ENUM ('SUPPLIER_EXISTS', 'SUPPLIER_ACTIVE', 'SUPPLIER_SITE_VALID', 'PO_EXISTS', 'PO_OPEN', 'PO_AMOUNT_SUFFICIENT', 'RECEIPT_EXISTS', 'THREE_WAY_MATCH', 'GL_ACCOUNT_VALID', 'TAX_CODE_VALID', 'PERIOD_OPEN', 'CURRENCY_VALID', 'DUPLICATE_CHECK', 'CROSS_BU_DUPLICATE', 'AMOUNT_ANOMALY', 'BANK_CHANGE_DETECTED');

-- CreateEnum
CREATE TYPE "ValidationResult" AS ENUM ('PASS', 'FAIL', 'WARNING', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('DUPLICATE', 'CROSS_BU_DUPLICATE', 'PO_MISMATCH', 'PO_AMOUNT_EXCEEDED', 'RECEIPT_PENDING', 'GL_INVALID', 'TAX_ERROR', 'BANK_ACCOUNT_CHANGE', 'AMOUNT_ANOMALY', 'SUPPLIER_INACTIVE', 'PERIOD_CLOSED', 'LOW_CONFIDENCE_EXTRACTION', 'ORACLE_IMPORT_ERROR');

-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('BLOCKING', 'WARNING', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'WAIVED', 'AUTO_RESOLVED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ASSEMBLING', 'UPLOADED_TO_UCM', 'JOB_SUBMITTED', 'JOB_RUNNING', 'JOB_COMPLETED', 'JOB_FAILED', 'PARTIALLY_FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "oracleBaseUrl" TEXT NOT NULL,
    "oracleUsername" TEXT NOT NULL,
    "oraclePassword" TEXT NOT NULL,
    "legislationCode" TEXT NOT NULL DEFAULT 'US',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "oracleBuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ledgerCurrency" TEXT NOT NULL DEFAULT 'USD',
    "legislationCode" TEXT NOT NULL DEFAULT 'US',

    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AP_CLERK',
    "oraclePersonId" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "oracleSupplierId" TEXT NOT NULL,
    "oracleSupplierNum" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxRegistration" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "paymentTerms" TEXT,
    "country" TEXT,
    "exceptionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCycleTimeDays" DOUBLE PRECISION,
    "lastInvoiceAt" TIMESTAMP(3),

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBankAccount" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "oracleBankAcctId" TEXT,
    "bankName" TEXT NOT NULL,
    "accountNumberMask" TEXT NOT NULL,
    "routingNumber" TEXT,
    "iban" TEXT,
    "swift" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "changeRequestedAt" TIMESTAMP(3),
    "changeStatus" TEXT,

    CONSTRAINT "VendorBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buId" TEXT,
    "vendorId" TEXT,
    "sourceChannel" "SourceChannel" NOT NULL,
    "sourceRef" TEXT,
    "documentUrl" TEXT NOT NULL,
    "documentMimeType" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL DEFAULT 'UNKNOWN',
    "classificationConf" DOUBLE PRECISION,
    "externalInvoiceNum" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currency" TEXT,
    "grossAmount" DECIMAL(18,4),
    "taxAmount" DECIMAL(18,4),
    "netAmount" DECIMAL(18,4),
    "poNumber" TEXT,
    "paymentTerms" TEXT,
    "earlyPayDiscountPct" DECIMAL(5,4),
    "earlyPayDiscountDate" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "extractionAvgConf" DOUBLE PRECISION,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "oracleInvoiceId" TEXT,
    "oracleInvoiceNum" TEXT,
    "oracleStatus" TEXT,
    "oracleHoldReason" TEXT,
    "fbdiBatchId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "oracleApprovedAt" TIMESTAMP(3),
    "oraclePaidAt" TIMESTAMP(3),
    "oraclePaymentRef" TEXT,
    "contentHash" TEXT,
    "semanticHash" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceField" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "extractedValue" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "boundingBox" JSONB,
    "manuallyReviewed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedValue" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,

    CONSTRAINT "InvoiceField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,4),
    "unitPrice" DECIMAL(18,4),
    "lineAmount" DECIMAL(18,4) NOT NULL,
    "taxCode" TEXT,
    "taxAmount" DECIMAL(18,4),
    "poNumber" TEXT,
    "poLineNumber" INTEGER,
    "oraclePoLineId" TEXT,
    "oraclePoShipId" TEXT,
    "receiptNumber" TEXT,
    "oracleReceiptId" TEXT,
    "glAccount" TEXT,
    "projectId" TEXT,
    "taskId" TEXT,
    "expenditureType" TEXT,
    "matchStatus" "LineMatchStatus",
    "oracleLineId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceValidation" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "check" "ValidationCheck" NOT NULL,
    "result" "ValidationResult" NOT NULL,
    "message" TEXT,
    "oraclePayload" JSONB,
    "oracleResponse" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exception" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "oracleHoldName" TEXT,
    "aiSuggestion" TEXT,
    "assignedTo" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolutionAction" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FBDIBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buId" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'ASSEMBLING',
    "invoiceCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "ucmDocId" TEXT,
    "oracleJobId" TEXT,
    "oracleJobStatus" TEXT,
    "errorLog" TEXT,
    "assembledAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FBDIBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorIp" TEXT,
    "eventType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "oraclePayload" JSONB,
    "oracleResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "BusinessUnit_tenantId_idx" ON "BusinessUnit"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_tenantId_oracleBuId_key" ON "BusinessUnit"("tenantId", "oracleBuId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_idx" ON "Vendor"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_tenantId_oracleSupplierId_key" ON "Vendor"("tenantId", "oracleSupplierId");

-- CreateIndex
CREATE INDEX "VendorBankAccount_vendorId_idx" ON "VendorBankAccount"("vendorId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_vendorId_idx" ON "Invoice"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_receivedAt_idx" ON "Invoice"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "Invoice_contentHash_idx" ON "Invoice"("contentHash");

-- CreateIndex
CREATE INDEX "Invoice_oracleInvoiceId_idx" ON "Invoice"("oracleInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceField_invoiceId_idx" ON "InvoiceField"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceField_invoiceId_fieldName_key" ON "InvoiceField"("invoiceId", "fieldName");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceValidation_invoiceId_idx" ON "InvoiceValidation"("invoiceId");

-- CreateIndex
CREATE INDEX "Exception_invoiceId_idx" ON "Exception"("invoiceId");

-- CreateIndex
CREATE INDEX "Exception_status_severity_idx" ON "Exception"("status", "severity");

-- CreateIndex
CREATE INDEX "Exception_assignedTo_idx" ON "Exception"("assignedTo");

-- CreateIndex
CREATE INDEX "FBDIBatch_tenantId_status_idx" ON "FBDIBatch"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_invoiceId_idx" ON "AuditEvent"("invoiceId");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBankAccount" ADD CONSTRAINT "VendorBankAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_buId_fkey" FOREIGN KEY ("buId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_fbdiBatchId_fkey" FOREIGN KEY ("fbdiBatchId") REFERENCES "FBDIBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceField" ADD CONSTRAINT "InvoiceField_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceValidation" ADD CONSTRAINT "InvoiceValidation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FBDIBatch" ADD CONSTRAINT "FBDIBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
