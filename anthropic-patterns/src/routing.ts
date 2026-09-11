/**
 * Routing — a cheap classifier turn picks a specialized handler (different
 * prompt/session) for each input.
 * https://www.anthropic.com/engineering/building-effective-agents
 */
import { z } from "zod";
import { createDevin } from "@cognition-ai/sdk";

await using devin = await createDevin();

const Route = z.object({ route: z.enum(["bug", "feature", "question"]) });
const handlers = {
  bug: "You triage bug reports. Reply with severity (P0-P3) + one repro question.",
  feature: "You triage feature requests. Reply with effort (S/M/L) + the core user story.",
  question: "You answer support questions. Reply in one sentence.",
} as const;

const tickets = [
  "The app crashes when I paste an emoji into the search box",
  "Can you add dark mode?",
];

for (const ticket of tickets) {
  const router = await devin.createSession();
  const { output } = await router.run(`Classify this ticket. No tools.\n"${ticket}"`, {
    output: Route,
  });

  const worker = await devin.createSession();
  const result = await worker.run(`${handlers[output.route]} No tools.\nTicket: "${ticket}"`);
  console.log(`\n[${output.route}] ${ticket}\n  -> ${result.text.trim()}`);
}
