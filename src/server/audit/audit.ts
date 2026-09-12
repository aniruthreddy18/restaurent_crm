import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
};

/**
 * Writes an audit row using the caller's transaction so history and the change
 * it records commit together.
 */
export async function recordAudit(db: Db, ctx: TenantContext, input: AuditInput) {
  return db.auditLog.create({
    data: {
      restaurantId: ctx.restaurantId,
      // Only real dashboard users get a FK; n8n and jobs are labelled instead.
      userId: ctx.actorType === "USER" ? (ctx.userId ?? null) : null,
      actorType: ctx.actorType,
      actorLabel: ctx.actorLabel ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: input.oldValue ?? undefined,
      newValue: input.newValue ?? undefined,
      ipAddress: ctx.ipAddress ?? null,
    },
  });
}
