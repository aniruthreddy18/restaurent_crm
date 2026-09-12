import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { getConversation } from "@/server/modules/conversations/conversation.service";

export const GET = withApi({ permission: "conversations:read" }, async ({ ctx, params }) =>
  ok(await getConversation(ctx, params.id)),
);
