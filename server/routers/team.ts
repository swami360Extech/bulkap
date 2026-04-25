import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "@/server/trpc";
import { UserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";

export const teamRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findMany({
      where: { tenantId: ctx.session.user.tenantId },
      select: {
        id: true, name: true, email: true, role: true,
        createdAt: true, lastLoginAt: true,
        _count: { select: { assignedExceptions: { where: { status: "OPEN" } } } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
  }),

  invite: adminProcedure
    .input(
      z.object({
        name:     z.string().min(2).max(100),
        email:    z.string().email(),
        role:     z.nativeEnum(UserRole),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const exists = await ctx.db.user.findUnique({ where: { email: input.email } });
      if (exists) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });

      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = await ctx.db.user.create({
        data: {
          tenantId: ctx.session.user.tenantId,
          name:     input.name,
          email:    input.email,
          role:     input.role,
          passwordHash,
        },
        select: { id: true, name: true, email: true, role: true },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId:  ctx.session.user.tenantId,
          actorType: "user",
          actorId:   ctx.session.user.id,
          eventType: "team.user_invited",
          description: `${ctx.session.user.name} invited ${input.name} (${input.email}) as ${input.role}`,
        },
      });

      return user;
    }),

  updateRole: adminProcedure
    .input(z.object({ userId: z.string().uuid(), role: z.nativeEnum(UserRole) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role" });
      }

      const user = await ctx.db.user.findFirst({
        where: { id: input.userId, tenantId: ctx.session.user.tenantId },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const updated = await ctx.db.user.update({
        where: { id: input.userId },
        data: { role: input.role },
        select: { id: true, name: true, role: true },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId:  ctx.session.user.tenantId,
          actorType: "user",
          actorId:   ctx.session.user.id,
          eventType: "team.role_changed",
          description: `${ctx.session.user.name} changed ${user.name}'s role from ${user.role} to ${input.role}`,
        },
      });

      return updated;
    }),

  remove: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
      }

      const user = await ctx.db.user.findFirst({
        where: { id: input.userId, tenantId: ctx.session.user.tenantId },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.user.delete({ where: { id: input.userId } });

      await ctx.db.auditEvent.create({
        data: {
          tenantId:  ctx.session.user.tenantId,
          actorType: "user",
          actorId:   ctx.session.user.id,
          eventType: "team.user_removed",
          description: `${ctx.session.user.name} removed ${user.name} (${user.email}) from the team`,
        },
      });

      return { success: true };
    }),

  resetPassword: adminProcedure
    .input(z.object({ userId: z.string().uuid(), newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findFirst({
        where: { id: input.userId, tenantId: ctx.session.user.tenantId },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await ctx.db.user.update({ where: { id: input.userId }, data: { passwordHash } });

      return { success: true };
    }),
});
