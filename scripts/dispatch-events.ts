/**
 * Flushes the event outbox to every subscribed webhook endpoint.
 * Run once (`npm run events:dispatch`) or on a loop (`--watch`).
 */
import { loadEnvFile } from "../src/lib/load-env";

loadEnvFile();

async function run() {
  const { dispatchPendingEvents } = await import("../src/server/events/dispatcher");
  const summary = await dispatchPendingEvents();
  console.log(
    `[events] picked=${summary.picked} delivered=${summary.delivered} failed=${summary.failed}`,
  );
  return summary;
}

const watch = process.argv.includes("--watch");
const intervalArg = process.argv.find((a) => a.startsWith("--interval="));
const intervalMs = intervalArg ? Number(intervalArg.split("=")[1]) * 1000 : 10_000;

if (watch) {
  console.log(`[events] watching, every ${intervalMs / 1000}s — Ctrl+C to stop`);
  const tick = async () => {
    try {
      await run();
    } catch (error) {
      console.error("[events] dispatch failed:", error);
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs);
} else {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
