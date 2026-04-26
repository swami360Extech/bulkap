import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "@/server/trpc";
import { UserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { sendEmail, generateTempPassword } from "@/server/services/email";
import { inviteEmail, passwordResetEmail } from "@/server/services/email/templates";

export const teamRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findMany({
      where: { tenantId: ctx.session.user.tenantId },
      select: {
        id: true, name: true, email: true, role: true,
        inviteStatus: true, invitedAt: true,
        createdAt: true, lastLoginAt: true,
        mustChangePassword: true,
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
        password: z.string().min(8).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const exists = await ctx.db.user.findUnique({ where: { email: input.email } });
      if (exists) throw new TRPCError({ code: "CONFLICT", message: "A user with this email already exists" });

      const tenant = await ctx.db.tenant.findUnique({ where: { id: ctx.session.user.tenantId } });
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });

      const tempPassword = input.password ?? generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const now = new Date();

      const user = await ctx.db.user.create({
        data: {
          tenantId:          ctx.session.user.tenantId,
          name:              input.name,
          email:             input.email,
          role:              input.role,
          passwordHash,
          mustChangePassword: true,
          inviteStatus:      "PENDING",
          invitedAt:         now,
          invitedByUserId:   ctx.session.user.id,
        },
        select: { id: true, name: true, email: true, role: true },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId:    ctx.session.user.tenantId,
          actorType:   "user",
          actorId:     ctx.session.user.id,
          eventType:   "team.user_invited",
          description: `${ctx.session.user.name} invited ${input.name} (${input.email}) as ${input.role}`,
        },
      });

      // Send invitation email
      const template = inviteEmail({
        inviteeName:  input.name,
        inviteeEmail: input.email,
        inviterName:  ctx.session.user.name,
        role:         input.role,
        tempPassword,
        tenantName:   tenant.name,
      });

      const emailResult = await sendEmail({ to: input.email, ...template });

      return {
        user,
        tempPassword,
        emailSent:    emailResult.ok,
        emailSkipped: "skipped" in emailResult && emailResult.skipped === true,
        emailError:   emailResult.ok ? null : emailResult.error,
      };
    }),

  resendInvite: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findFirst({
        where: { id: input.userId, tenantId: ctx.session.user.tenantId },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const tenant = await ctx.db.tenant.findUnique({ where: { id: ctx.session.user.tenantId } });
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });

      // Generate a fresh temp password
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      await ctx.db.user.update({
        where: { id: input.userId },
        data: { passwordHash, mustChangePassword: true, inviteStatus: "PENDING" },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId:    ctx.session.user.tenantId,
          actorType:   "user",
          actorId:     ctx.session.user.id,
          eventType:   "team.invite_resent",
          description: `${ctx.session.user.name} resent invite to ${user.name} (${user.email})`,
        },
      });

      const template = inviteEmail({
        inviteeName:  user.name,
        inviteeEmail: user.email,
        inviterName:  ctx.session.user.name,
        role:         user.role,
        tempPassword,
        tenantName:   tenant.name,
      });

      const emailResult = await sendEmail({ to: user.email, ...template });

      return {
        emailSent:    emailResult.ok,
        emailSkipped: "skipped" in emailResult && emailResult.skipped === true,
        emailError:   emailResult.ok ? null : emailResult.error,
        tempPassword,
      };
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
          tenantId:    ctx.session.user.tenantId,
          actorType:   "user",
          actorId:     ctx.session.user.id,
          eventType:   "team.role_changed",
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
          tenantId:    ctx.session.user.tenantId,
          actorType:   "user",
          actorId:     ctx.session.user.id,
          eventType:   "team.user_removed",
          description: `${ctx.session.user.name} removed ${user.name} (${user.email}) from the team`,
        },
      });

      return { success: true };
    }),

  resetPassword: adminProcedure
    .input(z.object({ userId: z.string().uuid(), newPassword: z.string().min(8).optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findFirst({
        where: { id: input.userId, tenantId: ctx.session.user.tenantId },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const tenant = await ctx.db.tenant.findUnique({ where: { id: ctx.session.user.tenantId } });
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });

      const tempPassword = input.newPassword ?? generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      await ctx.db.user.update({
        where: { id: input.userId },
        data: { passwordHash, mustChangePassword: true },
      });

      await ctx.db.auditEvent.create({
        data: {
          tenantId:    ctx.session.user.tenantId,
          actorType:   "user",
          actorId:     ctx.session.user.id,
          eventType:   "team.password_reset",
          description: `${ctx.session.user.name} reset password for ${user.name} (${user.email})`,
        },
      });

      const template = passwordResetEmail({
        userName:     user.name,
        userEmail:    user.email,
        resetterName: ctx.session.user.name,
        newPassword:  tempPassword,
        tenantName:   tenant.name,
      });

      const emailResult = await sendEmail({ to: user.email, ...template });

      return {
        tempPassword,
        emailSent:    emailResult.ok,
        emailSkipped: "skipped" in emailResult && emailResult.skipped === true,
        emailError:   emailResult.ok ? null : emailResult.error,
      };
    }),

  // Called by the user themselves after first login
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword:     z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect" });

      if (input.newPassword === input.currentPassword) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "New password must be different from current password" });
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await ctx.db.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, inviteStatus: "ACTIVE" },
      });

      return { success: true };
    }),
});
