import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "@/server/trpc";
import { ExceptionStatus, ExceptionSeverity, ExceptionType } from "@prisma/client";
import { TRPCError } from "@trpc/server";

export const exceptionRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.nativeEnum(ExceptionStatus).optional(),
        severity: z.nativeEnum(ExceptionSeverity).optional(),
        type: z.nativeEnum(ExceptionType).optional(),
        assignedTo: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const { page, pageSize, ...filters } = input;

      const where = {
        invoice: { tenantId },
        ...(filters.status && { status: filters.status }),
        ...(filters.severity && { severity: filters.severity }),
        ...(filters.type && { type: filters.type }),
        ...(filters.assignedTo && { assignedTo: filters.assignedTo }),
      };

      const [exceptions, total] = await Promise.all([
        ctx.db.exception.findMany({
          where,
          include: {
            invoice: { select: { externalInvoiceNum: true, vendor: { select: { name: true } }, grossAmount: true } },
            assignedUser: { select: { name: true, email: true } },
          },
          orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        ctx.db.exception.count({ where }),
      ]);

      return { exceptions, total, pages: Math.ceil(total / pageSize) };
    }),

  counts: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.session.user.tenantId;
    const results = await ctx.db.exception.groupBy({
      by: ["severity", "type"],
      where: { invoice: { tenantId }, status: "OPEN" },
      _count: true,
    });

    const blocking = results.filter((r) => r.severity === "BLOCKING").reduce((s, r) => s + r._count, 0);
    const warning = results.filter((r) => r.severity === "WARNING").reduce((s, r) => s + r._count, 0);
    const informational = results.filter((r) => r.severity === "INFORMATIONAL").reduce((s, r) => s + r._count, 0);
    const byType = Object.fromEntries(results.map((r) => [r.type, r._count]));

    return { blocking, warning, informational, byType };
  }),

  assign: protectedProcedure
    .input(z.object({ exceptionId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.exception.update({
        where: { id: input.exceptionId },
        data: { assignedTo: input.userId, assignedAt: new Date(), status: "IN_REVIEW" },
      });
      return updated;
    }),

  resolve: managerProcedure
    .input(
      z.object({
        exceptionId: z.string().uuid(),
        resolutionAction: z.string().min(5),
        releaseHold: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const exception = await ctx.db.exception.findUnique({ where: { id: input.exceptionId } });
      if (!exception) throw new TRPCError({ code: "NOT_FOUND" });

      const updated = await ctx.db.exception.update({
        where: { id: input.exceptionId },
        data: {
          status: "RESOLVED",
          resolutionAction: input.resolutionAction,
          resolvedBy: ctx.session.user.id,
          resolvedAt: new Date(),
        },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId: ctx.session.user.tenantId,
          invoiceId: exception.invoiceId,
          actorType: "user",
          actorId: ctx.session.user.id,
          eventType: "exception.resolved",
          description: `Exception ${exception.type} resolved: ${input.resolutionAction}`,
        },
      });

      return updated;
    }),

  waive: managerProcedure
    .input(z.object({ exceptionId: z.string().uuid(), waivedReason: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      const exception = await ctx.db.exception.findUnique({ where: { id: input.exceptionId } });
      if (!exception) throw new TRPCError({ code: "NOT_FOUND" });

      const updated = await ctx.db.exception.update({
        where: { id: input.exceptionId },
        data: {
          status: "WAIVED",
          waivedReason: input.waivedReason,
          resolvedBy: ctx.session.user.id,
          resolvedAt: new Date(),
        },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId: ctx.session.user.tenantId,
          invoiceId: exception.invoiceId,
          actorType: "user",
          actorId: ctx.session.user.id,
          eventType: "exception.waived",
          description: `Exception waived: ${input.waivedReason}`,
        },
      });

      return updated;
    }),

  bulkAssign: managerProcedure
    .input(z.object({ exceptionIds: z.array(z.string().uuid()).max(200), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.exception.updateMany({
        where: { id: { in: input.exceptionIds } },
        data: { assignedTo: input.userId, assignedAt: new Date(), status: "IN_REVIEW" },
      });
      return { count: result.count };
    }),
});
