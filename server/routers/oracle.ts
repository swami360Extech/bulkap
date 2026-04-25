import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";
import axios from "axios";
import { clearOracleClientCache } from "@/server/services/oracle/client";

const connectionFields = z.object({
  label:    z.string().min(1).max(100),
  baseUrl:  z.string().url("Must be a valid URL"),
  username: z.string().min(1).max(200),
  password: z.string().min(1),
});

export const oracleRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.oracleConnection.findMany({
      where: { tenantId: ctx.session.user.tenantId },
      select: {
        id: true, label: true, baseUrl: true, username: true,
        isActive: true, lastTestedAt: true, lastTestOk: true, lastTestError: true,
        createdAt: true,
      },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
  }),

  add: managerProcedure
    .input(connectionFields.extend({ setActive: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      if (input.setActive) {
        await ctx.db.oracleConnection.updateMany({
          where: { tenantId, isActive: true },
          data:  { isActive: false },
        });
      }

      const conn = await ctx.db.oracleConnection.create({
        data: {
          tenantId,
          label:    input.label,
          baseUrl:  input.baseUrl,
          username: input.username,
          password: input.password,
          isActive: input.setActive,
        },
      });

      if (input.setActive) {
        await syncActiveToTenant(ctx.db as any, tenantId, conn);
        clearOracleClientCache(tenantId);
      }

      return { id: conn.id };
    }),

  update: managerProcedure
    .input(
      z.object({
        id:       z.string().uuid(),
        label:    z.string().min(1).max(100).optional(),
        baseUrl:  z.string().url().optional(),
        username: z.string().min(1).max(200).optional(),
        password: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const tenantId = ctx.session.user.tenantId;

      const existing = await ctx.db.oracleConnection.findFirst({ where: { id, tenantId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const updated = await ctx.db.oracleConnection.update({
        where: { id },
        data:  {
          ...(fields.label    !== undefined && { label:    fields.label }),
          ...(fields.baseUrl  !== undefined && { baseUrl:  fields.baseUrl }),
          ...(fields.username !== undefined && { username: fields.username }),
          ...(fields.password !== undefined && { password: fields.password }),
        },
      });

      if (updated.isActive) {
        await syncActiveToTenant(ctx.db as any, tenantId, updated);
        clearOracleClientCache(tenantId);
      }

      return { id };
    }),

  remove: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      const conn = await ctx.db.oracleConnection.findFirst({ where: { id: input.id, tenantId } });
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });

      if (conn.isActive) {
        throw new TRPCError({
          code:    "PRECONDITION_FAILED",
          message: "Cannot remove the active connection. Set another connection as active first.",
        });
      }

      await ctx.db.oracleConnection.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  setActive: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      const conn = await ctx.db.oracleConnection.findFirst({ where: { id: input.id, tenantId } });
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.$transaction([
        ctx.db.oracleConnection.updateMany({
          where: { tenantId, isActive: true },
          data:  { isActive: false },
        }),
        ctx.db.oracleConnection.update({
          where: { id: input.id },
          data:  { isActive: true },
        }),
      ]);

      await syncActiveToTenant(ctx.db as any, tenantId, conn);
      clearOracleClientCache(tenantId);

      return { ok: true };
    }),

  // Test a saved connection (by id) or ad-hoc credentials (baseUrl + username + password)
  test: managerProcedure
    .input(
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("saved"),  connectionId: z.string().uuid() }),
        z.object({ mode: z.literal("adhoc"),  baseUrl: z.string().url(), username: z.string(), password: z.string() }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;

      let baseUrl: string, username: string, password: string;
      let connectionId: string | null = null;

      if (input.mode === "saved") {
        const conn = await ctx.db.oracleConnection.findFirst({
          where: { id: input.connectionId, tenantId },
        });
        if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
        ({ baseUrl, username, password } = conn);
        connectionId = conn.id;
      } else {
        ({ baseUrl, username, password } = input);
      }

      const isDev =
        !baseUrl ||
        baseUrl.includes("example.com") ||
        baseUrl.includes("your-oracle") ||
        baseUrl.includes("localhost");

      if (isDev) {
        await new Promise((r) => setTimeout(r, 900));
        if (connectionId) {
          await ctx.db.oracleConnection.update({
            where: { id: connectionId },
            data:  { lastTestedAt: new Date(), lastTestOk: true, lastTestError: null },
          });
        }
        return { ok: true as const, latencyMs: 912, message: "Dev mode — connection simulated successfully." };
      }

      const result = await probeOracleConnection(baseUrl, username, password);
      const latencyMs = result.latencyMs;

      if (connectionId) {
        await ctx.db.oracleConnection.update({
          where: { id: connectionId },
          data: result.ok
            ? { lastTestedAt: new Date(), lastTestOk: true,  lastTestError: null }
            : { lastTestedAt: new Date(), lastTestOk: false, lastTestError: result.error },
        });
      }

      return result;
    }),
});

// Probe endpoints across all Oracle Cloud modules — stops at first success or definitive auth failure.
// 403 is treated as "authenticated" because it proves credentials are valid; the user just lacks
// access to that specific resource (common for non-AP roles like CRM/HCM users).
const PROBE_ENDPOINTS = [
  // AP/Finance
  "/fscmRestApi/resources/11.13.18.05/businessUnits?limit=1&fields=BusinessUnitId",
  "/fscmRestApi/resources/11.13.18.05/ledgers?limit=1&fields=LedgerId",
  "/fscmRestApi/resources/11.13.18.05/invoices?limit=1&fields=InvoiceId",
  // HCM
  "/hcmRestApi/resources/11.13.18.05/workers?limit=1&fields=PersonNumber",
  "/hcmRestApi/resources/11.13.18.05/publicWorkers?limit=1&fields=PersonNumber",
  // CRM / Sales Cloud
  "/crmRestApi/resources/11.13.18.05/accounts?limit=1&fields=PartyNumber",
  "/crmRestApi/resources/11.13.18.05/opportunities?limit=1&fields=OptyNumber",
  // Resource catalogue (last resort — exists on every Oracle Cloud instance)
  "/fscmRestApi/resources/11.13.18.05",
  "/hcmRestApi/resources/11.13.18.05",
  "/crmRestApi/resources/11.13.18.05",
];

async function probeOracleConnection(
  baseUrl: string,
  username: string,
  password: string,
): Promise<
  | { ok: true;  latencyMs: number; message?: string }
  | { ok: false; latencyMs: number; error: string; statusCode?: number }
> {
  const base    = baseUrl.replace(/\/$/, "");
  const auth    = { username, password };
  const headers = { Accept: "application/json", "REST-Framework-Version": "4" };
  const timeout = 15_000;
  const start   = Date.now();

  // First: verify the host is reachable at all (HEAD to the base URL, no auth needed)
  try {
    await axios.head(base, { timeout: 8_000, validateStatus: () => true });
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err.code === "ENOTFOUND")   return { ok: false, latencyMs, error: "Host not found — check the base URL for typos." };
    if (err.code === "ECONNREFUSED") return { ok: false, latencyMs, error: "Connection refused — the host is unreachable on that port." };
    if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED")
      return { ok: false, latencyMs, error: "Connection timed out — the server did not respond in time." };
    if (err.code === "CERT_HAS_EXPIRED" || err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE")
      return { ok: false, latencyMs, error: "SSL certificate error — the server's certificate is invalid or expired." };
    return { ok: false, latencyMs, error: err.message ?? "Could not reach the Oracle host." };
  }

  // Second: try each endpoint until we get an authenticated response
  let lastStatusCode: number | undefined;

  for (const path of PROBE_ENDPOINTS) {
    try {
      await axios.get(`${base}${path}`, { auth, headers, timeout });
      // 2xx — fully connected
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      if (!axios.isAxiosError(err)) continue;

      const status = err.response?.status;
      lastStatusCode = status;

      if (status === 401) {
        // Definitive credential failure — no point trying more endpoints
        return {
          ok: false, latencyMs: Date.now() - start, statusCode: 401,
          error: "Authentication failed — check your username and password.",
        };
      }

      if (status === 403) {
        // Credentials valid, user just lacks access to this endpoint — count as connected
        return {
          ok: true, latencyMs: Date.now() - start,
          message: "Connected — credentials verified (user has limited REST API access for this module).",
        };
      }

      if (status && status >= 500) {
        return {
          ok: false, latencyMs: Date.now() - start, statusCode: status,
          error: `Oracle server error (HTTP ${status}) — the instance may be down or restarting.`,
        };
      }

      // 404 or other client error — try the next endpoint
    }
  }

  // All endpoints returned 404 — server is up but no REST API path matched
  return {
    ok: false,
    latencyMs: Date.now() - start,
    statusCode: lastStatusCode,
    error:
      "Oracle REST APIs not found on this host. Verify the base URL is the root of an Oracle Cloud instance " +
      "(e.g. https://your-instance.fa.us6.oraclecloud.com) and that REST APIs are enabled.",
  };
}

async function syncActiveToTenant(
  db: any,
  tenantId: string,
  conn: { baseUrl: string; username: string; password: string }
) {
  await db.tenant.update({
    where: { id: tenantId },
    data:  { oracleBaseUrl: conn.baseUrl, oracleUsername: conn.username, oraclePassword: conn.password },
  });
}
