import { type OracleRestClient } from "./client";

interface SupplierValidation {
  exists: boolean;
  active: boolean;
  name?: string;
  supplierId?: string;
}

interface POValidation {
  exists: boolean;
  open?: boolean;
  currency?: string;
  amountLimit?: number;
  amountBilled?: number;
  amountRemaining?: number;
}

interface ReceiptValidation {
  receiptExists: boolean;
  receipts: Array<{ receiptNumber: string; receivedQty: number }>;
}

// In-process cache keyed by tenantId+resource
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export class OracleValidationService {
  constructor(private client: OracleRestClient, private tenantId: string) {}

  async validateSupplier(supplierNum: string): Promise<SupplierValidation> {
    const key = `${this.tenantId}:supplier:${supplierNum}`;
    const cached = cacheGet<SupplierValidation>(key);
    if (cached) return cached;

    try {
      const res = await this.client.get<{ items: Array<{ SupplierId: string; Supplier: string; SupplierType: string }> }>(
        "/fscmRestApi/resources/11.13.18.05/suppliers",
        { q: `SupplierNumber=${supplierNum}`, fields: "SupplierId,Supplier,SupplierType", limit: 1 }
      );
      const supplier = res.items?.[0];
      const result: SupplierValidation = {
        exists: !!supplier,
        active: supplier?.SupplierType !== "INACTIVE",
        name: supplier?.Supplier,
        supplierId: supplier?.SupplierId,
      };
      cacheSet(key, result, 15 * 60 * 1000); // 15 min TTL
      return result;
    } catch {
      return { exists: false, active: false };
    }
  }

  async validatePO(poNumber: string, buId: string): Promise<POValidation> {
    const key = `${this.tenantId}:po:${buId}:${poNumber}`;
    const cached = cacheGet<POValidation>(key);
    if (cached) return cached;

    try {
      const res = await this.client.get<{ items: Array<{ POHeaderId: string; Status: string; Amount: number; AmountBilled: number; CurrencyCode: string }> }>(
        "/fscmRestApi/resources/11.13.18.05/purchaseOrders",
        { q: `PONumber=${poNumber};BUId=${buId}`, fields: "POHeaderId,Status,Amount,AmountBilled,CurrencyCode", limit: 1 }
      );
      const po = res.items?.[0];
      if (!po) {
        const result: POValidation = { exists: false };
        cacheSet(key, result, 5 * 60 * 1000);
        return result;
      }
      const result: POValidation = {
        exists: true,
        open: po.Status === "OPEN",
        currency: po.CurrencyCode,
        amountLimit: po.Amount,
        amountBilled: po.AmountBilled,
        amountRemaining: po.Amount - po.AmountBilled,
      };
      cacheSet(key, result, 5 * 60 * 1000);
      return result;
    } catch {
      return { exists: false };
    }
  }

  async validateReceipt(poNumber: string): Promise<ReceiptValidation> {
    try {
      const res = await this.client.get<{ items: Array<{ ReceiptNumber: string; QuantityReceived: number }> }>(
        "/fscmRestApi/resources/11.13.18.05/receivingReceiptRequests",
        { q: `PONumber=${poNumber}`, fields: "ReceiptNumber,QuantityReceived", limit: 10 }
      );
      return {
        receiptExists: (res.items?.length ?? 0) > 0,
        receipts: (res.items ?? []).map((r) => ({ receiptNumber: r.ReceiptNumber, receivedQty: r.QuantityReceived })),
      };
    } catch {
      return { receiptExists: false, receipts: [] };
    }
  }

  async validateGLAccount(account: string, ledgerId: string): Promise<boolean> {
    const key = `${this.tenantId}:gl:${ledgerId}:${account}`;
    const cached = cacheGet<boolean>(key);
    if (cached !== null) return cached;

    try {
      const res = await this.client.get<{ count: number; items: Array<{ Enabled: boolean }> }>(
        `/fscmRestApi/resources/11.13.18.05/ledgers/${ledgerId}/accountCombinations`,
        { q: `Concatenated=${account}`, fields: "Enabled", limit: 1 }
      );
      const valid = (res.count ?? 0) > 0 && res.items?.[0]?.Enabled === true;
      cacheSet(key, valid, 15 * 60 * 1000);
      return valid;
    } catch {
      return false;
    }
  }

  async checkPeriodOpen(ledgerId: string, invoiceDate: Date): Promise<boolean> {
    const period = this.toPeriodName(invoiceDate);
    const key = `${this.tenantId}:period:${ledgerId}:${period}`;
    const cached = cacheGet<boolean>(key);
    if (cached !== null) return cached;

    try {
      const res = await this.client.get<{ items: Array<{ Status: string }> }>(
        `/fscmRestApi/resources/11.13.18.05/ledgers/${ledgerId}/accountingPeriods`,
        { q: `PeriodName=${period}`, fields: "Status", limit: 1 }
      );
      const open = res.items?.[0]?.Status === "Open";
      cacheSet(key, open, 5 * 60 * 1000);
      return open;
    } catch {
      return false;
    }
  }

  private toPeriodName(date: Date): string {
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" }).replace(" ", "-");
  }
}
