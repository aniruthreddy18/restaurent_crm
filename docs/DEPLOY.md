# Deploy to Vercel + Neon, and connect n8n

Every command is copy-pasteable. Steps 2, 3 and 5 need your own accounts, so
they are the ones only you can run.

---

## What you are deploying

**One Next.js application.** The backend is not a separate service — the API
routes under `src/app/api/**` run as server-side functions in the same project
that serves the dashboard. There is no Express server, no second deploy.

```
  n8n (your Mac, :5678)                    Vercel                 Neon
  ─────────────────────                ──────────────        ─────────────
   HTTP ──────────────────────────────►  /api/orders   ──────► PostgreSQL
                                          /api/events           (all data)
   polls GET /api/events ◄──────────────  /api/customers
   receives signed webhooks ◄──────────── event outbox
```

**All data lives in PostgreSQL.** Nothing is held in files or in memory. Today
that is a local Homebrew Postgres at `/opt/homebrew/var/postgresql@17`; after
step 2 it is Neon, and your Mac is no longer part of the data path.

The 21 tables, grouped:

| Group | Tables |
| --- | --- |
| Permanent CRM | `customers` `orders` `order_items` `payments` `deliveries` `delivery_drivers` `reviews` |
| Temporary | `checkout_sessions` `conversation_sessions` `messages` |
| Menu | `categories` `products` |
| Integration | `events` `event_deliveries` `webhook_endpoints` `api_keys` `idempotency_records` |
| Platform | `restaurants` `users` `audit_logs` `notifications` |

---

## Step 1 — Push the code to GitHub

The CRM is its own git repo with one commit already made. It is **not** part of
the repo at your home directory — that matters, because committing from there
would sweep up your whole home folder.

```bash
cd ~/carrier-roadmap/restaurant-crm
gh repo create restaurant-crm --private --source=. --remote=origin --push
```

You are already signed in to `gh` as `aniruthreddy18`. Use `--public` instead of
`--private` if you prefer.

---

## Step 2 — Create the database (Neon)

1. Go to **https://console.neon.tech** and sign up (free tier is enough).
2. **Create project** → name it `restaurant-crm`, region **AWS ap-south-1
   (Mumbai)** so it sits next to the Vercel region configured in `vercel.json`.
3. On the dashboard, open **Connection string** and copy **two** URLs:

   | Toggle | Looks like | Use as |
   | --- | --- | --- |
   | **Pooled connection** ✅ | `...-pooler.ap-south-1.aws.neon.tech/...` | `DATABASE_URL` |
   | **Direct connection** | `...ap-south-1.aws.neon.tech/...` (no `-pooler`) | `DIRECT_URL` |

4. Append Prisma's pooling flags to the **pooled** one only:

   ```
   postgresql://USER:PASS@ep-xxx-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15
   ```

Both are needed. The app runs on the pooled URL because serverless functions
open many short-lived connections; `prisma migrate` needs the direct one,
because a transaction pooler cannot hold the session-level advisory locks
migrations take.

---

## Step 3 — Create the schema and your first login

Run this **from your Mac**, pointing at Neon:

```bash
cd ~/carrier-roadmap/restaurant-crm

export DATABASE_URL='<your pooled URL>'
export DIRECT_URL='<your direct URL>'

npx prisma migrate deploy
```

That creates all 21 tables. Then create your restaurant, admin user and API key:

```bash
npm run bootstrap -- \
  --name "Your Cookie Co" \
  --email you@example.com \
  --password 'a-long-strong-password' \
  --city Hyderabad \
  --currency INR \
  --timezone Asia/Kolkata
```

It prints an API key **once** — copy it now, you will need it in step 5.

> Do **not** run `npm run db:seed` against Neon. That is the development seed:
> it wipes and inserts demo data. `bootstrap` never deletes anything and is safe
> to re-run.

---

## Step 4 — Deploy to Vercel

1. Go to **https://vercel.com/new**, import the `restaurant-crm` repo.
2. Framework preset is detected as Next.js. **Leave the build command alone** —
   `package.json` already runs `prisma generate && next build`.
3. Add these environment variables (Production **and** Preview):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon **pooled** URL |
   | `DIRECT_URL` | Neon **direct** URL |
   | `AUTH_SECRET` | `openssl rand -base64 48` |
   | `COOKIE_SECURE` | `true` |
   | `DEFAULT_COUNTRY_CODE` | `91` |
   | `N8N_WEBHOOK_URL` | your n8n webhook URL (step 6) |
   | `N8N_WEBHOOK_SECRET` | `openssl rand -hex 32` |
   | `CRON_SECRET` | the API key from step 3 |

   ```bash
   openssl rand -base64 48   # AUTH_SECRET
   openssl rand -hex 32      # N8N_WEBHOOK_SECRET
   ```

4. **Deploy**, then check it:

   ```bash
   curl -s https://restaurent-crm.vercel.app/api/health
   # {"status":"ok","database":"up","time":"..."}
   ```

5. Sign in at `https://restaurent-crm.vercel.app/login` with the step-3 credentials.

`COOKIE_SECURE=true` matters: without it the session cookie is not marked
Secure, and browsers will drop it over HTTPS.

---

## Step 5 — Create the n8n credential

Your n8n is **Community edition**, which has no Variables feature, so the
workflows below carry the CRM URL inline — there is nothing to configure but
credentials.

**Credentials → New → Header Auth**

| Field | Value |
| --- | --- |
| Credential name | `CRM API` |
| Name | `Authorization` |
| Value | `Bearer <the API key from step 3>` |

That one credential is used by every node that talks to the CRM.

If you also want the WhatsApp send node in workflow 2, add a second Header Auth
credential named `WhatsApp API`, with Name `Authorization` and Value
`Bearer <your Meta permanent token>`.

---

## Step 6 — Import the workflows

Both files are in the `n8n/` folder of the repo. In n8n:
**Workflows → ⋯ → Import from File**.

### `n8n/1-phonepe-to-crm.json` — turns a payment into a CRM order

`PhonePe callback → map payload → POST /api/orders → respond`

After importing:

1. Open **POST /api/orders** → Credential → select `CRM API`.
2. Open **Map to CRM payload** and adjust the field mapping to match what your
   checkout stores. The code is commented line by line; the parts that matter
   are `phone`, `cookieType`, `quantity` and `merchantOrderId`.
3. **Save**, then **Activate**.
4. Copy the node's **Production URL** and register it with PhonePe as the
   callback URL.

The node already sends `Idempotency-Key: <orderId>`, so a retried PhonePe
callback returns the original order instead of creating a second one.

### `n8n/2-crm-events-to-whatsapp.json` — turns CRM events into messages

`every 30s → GET /api/events → build message → send WhatsApp → ack`

After importing:

1. Open **GET pending events** → Credential → `CRM API`.
2. Open **Acknowledge event** → Credential → `CRM API`.
3. Open **Send WhatsApp message**:
   - replace `YOUR_PHONE_NUMBER_ID` in the URL with your WhatsApp Cloud API
     phone number id, and attach the `WhatsApp API` credential; **or**
   - delete the node and drop in the WhatsApp send node you already use,
     reconnecting **Build message → (your node) → Acknowledge event**.
4. Check the wording in **Build message** — that Code node is where every
   customer-facing sentence lives.
5. **Save**, then **Activate**.

Acknowledgement happens only *after* a successful send, so a WhatsApp outage
leaves the event `PENDING` and it goes out on the next pass rather than being
silently lost.

---

### Optional — webhook push for lower latency

Polling every 30 s is robust and needs no public URL. To also get instant
delivery, add a **Webhook** node in n8n, then register it with the CRM:

```bash
export CRM=https://restaurent-crm.vercel.app/api
export KEY=<your API key>

# From the CRM UI: Settings → Webhook endpoints.
# Or set N8N_WEBHOOK_URL + N8N_WEBHOOK_SECRET and re-run bootstrap.
```

Verify the signature before trusting the body — a Code node:

```js
const crypto = require('crypto');
const raw = JSON.stringify($json.body);
const ts  = $json.headers['x-crm-timestamp'];
const expected = 'sha256=' + crypto.createHmac('sha256', $vars.CRM_WEBHOOK_SECRET)
  .update(`${ts}.${raw}`).digest('hex');
if (expected !== $json.headers['x-crm-signature']) throw new Error('Bad signature');
if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error('Stale delivery');
return $json.body;
```

Push and polling coexist safely: an event is delivered once, whichever gets
there first.

> Your n8n is currently reachable at
> `https://sloped-manatee-barometer.ngrok-free.dev`. Free ngrok domains change
> on restart — if you rely on push, either use a reserved domain or keep polling
> as the primary, which is why it is the default above.

---

## Step 7 — End-to-end check

```bash
export CRM=https://restaurent-crm.vercel.app/api
export KEY=<your API key>

# 1. Nobody yet
curl -s "$CRM/customers/phone/919000012345" -H "Authorization: Bearer $KEY"
# -> 404 NOT_FOUND  (expected)

# 2. A paid order
curl -s -X POST "$CRM/orders" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: LIVE-TEST-1" \
  -d '{"phone":"919000012345","customerName":"Live Test","orderId":"LIVE-TEST-1",
       "cookieType":"Double Chocolate Chip","quantity":6,"toppings":["Sea salt"],
       "totalPrice":720,"paymentStatus":"SUCCESS",
       "paymentTransactionId":"T-LIVE-1","gateway":"phonepe"}'
# -> customerCreated: true, orderNumber: ORD-...

# 3. Same call again — must NOT duplicate
curl -s -X POST "$CRM/orders" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: LIVE-TEST-1" \
  -d '{"phone":"919000012345","customerName":"Live Test","orderId":"LIVE-TEST-1",
       "cookieType":"Double Chocolate Chip","quantity":6,"toppings":["Sea salt"],
       "totalPrice":720,"paymentStatus":"SUCCESS",
       "paymentTransactionId":"T-LIVE-1","gateway":"phonepe"}'
# -> duplicate: true, same ids

# 4. The customer now exists
curl -s "$CRM/customers/phone/919000012345" -H "Authorization: Bearer $KEY"
```

Then in the dashboard: the order shows on the **Orders** board. Press
**ORDER IS READY** and workflow 2 should send the WhatsApp message within 30 s.

---

## How real-time it is

| Path | Latency |
| --- | --- |
| n8n → CRM (orders, lookups) | Immediate — a normal HTTPS call |
| CRM → n8n via polling | Up to 30 s (your Schedule Trigger interval) |
| CRM → n8n via webhook push | Under a second |

The CRM flushes its outbox immediately after every mutating request, using
Next.js `after()` — the webhook goes out once the HTTP response has already been
returned, so a slow n8n never slows the CRM down.

---

## Operating it

| Task | Command |
| --- | --- |
| Ship a change | `git push` — Vercel redeploys automatically |
| Apply a new migration | `DATABASE_URL=... DIRECT_URL=... npx prisma migrate deploy` |
| Inspect production data | `DATABASE_URL=... npx prisma studio` |
| Add staff | Dashboard → **Staff** |
| Rotate the API key | Dashboard → **Settings → API keys** (create new, update n8n, revoke old) |
| Watch stuck events | Dashboard → **Settings**, or `GET /api/events?status=DEAD` |

Nightly at 03:00 a Vercel cron calls `/api/maintenance/purge`, which expires and
deletes stale carts and old idempotency records. It never touches the permanent
CRM tables.

### Two things to know

**Rate limiting is per-instance.** The limiter lives in process memory, so on
Vercel each function instance counts separately and the effective limit is
looser than configured. It is a safety net, not a security control — put Redis
behind it (`src/server/http/rate-limit.ts`) if you ever need a hard limit.

**Neon's free tier sleeps.** An idle database suspends and the next query pays a
few hundred ms to wake it. Fine for WhatsApp ordering; upgrade if you want it
always warm.

---

## If something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails on `@prisma/client` | Client not generated | Confirm the build command is `prisma generate && next build` |
| `P1001 can't reach database` | Wrong URL, or Neon asleep | Check `DATABASE_URL`; retry once |
| `P3005 schema is not empty` | Migration history out of sync | `npx prisma migrate resolve --applied <migration-name>` |
| Login redirects back to `/login` | `COOKIE_SECURE` not `true` over HTTPS | Set it and redeploy |
| `401 UNAUTHORIZED` from n8n | Key wrong or revoked | Check the Header Auth credential is `Bearer <key>` |
| Events pile up as `PENDING` | No poller, no webhook | Activate workflow 2 |
| Events go `DEAD` | Endpoint kept failing | Check the URL, fix, then re-queue from Settings |
