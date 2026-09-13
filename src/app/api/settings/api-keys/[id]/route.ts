import { z } from "zod";
import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { deleteApiKey, revokeApiKey } from "@/server/modules/restaurants/restaurant.service";

const querySchema = z.object({
  /** "permanent" removes the row entirely; the default just revokes it. */
  mode: z.enum(["revoke", "permanent"]).default("revoke"),
});

/**
 * DELETE /api/settings/api-keys/:id
 *
 * Two steps on purpose: revoke first (instantly stops the key working, keeps
 * the record visible), then optionally delete to tidy the list. Deleting an
 * active key is refused.
 */
export const DELETE = withApi(
  { permission: "settings:write", auth: "session", querySchema },
  async ({ ctx, query, params }) => {
    if (query.mode === "permanent") {
      return ok({ deleted: true, ...(await deleteApiKey(ctx, params.id)) });
    }
    const revoked = await revokeApiKey(ctx, params.id);
    return ok({ revoked: Boolean(revoked) });
  },
);
