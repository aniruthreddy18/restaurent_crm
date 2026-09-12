# n8n integration — WhatsApp + PhonePe

Exactly what your n8n workflow needs. Every example below was run against the
live API, not written from the schema.

---

## 1. Base URL

| Environment | Base URL |
| --- | --- |
| Local (running now) | `http://localhost:3002/api` |
| Deployed | `https://<your-app>.vercel.app/api` |

Not deployed yet — the Vercel + Neon steps are in [DEPLOY.md](DEPLOY.md). Build
the workflow against localhost and change one variable when you go live.

> Note the `/api` prefix. Your spec said `GET /customers/phone/{phone}`; the
> real path is `GET /api/customers/phone/{phone}`.

---

## 2. Authentication

Every request carries a bearer token:

```http
Authorization: Bearer rk_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

In n8n: **Credentials → Header Auth** — Name `Authorization`, Value
`Bearer <your key>`. Attach it to every HTTP Request node.

Create keys in the CRM under **Settings → API keys**. The raw value is shown
once; only its SHA-256 digest is stored. The key identifies your restaurant, so
a request can never reach another tenant's data whatever it sends in the body.

---

## 3. Find customer by phone

```http
GET /api/customers/phone/{phone}
```

Any format works — `+91 90000 77777`, `09000077777`, `919000077777`. URL-encode
a leading `+` as `%2B`, or just send the digits.

**Lookup only — it never creates.** Safe to call on every turn of a conversation.

### Found → `200`

```json
{
  "success": true,
  "data": {
    "id": "49831d5b-855d-47eb-a298-713cea33574f",
    "name": "Aarti Desai",
    "whatsappNumber": "919000077777",
    "phone": "919000077777",
    "email": null,
    "city": null,
    "totalOrders": 1,
    "totalSpent": "1440",
    "averageOrderValue": "1440",
    "customerType": "NEW",
    "firstOrderAt": "2026-09-12T13:42:11.902Z",
    "lastOrderAt": "2026-09-12T13:42:11.902Z",
    "found": true
  }
}
```

**`data.id` is the Customer ID.**

### Not found → `404`

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Customer for 919000077777 not found" } }
```

This is the **normal** answer for anyone who has not completed a payment — not
an error. In n8n, set the HTTP Request node to **Never Error** (or allow 404) and
branch on `success`.

---

## 4. Create customer

```http
POST /api/customers
```

```json
{
  "whatsappNumber": "+91 90000 77777",
  "name": "Aarti Desai",
  "email": "aarti@example.com",
  "address": "Flat 7, Kondapur",
  "city": "Hyderabad"
}
```

Returns `201` with the customer object (`data.id` is the Customer ID), or `409`
if that number already exists.

### You probably do not need this

`POST /api/orders` already does find-or-create by phone, atomically, at the
moment the payment settles. Calling `POST /api/customers` during a conversation
fills the CRM with people who only asked about prices — the exact thing the
system was built to avoid.

Use it for genuine manual entry (a walk-in, an order taken by phone). For the
WhatsApp flow, skip straight to the order.

---

## 5. Create order

```http
POST /api/orders
```

Send the payload you specified:

```json
{
  "phone": "+91 90000 77777",
  "customerName": "Aarti Desai",
  "orderId": "ORD-COOKIE-2001",
  "cookieType": "Double Chocolate Chip",
  "quantity": 12,
  "toppings": ["Sea salt", "Walnuts"],
  "deliveryDate": "2026-09-20T10:00:00.000Z",
  "totalPrice": 1440,
  "paymentStatus": "SUCCESS",
  "paymentTransactionId": "T2409121234567890",
  "paidAt": "2026-09-12T12:00:00.000Z",
  "gateway": "phonepe",
  "paymentMethod": "UPI"
}
```

### Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `customerId` | uuid | ✱ | Use it if you already have it. Otherwise send `phone`. |
| `phone` | string | ✱ | Any format. Creates the customer **only** when payment is terminal. |
| `customerName` | string | | Stored on first contact; never overwrites an existing name with a blank. |
| `orderId` | string | | **Your** reference. Unique per restaurant — the idempotency anchor. |
| `cookieType` | string | ✱ | Becomes the order line's name snapshot. |
| `quantity` | int ≥ 1 | | Defaults to 1. |
| `toppings` | string[] or CSV | | Snapshotted on the line as structured `modifiers`. |
| `unitPrice` | number | | If omitted, derived as `totalPrice / quantity`. |
| `items` | array | ✱ | Multi-line alternative to `cookieType` — `[{name, price, quantity, modifiers?}]`. |
| `deliveryDate` | ISO 8601 | | When the customer wants it. Stored as `scheduledFor`. |
| `deliveryAddress` | string | | Present ⇒ a delivery record is opened automatically. |
| `totalPrice` | number | | Authoritative total — what PhonePe actually charged. |
| `deliveryFee` / `discount` / `tax` | number | | Default 0. |
| `paymentStatus` | `PENDING`·`SUCCESS`·`FAILED`·`REFUNDED` | | Default `PENDING`. |
| `paymentTransactionId` | string | ✱ | **Required** when status is SUCCESS or FAILED. |
| `paidAt` | ISO 8601 | | Defaults to now on success. |
| `gateway` / `paymentMethod` | string | | e.g. `phonepe`, `UPI`. |
| `notes` | string | | Free text. |

✱ = conditionally required. You need `customerId` **or** `phone`; and
`cookieType` **or** `items`.

### Response → `201`

```json
{
  "success": true,
  "data": {
    "duplicate": false,
    "orderId": "ORD-COOKIE-2001",
    "crmOrderId": "b44b663a-fe7f-4869-b800-ebd87a4ec855",
    "orderNumber": "ORD-260912-0022",
    "customerId": "49831d5b-855d-47eb-a298-713cea33574f",
    "customerCreated": true,
    "status": "CONFIRMED",
    "paymentStatus": "SUCCESS",
    "paymentId": "915f85ab-3ded-484c-aa8e-2d9270485046"
  }
}
```

| Field | Meaning |
| --- | --- |
| `orderId` | Your reference, echoed back |
| `crmOrderId` | The CRM's internal id — use it for status updates |
| `orderNumber` | Human-readable, what staff see: `ORD-260912-0022` |
| `customerId` | **The Customer ID**, found or created |
| `customerCreated` | `true` only the first time this phone number ever paid |
| `duplicate` | `true` if this was a repeat callback |

One call creates the customer, the order, the order line (with price snapshot),
the payment record and the `CUSTOMER_CREATED` / `PAYMENT_SUCCESS` /
`ORDER_CONFIRMED` events.

---

## 6. Duplicate PhonePe callbacks

**Send the same `orderId` and you cannot get a second order.** Verified live:

Second identical callback → `200` (not `201`), same ids, `duplicate: true`:

```json
{
  "success": true,
  "data": {
    "duplicate": true,
    "orderId": "ORD-COOKIE-2001",
    "crmOrderId": "b44b663a-fe7f-4869-b800-ebd87a4ec855",
    "orderNumber": "ORD-260912-0022",
    "customerId": "49831d5b-855d-47eb-a298-713cea33574f",
    "status": "CONFIRMED",
    "paymentStatus": "SUCCESS",
    "totalPrice": "1440"
  }
}
```

Protection runs at four independent levels, so a duplicate is caught even if one
of them is missing from your payload:

| Level | Key | Enforced by |
| --- | --- | --- |
| 1 | `orderId` | `UNIQUE (restaurant_id, external_order_id)` |
| 2 | `Idempotency-Key` header | Stored response replayed verbatim |
| 3 | `paymentTransactionId` | `UNIQUE (restaurant_id, transaction_id)` |
| 4 | Event de-duplication | `UNIQUE (restaurant_id, external_event_id)` |

Concurrent duplicates (two callbacks landing at the same instant) retry the
transaction and converge on one row rather than racing.

PhonePe retrying with a **new** transaction id but the same `orderId` still
yields one order — both attempts are kept as payment history.

Always send `orderId`. Optionally also:

```http
Idempotency-Key: ORD-COOKIE-2001
```

---

## 7. The n8n flow

```
WhatsApp message
   └─ POST /api/messages                          (logs it; creates no customer)

AI agent + Google Sheets
   └─ POST /api/checkout-sessions                 (the cart; creates no customer)

PhonePe payment
   └─ callback → POST /api/orders                 ← customer + order + payment
                                                    + events, all in one call

CRM events → n8n → WhatsApp
   ORDER_CONFIRMED   "Order confirmed"
   ORDER_READY       "Your order is ready"
   ORDER_DELIVERED   "Delivered — thank you!" → ask for a rating
```

For a `PENDING` payment, post the cart to `/api/checkout-sessions`, not to
`/api/orders`. Abandoned carts then leave nothing behind.

### If you must create the customer first

Your original plan — lookup, create, then order — still works:

1. `GET /api/customers/phone/{phone}` → `404`
2. `POST /api/customers` → `data.id`
3. `POST /api/orders` with `customerId` + `paymentStatus`

The CRM allows it. It just means a customer record exists for everyone who
reaches checkout, including those who never pay. Sending `phone` on the order
instead gives you the same Customer ID with none of that.

---

## 8. Errors

| Status | Code | Cause |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Bad, missing or revoked key |
| 404 | `NOT_FOUND` | No such customer/order **in your restaurant** |
| 409 | `CONFLICT` | Same `Idempotency-Key` reused with a *different* body |
| 422 | `VALIDATION_ERROR` | Bad shape — `details[]` names each field |
| 400 | `CUSTOMER_NOT_ESTABLISHED` | Non-terminal payment with no `customerId` |
| 429 | `RATE_LIMITED` | 300/min on orders; see `Retry-After` |

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "path": "paymentTransactionId",
        "message": "paymentTransactionId is required for a SUCCESS or FAILED payment" }
    ]
  }
}
```

---

## 9. Copy-paste test

```bash
export CRM=http://localhost:3002/api
export KEY=<your key>

curl -s -X POST $CRM/orders \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ORD-COOKIE-3001" \
  -d '{
    "phone": "+91 90000 77777",
    "customerName": "Aarti Desai",
    "orderId": "ORD-COOKIE-3001",
    "cookieType": "Double Chocolate Chip",
    "quantity": 12,
    "toppings": ["Sea salt", "Walnuts"],
    "deliveryDate": "2026-09-20T10:00:00.000Z",
    "totalPrice": 1440,
    "paymentStatus": "SUCCESS",
    "paymentTransactionId": "T2409121234567890",
    "paidAt": "2026-09-12T12:00:00.000Z",
    "gateway": "phonepe",
    "paymentMethod": "UPI"
  }' | jq

# Run it twice — the second returns duplicate: true and the same ids.

curl -s "$CRM/customers/phone/%2B91%2090000%2077777" -H "Authorization: Bearer $KEY" | jq
```
