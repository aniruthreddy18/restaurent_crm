# n8n setup — Restaurant CRM

**For the person who owns the n8n workflows.**

You don't need to install, build or deploy anything. The CRM is already live.
Your job is to make n8n talk to it: two connections, about 30 minutes.

---

## 1. What this is

A restaurant/bakery CRM — the permanent record of customers, orders, payments,
deliveries and reviews. It is **not** a chatbot and it never talks to WhatsApp.

You keep doing all the talking. The CRM just remembers.

```
  Customer ──► WhatsApp ──► n8n ──► AI agent          (you already have this)
                                      │
                                      ▼
                                   PhonePe
                                      │
                                      ▼
   ┌──────────────────────────────────────────────────┐
   │  1.  n8n tells the CRM: "someone paid"           │  ← you build this
   │  2.  CRM tells n8n: "order is ready"             │  ← and this
   └──────────────────────────────────────────────────┘
                                      │
                                      ▼
                            n8n ──► WhatsApp message
```

Two connections:

| # | Direction | When it runs | What it does |
| --- | --- | --- | --- |
| 1 | n8n → CRM | PhonePe confirms a payment | Creates the customer, order and payment |
| 2 | CRM → n8n | Every 30 seconds | Picks up "order ready" / "delivered" and sends WhatsApp |

### One rule worth knowing

The CRM creates a customer **only** when a payment reaches SUCCESS or FAILED.
Someone who says hello, asks about prices, builds a cart and disappears leaves
nothing permanent behind. So: don't call the "create customer" endpoint during a
conversation. Sending the order after payment does it for you, automatically.

---

## 2. What you need from the CRM owner

| Item | Example | Secret? |
| --- | --- | --- |
| CRM URL | `https://restaurent-crm.vercel.app` | No |
| API key | `rk_live_...` | **Yes** |
| The three workflow files | `0-test-connection.json`, `1-…`, `2-…` | No |
| A staff login (optional) | `you@example.com` + password | **Yes** |

That is the complete list. You do **not** need — and should not be given —
database credentials, the Vercel account, the GitHub repo, or the CRM admin
password. The API key alone does everything n8n needs.

The optional staff login is only so you can watch orders move on screen while
testing. Ask for a **Kitchen** role account, not an admin one.

---

## 3. Check the CRM is up

Before touching n8n:

```bash
curl -s https://restaurent-crm.vercel.app/api/health
```

Expected:

```json
{"status":"ok","config":"ok","database":"up","time":"..."}
```

If it says `degraded`, stop — it tells you which setting is wrong, and that is
the CRM owner's job to fix, not yours.

---

## 4. Save the API key in n8n

The CRM rejects any request without a key. In n8n a saved key is a
**credential**: create it once, then point every node at it.

1. Open n8n → top-left menu → **Credentials** → **Add credential**
2. Search for **Header Auth**, select it
3. Fill in three fields:

   | Field | Value |
   | --- | --- |
   | Credential name | `CRM API` |
   | **Name** | `Authorization` |
   | **Value** | `Bearer rk_live_...` |

4. **Save**

> The word `Bearer`, then a space, then the key. Pasting the key on its own is
> the single most common mistake and produces `401 Unauthorized`.

---

## 5. Test the connection first

Import **`0-test-connection.json`**
(**Workflows → Add workflow ▾ → Import from File**).

1. Click the **Ask the CRM for customers** node
2. **Credential to connect with** → `CRM API`
3. Close it, click **Test workflow**

| Result | Meaning |
| --- | --- |
| Green, JSON with a `data` array | Working. Continue. |
| `401 Unauthorized` | Credential wrong — check `Bearer ` and the space |
| `403 Forbidden` | Key was revoked. Ask for a new one. |
| Connection refused / timeout | Check the URL, and that you have internet |

**Do not continue until this is green.** Everything below depends on it.

---

## 6. Connection 1 — payment becomes an order

Import **`1-phonepe-to-crm.json`**.

| Node | Purpose |
| --- | --- |
| **PhonePe callback** | A webhook PhonePe calls when a payment finishes |
| **Map to CRM payload** | Renames PhonePe's fields to the CRM's field names |
| **POST /api/orders** | Creates customer + order + payment in one call |
| **Acknowledge PhonePe** | Replies 200 so PhonePe stops retrying |

### Set it up

1. **POST /api/orders** → credential → `CRM API`
2. **Map to CRM payload** → this is the only node you must edit. See below.
3. **Save** → toggle **Active** (top right)
4. **PhonePe callback** → copy the **Production URL** → register it in the
   PhonePe dashboard as the callback URL

### The mapping node

The CRM expects these field names. Map your own checkout data onto them:

| CRM field | Required | Notes |
| --- | --- | --- |
| `phone` | yes | Any format — `+91 90000 55555`, `09000055555`, all fine |
| `orderId` | strongly | **Your** order reference. Makes retries safe. |
| `cookieType` | yes | Product name |
| `quantity` | | Defaults to 1 |
| `toppings` | | Array or comma-separated string |
| `deliveryDate` | | ISO 8601 |
| `totalPrice` | yes | What was actually charged |
| `paymentStatus` | yes | `SUCCESS` / `FAILED` / `PENDING` |
| `paymentTransactionId` | yes when terminal | PhonePe's transaction id |
| `paidAt`, `gateway`, `paymentMethod`, `deliveryAddress`, `customerName` | | Optional |

Full request/response reference: `docs/INTEGRATION.md` in the repo.

### Duplicate callbacks are already handled

PhonePe retries. Send the same `orderId` and the CRM returns the original order
with `"duplicate": true` — never a second order, second customer or second
charge record. The node already sends `Idempotency-Key` too.

**Send failed payments as well** (`paymentStatus: "FAILED"`). The restaurant
wants to know about those, and the CRM records them without counting the money.

---

## 7. Connection 2 — CRM events become WhatsApp messages

Import **`2-crm-events-to-whatsapp.json`**. This one runs on its own.

| Node | Purpose |
| --- | --- |
| **Every 30 seconds** | Timer |
| **GET pending events** | Asks the CRM what's new |
| **One item per event** | Splits the list |
| **Build message** | Writes the sentence the customer reads |
| **Send WhatsApp message** | Sends it |
| **Acknowledge event** | Tells the CRM it was sent, so it isn't repeated |

### Set it up

1. **GET pending events** → credential → `CRM API`
2. **Acknowledge event** → credential → `CRM API`
3. **Send WhatsApp message** → easiest path: **delete this node** and drop in the
   WhatsApp node you already use, reconnecting
   `Build message → your node → Acknowledge event`.
   It expects `to` (the number) and `text` (the message) on each item.
4. **Build message** → edit the wording. Every customer-facing sentence is here.
5. **Save** → **Active**

### Events you'll receive

| Event | Suggested message |
| --- | --- |
| `ORDER_CONFIRMED` | "Your order {{orderNumber}} is confirmed." |
| `PAYMENT_FAILED` | "Payment didn't go through. Reply RETRY." |
| `ORDER_READY` | "Your order is ready." |
| `ORDER_OUT_FOR_DELIVERY` | "Your order is on its way." |
| `ORDER_DELIVERED` | "Delivered — thank you!" then ask for a 1–5 rating |
| `ORDER_CANCELLED` | "Your order has been cancelled." |

`CUSTOMER_CREATED`, `PAYMENT_SUCCESS` and `REVIEW_RECEIVED` are internal —
acknowledge them and send nothing.

Every event payload carries what a message needs:

```json
{
  "orderNumber": "ORD-260912-0022",
  "totalAmount": "1440",
  "customer": { "name": "Aarti Desai", "whatsappNumber": "919000077777" },
  "items": [{ "name": "Double Chocolate Chip", "quantity": 12 }]
}
```

`whatsappNumber` is already in the exact format the WhatsApp Cloud API wants.

### Acknowledge only after sending

The **Acknowledge event** node runs last on purpose. If WhatsApp fails, the event
stays pending and goes out on the next pass instead of disappearing. Don't
reorder those two nodes.

---

## 8. Optional — instant instead of every-30-seconds

Polling every 30 s is reliable and needs no public URL. If you want
sub-second delivery, the CRM can push instead. Ask the owner to register your
n8n webhook URL, then verify the signature before trusting the body:

```js
const crypto = require('crypto');
const raw = JSON.stringify($json.body);
const ts  = $json.headers['x-crm-timestamp'];
const expected = 'sha256=' + crypto.createHmac('sha256', CRM_WEBHOOK_SECRET)
  .update(`${ts}.${raw}`).digest('hex');
if (expected !== $json.headers['x-crm-signature']) throw new Error('Bad signature');
if (Math.abs(Date.now()/1000 - Number(ts)) > 300) throw new Error('Stale delivery');
return $json.body;
```

Both can run together — an event is delivered once, whichever arrives first.

---

## 9. End-to-end test

Use your own WhatsApp number so the test message reaches you.

```bash
export CRM=https://restaurent-crm.vercel.app/api
export KEY=<the API key>

curl -s -X POST "$CRM/orders" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"<your WhatsApp number>","customerName":"Test Run",
       "orderId":"TEST-1","cookieType":"Double Chocolate Chip","quantity":6,
       "toppings":["Sea salt"],"totalPrice":720,"paymentStatus":"SUCCESS",
       "paymentTransactionId":"T-TEST-1","gateway":"phonepe"}'
```

Expect `"customerCreated": true` and an `orderNumber`.

Run the **exact same command again** — you should get `"duplicate": true` and
identical ids. That is the retry protection working.

Then, with a staff login, open `https://restaurent-crm.vercel.app/orders`:

1. The order sits in **Confirmed**
2. **Start preparing** → moves to Preparing
3. **ORDER IS READY** → within 30 s your WhatsApp message arrives

If it does, both connections work.

---

## 10. If something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 Unauthorized` | Credential missing `Bearer ` prefix | Re-edit the credential |
| `403 Forbidden` | Key revoked | Ask for a new key |
| `422 VALIDATION_ERROR` | A field is wrong — `details[]` names it | Fix the mapping node |
| `400 MISSING_ORDER_ITEMS` | No `cookieType` and no `items` | Add the product name |
| `409 CONFLICT` | Same `Idempotency-Key`, different body | Make the expression stable between runs |
| Duplicate orders appearing | `orderId` changes per retry | Use PhonePe's `merchantOrderId`, not a random value |
| No WhatsApp messages | Workflow 2 inactive, or credential missing | Check **Active**, check both CRM nodes |
| Messages repeat forever | **Acknowledge event** failing | Open the execution, check that node |
| `degraded` on /api/health | CRM misconfigured | Owner's job — the response names the variable |

### Useful checks

```bash
# What is the CRM waiting to tell you?
curl -s "$CRM/events?status=PENDING" -H "Authorization: Bearer $KEY"

# Anything permanently stuck?
curl -s "$CRM/events?status=DEAD" -H "Authorization: Bearer $KEY"

# Does this customer exist yet?
curl -s "$CRM/customers/phone/919000077777" -H "Authorization: Bearer $KEY"
```

A `404` on the last one is normal — it means that number has never completed a
payment, so by design there is no CRM record.

---

## 11. Reference

| Document | Contents |
| --- | --- |
| `docs/INTEGRATION.md` | Every endpoint, request and response, verified against the live API |
| `docs/API.md` | Full API reference including events and webhooks |
| `docs/N8N.md` | Design notes on the n8n split of responsibilities |
