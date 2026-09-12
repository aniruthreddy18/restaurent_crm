# Restaurant CRM

The permanent business system of record behind a WhatsApp + AI + n8n restaurant
automation. It owns customers, orders, payments, deliveries, reviews, staff and
history — and nothing else.

```
Customer → WhatsApp → Meta Cloud API → n8n → AI agent → Google Sheets (menu)
                                         ↓
                            temporary checkout session
                                         ↓
                                     payment
                                         ↓
                            ┌──────── Restaurant CRM ────────┐
                            │  customers · orders · payments │
                            │  deliveries · reviews · audit  │
                            └────────────┬───────────────────┘
                                         ↓  events
                                        n8n → WhatsApp notifications
```

**The CRM is not the chatbot and not the AI agent.** It never talks to WhatsApp.
It exposes a REST API that n8n calls, and an event outbox that n8n consumes.

---

## The one rule that shapes everything

> A permanent CRM customer is created **only** after a payment attempt reaches a
> terminal result — `SUCCESS` or `FAILED`.

Saying hello, asking about the menu, asking prices, starting an order, building a
cart, or abandoning checkout create **nothing** in `customers`, `orders` or
`payments`. Those interactions live in the *temporary layer*
(`checkout_sessions`, `conversation_sessions`, `messages`), which may be purged.

There is exactly one function in the codebase that can bring a customer into
existence from WhatsApp — `upsertCustomerFromTerminalPayment` in
[customer.service.ts](src/server/modules/customers/customer.service.ts) — and it
is called from exactly one place, the terminal-payment branch of
[payment.service.ts](src/server/modules/payments/payment.service.ts).

`tests/core-business-rule.test.ts` exists to keep it that way.

---

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Backend | Next.js Route Handlers, TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Auth | Session cookies (signed JWT via `jose`) + bcrypt, with a Supabase seam |
| Charts | Recharts |
| Validation | Zod, at every API boundary |
| Tests | Vitest against a real PostgreSQL database |

---

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`. At minimum set `DATABASE_URL`, `TEST_DATABASE_URL` and
`AUTH_SECRET`. Generate a secret with:

```bash
openssl rand -base64 48
```

### 3. Create the databases

Local PostgreSQL:

```bash
createdb restaurant_crm && createdb restaurant_crm_test
```

Supabase: use the **pooled** connection string for `DATABASE_URL` and the direct
`:5432` one for `DIRECT_URL`, so `prisma migrate` can take advisory locks.

### 4. Run migrations

```bash
npm run db:migrate
```

For an existing database (staging/production) use `npm run db:deploy`.

### 5. Seed

```bash
npm run db:seed
```

This builds a realistic restaurant by driving the **real** service layer — carts
are converted through the actual payment flow, so the seeded data obeys the same
rules as production traffic. It prints the sign-in credentials and an n8n API key
when it finishes.

Seeded accounts (all with the same password, default `Password123!`):

| Email | Role |
| --- | --- |
| `admin@spicegarden.test` | ADMIN |
| `manager@spicegarden.test` | MANAGER |
| `kitchen@spicegarden.test` | KITCHEN |
| `cashier@spicegarden.test` | CASHIER |
| `delivery@spicegarden.test` | DELIVERY |

A second restaurant, *Coastal Curry*, is seeded purely so you can confirm that no
Spice Garden session can ever see its data.

### 6. Start the dev server

```bash
npm run dev
```

Open http://localhost:3000 and sign in.

### 7. Test the API

```bash
curl -s http://localhost:3000/api/health
```

Then, with the API key the seed printed:

```bash
curl -s http://localhost:3000/api/orders \
  -H "Authorization: Bearer rk_test_local_development_key_change_me"
```

A full, runnable walkthrough of the business flow is in
[docs/API.md](docs/API.md#end-to-end-walkthrough).

### 8. Connect n8n locally

1. In the CRM, go to **Settings → API keys → Create API key**. Copy it (it is
   shown once — only its SHA-256 digest is stored).
2. In n8n, create an **HTTP Header Auth** credential:
   `Authorization: Bearer <key>`.
3. Point n8n at `http://localhost:3000/api/...`.
4. For CRM → n8n events, either:
   - **push**: set `N8N_WEBHOOK_URL` + `N8N_WEBHOOK_SECRET`, then run
     `npm run events:dispatch -- --watch` (or hit `POST /api/events/dispatch`
     from cron); or
   - **pull**: poll `GET /api/events?status=PENDING` and acknowledge each with
     `POST /api/events/:id/ack`. This needs no public URL, which makes it the
     easier option for local n8n.

See [docs/N8N.md](docs/N8N.md) for the node-by-node workflow.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Migrate the test DB, then run the whole suite |
| `npm run db:migrate` | Create + apply a migration (development) |
| `npm run db:deploy` | Apply existing migrations (production) |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |
| `npm run events:dispatch` | Flush the event outbox to webhooks (`-- --watch` to loop) |

---

## Architecture

```
src/
  app/
    (dashboard)/       Authenticated UI — server components
    api/               Route handlers (the n8n-facing REST API)
    login/
  server/
    auth/              Sessions, passwords, API keys, the role matrix
    core/              Errors, tenant context, pagination
    db/                Prisma client
    events/            Outbox emit, HMAC signing, webhook dispatcher
    audit/             Audit-log writer
    idempotency/       Request-level replay protection
    http/              withApi(): auth + CSRF + rate limit + Zod + errors
    modules/           Business logic, one folder per domain
  components/          UI: primitives, badges, charts, feature widgets
  lib/                 Env, phone normalisation, money, formatting
```

**Rules the layout enforces**

- Route handlers hold no business logic — they validate and delegate.
- Every service takes a `TenantContext`, and the `restaurantId` in it comes from
  the authenticated principal, never from a request body. That is what makes
  cross-tenant access structurally impossible rather than merely unlikely.
- Events and audit rows are written inside the same transaction as the change
  they describe (transactional outbox), so the CRM cannot lose an event when n8n
  is down, and cannot emit one for a change that rolled back.

### Permanent vs temporary

| Permanent (CRM owns this) | Temporary (disposable) |
| --- | --- |
| `customers` | `checkout_sessions` |
| `orders`, `order_items` | `conversation_sessions` |
| `payments` | `messages` |
| `deliveries`, `delivery_drivers` | |
| `reviews` | |
| `audit_logs`, `events` | |

`messages.customer_id` is nullable **by design** — most people who message a
restaurant never become customers.

### Order status vs payment status

Two independent axes, never mixed:

```
CONFIRMED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED
     ↓          ↓         ↓            ↓
 CANCELLED  CANCELLED CANCELLED     FAILED

payment: PENDING · SUCCESS · FAILED · REFUNDED
```

The transition table is data, in
[order.status.ts](src/server/modules/orders/order.status.ts), so the Kanban
board, the REST API and the tests cannot disagree about what is legal.

### Idempotency

Payment providers retry. The system is idempotent at four independent levels:

1. `Idempotency-Key` header / `externalEventId` → stored response replayed verbatim.
2. `payments(restaurant_id, transaction_id)` unique.
3. `orders(checkout_session_id)` unique — one cart yields at most one order.
4. `events(restaurant_id, external_event_id)` unique.

Concurrent duplicates that collide on a unique index retry the whole transaction
and converge on the winner's row (`withConcurrencyRetry`).

### Roles

`ADMIN · MANAGER · KITCHEN · CASHIER · DELIVERY`, defined as a typed matrix in
[permissions.ts](src/server/auth/permissions.ts) and enforced in the service
layer — not merely hidden in the UI. The Staff screen renders the live matrix.

Roles are code rather than a `roles` table on purpose: permissions change with
releases, and a typed union turns an unknown permission into a compile error
instead of a production 403.

### Security

- Passwords: bcrypt (cost 12); failed logins run a comparison anyway so response
  timing does not leak which emails exist.
- Sessions: HS256 JWT in an httpOnly, SameSite=Lax cookie. Re-validated against
  the database on every request, so deactivating a user takes effect at once.
- CSRF: double-submit token required on every cookie-authenticated mutation.
  API-key callers are exempt — they carry no ambient cookie authority.
- API keys: only the SHA-256 digest is stored; the raw key is shown once.
  An API key cannot mint another API key.
- Webhooks: HMAC-SHA256 over `<timestamp>.<body>`, with the timestamp inside the
  signed material so a captured delivery cannot be replayed later.
- Rate limiting: per principal, in-process. **Swap for Redis before running more
  than one replica** — see [rate-limit.ts](src/server/http/rate-limit.ts).
- Payments: metadata only. Anything resembling a card number, CVV, PIN or
  password is redacted on the way in, even if a caller sends it.
- Every state change writes an audit row with actor, old value and new value.

---

## Testing

```bash
npm test
```

81 tests against a real PostgreSQL database (truncated between cases), covering:

| Area | File |
| --- | --- |
| Chatting/browsing/abandoning creates no customer; terminal payments do | `core-business-rule.test.ts` |
| Replayed webhooks, concurrent duplicates, failed-then-retried payments | `idempotency.test.ts` |
| Status machine, ORDER_READY, MARK DELIVERED, reviews, order numbering | `order-lifecycle.test.ts` |
| Restaurant A cannot read or write Restaurant B | `tenant-isolation.test.ts` |
| Role matrix; unauthorised users cannot change order status | `permissions.test.ts` |
| Dashboard tiles, timezone-correct revenue series, funnel | `analytics.test.ts` |
| Phone normalisation, tiering, totals, signing, redaction | `units.test.ts` |

---

## Authentication: local or Supabase

The CRM ships with self-contained email/password auth so it runs with nothing but
PostgreSQL. `users.external_id` and `AUTH_PROVIDER=supabase` are the seam for
delegating to Supabase Auth: verify the Supabase JWT and map its `sub` to
`users.external_id`. The role matrix, tenant scoping and guards are unchanged
either way, because they read from `users`, not from the token.

---

## Deliberately not built

Per the V1 scope: live GPS, route optimisation, driver location streaming, fleet
management. `orders.latitude/longitude` and `deliveries.latitude/longitude` exist
in the schema and are never written — they are the seam a future tracking version
plugs into without a migration.

Also designed for but not implemented: multiple branches, inventory, coupons,
loyalty, subscriptions, segmentation, marketing automation, multiple WhatsApp
numbers, multiple payment providers, custom domains.

The `notifications` table is likewise reserved and currently unwritten — V1
surfaces state through the order board and the event counters on Settings.

The menu lives in the CRM schema, but the customer-facing menu is still served
from Google Sheets through n8n. `products.external_ref` is the only link, it is
nullable, and removing the Sheets integration later needs no schema change.

---

## Documentation

- [docs/API.md](docs/API.md) — every endpoint: auth, request, response, errors, examples
- [docs/N8N.md](docs/N8N.md) — the n8n integration, workflow by workflow
