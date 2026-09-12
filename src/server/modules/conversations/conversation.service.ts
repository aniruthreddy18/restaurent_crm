import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { NotFoundError } from "@/server/core/errors";
import { assertCan } from "@/server/auth/permissions";
import { normalizeWhatsAppNumber } from "@/lib/phone";
import { paginated } from "@/server/core/pagination";
import type { CreateMessageInput, ListConversationsInput } from "./conversation.schema";

/**
 * Conversation history is the temporary layer's other half.
 *
 * Logging a message NEVER creates a customer. `customerId` is linked only when
 * one already exists for the number — which, by the core rule, means a payment
 * already reached a terminal result. Someone who only ever says hello lives
 * here and nowhere else.
 */
function countryCode() {
  return process.env.DEFAULT_COUNTRY_CODE ?? "91";
}

export async function recordMessage(ctx: TenantContext, input: CreateMessageInput) {
  const whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber, countryCode());

  // Look up — never create. This is the line the temporary layer does not cross.
  const customer = await prisma.customer.findUnique({
    where: { restaurantId_whatsappNumber: { restaurantId: ctx.restaurantId, whatsappNumber } },
    select: { id: true },
  });

  const conversation = await prisma.conversationSession.upsert({
    where: { restaurantId_whatsappNumber: { restaurantId: ctx.restaurantId, whatsappNumber } },
    create: {
      restaurantId: ctx.restaurantId,
      whatsappNumber,
      customerId: customer?.id ?? null,
      lastMessageAt: new Date(),
    },
    update: { lastMessageAt: new Date(), customerId: customer?.id ?? undefined, status: "OPEN" },
  });

  // A replayed WhatsApp webhook carries the same message id — store it once.
  if (input.externalMessageId) {
    const existing = await prisma.message.findUnique({
      where: {
        restaurantId_externalMessageId: {
          restaurantId: ctx.restaurantId,
          externalMessageId: input.externalMessageId,
        },
      },
    });
    if (existing) return { message: existing, created: false };
  }

  try {
    const message = await prisma.message.create({
      data: {
        restaurantId: ctx.restaurantId,
        conversationId: conversation.id,
        whatsappNumber,
        customerId: customer?.id ?? null,
        orderId: input.orderId ?? null,
        direction: input.direction,
        message: input.message,
        externalMessageId: input.externalMessageId ?? null,
        status: input.status,
      },
    });
    return { message, created: true };
  } catch (error) {
    // Lost a race with a concurrent replay of the same webhook.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.externalMessageId) {
      const message = await prisma.message.findUniqueOrThrow({
        where: {
          restaurantId_externalMessageId: {
            restaurantId: ctx.restaurantId,
            externalMessageId: input.externalMessageId,
          },
        },
      });
      return { message, created: false };
    }
    throw error;
  }
}

export async function listConversations(ctx: TenantContext, input: ListConversationsInput) {
  assertCan(ctx, "conversations:read");

  const where: Prisma.ConversationSessionWhereInput = { restaurantId: ctx.restaurantId };
  if (input.status) where.status = input.status;
  if (input.filter === "customers") where.customerId = { not: null };
  if (input.filter === "prospects") where.customerId = null;
  if (input.search) {
    const digits = input.search.replace(/\D/g, "");
    where.OR = [
      { whatsappNumber: { contains: digits || input.search } },
      { customer: { name: { contains: input.search, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.conversationSession.findMany({
      where,
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      include: {
        customer: { select: { id: true, name: true, customerType: true } },
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.conversationSession.count({ where }),
  ]);

  return paginated(rows, total, { page: input.page, pageSize: input.pageSize });
}

export async function getConversation(ctx: TenantContext, conversationId: string) {
  assertCan(ctx, "conversations:read");
  const conversation = await prisma.conversationSession.findFirst({
    where: { id: conversationId, restaurantId: ctx.restaurantId },
    include: {
      customer: { select: { id: true, name: true, customerType: true, whatsappNumber: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 300 },
    },
  });
  if (!conversation) throw new NotFoundError("Conversation");
  return conversation;
}
