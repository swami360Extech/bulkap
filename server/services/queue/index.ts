import { db } from "@/lib/db";
import { QueueType, QueuePriority, QueueItemStatus, UserRole } from "@prisma/client";

const MAX_WIP = 20;

// SLA defaults in minutes per queue type + priority
const DEFAULT_SLA: Record<QueueType, Record<QueuePriority, number>> = {
  REVIEW:    { CRITICAL: 240,  HIGH: 720,  NORMAL: 1440, LOW: 2880 },
  EXCEPTION: { CRITICAL: 480,  HIGH: 1440, NORMAL: 2880, LOW: 4320 },
  APPROVAL:  { CRITICAL: 240,  HIGH: 480,  NORMAL: 1440, LOW: 2880 },
};

const ELIGIBLE_ROLES: Record<QueueType, UserRole[]> = {
  REVIEW:    [UserRole.AP_CLERK, UserRole.AP_MANAGER, UserRole.ADMIN],
  EXCEPTION: [UserRole.AP_CLERK, UserRole.AP_MANAGER, UserRole.ADMIN],
  APPROVAL:  [UserRole.APPROVER, UserRole.AP_MANAGER, UserRole.ADMIN],
};

export async function scorePriority(params: {
  dueDate?: Date | null;
  grossAmount?: number | null;
  createdAt: Date;
}): Promise<{ score: number; priority: QueuePriority }> {
  const now = new Date();
  const ageHours = (now.getTime() - params.createdAt.getTime()) / 3_600_000;

  let score = 0;

  // Due date component (0–100)
  if (params.dueDate) {
    const daysUntilDue = (params.dueDate.getTime() - now.getTime()) / 86_400_000;
    if (daysUntilDue <= 0)   score += 100;
    else if (daysUntilDue <= 2)  score += 90;
    else if (daysUntilDue <= 5)  score += 70;
    else if (daysUntilDue <= 14) score += 40;
    else score += 10;
  } else {
    score += 20;
  }

  // Amount component (0–40)
  const amount = params.grossAmount ?? 0;
  if (amount >= 100_000)     score += 40;
  else if (amount >= 50_000) score += 30;
  else if (amount >= 10_000) score += 15;
  else if (amount >= 1_000)  score += 5;

  // Aging component (0–20)
  score += Math.min(Math.floor(ageHours / 4), 20);

  const priority: QueuePriority =
    score >= 90 ? "CRITICAL" :
    score >= 60 ? "HIGH" :
    score >= 30 ? "NORMAL" : "LOW";

  return { score, priority };
}

async function getSlaMinutes(
  tenantId: string,
  queueType: QueueType,
  priority: QueuePriority
): Promise<number> {
  const cfg = await db.queueSlaConfig.findUnique({
    where: { tenantId_queueType_priority: { tenantId, queueType, priority } },
  });
  return cfg?.targetMinutes ?? DEFAULT_SLA[queueType][priority];
}

async function pickAssignee(tenantId: string, queueType: QueueType): Promise<string | null> {
  const roles = ELIGIBLE_ROLES[queueType];
  const users = await db.user.findMany({
    where: { tenantId, role: { in: roles } },
    select: { id: true },
  });
  if (users.length === 0) return null;

  const userIds = users.map((u) => u.id);
  const workloads = await db.queueItem.groupBy({
    by: ["assignedUserId"],
    where: {
      tenantId,
      assignedUserId: { in: userIds },
      status: { in: ["ASSIGNED", "IN_PROGRESS", "SNOOZED"] as QueueItemStatus[] },
    },
    _count: { id: true },
  });

  const loadMap = new Map(workloads.map((w) => [w.assignedUserId, w._count.id as number]));
  let best: string | null = null;
  let bestLoad = Infinity;

  for (const { id } of users) {
    const load = loadMap.get(id) ?? 0;
    if (load < bestLoad && load < MAX_WIP) {
      best = id;
      bestLoad = load;
    }
  }
  return best;
}

export async function enqueueInvoice(params: {
  tenantId: string;
  invoiceId: string;
  queueType: QueueType;
  dueDate?: Date | null;
  grossAmount?: number | null;
}): Promise<void> {
  // Idempotent — don't create duplicate open items for same invoice+type
  const existing = await db.queueItem.findFirst({
    where: {
      invoiceId: params.invoiceId,
      queueType: params.queueType,
      status: { notIn: ["COMPLETED", "RETURNED"] as QueueItemStatus[] },
    },
  });
  if (existing) return;

  const createdAt = new Date();
  const { score, priority } = await scorePriority({
    dueDate: params.dueDate,
    grossAmount: params.grossAmount,
    createdAt,
  });

  const slaMinutes = await getSlaMinutes(params.tenantId, params.queueType, priority);
  const slaDeadline = new Date(createdAt.getTime() + slaMinutes * 60_000);

  const assignedUserId = await pickAssignee(params.tenantId, params.queueType);
  const status: QueueItemStatus = assignedUserId ? "ASSIGNED" : "UNASSIGNED";

  const item = await db.queueItem.create({
    data: {
      tenantId:      params.tenantId,
      invoiceId:     params.invoiceId,
      queueType:     params.queueType,
      priority,
      priorityScore: score,
      slaDeadline,
      status,
      assignedUserId,
      assignedAt:    assignedUserId ? createdAt : null,
    },
  });

  await db.queueItemEvent.create({
    data: {
      itemId: item.id,
      action: assignedUserId ? "auto_assigned" : "enqueued",
      toStatus: status,
      note: assignedUserId
        ? `Auto-assigned to user ${assignedUserId} (score ${score})`
        : `Enqueued unassigned (score ${score})`,
    },
  });
}

export async function completeQueueItem(itemId: string, actorId: string): Promise<void> {
  const item = await db.queueItem.findUnique({ where: { id: itemId } });
  if (!item) return;

  const now = new Date();
  const tatMs = item.startedAt ? now.getTime() - item.startedAt.getTime() : null;

  await db.queueItem.update({
    where: { id: itemId },
    data: {
      status:      "COMPLETED",
      completedAt: now,
      tatMs:       tatMs ?? undefined,
    },
  });

  await db.queueItemEvent.create({
    data: {
      itemId,
      actorId,
      action:     "completed",
      fromStatus: item.status,
      toStatus:   "COMPLETED",
    },
  });
}

export async function refreshSlaStatuses(tenantId: string): Promise<void> {
  const now = new Date();
  await db.queueItem.updateMany({
    where: {
      tenantId,
      slaBreached: false,
      slaDeadline: { lte: now },
      status: { notIn: ["COMPLETED", "RETURNED"] as QueueItemStatus[] },
    },
    data: { slaBreached: true, slaBreachedAt: now },
  });
}
