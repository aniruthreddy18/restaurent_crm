/** Applies migrations to TEST_DATABASE_URL before the suite runs. */
import { execFileSync } from "child_process";
import { loadEnvFile } from "../src/lib/load-env";

loadEnvFile();

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set — copy .env.example to .env and fill it in.");
  process.exit(1);
}

try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    // DIRECT_URL must point at the test database too, or migrations would be
    // applied to whatever the development DIRECT_URL names.
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
} catch {
  // Most often P3005: the database has tables but no migration history — e.g.
  // after it was borrowed as a shadow database. Say how to fix it rather than
  // dropping someone's database automatically.
  const name = url.split("/").pop()?.split("?")[0] ?? "your test database";
  console.error(
    `\nCould not migrate the test database.\n\n` +
      `If it reports P3005 ("schema is not empty"), its migration history is out of\n` +
      `sync. The test database is disposable, so rebuild it:\n\n` +
      `    dropdb ${name} && createdb ${name} && npm test\n`,
  );
  process.exit(1);
}

// Never use the test database as a --shadow-database-url: Prisma resets shadow
// databases, which is exactly what strands the migration history above.
