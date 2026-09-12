import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { revokeApiKey } from "@/server/modules/restaurants/restaurant.service";

export const DELETE = withApi({ permission: "settings:write", auth: "session" }, async ({ ctx, params }) => {
  const revoked = await revokeApiKey(ctx, params.id);
  return ok({ revoked: Boolean(revoked) });
});
