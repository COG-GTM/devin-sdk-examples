/**
 * Parallelization — sectioning (independent subtasks run concurrently as
 * separate sessions) and voting (same task N times, take the majority).
 * https://www.anthropic.com/engineering/building-effective-agents
 */
import { z } from "zod";
import { createDevin } from "@cognition-ai/sdk";

await using devin = await createDevin();

const snippet = `function div(a, b) { return a / b; }`;

// Sectioning: independent reviews in parallel — sessions are cheap, and a
// Turn is just a promise, so Promise.all composes naturally.
const aspects = ["correctness/edge cases", "naming/readability", "API design"];
const reviews = await Promise.all(
  aspects.map(async (aspect) => {
    const s = await devin.createSession();
    const r = await s.run(`Review only ${aspect} of this JS, one sentence, no tools:\n${snippet}`);
    return `${aspect}: ${r.text.trim()}`;
  }),
);
console.log("sectioned reviews:\n" + reviews.map((r) => `- ${r}`).join("\n"));

// Voting: ask 3 times, take the majority.
const Vote = z.object({ safe: z.boolean() });
const votes = await Promise.all(
  Array.from({ length: 3 }, async () => {
    const s = await devin.createSession();
    const r = await s.run(
      `Is this snippet safe to ship without a zero-divisor guard? No tools.\n${snippet}`,
      { output: Vote },
    );
    return r.output.safe;
  }),
);
const yes = votes.filter(Boolean).length;
console.log(
  `\nvotes safe=[${votes.join(", ")}] -> majority: ${yes > votes.length / 2 ? "safe" : "unsafe"}`,
);
