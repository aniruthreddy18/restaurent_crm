import { loadEnvFile } from "../src/lib/load-env";

loadEnvFile();

// Every test talks to the dedicated test database, never the dev one.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must be set — see .env.example");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET ||= "test-secret-value-that-is-definitely-long-enough-32";
process.env.DEFAULT_COUNTRY_CODE ||= "91";
