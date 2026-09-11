/**
 * Evaluator-optimizer — a generator session drafts, an evaluator session
 * grades against explicit criteria, loop until accepted.
 * https://www.anthropic.com/engineering/building-effective-agents
 */
import { z } from "zod";
import { createDevin } from "@cognition-ai/sdk";

await using devin = await createDevin();
const generator = await devin.createSession();
const evaluator = await devin.createSession();

const Verdict = z.object({ pass: z.boolean(), feedback: z.string() });
const task = "Write a one-line JS arrow function `clamp(n, lo, hi)`.";
const criteria = "Must handle lo > hi by swapping, and must be a single line.";

let draft = (await generator.run(`${task} Code only, no tools.`)).text.trim();

for (let round = 1; round <= 3; round++) {
  const verdict = await evaluator.run(
    `Grade this against the criteria. No tools.\nCriteria: ${criteria}\nDraft:\n${draft}`,
    { output: Verdict },
  );
  console.log(
    `round ${String(round)}: pass=${String(verdict.output.pass)} — ${verdict.output.feedback}`,
  );
  if (verdict.output.pass) break;
  // The generator session keeps its own history; just feed it the feedback.
  draft = (
    await generator.run(
      `Revise per this feedback, code only, no tools:\n${verdict.output.feedback}`,
    )
  ).text.trim();
}
console.log("\nfinal draft:\n" + draft);
