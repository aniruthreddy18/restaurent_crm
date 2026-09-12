import type { EventType, OrderStatus } from "@prisma/client";
import { BusinessRuleError } from "@/server/core/errors";

/**
 * The fulfilment state machine. Kept as data so the Kanban board, the API and
 * the tests all agree on what is legal — there is no second copy of this.
 *
 * Payment status is deliberately absent: money and food move independently.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: [],
};

/** Columns of the kitchen board, in the order staff work through them. */
export const BOARD_STATUSES: readonly OrderStatus[] = [
  "CONFIRMED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export const STATUS_EVENT: Partial<Record<OrderStatus, EventType>> = {
  PREPARING: "ORDER_PREPARING",
  READY: "ORDER_READY",
  OUT_FOR_DELIVERY: "ORDER_OUT_FOR_DELIVERY",
  DELIVERED: "ORDER_DELIVERED",
  CANCELLED: "ORDER_CANCELLED",
};

/** Column on `orders` that records when the status was reached. */
export const STATUS_TIMESTAMP_FIELD: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "confirmedAt",
  PREPARING: "preparingAt",
  READY: "readyAt",
  OUT_FOR_DELIVERY: "dispatchedAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (from === to) {
    throw new BusinessRuleError(`Order is already ${to}`, "ORDER_STATUS_UNCHANGED");
  }
  if (!canTransition(from, to)) {
    const allowed = ORDER_TRANSITIONS[from];
    throw new BusinessRuleError(
      allowed.length
        ? `Cannot move an order from ${from} to ${to}. Allowed next: ${allowed.join(", ")}`
        : `${from} is a final status and cannot be changed`,
      "INVALID_ORDER_TRANSITION",
      { from, to, allowed },
    );
  }
}
