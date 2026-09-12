import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { listConversationsSchema } from "@/server/modules/conversations/conversation.schema";
import { listConversations } from "@/server/modules/conversations/conversation.service";

export const GET = withApi(
  { permission: "conversations:read", querySchema: listConversationsSchema },
  async ({ ctx, query }) => ok(await listConversations(ctx, query)),
);
