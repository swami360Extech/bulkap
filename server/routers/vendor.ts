import { z } from "zod";
import { router, protectedProcedure } from "@/server/trpc";

export const vendorRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search:   z.string().optional(),
        page:     z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const where = {
        tenantId,
        ...(input.search && {
          OR: [
            { name:              { contains: input.search, mode: "insensitive" as const } },
            { oracleSupplierNum: { contains: input.search, mode: "insensitive" as const } },
          ],
        }),
      };

      const [vendors, total] = await Promise.all([
        ctx.db.vendor.findMany({
          where,
          include: { _count: { select: { invoices: true } } },
          orderBy: { name: "asc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.db.vendor.count({ where }),
      ]);

      return { vendors, total, pages: Math.ceil(total / input.pageSize) };
    }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.session.user.tenantId;
    const [total, withExceptions, highRisk] = await Promise.all([
      ctx.db.vendor.count({ where: { tenantId } }),
      ctx.db.vendor.count({ where: { tenantId, exceptionRate: { gt: 0 } } }),
      ctx.db.vendor.count({ where: { tenantId, exceptionRate: { gt: 0.1 } } }),
    ]);
    return { total, withExceptions, highRisk };
  }),
});
