/**
 * Seeds a realistic single-restaurant tenant plus a second restaurant that
 * exists purely to prove tenant isolation (nothing should ever see its data).
 *
 * Orders are created through the real payment flow, so the seeded data obeys
 * the same business rules as production traffic.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { generateApiKey, hashApiKey } from "../src/server/auth/api-key";
import { systemContext } from "../src/server/core/context";
import { upsertCheckoutSession } from "../src/server/modules/checkout/checkout.service";
import { recordPaymentResult } from "../src/server/modules/payments/payment.service";
import { changeOrderStatus } from "../src/server/modules/orders/order.service";
import { createReview } from "../src/server/modules/reviews/review.service";
import { recordMessage } from "../src/server/modules/conversations/conversation.service";

const prisma = new PrismaClient();

const MENU = [
  { category: "Starters", items: [
    { name: "Paneer Tikka", price: 280, prep: 15, sku: "ST-001" },
    { name: "Chicken 65", price: 320, prep: 18, sku: "ST-002" },
    { name: "Veg Spring Rolls", price: 210, prep: 12, sku: "ST-003" },
  ]},
  { category: "Main Course", items: [
    { name: "Butter Chicken", price: 420, prep: 25, sku: "MC-001" },
    { name: "Paneer Butter Masala", price: 360, prep: 22, sku: "MC-002" },
    { name: "Hyderabadi Chicken Biryani", price: 380, prep: 30, sku: "MC-003" },
    { name: "Veg Biryani", price: 300, prep: 28, sku: "MC-004" },
    { name: "Dal Makhani", price: 260, prep: 20, sku: "MC-005" },
  ]},
  { category: "Breads", items: [
    { name: "Butter Naan", price: 70, prep: 8, sku: "BR-001" },
    { name: "Garlic Naan", price: 90, prep: 8, sku: "BR-002" },
    { name: "Tandoori Roti", price: 45, prep: 6, sku: "BR-003" },
  ]},
  { category: "Desserts", items: [
    { name: "Gulab Jamun (2 pc)", price: 120, prep: 5, sku: "DS-001" },
    { name: "Rasmalai (2 pc)", price: 150, prep: 5, sku: "DS-002" },
  ]},
  { category: "Beverages", items: [
    { name: "Masala Chai", price: 60, prep: 5, sku: "BV-001" },
    { name: "Sweet Lassi", price: 110, prep: 5, sku: "BV-002" },
    { name: "Fresh Lime Soda", price: 90, prep: 4, sku: "BV-003" },
  ]},
];

const CUSTOMERS = [
  { name: "Ananya Rao", number: "919876543210", city: "Hyderabad", address: "12-4-77, Banjara Hills, Hyderabad" },
  { name: "Rahul Menon", number: "919812345678", city: "Hyderabad", address: "3rd Floor, Jubilee Hills Rd 36, Hyderabad" },
  { name: "Sneha Kulkarni", number: "919900112233", city: "Hyderabad", address: "Flat 402, Gachibowli, Hyderabad" },
  { name: "Vikram Shetty", number: "919845001122", city: "Hyderabad", address: "Plot 9, Madhapur, Hyderabad" },
  { name: "Fatima Sheikh", number: "919701234567", city: "Hyderabad", address: "Old City, Charminar Rd, Hyderabad" },
  { name: "Arjun Nair", number: "919632587410", city: "Hyderabad", address: "Kondapur Main Rd, Hyderabad" },
];

/** Numbers that only ever chat — they must NOT appear in the customers table. */
const PROSPECTS = [
  { number: "919000000001", text: "Hi, are you open right now?" },
  { number: "919000000002", text: "What's in the veg biryani?" },
  { number: "919000000003", text: "How much for butter chicken?" },
];

function pick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i += 1) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
}

async function main() {
  console.log("Seeding…");

  // --- Wipe (dev only; order respects FKs via cascades) -------------------
  await prisma.restaurant.deleteMany({ where: { slug: { in: ["spice-garden", "coastal-curry"] } } });

  // --- Restaurant + staff ------------------------------------------------
  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Spice Garden",
      slug: "spice-garden",
      phone: "+914040404040",
      email: "hello@spicegarden.test",
      address: "Road No. 12, Banjara Hills",
      city: "Hyderabad",
      currency: "INR",
      timezone: "Asia/Kolkata",
      settings: { customerTiers: { regularMinOrders: 2, loyalMinOrders: 5, vipMinOrders: 10, vipMinSpend: 10000, inactiveAfterDays: 90 } },
    },
  });

  // Second tenant — used by the isolation test and by eyeballing the UI.
  const other = await prisma.restaurant.create({
    data: { name: "Coastal Curry", slug: "coastal-curry", city: "Kochi", currency: "INR" },
  });
  const otherCustomer = await prisma.customer.create({
    data: { restaurantId: other.id, whatsappNumber: "919555000111", name: "Other Tenant Customer" },
  });
  await prisma.user.create({
    data: {
      restaurantId: other.id,
      name: "Coastal Admin",
      email: "admin@coastalcurry.test",
      passwordHash: await hashPassword("Password123!"),
      role: "ADMIN",
    },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@spicegarden.test";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Password123!";
  const passwordHash = await hashPassword(adminPassword);

  const staff = await Promise.all(
    [
      { name: "Priya Sharma", email: adminEmail, role: "ADMIN" as const, phone: "+919000000101" },
      { name: "Ravi Kumar", email: "manager@spicegarden.test", role: "MANAGER" as const, phone: "+919000000102" },
      { name: "Chef Imran", email: "kitchen@spicegarden.test", role: "KITCHEN" as const, phone: "+919000000103" },
      { name: "Meena Iyer", email: "cashier@spicegarden.test", role: "CASHIER" as const, phone: "+919000000104" },
      { name: "Suresh Babu", email: "delivery@spicegarden.test", role: "DELIVERY" as const, phone: "+919000000105" },
      { name: "Ajay Pillai", email: "delivery2@spicegarden.test", role: "DELIVERY" as const, phone: "+919000000106" },
    ].map((u) =>
      prisma.user.create({ data: { restaurantId: restaurant.id, passwordHash, ...u } }),
    ),
  );

  for (const driver of staff.filter((u) => u.role === "DELIVERY")) {
    await prisma.deliveryDriver.create({
      data: {
        restaurantId: restaurant.id,
        userId: driver.id,
        name: driver.name,
        phone: driver.phone ?? "",
        vehicle: driver.name === "Suresh Babu" ? "Honda Activa — TS09 AB 1234" : "Bajaj Pulsar — TS09 CD 5678",
      },
    });
  }

  // --- API key for n8n ---------------------------------------------------
  const pinned = process.env.SEED_API_KEY;
  const apiKey = pinned
    ? { raw: pinned, hash: hashApiKey(pinned), displayPrefix: pinned.slice(0, 12) }
    : generateApiKey("rk_test");
  await prisma.apiKey.create({
    data: {
      restaurantId: restaurant.id,
      name: "n8n automation",
      keyHash: apiKey.hash,
      keyPrefix: apiKey.displayPrefix,
      scopes: ["orders", "payments", "customers", "reviews", "messages", "events"],
    },
  });

  // --- Webhook endpoint (CRM -> n8n) -------------------------------------
  const webhookUrl = process.env.N8N_WEBHOOK_URL || "http://localhost:5678/webhook/crm-events";
  await prisma.webhookEndpoint.create({
    data: {
      restaurantId: restaurant.id,
      name: "n8n events",
      url: webhookUrl,
      secret: process.env.N8N_WEBHOOK_SECRET || "local-dev-webhook-secret",
      eventTypes: [],
    },
  });

  // --- Menu --------------------------------------------------------------
  const products: { id: string; name: string; price: number }[] = [];
  for (const [index, group] of MENU.entries()) {
    const category = await prisma.category.create({
      data: { restaurantId: restaurant.id, name: group.category, sortOrder: index },
    });
    for (const item of group.items) {
      const product = await prisma.product.create({
        data: {
          restaurantId: restaurant.id,
          categoryId: category.id,
          name: item.name,
          description: `${item.name} — prepared fresh to order.`,
          price: item.price,
          sku: item.sku,
          preparationTime: item.prep,
          isAvailable: true,
          externalRef: `sheet-row-${item.sku}`,
        },
      });
      products.push({ id: product.id, name: product.name, price: item.price });
    }
  }

  const ctx = systemContext(restaurant.id, "seed");

  // --- Prospects: conversations only. No customers may result. -----------
  for (const prospect of PROSPECTS) {
    await recordMessage(ctx, {
      whatsappNumber: prospect.number,
      direction: "INBOUND",
      message: prospect.text,
      status: "DELIVERED",
      externalMessageId: `wamid.seed.${prospect.number}.in`,
    });
    await recordMessage(ctx, {
      whatsappNumber: prospect.number,
      direction: "OUTBOUND",
      message: "Hi! We're open 11am–11pm. Would you like to see today's menu?",
      status: "SENT",
      externalMessageId: `wamid.seed.${prospect.number}.out`,
    });
  }

  // --- An abandoned cart: temporary layer only, no customer --------------
  await upsertCheckoutSession(ctx, {
    sessionId: "sess-abandoned-001",
    whatsappNumber: "919000000004",
    customerName: "Undecided Diner",
    items: [{ productId: products[3].id, name: products[3].name, price: products[3].price, quantity: 1 }],
    deliveryFee: 40,
    discount: 0,
    tax: 0,
    expiresInMinutes: 60,
  });
  await prisma.checkoutSession.updateMany({
    where: { restaurantId: restaurant.id, sessionId: "sess-abandoned-001" },
    data: { status: "ABANDONED" },
  });

  // --- Real orders, created through the real payment flow ----------------
  let sessionCounter = 0;
  const createdOrders: { orderId: string; customerId: string; daysAgo: number }[] = [];

  for (const [customerIndex, customer] of CUSTOMERS.entries()) {
    // Vary history so the tiering rules produce a spread of customer types.
    const orderCount = [8, 5, 3, 2, 1, 1][customerIndex];

    for (let n = 0; n < orderCount; n += 1) {
      sessionCounter += 1;
      const sessionId = `sess-seed-${sessionCounter.toString().padStart(4, "0")}`;
      const chosen = pick(products, 2 + Math.floor(Math.random() * 3));
      const items = chosen.map((p) => ({
        productId: p.id,
        name: p.name,
        price: p.price,
        quantity: 1 + Math.floor(Math.random() * 2),
      }));

      await upsertCheckoutSession(ctx, {
        sessionId,
        whatsappNumber: customer.number,
        customerName: customer.name,
        items,
        deliveryAddress: customer.address,
        deliveryFee: 40,
        discount: 0,
        tax: 0,
        expiresInMinutes: 120,
      });

      // Roughly one in eight attempts fails — the CRM records those too.
      const failed = sessionCounter % 8 === 0;
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0) + 40;

      const result = await recordPaymentResult(ctx, {
        transactionId: `pay_seed_${sessionCounter.toString().padStart(4, "0")}`,
        status: failed ? "FAILED" : "SUCCESS",
        amount: total,
        currency: "INR",
        paymentMethod: failed ? "UPI" : ["UPI", "CARD", "NETBANKING"][sessionCounter % 3],
        gateway: "razorpay",
        failureReason: failed ? "Insufficient funds" : undefined,
        whatsappNumber: customer.number,
        customer: { name: customer.name, city: customer.city, address: customer.address },
        checkoutSessionId: sessionId,
        deliveryAddress: customer.address,
        externalEventId: `evt_seed_${sessionCounter}`,
      });

      if (result.orderId && !failed) {
        const daysAgo = orderCount - n;
        createdOrders.push({ orderId: result.orderId, customerId: result.customerId!, daysAgo });
      }
    }
  }

  // --- Walk the successful orders through the fulfilment lifecycle -------
  for (const [index, entry] of createdOrders.entries()) {
    const stage = index % 6;

    // Leave the newest few spread across the board so the Kanban view is alive.
    if (stage === 0) continue; // stays CONFIRMED
    await changeOrderStatus(ctx, entry.orderId, "PREPARING");
    if (stage === 1) continue;
    await changeOrderStatus(ctx, entry.orderId, "READY");
    if (stage === 2) continue;

    const delivery = await prisma.delivery.findUnique({ where: { orderId: entry.orderId } });
    if (delivery) {
      const drivers = await prisma.deliveryDriver.findMany({ where: { restaurantId: restaurant.id } });
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { driverId: drivers[index % drivers.length].id, status: "ASSIGNED", assignedAt: new Date() },
      });
    }

    await changeOrderStatus(ctx, entry.orderId, "OUT_FOR_DELIVERY");
    if (stage === 3) continue;

    await changeOrderStatus(ctx, entry.orderId, "DELIVERED");

    // Backdate delivered orders so the revenue chart has history.
    const createdAt = new Date(Date.now() - entry.daysAgo * 86_400_000);
    await prisma.order.update({
      where: { id: entry.orderId },
      data: { createdAt, deliveredAt: createdAt },
    });

    if (stage === 4) {
      await createReview(ctx, {
        orderId: entry.orderId,
        rating: [5, 4, 5, 3, 5, 4][index % 6],
        comment: ["Delicious, arrived hot!", "Good food, slightly late.", "Best biryani in town.", "Portion was small.", "Perfect as always.", "Will order again."][index % 6],
        source: "WHATSAPP",
      });
    }
  }

  // Recompute tiers after backdating so INACTIVE/VIP land correctly.
  const allCustomers = await prisma.customer.findMany({ where: { restaurantId: restaurant.id } });
  const { recalculateCustomerStats } = await import("../src/server/modules/customers/customer.service");
  for (const c of allCustomers) await recalculateCustomerStats(prisma, ctx, c.id);

  const counts = {
    customers: await prisma.customer.count({ where: { restaurantId: restaurant.id } }),
    orders: await prisma.order.count({ where: { restaurantId: restaurant.id } }),
    payments: await prisma.payment.count({ where: { restaurantId: restaurant.id } }),
    reviews: await prisma.review.count({ where: { restaurantId: restaurant.id } }),
    events: await prisma.event.count({ where: { restaurantId: restaurant.id } }),
    conversations: await prisma.conversationSession.count({ where: { restaurantId: restaurant.id } }),
    products: await prisma.product.count({ where: { restaurantId: restaurant.id } }),
  };

  console.log(`
Seed complete — ${restaurant.name}
────────────────────────────────────────────────────────
  Sign in:      ${adminEmail} / ${adminPassword}
  Other roles:  manager@ / kitchen@ / cashier@ / delivery@spicegarden.test
                (same password)

  n8n API key:  ${apiKey.raw}
  Webhook URL:  ${webhookUrl}

  Records:      ${counts.products} products, ${counts.customers} customers,
                ${counts.orders} orders, ${counts.payments} payments,
                ${counts.reviews} reviews, ${counts.events} events,
                ${counts.conversations} conversations

  Isolation check: "Coastal Curry" holds customer ${otherCustomer.id},
  which must never be visible from a Spice Garden session.
────────────────────────────────────────────────────────
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
