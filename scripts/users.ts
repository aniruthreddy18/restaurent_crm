/**
 * List staff accounts, or reset a password — for when nobody can get in.
 *
 * Passwords are stored only as bcrypt hashes, so a forgotten one cannot be
 * read back; it can only be replaced. Run against whichever database you point
 * DATABASE_URL at.
 *
 *   npm run users                                   # list accounts
 *   npm run users -- --email you@example.com --password 'new-password'
 */
import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "../src/lib/load-env";
import { hashPassword } from "../src/server/auth/password";

loadEnvFile();

const prisma = new PrismaClient();

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

function describeTarget() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/:]+)/)?.[1] ?? "unknown host";
  const db = url.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "unknown db";
  return `${db} @ ${host}`;
}

async function main() {
  const email = arg("email");
  const password = arg("password");

  console.log(`\nDatabase: ${describeTarget()}\n`);

  if (!email) {
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { email: "asc" }],
      select: {
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        restaurant: { select: { name: true } },
      },
    });

    if (users.length === 0) {
      console.log("No users yet. Run `npm run bootstrap` to create the first admin.\n");
      return;
    }

    console.log("Accounts:\n");
    for (const u of users) {
      const flags = [u.isActive ? "active" : "INACTIVE", u.lastLoginAt ? "has signed in" : "never signed in"];
      console.log(`  ${u.email}`);
      console.log(`      ${u.name} · ${u.role} · ${u.restaurant.name} · ${flags.join(" · ")}`);
    }
    console.log(
      "\nForgotten the password? Passwords are stored as bcrypt hashes and cannot be\n" +
        "read back — set a new one:\n\n" +
        `    npm run users -- --email ${users[0].email} --password 'a-new-strong-password'\n`,
    );
    return;
  }

  if (!password) {
    console.error("Pass --password together with --email to set a new password.\n");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.\n");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.error(`No account with email "${email}". Run without arguments to list them.\n`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), isActive: true },
  });

  console.log(`Password updated for ${user.email} (${user.role}). The account is active.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
