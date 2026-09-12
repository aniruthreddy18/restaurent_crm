# n8n integration guide

How n8n and the CRM divide the work, and the four workflows that connect them.

## Who owns what

| System | Owns |
| --- | --- |
| WhatsApp / Meta Cloud API | Customer communication |
| n8n | Automation, orchestration, all outbound messaging |
| AI agent | Conversation intelligence |
| Google Sheets | Restaurant and menu knowledge (today) |
| Payment provider | Payment processing |
| **Restaurant CRM** | **Permanent business data: customers, orders, payments, deliveries, reviews, history** |

The CRM never calls WhatsApp and never calls n8n's workflows directly. It
publishes events. If n8n is down, the CRM keeps working and the outbox keeps
filling — nothing is lost.

---

## Setup

1. **Get an API key.** CRM → **Settings → API keys → Create API key**. Copy it
   immediately; only its SHA-256 digest is stored.
2. **Create an n8n credential.** *Header Auth*, name `Authorization`, value
   `Bearer <key>`. Use it on every HTTP Request node below.
3. **Choose an event transport** (see [Receiving events](#receiving-events)).

---

## Workflow 1 — Conversation

**Trigger:** WhatsApp message received.

1. Log the inbound message:
   `POST /api/messages`
   ```json
   { "whatsappNumber": "{{$json.from}}",
     "direction": "INBOUND",
     "message": "{{$json.text.body}}",
     "externalMessageId": "{{$json.id}}",
     "status": "DELIVERED" }
   ```
   Passing `externalMessageId` makes a replayed WhatsApp webhook a no-op.

2. Run the AI agent against Google Sheets for menu and restaurant facts.

3. Log the reply with `direction: "OUTBOUND"` after sending it.

> This workflow creates **no** CRM customer, by design. Someone who only ever
> asks about the menu stays in `conversation_sessions` and `messages`. They
> appear in the CRM under **Conversations → Not yet customers**.

---

## Workflow 2 — Cart and checkout

As the agent assembles an order, keep the cart in the CRM's temporary layer:

`POST /api/checkout-sessions`
```json
{ "sessionId": "{{$json.conversationId}}",
  "whatsappNumber": "{{$json.from}}",
  "customerName": "{{$json.name}}",
  "items": [ { "name": "Chicken Biryani", "price": 380, "quantity": 2 } ],
  "deliveryAddress": "{{$json.address}}",
  "deliveryFee": 40,
  "expiresInMinutes": 30 }
```

Idempotent on `sessionId` — call it on every turn. Totals come back computed, so
the agent can quote a figure it did not have to calculate.

If the customer goes quiet, `PATCH /api/checkout-sessions/{sessionId}` with
`{ "status": "ABANDONED" }`. Still no customer, no order.

---

## Workflow 3 — Payment result

**This is the important one.** Trigger it from the payment provider's webhook.

`POST /api/payments`, with `Idempotency-Key` set to the provider's event id:

```json
{ "transactionId": "{{$json.payload.payment.entity.id}}",
  "status": "SUCCESS",
  "amount": {{$json.payload.payment.entity.amount / 100}},
  "currency": "INR",
  "paymentMethod": "{{$json.payload.payment.entity.method}}",
  "gateway": "razorpay",
  "whatsappNumber": "{{$json.notes.whatsapp}}",
  "customer": { "name": "{{$json.notes.name}}" },
  "checkoutSessionId": "{{$json.notes.sessionId}}",
  "deliveryAddress": "{{$json.notes.address}}",
  "externalEventId": "{{$json.event_id}}" }
```

For a failure, send `"status": "FAILED"` with a `failureReason`.

The CRM then, in one transaction: upserts the customer by WhatsApp number,
creates the order with price snapshots, records the payment, retires the cart,
opens a delivery record if there is an address, writes audit rows, and emits the
events.

The response tells you what happened:

```json
{ "replayed": false, "customerCreated": true,
  "customerId": "…", "orderId": "…", "orderNumber": "ORD-260912-0021",
  "paymentId": "…", "paymentStatus": "SUCCESS", "orderStatus": "CONFIRMED" }
```

**Send every attempt.** A failed payment is real commercial history and lets the
restaurant follow up. Do **not** call `POST /api/customers` from this workflow —
the payment endpoint already did it, correctly and idempotently.

> Retries are free. Fire the same webhook five times and you still get one
> customer, one order, one payment and one of each event.

---

## Workflow 4 — Notifications

**Trigger:** a CRM event.

| Event | Message to send |
| --- | --- |
| `ORDER_CONFIRMED` | "Thanks! Order {{orderNumber}} is confirmed — {{totalAmount}}." |
| `PAYMENT_FAILED` | "Your payment didn't go through. Reply RETRY to try again." |
| `ORDER_READY` | "Your order is ready." |
| `ORDER_OUT_FOR_DELIVERY` | "Your order is on its way." |
| `ORDER_DELIVERED` | "Your order has been delivered. Thank you for ordering!" → then ask for a rating |
| `ORDER_CANCELLED` | "Order {{orderNumber}} has been cancelled." |

Every payload carries what a message needs:

```jsonc
{ "orderId": "…", "orderNumber": "ORD-260912-0003",
  "status": "READY", "paymentStatus": "SUCCESS",
  "totalAmount": "930", "currency": "INR",
  "customer": { "id": "…", "name": "Ananya Rao", "whatsappNumber": "919876543210" },
  "items": [ { "name": "Butter Naan", "quantity": 1, "unitPrice": "70", "total": "70" } ] }
```

`whatsappNumber` is already normalised E.164 without the `+`, which is exactly
the `wa_id` format the Cloud API expects.

### The rating follow-up

After `ORDER_DELIVERED`, wait a few minutes, then ask for a 1–5 rating. When the
customer replies:

`POST /api/reviews`
```json
{ "orderNumber": "{{$json.orderNumber}}",
  "rating": {{$json.rating}},
  "comment": "{{$json.comment}}",
  "source": "WHATSAPP",
  "externalEventId": "review-{{$json.orderNumber}}" }
```

The CRM takes the customer from the order, so a rating can never land on the
wrong person, and a second reply cannot create a second review.

---

## Receiving events

### Option A — polling (easiest for local n8n)

No public URL needed.

1. **Schedule Trigger**, every 30 seconds.
2. **HTTP Request**: `GET /api/events?status=PENDING&limit=50`
3. **Switch** on `type` → send the matching WhatsApp message.
4. **HTTP Request**: `POST /api/events/{{$json.id}}/ack`

Acknowledge only *after* the message is sent. An unacknowledged event is handed
out again — at-least-once delivery, so keep step 3 tolerant of a repeat.

### Option B — webhooks (production)

1. In the CRM, configure a webhook endpoint (the seed creates one from
   `N8N_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET`).
2. In n8n, add a **Webhook** node at that path.
3. **Verify the signature before acting on the body:**

   ```js
   const crypto = require("crypto");
   const raw = JSON.stringify($json.body);
   const ts = $json.headers["x-crm-timestamp"];
   const expected = "sha256=" + crypto.createHmac("sha256", $env.CRM_WEBHOOK_SECRET)
     .update(`${ts}.${raw}`).digest("hex");
   if (expected !== $json.headers["x-crm-signature"]) throw new Error("Bad signature");
   if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error("Stale delivery");
   return $json.body;
   ```

4. Return 2xx only on success. Anything else is retried with exponential backoff
   up to `EVENT_MAX_ATTEMPTS`, after which the event is marked `DEAD` and shown
   on the CRM's Settings screen.

5. Run the dispatcher so the outbox is actually flushed:

   ```bash
   npm run events:dispatch -- --watch --interval=10
   ```

   or from cron: `* * * * * curl -X POST .../api/events/dispatch -H "Authorization: Bearer $KEY" -d '{}'`

Both options can run together: an event is delivered once, whichever side gets
there first.

---

## Common mistakes

| Mistake | What goes wrong | Do instead |
| --- | --- | --- |
| `POST /api/customers` when a conversation starts | Fills the CRM with people who never bought anything | Let `POST /api/payments` create customers |
| Skipping `externalEventId` / `Idempotency-Key` | Provider retries still converge, but you lose the replay signal | Always send the provider's event id |
| Only reporting successful payments | The restaurant cannot follow up on failures | Send `FAILED` too |
| Sending card details in `metadata` | They are redacted on arrival | Send `rrn`, `method`, gateway references only |
| Acknowledging an event before sending the message | A crash loses the notification | Ack after the send succeeds |
| Deriving the customer for a review in n8n | A rating can land on the wrong person | Send `orderNumber`; the CRM resolves it |

---

## Health and troubleshooting

- `GET /api/health` — unauthenticated liveness check.
- **Settings** in the CRM shows pending, delivered, failed and dead event counts.
- `GET /api/events?status=DEAD` lists events that exhausted their retries.
- A `409 CONFLICT` on `POST /api/payments` means the same `Idempotency-Key` was
  reused with a *different* body — usually an n8n expression resolving
  inconsistently between runs.
