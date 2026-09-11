/**
 * `enrich(ticket)` is Devin as a function: a support ticket goes in, a typed
 * Enrichment comes out. Devin reads the product's source, runs whatever
 * read-only checks help, and answers in the shape the schema demands; the SDK
 * validates the reply, so the rest of the program branches on plain fields.
 */
import { z } from "zod";
import type { AcpSession, Turn } from "@cognition-ai/sdk";

/** What the help desk sends. Pylon, Intercom, Zendesk all map onto this. */
export const Ticket = z.object({
  id: z.string().max(64),
  subject: z.string().max(500),
  body: z.string().max(20_000),
  customer: z.object({ name: z.string().max(200), plan: z.string().max(100).optional() }),
});
export type Ticket = z.infer<typeof Ticket>;

/** What Devin hands back. Every field is something the support flow acts on. */
export const Enrichment = z.object({
  kind: z.enum(["bug", "config", "question", "feature"]),
  severity: z.enum(["p0", "p1", "p2", "p3"]),
  summary: z.string().describe("One line for the ticket header"),
  affectedCode: z
    .array(z.object({ path: z.string(), why: z.string() }))
    .describe("Files in the repository this ticket is about, with the reason each matters"),
  rootCause: z.string().nullable().describe("For bugs and config issues; null otherwise"),
  customerReply: z.string().describe("A reply a support engineer could send unchanged"),
  confidence: z.number().min(0).max(1).describe("How sure you are the reply is correct"),
});
export type Enrichment = z.infer<typeof Enrichment>;

/**
 * `await enrich(session, ticket)` resolves to the validated outcome; `for await`
 * the returned turn first to watch the tool calls stream by.
 */
export function enrich(session: AcpSession, ticket: Ticket): Turn<Enrichment> {
  return session.run(prompt(ticket), { output: Enrichment });
}

function prompt(ticket: Ticket): string {
  return [
    "You are the tier-2 support engineer for the product in this repository.",
    "Investigate the ticket against the actual code: read the relevant source and docs, and run",
    "read-only commands (tests, type checks, a small repro script) when they settle the question.",
    "Do not modify any file. Ground every claim in what you found; when the customer is wrong,",
    "say so kindly in the reply and point at the exact API or option they need. If the code does",
    "not answer the question, say what you could and could not establish and lower confidence.",
    "",
    `Ticket ${ticket.id} from ${ticket.customer.name}${ticket.customer.plan ? ` (${ticket.customer.plan} plan)` : ""}`,
    `Subject: ${ticket.subject}`,
    "",
    ticket.body,
  ].join("\n");
}
