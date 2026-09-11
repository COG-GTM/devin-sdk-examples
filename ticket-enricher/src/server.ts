/**
 * The webhook. The help desk POSTs a ticket; we acknowledge at once (Devin
 * takes minutes, webhook senders wait seconds) and finish in the background.
 *
 *   WEBHOOK_SECRET=… bun run serve
 *   curl -X POST localhost:8787/webhooks/tickets \
 *        -H 'content-type: application/json' -H "x-webhook-secret: $WEBHOOK_SECRET" \
 *        --data @fixtures/question-webhook-retries.json
 */
import { timingSafeEqual } from "node:crypto";
import { devin, handle } from "./handle.js";
import { Ticket } from "./enrich.js";
import { consoleSink } from "./sink.js";

// A shared secret stands in for your help desk's signature scheme (Pylon,
// Intercom and Zendesk each sign differently). Anyone who can reach this route
// can start Devin sessions on your account, so never serve it without a check.
const secret = process.env.WEBHOOK_SECRET;
if (secret === undefined || secret.length < 16) {
  throw new Error(
    "set WEBHOOK_SECRET (16+ characters); the help desk sends it as x-webhook-secret",
  );
}
const authorized = (request: Request): boolean => {
  const sent = Buffer.from(request.headers.get("x-webhook-secret") ?? "");
  const want = Buffer.from(secret);
  return sent.length === want.length && timingSafeEqual(sent, want);
};

const inFlight = new Set<Promise<void>>();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  routes: {
    "/webhooks/tickets": {
      POST: async (request) => {
        if (!authorized(request)) return new Response(null, { status: 401 });

        const body: unknown = await request.json().catch(() => undefined);
        const parsed = Ticket.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

        const ticket = parsed.data;
        console.log(`[${ticket.id}] received: ${ticket.subject}`);
        const job = handle(ticket, consoleSink).catch((error: unknown) => {
          console.error(`[${ticket.id}] failed:`, error);
        });
        inFlight.add(job);
        void job.finally(() => inFlight.delete(job));
        return Response.json({ accepted: ticket.id }, { status: 202 });
      },
    },
  },
});

console.log(`listening on ${server.url.toString()}webhooks/tickets`);

// Stop taking tickets, let the ones already acknowledged finish, then exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void (async () => {
      await server.stop();
      if (inFlight.size > 0) console.log(`draining ${String(inFlight.size)} ticket(s)`);
      await Promise.allSettled(inFlight);
      devin.close();
      process.exit(0);
    })();
  });
}
