/**
 * Prompt chaining — decompose a task into fixed sequential steps, each step's
 * output feeding the next, with a programmatic gate between steps.
 * https://www.anthropic.com/engineering/building-effective-agents
 */
import { z } from "zod";
import { createDevin } from "@cognition-ai/sdk";

await using devin = await createDevin();
const session = await devin.createSession();

// Step 1: generate a structured outline. `output` makes run() instruct the
// agent to reply with matching JSON, then validates the reply against the schema.
const Outline = z.object({ title: z.string(), sections: z.array(z.string()).length(3) });
const outline = await session.run(
  "Outline a 3-section blog post about why TypeScript unions beat enums. No tools.",
  { output: Outline },
);
console.log("outline:", outline.output);

// Gate: a plain programmatic check between steps.
if (outline.output.sections.some((s) => s.length > 200)) {
  throw new Error("gate failed: section too long");
}
console.log("gate: ok");

// Step 2: expand — same session, so the model keeps its own context, and we
// feed step 1's *validated* output back in.
const draft = await session.run(
  "Write one crisp sentence for each section of this outline, as `- section: sentence` lines. No tools.\n" +
    JSON.stringify(outline.output),
);
console.log("\ndraft:\n" + draft.text);
