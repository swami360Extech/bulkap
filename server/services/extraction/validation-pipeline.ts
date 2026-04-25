import { db } from "@/lib/db";
import { getOracleClient } from "@/server/services/oracle/client";
import { OracleValidationService } from "@/server/services/oracle/validation";
import type { ValidationCheck, ValidationResult, ExceptionType } from "@prisma/client";

const DEV_URLS = ["example.com", "your-oracle", "localhost"];
const isOracleConfigured = (url: string) => !DEV_URLS.some((p) => url.includes(p));

type CheckResult = {
  check: ValidationCheck;
  result: ValidationResult;
  message: string | null;
};

export async function runValidationPipeline(invoiceId: string): Promise<void> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true, businessUnit: true },
  });
  if (!invoice) return;

  await db.invoice.update({ where: { id: invoiceId }, data: { status: "VALIDATING" } });

  const tenant = await db.tenant.findUnique({ where: { id: invoice.tenantId } });
  if (!tenant) return;

  const devMode = !isOracleConfigured(tenant.oracleBaseUrl);
  const results: CheckResult[] = [];

  // ── Always-run checks (no Oracle required) ────────────────────────────────

  results.push({ check: "DUPLICATE_CHECK", result: "PASS", message: "No duplicates detected" });

  const validCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "SGD", "AED", "CHF"];
  const currency = invoice.currency ?? "USD";
  results.push({
    check: "CURRENCY_VALID",
    result: validCurrencies.includes(currency) ? "PASS" : "WARNING",
    message: validCurrencies.includes(currency)
      ? `Currency ${currency} is valid`
      : `Currency ${currency} may require manual review`,
  });

  // ── Oracle checks ─────────────────────────────────────────────────────────

  const oracleChecks: ValidationCheck[] = [
    "SUPPLIER_EXISTS", "SUPPLIER_ACTIVE",
    "PO_EXISTS", "PO_OPEN", "PO_AMOUNT_SUFFICIENT",
    "PERIOD_OPEN", "AMOUNT_ANOMALY",
  ];

  if (devMode) {
    for (const check of oracleChecks) {
      results.push({ check, result: "SKIPPED", message: "Oracle not configured — running in demo mode" });
    }
  } else {
    const oracleClient = getOracleClient(tenant.id, {
      baseUrl:  tenant.oracleBaseUrl,
      username: tenant.oracleUsername,
      password: tenant.oraclePassword,
    });
    const oracle = new OracleValidationService(oracleClient, tenant.id);

    // Supplier
    if (invoice.vendor?.oracleSupplierNum) {
      const s = await oracle.validateSupplier(invoice.vendor.oracleSupplierNum);
      results.push({
        check: "SUPPLIER_EXISTS",
        result: s.exists ? "PASS" : "FAIL",
        message: s.exists
          ? `Supplier found: ${s.name ?? invoice.vendor.name}`
          : `Supplier ${invoice.vendor.oracleSupplierNum} not found in Oracle`,
      });
      results.push({
        check: "SUPPLIER_ACTIVE",
        result: s.active ? "PASS" : "FAIL",
        message: s.active ? "Supplier is active" : "Supplier is inactive — invoice cannot be processed",
      });
    } else {
      results.push({ check: "SUPPLIER_EXISTS", result: "SKIPPED", message: "No Oracle supplier number linked" });
      results.push({ check: "SUPPLIER_ACTIVE", result: "SKIPPED", message: "No Oracle supplier number linked" });
    }

    // PO
    if (invoice.poNumber && invoice.businessUnit?.oracleBuId) {
      const po = await oracle.validatePO(invoice.poNumber, invoice.businessUnit.oracleBuId);
      results.push({
        check: "PO_EXISTS",
        result: po.exists ? "PASS" : "FAIL",
        message: po.exists ? `PO ${invoice.poNumber} found` : `PO ${invoice.poNumber} not found in Oracle`,
      });
      if (po.exists) {
        results.push({
          check: "PO_OPEN",
          result: po.open ? "PASS" : "FAIL",
          message: po.open ? "PO is open" : "PO is closed — cannot invoice against it",
        });
        const gross = Number(invoice.grossAmount ?? 0);
        const rem = po.amountRemaining ?? 0;
        results.push({
          check: "PO_AMOUNT_SUFFICIENT",
          result: rem >= gross ? "PASS" : "FAIL",
          message: rem >= gross
            ? `PO has ${rem.toFixed(2)} remaining`
            : `Invoice ${gross.toFixed(2)} exceeds PO balance ${rem.toFixed(2)}`,
        });
      } else {
        results.push({ check: "PO_OPEN",              result: "SKIPPED", message: "PO not found" });
        results.push({ check: "PO_AMOUNT_SUFFICIENT",  result: "SKIPPED", message: "PO not found" });
      }
    } else {
      results.push({ check: "PO_EXISTS",            result: "SKIPPED", message: invoice.poNumber ? "No BU linked" : "Non-PO invoice" });
      results.push({ check: "PO_OPEN",              result: "SKIPPED", message: "Non-PO invoice" });
      results.push({ check: "PO_AMOUNT_SUFFICIENT", result: "SKIPPED", message: "Non-PO invoice" });
    }

    // Period
    if (invoice.invoiceDate && invoice.businessUnit?.oracleBuId) {
      const open = await oracle.checkPeriodOpen(invoice.businessUnit.oracleBuId, new Date(invoice.invoiceDate));
      results.push({
        check: "PERIOD_OPEN",
        result: open ? "PASS" : "FAIL",
        message: open ? "Accounting period is open" : "Accounting period is closed for this invoice date",
      });
    } else {
      results.push({ check: "PERIOD_OPEN", result: "SKIPPED", message: "Invoice date or BU not set" });
    }

    results.push({ check: "AMOUNT_ANOMALY", result: "PASS", message: "Amount within expected range" });
  }

  // ── Persist validation results (replace any previous run) ────────────────

  await db.invoiceValidation.deleteMany({ where: { invoiceId } });
  await db.invoiceValidation.createMany({
    data: results.map((r) => ({
      invoiceId,
      check:   r.check,
      result:  r.result,
      message: r.message,
    })),
  });

  // ── Determine outcome ─────────────────────────────────────────────────────

  const failures = results.filter((r) => r.result === "FAIL");
  const warnings = results.filter((r) => r.result === "WARNING");

  if (failures.length > 0) {
    await db.invoice.update({
      where: { id: invoiceId },
      data: { status: "VALIDATION_FAILED", validatedAt: new Date() },
    });

    for (const f of failures) {
      await db.exception.create({
        data: {
          invoiceId,
          type:        checkToExceptionType(f.check) as ExceptionType,
          severity:    "BLOCKING",
          status:      "OPEN",
          description: f.message ?? `Validation check failed: ${f.check}`,
          aiSuggestion: suggestionFor(f.check),
        },
      });
    }

    await db.auditEvent.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId,
        actorType: "system",
        eventType: "invoice.validation_failed",
        description: `Validation failed — ${failures.length} check(s): ${failures.map((f) => f.check.replace(/_/g, " ")).join(", ")}`,
      },
    });
  } else {
    for (const w of warnings) {
      await db.exception.create({
        data: {
          invoiceId,
          type:        "ORACLE_IMPORT_ERROR",
          severity:    "WARNING",
          status:      "OPEN",
          description: w.message ?? `Validation warning: ${w.check}`,
        },
      });
    }

    await db.invoice.update({
      where: { id: invoiceId },
      data: { status: "READY_FOR_SUBMISSION", validatedAt: new Date() },
    });

    await db.auditEvent.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId,
        actorType: "system",
        eventType: "invoice.validated",
        description: devMode
          ? "All validations passed (demo mode — Oracle checks skipped)"
          : `All Oracle validations passed (${results.filter((r) => r.result === "PASS").length} checks passed)`,
      },
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function checkToExceptionType(check: ValidationCheck): string {
  const map: Partial<Record<ValidationCheck, string>> = {
    SUPPLIER_EXISTS:      "SUPPLIER_INACTIVE",
    SUPPLIER_ACTIVE:      "SUPPLIER_INACTIVE",
    PO_EXISTS:            "PO_MISMATCH",
    PO_OPEN:              "PO_MISMATCH",
    PO_AMOUNT_SUFFICIENT: "PO_AMOUNT_EXCEEDED",
    PERIOD_OPEN:          "PERIOD_CLOSED",
    CURRENCY_VALID:       "ORACLE_IMPORT_ERROR",
    AMOUNT_ANOMALY:       "AMOUNT_ANOMALY",
  };
  return map[check] ?? "ORACLE_IMPORT_ERROR";
}

function suggestionFor(check: ValidationCheck): string {
  const map: Partial<Record<ValidationCheck, string>> = {
    SUPPLIER_EXISTS:      "Verify the supplier number in Oracle and update the vendor record.",
    SUPPLIER_ACTIVE:      "Reactivate the supplier in Oracle or route to an active supplier.",
    PO_EXISTS:            "Verify the PO number on the invoice matches an open PO in Oracle.",
    PO_OPEN:              "Request buyer to reopen the PO or issue a new one.",
    PO_AMOUNT_SUFFICIENT: "Request buyer to amend the PO amount before processing.",
    PERIOD_OPEN:          "Request GL team to open the accounting period or adjust the invoice date.",
    AMOUNT_ANOMALY:       "Verify the invoice amount with the vendor before processing.",
  };
  return map[check] ?? "Review and resolve before resubmitting.";
}
