import { z } from "zod";
import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createApiKey, listApiKeys } from "@/server/modules/restaurants/restaurant.service";

const bodySchema = z.object({ name: z.string().trim().min(1).max(80) });

export const GET = withApi({ permission: "settings:read", auth: "session" }, async ({ ctx }) =>
  ok(await listApiKeys(ctx)),
);

/**
 * Session-only: an API key must never be able to mint another API key, or a
 * single leaked key becomes permanent access.
 */
export const POST = withApi(
  { permission: "settings:write", auth: "session", bodySchema },
  async ({ ctx, body }) => created(await createApiKey(ctx, body.name)),
);
