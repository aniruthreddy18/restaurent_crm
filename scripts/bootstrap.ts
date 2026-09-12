/**
 * Production bootstrap — creates ONE restaurant, ONE admin and ONE API key,
 * and nothing else.
 *
 * `npm run db:seed` is for development: it wipes and inserts demo data. This
 * script never deletes anything and is safe to run against a live database; if
 * the restaurant slug already exists it adds only what is missing.
 *
 *   npm run bootstrap -- --name "Spice Garden" --slug spice-garden \
 *       --email owner@example.com --password 'a-strong-password' \
 *       --city Hyderabad --currency INR --timezone Asia/Kolkata
 */
import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "../src/lib/load-env";
import { hashPassword } from "../src/server/auth/password";
import { generateApiKey } from "../src/server/auth/api-key";

loadEnvFile();

const prisma = new PrismaClient();

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index !== -1 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const name = arg("name");
  const email = arg("email");
  const password = arg("password");

  if (!name || !email || !password) {
    console.error(
      "Missing required arguments.\n\n" +
        "  npm run bootstrap -- --name \"Your Restaurant\" --email you@example.com --password 'strong-password'\n\n" +
        "Optional: --slug --city --currency --timezone --webhook-url --webhook-secret",
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const slug = arg("slug", slugify(name))!;

  const restaurant = await prisma.restaurant.upsert({
    where: { slug },
    create: {
      name,
      slug,
      city: arg("city") ?? null,
      currency: arg("currency", "INR")!,
      timezone: arg("timezone", "Asia/Kolkata")!,
    },
    update: {},
  });

  const existingUser = await prisma.user.findFirst({
    where: { restaurantId: restaurant.id, email: email.toLowerCase() },
  });

  if (existingUser) {
    console.log(`Admin ${email} already exists — leaving it untouched.`);
  } else {
    await prisma.user.create({
      data: {
        restaurantId: restaurant.id,
        name: arg("admin-name", "Owner")!,
        email: email.toLowerCase(),
        passwordHash: await hashPassword(password),
        role: "ADMIN",
      },
    });
  }

  // Always mint a fresh key: the raw value cannot be recovered from an old one.
  const key = generateApiKey("rk_live");
  await prisma.apiKey.create({
    data: {
      restaurantId: restaurant.id,
      name: arg("key-name", "n8n automation")!,
      keyHash: key.hash,
      keyPrefix: key.displayPrefix,
    },
  });

  const webhookUrl = arg("webhook-url") ?? process.env.N8N_WEBHOOK_URL;
  const webhookSecret = arg("webhook-secret") ?? process.env.N8N_WEBHOOK_SECRET;
  let webhookNote = "none configured — n8n can poll GET /api/events instead";

  if (webhookUrl && webhookSecret) {
    const existing = await prisma.webhookEndpoint.findFirst({
      where: { restaurantId: restaurant.id, url: webhookUrl },
    });
    if (existing) {
      await prisma.webhookEndpoint.update({
        where: { id: existing.id },
        data: { secret: webhookSecret, isActive: true },
      });
    } else {
      await prisma.webhookEndpoint.create({
        data: {
          restaurantId: restaurant.id,
          name: "n8n events",
          url: webhookUrl,
          secret: webhookSecret,
          eventTypes: [],
        },
      });
    }
    webhookNote = webhookUrl;
  }

  console.log(`
Bootstrap complete
──────────────────────────────────────────────────────────────
  Restaurant:  ${restaurant.name}  (slug: ${restaurant.slug})
  Admin login: ${email}
  Webhook:     ${webhookNote}

  API key (shown once — store it in your n8n credential now):

      ${key.raw}

  Next: sign in, then add your staff under Staff.
──────────────────────────────────────────────────────────────
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
