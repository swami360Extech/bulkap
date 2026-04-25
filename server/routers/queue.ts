import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "@/server/trpc";
import { QueueType, QueuePriority, QueueItemStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { enqueueInvoice, completeQueueItem, refreshSlaStatuses, scorePriority } from "@/server/services/queue";

const ACTIVE_STATUSES: QueueItemStatus[] = ["ASSIGNED", "IN_PROGRESS", "SNOOZED", "ON_HOLD", "ESCALATED"];

export const queueRouter = router({
  // ── Clerk: My Queue ──────────────────────────────────────────────────────────
  myItems: protectedProcedure
    .input(
      z.object({
        queueType: z.nativeEnum(QueueType).optional(),
        status: z.nativeEnum(QueueItemStatus).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const tenantId = ctx.session.user.tenantId;
      const { page, pageSize, queueType, status } = input;

      await refreshSlaStatuses(tenantId);

      const where = {
        tenantId,
        assignedUserId: userId,
        ...(queueType && { queueType }),
        ...(status ? { status } : { status: { in: ACTIVE_STATUSES } }),
      };

      const [items, total] = await Promise.all([
        ctx.db.queueItem.findMany({
          where,
          include: {
            invoice: {
              select: {
                externalInvoiceNum: true,
                grossAmount: true,
                currency: true,
                dueDate: true,
                status: true,
                originalFilename: true,
                vendor: { select: { name: true } },
                fields: {
                  where: { fieldName: "vendor_name" },
                  select: { extractedValue: true, confirmedValue: true },
                },
              },
            },
            events: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: [{ slaBreached: "desc" }, { priorityScore: "desc" }, { createdAt: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        ctx.db.queueItem.count({ where }),
      ]);

      return { items, total, pages: Math.ceil(total / pageSize) };
    }),

  // ── Manager: All Queue Items ─────────────────────────────────────────────────
  allItems: managerProcedure
    .input(
      z.object({
        queueType: z.nativeEnum(QueueType).optional(),
        status: z.nativeEnum(QueueItemStatus).optional(),
        assignedUserId: z.string().uuid().optional(),
        priority: z.nativeEnum(QueuePriority).optional(),
        slaBreached: z.boolean().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      await refreshSlaStatuses(tenantId);

      const { page, pageSize, ...filters } = input;
      const where = {
        tenantId,
        ...(filters.queueType && { queueType: filters.queueType }),
        ...(filters.status
          ? { status: filters.status }
          : { status: { in: [...ACTIVE_STATUSES, "UNASSIGNED"] as QueueItemStatus[] } }),
        ...(filters.assignedUserId !== undefined && { assignedUserId: filters.assignedUserId }),
        ...(filters.priority && { priority: filters.priority }),
        ...(filters.slaBreached !== undefined && { slaBreached: filters.slaBreached }),
      };

      const [items, total] = await Promise.all([
        ctx.db.queueItem.findMany({
          where,
          include: {
            invoice: {
              select: {
                externalInvoiceNum: true,
                grossAmount: true,
                currency: true,
                dueDate: true,
                status: true,
                originalFilename: true,
                vendor: { select: { name: true } },
                fields: {
                  where: { fieldName: "vendor_name" },
                  select: { extractedValue: true, confirmedValue: true },
                },
              },
            },
            assignedUser: { select: { id: true, name: true, email: true } },
            events: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: [{ slaBreached: "desc" }, { priorityScore: "desc" }, { createdAt: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        ctx.db.queueItem.count({ where }),
      ]);

      return { items, total, pages: Math.ceil(total / pageSize) };
    }),

  // ── Stats: summary for dashboard ─────────────────────────────────────────────
  stats: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.session.user.tenantId;
    const userId = ctx.session.user.id;
    await refreshSlaStatuses(tenantId);

    const [byStatus, byPriority, slaBreached, myOpen, myOverdue, avgTat] = await Promise.all([
      ctx.db.queueItem.groupBy({
        by: ["status"],
        where: { tenantId, status: { in: [...ACTIVE_STATUSES, "UNASSIGNED"] as QueueItemStatus[] } },
        _count: { id: true },
      }),
      ctx.db.queueItem.groupBy({
        by: ["priority"],
        where: { tenantId, status: { in: [...ACTIVE_STATUSES, "UNASSIGNED"] as QueueItemStatus[] } },
        _count: { id: true },
      }),
      ctx.db.queueItem.count({
        where: { tenantId, slaBreached: true, status: { notIn: ["COMPLETED", "RETURNED"] as QueueItemStatus[] } },
      }),
      ctx.db.queueItem.count({
        where: { tenantId, assignedUserId: userId, status: { in: ACTIVE_STATUSES } },
      }),
      ctx.db.queueItem.count({
        where: {
          tenantId,
          assignedUserId: userId,
          slaBreached: true,
          status: { notIn: ["COMPLETED", "RETURNED"] as QueueItemStatus[] },
        },
      }),
      ctx.db.queueItem.aggregate({
        where: { tenantId, status: "COMPLETED", tatMs: { not: null } },
        _avg: { tatMs: true },
      }),
    ]);

    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count.id])),
      byPriority: Object.fromEntries(byPriority.map((r) => [r.priority, r._count.id])),
      slaBreached,
      myOpen,
      myOverdue,
      avgTatMs: avgTat._avg.tatMs ?? null,
    };
  }),

  // ── Claim (self-assign unassigned) ───────────────────────────────────────────
  claim: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.queueItem.findFirst({
        where: { id: input.itemId, tenantId: ctx.session.user.tenantId, status: "UNASSIGNED" },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found or already assigned" });

      const now = new Date();
      await ctx.db.queueItem.update({
        where: { id: input.itemId },
        data: { assignedUserId: ctx.session.user.id, status: "ASSIGNED", assignedAt: now },
      });
      await ctx.db.queueItemEvent.create({
        data: {
          itemId: input.itemId,
          actorId: ctx.session.user.id,
          action: "claimed",
          fromStatus: "UNASSIGNED",
          toStatus: "ASSIGNED",
        },
      });
      return { success: true };
    }),

  // ── Start working ────────────────────────────────────────────────────────────
  start: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.queueItem.findFirst({
        where: {
          id: input.itemId,
          tenantId: ctx.session.user.tenantId,
          assignedUserId: ctx.session.user.id,
          status: "ASSIGNED",
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const now = new Date();
      await ctx.db.queueItem.update({
        where: { id: input.itemId },
        data: { status: "IN_PROGRESS", startedAt: now },
      });
      await ctx.db.queueItemEvent.create({
        data: {
          itemId: input.itemId,
          actorId: ctx.session.user.id,
          action: "started",
          fromStatus: "ASSIGNED",
          toStatus: "IN_PROGRESS",
        },
      });
      return { success: true };
    }),

  // ── Complete ─────────────────────────────────────────────────────────────────
  complete: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.queueItem.findFirst({
        where: {
          id: input.itemId,
          tenantId: ctx.session.user.tenantId,
          assignedUserId: ctx.session.user.id,
          status: { in: ["ASSIGNED", "IN_PROGRESS"] as QueueItemStatus[] },
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await completeQueueItem(input.itemId, ctx.session.user.id);
      return { success: true };
    }),

  // ── Snooze ───────────────────────────────────────────────────────────────────
  snooze: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        until: z.string().datetime(),
        reason: z.string().min(3).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.queueItem.findFirst({
        where: {
          id: input.itemId,
          tenantId: ctx.session.user.tenantId,
          assignedUserId: ctx.session.user.id,
          status: { in: ["ASSIGNED", "IN_PROGRESS"] as QueueItemStatus[] },
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.queueItem.update({
        where: { id: input.itemId },
        data: { status: "SNOOZED", snoozeUntil: new Date(input.until), snoozeReason: input.reason },
      });
      await ctx.db.queueItemEvent.create({
        data: {
          itemId: input.itemId,
          actorId: ctx.session.user.id,
          action: "snoozed",
          fromStatus: item.status,
          toStatus: "SNOOZED",
          note: input.reason,
        },
      });
      return { success: true };
    }),

  // ── Return to pool ───────────────────────────────────────────────────────────
  returnItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid(), reason: z.string().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.queueItem.findFirst({
        where: {
          id: input.itemId,
          tenantId: ctx.session.user.tenantId,
          assignedUserId: ctx.session.user.id,
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.queueItem.update({
        where: { id: input.itemId },
        data: {
          status: "RETURNED",
          returnReason: input.reason,
          assignedUserId: null,
          assignedAt: null,
          startedAt: null,
        },
      });
      await ctx.db.queueItemEvent.create({
        data: {
          itemId: input.itemId,
          actorId: ctx.session.user.id,
          action: "returned",
          fromStatus: item.status,
          toStatus: "RETURNED",
          note: input.reason,
        },
      });
      return { success: true };
    }),

  // ── Manager: Assign to specific user ─────────────────────────────────────────
  assign: managerProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        userId: z.string().uuid(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.queueItem.findFirst({
        where: { id: input.itemId, tenantId: ctx.session.user.tenantId },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const now = new Date();
      await ctx.db.queueItem.update({
        where: { id: input.itemId },
        data: { assignedUserId: input.userId, status: "ASSIGNED", assignedAt: now },
      });
      await ctx.db.queueItemEvent.create({
        data: {
          itemId: input.itemId,
          actorId: ctx.session.user.id,
          action: "assigned",
          fromStatus: item.status,
          toStatus: "ASSIGNED",
          note: input.note,
        },
      });
      return { success: true };
    }),

  // ── Manager: Bulk auto-assign unassigned items ────────────────────────────────
  autoAssign: managerProcedure
    .input(z.object({ queueType: z.nativeEnum(QueueType).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const unassigned = await ctx.db.queueItem.findMany({
        where: {
          tenantId,
          status: "UNASSIGNED",
          ...(input.queueType && { queueType: input.queueType }),
        },
        orderBy: [{ slaBreached: "desc" }, { priorityScore: "desc" }],
      });

      let assigned = 0;
      for (const item of unassigned) {
        const users = await ctx.db.user.findMany({
          where: {
            tenantId,
            role: {
              in: item.queueType === "APPROVAL"
                ? ["APPROVER", "AP_MANAGER", "ADMIN"]
                : ["AP_CLERK", "AP_MANAGER", "ADMIN"],
            },
          },
          select: { id: true },
        });
        const workloads = await ctx.db.queueItem.groupBy({
          by: ["assignedUserId"],
          where: {
            tenantId,
            assignedUserId: { in: users.map((u) => u.id) },
            status: { in: ["ASSIGNED", "IN_PROGRESS", "SNOOZED"] as QueueItemStatus[] },
          },
          _count: { id: true },
        });
        const loadMap = new Map(workloads.map((w) => [w.assignedUserId, w._count.id]));
        let bestUser: string | null = null;
        let bestLoad = Infinity;
        for (const { id } of users) {
          const load = loadMap.get(id) ?? 0;
          if (load < bestLoad && load < 20) { bestUser = id; bestLoad = load; }
        }

        if (bestUser) {
          const now = new Date();
          await ctx.db.queueItem.update({
            where: { id: item.id },
            data: { assignedUserId: bestUser, status: "ASSIGNED", assignedAt: now },
          });
          await ctx.db.queueItemEvent.create({
            data: {
              itemId: item.id,
              actorId: ctx.session.user.id,
              action: "auto_assigned",
              fromStatus: "UNASSIGNED",
              toStatus: "ASSIGNED",
              note: `Bulk auto-assign by manager`,
            },
          });
          assigned++;
        }
      }
      return { assigned };
    }),

  // ── Escalate ─────────────────────────────────────────────────────────────────
  escalate: managerProcedure
    .input(z.object({ itemId: z.string().uuid(), note: z.string().min(3).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.queueItem.findFirst({
        where: { id: input.itemId, tenantId: ctx.session.user.tenantId },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.queueItem.update({
        where: { id: input.itemId },
        data: {
          status: "ESCALATED",
          escalationNote: input.note,
          priority: "CRITICAL",
          priorityScore: 150,
        },
      });
      await ctx.db.queueItemEvent.create({
        data: {
          itemId: input.itemId,
          actorId: ctx.session.user.id,
          action: "escalated",
          fromStatus: item.status,
          toStatus: "ESCALATED",
          note: input.note,
        },
      });
      return { success: true };
    }),

  // ── Analytics ────────────────────────────────────────────────────────────────
  analytics: managerProcedure
    .input(
      z.object({
        dateFrom: z.string().datetime(),
        dateTo: z.string().datetime(),
      })
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.session.user.tenantId;
      const from = new Date(input.dateFrom);
      const to = new Date(input.dateTo);

      const [completed, slaBreaches, byUser, throughputRaw] = await Promise.all([
        ctx.db.queueItem.findMany({
          where: { tenantId, status: "COMPLETED", completedAt: { gte: from, lte: to } },
          select: { tatMs: true, priority: true, queueType: true, assignedUserId: true, slaBreached: true },
        }),
        ctx.db.queueItem.count({
          where: { tenantId, slaBreached: true, createdAt: { gte: from, lte: to } },
        }),
        ctx.db.queueItem.groupBy({
          by: ["assignedUserId"],
          where: { tenantId, status: "COMPLETED", completedAt: { gte: from, lte: to } },
          _count: { id: true },
          _avg: { tatMs: true },
        }),
        ctx.db.queueItem.findMany({
          where: { tenantId, createdAt: { gte: from, lte: to } },
          select: { createdAt: true, status: true },
        }),
      ]);

      const totalCompleted = completed.length;
      const avgTatMs = totalCompleted > 0
        ? completed.reduce((s, i) => s + (i.tatMs ?? 0), 0) / totalCompleted
        : 0;
      const slaComplianceRate = totalCompleted > 0
        ? completed.filter((i) => !i.slaBreached).length / totalCompleted
        : 1;

      const byPriority = {} as Record<string, { count: number; avgTatMs: number }>;
      for (const item of completed) {
        if (!byPriority[item.priority]) byPriority[item.priority] = { count: 0, avgTatMs: 0 };
        byPriority[item.priority].count++;
        byPriority[item.priority].avgTatMs += item.tatMs ?? 0;
      }
      for (const k of Object.keys(byPriority)) {
        byPriority[k].avgTatMs /= byPriority[k].count;
      }

      // Daily throughput
      const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
      const throughput = Array.from({ length: Math.min(days, 30) }, (_, i) => {
        const day = new Date(from);
        day.setUTCDate(from.getUTCDate() + i);
        const dayEnd = new Date(day);
        dayEnd.setUTCDate(day.getUTCDate() + 1);
        return {
          date: day.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
          received: throughputRaw.filter((r) => {
            const d = new Date(r.createdAt);
            return d >= day && d < dayEnd;
          }).length,
          completed: throughputRaw.filter((r) => {
            const d = new Date(r.createdAt);
            return d >= day && d < dayEnd && r.status === "COMPLETED";
          }).length,
        };
      });

      return {
        totalCompleted,
        avgTatMs,
        slaComplianceRate,
        slaBreaches,
        byPriority,
        byUser: byUser.map((u) => ({
          userId: u.assignedUserId,
          completed: u._count.id,
          avgTatMs: u._avg.tatMs ?? 0,
        })),
        throughput,
      };
    }),

  // ── SLA config (manager) ─────────────────────────────────────────────────────
  getSlaConfig: managerProcedure.query(async ({ ctx }) => {
    return ctx.db.queueSlaConfig.findMany({
      where: { tenantId: ctx.session.user.tenantId },
      orderBy: [{ queueType: "asc" }, { priority: "asc" }],
    });
  }),

  upsertSlaConfig: managerProcedure
    .input(
      z.object({
        queueType: z.nativeEnum(QueueType),
        priority: z.nativeEnum(QueuePriority),
        targetMinutes: z.number().int().min(1).max(43200),
        warningPct: z.number().int().min(10).max(99).default(75),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.queueSlaConfig.upsert({
        where: {
          tenantId_queueType_priority: {
            tenantId: ctx.session.user.tenantId,
            queueType: input.queueType,
            priority: input.priority,
          },
        },
        create: {
          tenantId: ctx.session.user.tenantId,
          queueType: input.queueType,
          priority: input.priority,
          targetMinutes: input.targetMinutes,
          warningPct: input.warningPct,
        },
        update: { targetMinutes: input.targetMinutes, warningPct: input.warningPct },
      });
    }),
});
