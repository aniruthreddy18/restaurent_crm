import { prisma } from "@/server/db/prisma";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { NotFoundError } from "@/server/core/errors";

/** Marks a polled event as handled so it is not delivered again. */
export const POST = withApi({ permission: "events:read" }, async ({ ctx, params }) => {
  const event = await prisma.event.findFirst({
    where: { id: params.id, restaurantId: ctx.restaurantId },
  });
  if (!event) throw new NotFoundError("Event");

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: { status: "DELIVERED", deliveredAt: new Date(), lastError: null },
  });

  return ok({ id: updated.id, status: updated.status, deliveredAt: updated.deliveredAt });
});
