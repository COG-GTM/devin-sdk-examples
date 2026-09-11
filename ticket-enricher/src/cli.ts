/**
 * Run the same pipeline on one ticket without the webhook server:
 *
 *   bun run enrich fixtures/question-webhook-retries.json
 */
import { devin, handle } from "./handle.js";
import { Ticket } from "./enrich.js";
import { consoleSink } from "./sink.js";

if (process.argv.length < 3) {
  console.error("usage: bun run enrich <ticket.json>");
  process.exit(2);
}

try {
  const ticket = Ticket.parse(await Bun.file(process.argv[2]).json());
  await handle(ticket, consoleSink);
} finally {
  devin.close();
}
