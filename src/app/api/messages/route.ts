import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createMessageSchema } from "@/server/modules/conversations/conversation.schema";
import { recordMessage } from "@/server/modules/conversations/conversation.service";

/**
 * Conversation logging. Explicitly does NOT create a customer — it only links
 * to one that already exists. This is the endpoint n8n hits for every inbound
 * and outbound WhatsApp message.
 */
export const POST = withApi(
  { bodySchema: createMessageSchema, rateLimit: { max: 600, windowSeconds: 60 } },
  async ({ ctx, body }) => {
    const { message, created: isNew } = await recordMessage(ctx, body);
    const payload = { ...message, replayed: !isNew };
    return isNew ? created(payload) : ok(payload);
  },
);
