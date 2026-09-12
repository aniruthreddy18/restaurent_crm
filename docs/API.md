# Restaurant CRM — API reference

Base URL: `http://localhost:3000/api` in development.

All responses share one envelope:

```jsonc
// success
{ "success": true, "data": { /* … */ } }

// failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ /* … */ ] } }
```

---

## Authentication

Two schemes. Most endpoints accept either.

### API key — for n8n and any machine caller

```http
Authorization: Bearer rk_live_xxxxxxxxxxxxxxxxxxxx
```

`X-Api-Key: <key>` also works. Create keys in **Settings → API keys**; the raw
value is shown once, and only its SHA-256 digest is stored. The key determines
the restaurant — a caller can never reach another tenant's data, whatever it
sends in the body.

### Session cookie — for the dashboard UI

Set by `POST /api/auth/login`. Cookie-authenticated **mutations** must also echo
the CSRF cookie:

```http
X-CSRF-Token: <value of the crm_csrf cookie>
```

API-key callers are exempt from CSRF — they carry no ambient cookie authority.

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Missing, invalid, revoked or expired credentials |
| 403 | `FORBIDDEN` | Authenticated, but the role lacks the permission (or CSRF failed) |
| 404 | `NOT_FOUND` | No such record **in your restaurant** |
| 409 | `CONFLICT` | Unique-constraint clash, or an idempotency key reused with a different body |
| 422 | `VALIDATION_ERROR` | Zod rejected the request; `details[]` lists each problem |
| 400 | `BUSINESS_RULE_VIOLATION` | Valid shape, illegal operation (e.g. an invalid status transition) |
| 429 | `RATE_LIMITED` | Too many requests; see the `Retry-After` header |
| 500 | `INTERNAL_ERROR` | Unexpected. Details are logged server-side, never returned |

### Rate limits

120 requests/minute per principal by default. Higher on the hot paths:
`POST /api/payments` 300/min, `POST /api/messages` and
`POST /api/checkout-sessions` 600/min. `POST /api/auth/login` is 10 per 5
minutes per IP.

---

## Idempotency

Send an `Idempotency-Key` header on any POST that must not be applied twice:

```http
Idempotency-Key: evt_razorpay_9f3a1c
```

The first call runs and its response is stored. Replays return **that exact
stored response** with `"replayed": true` added. Reusing a key with a *different*
body is a `409` — that is a caller bug, and silently returning the old answer
would hide it.

> Because the stored response is returned verbatim, a replay of a
> customer-creating call still shows `"customerCreated": true`. Read `replayed`
> to tell a first delivery from a repeat.

`POST /api/payments` is additionally idempotent on `transactionId` alone, so
replays are safe even without the header.

---

## Endpoints

### Health

#### `GET /api/health`
Unauthenticated liveness probe. Exposes no tenant data.

```json
{ "status": "ok", "database": "up", "time": "2026-09-12T12:00:00.000Z" }
```
Returns `503` with `"status": "degraded"` if the database is unreachable.

---

### Auth

#### `POST /api/auth/login`

```json
{ "email": "admin@spicegarden.test", "password": "Password123!" }
```

```json
{ "success": true,
  "data": { "user": { "id": "…", "name": "Priya Sharma", "email": "…", "role": "ADMIN" },
            "restaurant": { "id": "…", "name": "Spice Garden" } } }
```

Sets `crm_session` (httpOnly) and `crm_csrf`. Wrong email and wrong password
return the same `401` message.

#### `POST /api/auth/logout`
Clears both cookies.

---

### Customers

Permission: `customers:read` / `customers:write`.

#### `GET /api/customers`

| Query | Notes |
| --- | --- |
| `page`, `pageSize` | default 1 / 20, max 100 |
| `search` | name, email, phone or WhatsApp number in any format |
| `customerType` | `NEW` `REGULAR` `LOYAL` `VIP` `INACTIVE` |
| `city` | exact, case-insensitive |
| `sort` | `recent` (default) `spend` `orders` `name` |

```json
{ "success": true,
  "data": { "data": [ { "id": "…", "name": "Ananya Rao", "whatsappNumber": "919876543210",
                        "customerType": "LOYAL", "totalOrders": 7, "totalSpent": "7415",
                        "averageOrderValue": "1059.29", "lastOrderAt": "2026-09-12T…" } ],
            "meta": { "page": 1, "pageSize": 20, "total": 7, "totalPages": 1 } } }
```

#### `GET /api/customers/:id`
Full profile: `customer`, `orders`, `payments`, `reviews`, `deliveries` and a
`timeline` built from the event outbox.

#### `POST /api/customers`
Manual entry (walk-in, phone order). **n8n should not call this during a
conversation** — permanent customers come from the payment result.

```json
{ "whatsappNumber": "+91 98765 43210", "name": "Ananya Rao", "city": "Hyderabad" }
```

`409` if the number already exists in this restaurant.

#### `PATCH /api/customers/:id`
Any of `name`, `phone`, `email`, `address`, `city`, `notes`.
`whatsappNumber` is immutable — it is the identity key.

---

### Payments — the primary n8n integration point

#### `POST /api/payments`

Permission: `payments:write`. Call this once the payment provider returns.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `transactionId` | string | ✔ | Gateway id. Unique per restaurant; the idempotency anchor |
| `status` | `PENDING` \| `SUCCESS` \| `FAILED` \| `REFUNDED` | ✔ | Only SUCCESS/FAILED create a customer |
| `amount` | number | ✔ | |
| `currency` | string(3) | | default `INR` |
| `whatsappNumber` | string | ✔ | Any format; normalised to E.164 without `+` |
| `customer` | object | | `name`, `phone`, `email`, `address`, `city` |
| `checkoutSessionId` | string | | Converts that cart; supplies items if `items` is omitted |
| `items` | array | | `{ productId?, name, price, quantity, notes? }`. Wins over the cart |
| `deliveryFee`, `discount`, `tax` | number | | Fall back to the cart's values |
| `deliveryAddress` | string | | Creates a delivery record on success |
| `paymentMethod`, `gateway` | string | | e.g. `UPI`, `razorpay` |
| `failureReason` | string | | For FAILED |
| `paidAt` | ISO 8601 | | Defaults to now on success |
| `externalEventId` | string | | Provider webhook id — de-duplicates the event |
| `metadata` | object | | Non-sensitive echo. Card/CVV/PIN-like keys are redacted |

**Behaviour by status**

| Status | Customer | Order | Payment | Events |
| --- | --- | --- | --- | --- |
| `PENDING` | none | none | recorded | none |
| `SUCCESS` | created or reused | created, `CONFIRMED` | `SUCCESS` | `PAYMENT_SUCCESS`, `ORDER_CONFIRMED`, (`CUSTOMER_CREATED`) |
| `FAILED` | created or reused | created, `FAILED` | `FAILED` | `PAYMENT_FAILED`, (`CUSTOMER_CREATED`) |

A failed payment retried successfully on the same checkout session **revives the
existing order** rather than creating a second one.

```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $CRM_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evt_razorpay_9f3a1c" \
  -d '{
    "transactionId": "pay_NkR2x8Lm",
    "status": "SUCCESS",
    "amount": 920,
    "currency": "INR",
    "paymentMethod": "UPI",
    "gateway": "razorpay",
    "whatsappNumber": "+91 90000 55555",
    "customer": { "name": "Demo Diner", "city": "Hyderabad" },
    "checkoutSessionId": "sess-abc-123",
    "deliveryAddress": "Flat 7, Kondapur",
    "externalEventId": "evt_razorpay_9f3a1c"
  }'
```

```json
{ "success": true,
  "data": { "replayed": false, "customerCreated": true,
            "customerId": "7f2a0f4e-…", "orderId": "411eb29b-…",
            "orderNumber": "ORD-260912-0021", "paymentId": "989c8797-…",
            "paymentStatus": "SUCCESS", "orderStatus": "CONFIRMED" } }
```

`201` on first processing, `200` on a replay.

**Errors**: `422` bad shape · `404` unknown `checkoutSessionId` ·
`400 MISSING_ORDER_ITEMS` when neither `items` nor a cart supplies lines ·
`409` idempotency key reused with a different body.

#### `GET /api/payments`
Filters: `status`, `customerId`, `orderId`, `search` (transaction id, order
number, customer name), `page`, `pageSize`.

#### `GET /api/payments/:id` · `PATCH /api/payments/:id`
`PATCH` takes `status`, `failureReason`, `metadata` — for manual corrections and
refund marking. It updates the linked order's payment status and recomputes the
customer's lifetime value. It never re-runs customer creation.

---

### Checkout sessions — the temporary layer

Creating or updating one creates **no** customer and **no** order.

#### `POST /api/checkout-sessions`
Idempotent on `sessionId`; safe to call on every turn of the conversation.

```json
{ "sessionId": "sess-abc-123",
  "whatsappNumber": "+91 90000 55555",
  "customerName": "Demo Diner",
  "items": [ { "name": "Hyderabadi Chicken Biryani", "price": 380, "quantity": 2 },
             { "name": "Gulab Jamun (2 pc)", "price": 120, "quantity": 1 } ],
  "deliveryAddress": "Flat 7, Kondapur",
  "deliveryFee": 40, "discount": 0, "tax": 0,
  "expiresInMinutes": 30 }
```

Totals are computed server-side; a discount larger than the cart floors the total
at zero rather than going negative.

#### `GET /api/checkout-sessions` · `GET /api/checkout-sessions/:id`
`:id` accepts the CRM id or your `sessionId`.

#### `PATCH /api/checkout-sessions/:id`
`{ "status": "ABANDONED" }`. Still creates nothing permanent.

---

### Orders

#### `GET /api/orders`
Filters: `status`, `paymentStatus`, `customerId`, `search`, `from`, `to` (ISO),
`page`, `pageSize`.

#### `POST /api/orders`
Permission: `orders:write`. Requires an **existing** `customerId` — this endpoint
is not a back door around the core rule.

```json
{ "customerId": "7f2a0f4e-…",
  "items": [ { "name": "Butter Chicken", "price": 420, "quantity": 1 } ],
  "deliveryFee": 40, "paymentStatus": "PENDING" }
```

#### `GET /api/orders/:id`
Accepts the id or the order number. Includes items, customer, payments, delivery
and review.

#### `PATCH /api/orders/:id`
`status` (permission `orders:status`), `deliveryAddress`, `notes`
(`orders:write`), plus an optional `reason` recorded in the audit log.
An illegal transition returns `400 INVALID_ORDER_TRANSITION` and lists what is
allowed from the current status.

#### `POST /api/orders/:id/ready` — **the [ORDER IS READY] button**
Permission: `orders:status`. Validates the transition, sets `READY`, stamps
`readyAt`, writes an audit row and emits `ORDER_READY`.

```json
{ "success": true,
  "data": { "id": "…", "orderNumber": "ORD-260912-0021", "status": "READY",
            "readyAt": "2026-09-12T12:20:00.000Z", "event": "ORDER_READY" } }
```

The CRM does **not** send the WhatsApp message — n8n consumes the event and does.

#### `POST /api/orders/:id/cancel`
Permission: `orders:cancel`. Body `{ "reason": "…" }`. Emits `ORDER_CANCELLED`
and removes the order from the customer's lifetime value.

#### `GET /api/orders/:id/timeline`
Merged audit rows and events for that order.

#### `GET /api/orders/board`
The five Kanban columns with their orders.

---

### Deliveries

#### `GET /api/deliveries`
Filters: `status`, `driverId`, `scope` (`all` | `me`), `page`, `pageSize`.
A `DELIVERY`-role caller is hard-scoped to their own assignments regardless of
what they pass.

#### `POST /api/deliveries`
`{ "orderId": "…", "driverId": "…", "deliveryAddress": "…" }`. Upserts on order.

#### `PATCH /api/deliveries/:id`
`driverId`, `status`, `deliveryAddress`, `notes`, `failureReason`.
Setting `status` to `OUT_FOR_DELIVERY` or `DELIVERED` routes through the two
endpoints below so the order stays in step.

#### `POST /api/deliveries/:id/dispatch`
`READY → OUT_FOR_DELIVERY`. Emits `ORDER_OUT_FOR_DELIVERY`.
`400 ORDER_NOT_READY` if the kitchen has not finished.

#### `POST /api/deliveries/:id/delivered` — **the [MARK DELIVERED] button**
Sets delivery and order to `DELIVERED`, stamps the time, audits it and emits
`ORDER_DELIVERED`. Pressing it twice does not emit a second event.

```json
{ "success": true,
  "data": { "id": "…", "status": "DELIVERED", "deliveredAt": "2026-09-12T…",
            "orderNumber": "ORD-260912-0021", "event": "ORDER_DELIVERED" } }
```

---

### Reviews

#### `POST /api/reviews`
Identify the order by `orderId` **or** `orderNumber` (n8n usually has the
latter). The customer is taken from the order, never from the request — a rating
cannot be attributed to the wrong person.

```json
{ "orderNumber": "ORD-260912-0021", "rating": 5,
  "comment": "Fast and delicious!", "source": "WHATSAPP" }
```

`rating` must be 1–5. One review per order: a replay returns the existing review
with `"replayed": true`. Cancelled and failed orders return
`400 ORDER_NOT_REVIEWABLE`.

#### `GET /api/reviews`
Filters: `rating`, `customerId`, `page`, `pageSize`. The response carries a
`summary` with `averageRating` and `totalReviews`.

---

### Messages and conversations

#### `POST /api/messages`
Logs one WhatsApp message. **Never creates a customer** — it links to one only if
that number already has a CRM record.

```json
{ "whatsappNumber": "+91 90000 55555",
  "direction": "INBOUND",
  "message": "Hi, what is in the biryani?",
  "externalMessageId": "wamid.HBgMOTE5…",
  "status": "DELIVERED" }
```

Send `externalMessageId` and a replayed WhatsApp webhook stores nothing extra.

#### `GET /api/conversations`
Filters: `status`, `search`, `filter` (`all` | `customers` | `prospects`).
`prospects` is the set of people who have talked to you but never paid.

#### `GET /api/conversations/:id`
The thread, up to 300 messages.

---

### Menu

`GET|POST /api/menu/categories` · `GET|POST /api/menu/products` ·
`GET|PATCH|DELETE /api/menu/products/:id`

`menu:read` to read, `menu:write` to change. A `PATCH` carrying **only**
`isAvailable` needs just `menu:availability`, which is what lets kitchen staff
mark a dish sold out without being able to edit prices. `DELETE` is a soft
retire — it sets `isAvailable: false` so historical order lines keep their link.

---

### Events

#### `GET /api/events` — the pull side of the outbox

| Query | Notes |
| --- | --- |
| `status` | `PENDING` (default) `DELIVERED` `FAILED` `DEAD` |
| `type` | any event type |
| `since` | ISO 8601 |
| `limit` | default 50, max 200 |

```json
{ "success": true,
  "data": [ { "id": "41f53fee-…", "type": "ORDER_READY",
              "entityType": "order", "entityId": "dc74cac7-…",
              "externalEventId": null, "status": "PENDING", "attempts": 0,
              "occurredAt": "2026-09-12T12:12:16.557Z",
              "data": { "orderNumber": "ORD-260912-0003", "status": "READY",
                        "totalAmount": "930",
                        "customer": { "id": "…", "name": "Ananya Rao",
                                      "whatsappNumber": "919876543210" },
                        "items": [ { "name": "Butter Naan", "quantity": 1,
                                     "unitPrice": "70", "total": "70" } ] } } ] }
```

#### `POST /api/events/:id/ack`
Marks a polled event handled so it is not handed out again.

#### `POST /api/events/dispatch`
Permission: `settings:write`. Flushes pending events to every subscribed webhook.
Returns `{ "picked": 5, "delivered": 5, "failed": 0 }`.

---

### Staff and settings

`GET|POST /api/staff` · `PATCH /api/staff/:id` — `staff:read` / `staff:write`.
Creating a `DELIVERY` user automatically creates their driver profile. The last
active admin cannot be demoted or deactivated (`400 LAST_ADMIN`).

`GET|POST /api/settings/api-keys` · `DELETE /api/settings/api-keys/:id` —
**session auth only**, so a leaked API key cannot mint another.

---

## Outgoing webhooks (CRM → n8n)

Each delivery is a `POST` with:

```http
Content-Type: application/json
X-CRM-Event: ORDER_READY
X-CRM-Event-Id: 41f53fee-5aed-4e5c-ab11-871222c11e9b
X-CRM-Timestamp: 1789545136
X-CRM-Signature: sha256=8f1c…
```

```jsonc
{ "id": "41f53fee-…", "type": "ORDER_READY", "restaurantId": "…",
  "entityType": "order", "entityId": "dc74cac7-…",
  "externalEventId": null, "occurredAt": "2026-09-12T12:12:16.557Z",
  "data": { /* same payload as GET /api/events */ } }
```

### Verifying the signature

```js
const expected =
  "sha256=" + createHmac("sha256", secret)
    .update(`${headers["x-crm-timestamp"]}.${rawBody}`)
    .digest("hex");
// Compare with timingSafeEqual, and reject timestamps older than ~5 minutes.
```

The timestamp is inside the signed material, so a captured delivery cannot be
replayed later.

Any non-2xx response is a failure: the event is retried with exponential backoff
(capped at ~1 hour) until `EVENT_MAX_ATTEMPTS`, then marked `DEAD`.

### Event types

| Event | When |
| --- | --- |
| `CUSTOMER_CREATED` | A terminal payment brought a new customer into existence |
| `PAYMENT_SUCCESS` / `PAYMENT_FAILED` | A payment reached a terminal result |
| `ORDER_CONFIRMED` | A paid order was created — send the confirmation |
| `ORDER_PREPARING` | Kitchen started |
| `ORDER_READY` | [ORDER IS READY] pressed — send "your order is ready" |
| `ORDER_OUT_FOR_DELIVERY` | Driver dispatched |
| `ORDER_DELIVERED` | [MARK DELIVERED] pressed — thank them, then ask for a rating |
| `ORDER_CANCELLED` | Order cancelled |
| `REVIEW_RECEIVED` | A rating was stored |

---

## End-to-end walkthrough

Runnable against a seeded local instance.

```bash
export CRM=http://localhost:3000/api
export KEY=rk_test_local_development_key_change_me
auth=(-H "Authorization: Bearer $KEY" -H "Content-Type: application/json")

# 1. Someone messages the restaurant. No customer is created.
curl -s -X POST $CRM/messages "${auth[@]}" -d '{
  "whatsappNumber":"+91 90000 55555","direction":"INBOUND",
  "message":"Hi, what is in the biryani?","externalMessageId":"wamid.1","status":"DELIVERED"}'

# 2. The agent builds a cart. Still no customer.
curl -s -X POST $CRM/checkout-sessions "${auth[@]}" -d '{
  "sessionId":"sess-abc-123","whatsappNumber":"+91 90000 55555",
  "items":[{"name":"Hyderabadi Chicken Biryani","price":380,"quantity":2}],
  "deliveryAddress":"Flat 7, Kondapur","deliveryFee":40,"expiresInMinutes":30}'

# 3. Payment starts. Still no customer.
curl -s -X POST $CRM/payments "${auth[@]}" -d '{
  "transactionId":"pay_demo","status":"PENDING","amount":800,
  "whatsappNumber":"+91 90000 55555","checkoutSessionId":"sess-abc-123"}'

# 4. Payment succeeds. NOW the customer, order and payment appear.
curl -s -X POST $CRM/payments "${auth[@]}" -H "Idempotency-Key: evt-1" -d '{
  "transactionId":"pay_demo","status":"SUCCESS","amount":800,"paymentMethod":"UPI",
  "gateway":"razorpay","whatsappNumber":"+91 90000 55555",
  "customer":{"name":"Demo Diner"},"checkoutSessionId":"sess-abc-123",
  "externalEventId":"evt-1"}'
# -> { "customerCreated": true, "orderNumber": "ORD-…", "orderStatus": "CONFIRMED" }

# 5. Kitchen work. ORDER_ID comes from step 4.
curl -s -X PATCH $CRM/orders/$ORDER_ID "${auth[@]}" -d '{"status":"PREPARING"}'
curl -s -X POST  $CRM/orders/$ORDER_ID/ready "${auth[@]}" -d '{}'      # -> ORDER_READY

# 6. Delivery. DELIVERY_ID from GET /api/deliveries.
curl -s -X POST $CRM/deliveries/$DELIVERY_ID/dispatch  "${auth[@]}" -d '{}'
curl -s -X POST $CRM/deliveries/$DELIVERY_ID/delivered "${auth[@]}" -d '{}'  # -> ORDER_DELIVERED

# 7. The customer rates the order.
curl -s -X POST $CRM/reviews "${auth[@]}" -d "{
  \"orderId\":\"$ORDER_ID\",\"rating\":5,\"comment\":\"Fast and delicious!\",\"source\":\"WHATSAPP\"}"

# 8. Collect the events n8n should act on.
curl -s "$CRM/events?status=PENDING&limit=50" -H "Authorization: Bearer $KEY"
```
