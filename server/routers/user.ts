import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "@/server/trpc";
import { TRPCError } from "@trpc/server";

export const userRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true, lastLoginAt: true },
    });
  }),

  updateProfile: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { name: input.name },
        select: { id: true, name: true, email: true, role: true },
      });
    }),

  tenantConfig: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.tenant.findUnique({
      where: { id: ctx.session.user.tenantId },
      select: {
        id: true, name: true, slug: true,
        oracleBaseUrl: true, oracleUsername: true,
        defaultCurrency: true, legislationCode: true,
      },
    });
  }),

  updateTenantOracle: managerProcedure
    .input(
      z.object({
        oracleBaseUrl:  z.string().url(),
        oracleUsername: z.string().min(1),
        oraclePassword: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tenant = await ctx.db.tenant.findUnique({ where: { id: ctx.session.user.tenantId } });
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.tenant.update({
        where: { id: tenant.id },
        data: {
          oracleBaseUrl:  input.oracleBaseUrl,
          oracleUsername: input.oracleUsername,
          ...(input.oraclePassword && { oraclePassword: input.oraclePassword }),
        },
        select: { id: true, oracleBaseUrl: true, oracleUsername: true },
      });
    }),
});
