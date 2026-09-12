/**
 * The outbox dispatcher. Dispatch now runs after every mutating request as well
 * as from cron and the CLI, so overlapping runs are normal and must not deliver
 * the same event twice.
 */
import { createServer, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { prisma } from "@/server/db/prisma";
import { dispatchPendingEvents } from "@/server/events/dispatcher";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import { CART_TOTAL, cartItems, createTenant, resetDatabase, type Tenant } from "./helpers";

const SECRET = "test-webhook-secret";

type Received = { type: string; signatureValid: boolean; eventId: string };

/** Minimal stand-in for n8n that verifies the signature the way n8n should. */
function startReceiver(behaviour: { status?: number } = {}) {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const ts = req.headers["x-crm-timestamp"] as string;
      const expected = "sha256=" + createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
      const parsed = JSON.parse(body);
      received.push({
        type: parsed.type,
        signatureValid: req.headers["x-crm-signature"] === expected,
        eventId: parsed.id,
      });
      res.writeHead(behaviour.status ?? 200).end("ok");
    });
  });

  return new Promise<{ url: string; received: Received[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/webhook`,
        received,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

let tenant: Tenant;
let receiver: Awaited<ReturnType<typeof startReceiver>>;

async function subscribe(url: string) {
  await prisma.webhookEndpoint.create({
    data: { restaurantId: tenant.restaurantId, name: "test n8n", url, secret: SECRET, eventTypes: [] },
  });
}

async function makeEvents() {
  await recordPaymentResult(tenant.ctx, {
    transactionId: "txn-1",
    status: "SUCCESS",
    amount: CART_TOTAL,
    currency: "INR",
    whatsappNumber: "919876543210",
    items: cartItems(),
  });
}

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant();
});

afterEach(async () => {
  await receiver?.close();
});

describe("webhook delivery", () => {
  it("signs every delivery so n8n can verify it", async () => {
    receiver = await startReceiver();
    await subscribe(receiver.url);
    await makeEvents();

    const summary = await dispatchPendingEvents();

    expect(summary.delivered).toBeGreaterThan(0);
    expect(summary.failed).toBe(0);
    expect(receiver.received.length).toBe(summary.delivered);
    expect(receiver.received.every((r) => r.signatureValid)).toBe(true);
    expect(receiver.received.map((r) => r.type)).toContain("PAYMENT_SUCCESS");
  });

  it("delivers each event exactly once when dispatchers overlap", async () => {
    receiver = await startReceiver();
    await subscribe(receiver.url);
    await makeEvents();

    const pending = await prisma.event.count({ where: { status: "PENDING" } });
    expect(pending).toBeGreaterThan(1);

    // Four dispatchers racing — what happens when several requests finish at
    // once and each schedules a post-response flush.
    await Promise.all([
      dispatchPendingEvents(),
      dispatchPendingEvents(),
      dispatchPendingEvents(),
      dispatchPendingEvents(),
    ]);

    const ids = receiver.received.map((r) => r.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(pending);
    expect(await prisma.event.count({ where: { status: "PENDING" } })).toBe(0);
    expect(await prisma.event.count({ where: { status: "DELIVERED" } })).toBe(pending);
  });

  it("returns a failed event to PENDING with backoff rather than losing it", async () => {
    receiver = await startReceiver({ status: 500 });
    await subscribe(receiver.url);
    await makeEvents();

    const summary = await dispatchPendingEvents();
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.delivered).toBe(0);

    const event = await prisma.event.findFirstOrThrow({ where: { type: "PAYMENT_SUCCESS" } });
    expect(event.status).toBe("PENDING");
    expect(event.attempts).toBe(1);
    expect(event.lastError).toContain("500");
    // Backed off, so an immediate re-run does not hammer a failing endpoint.
    expect(event.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("leaves events PENDING for polling when no webhook is configured", async () => {
    await makeEvents();
    const pending = await prisma.event.count({ where: { status: "PENDING" } });

    const summary = await dispatchPendingEvents();

    expect(summary.delivered).toBe(0);
    // Still offered by GET /api/events?status=PENDING — polling is unaffected
    // by there being no webhook subscriber.
    expect(await prisma.event.count({ where: { status: "PENDING" } })).toBe(pending);
  });
});
