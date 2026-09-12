import { z } from "zod";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { dispatchPendingEvents } from "@/server/events/dispatcher";

const bodySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

/**
 * PUSH side: flushes the outbox to every subscribed webhook endpoint.
 * Intended for a cron ping (`* * * * * curl -X POST .../api/events/dispatch`)
 * or a manual retry from the settings screen.
 */
export const POST = withApi({ permission: "settings:write", bodySchema }, async ({ body }) =>
  ok(await dispatchPendingEvents(body.limit)),
);
