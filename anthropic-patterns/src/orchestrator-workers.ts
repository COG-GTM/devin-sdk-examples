/**
 * Orchestrator-workers — an orchestrator turn dynamically decides the
 * subtasks, workers execute them in parallel, the orchestrator merges.
 * https://www.anthropic.com/engineering/building-effective-agents
 */
import { z } from "zod";
import { createDevin } from "@cognition-ai/sdk";

await using devin = await createDevin();

const goal = "Ship a `parseDuration('1h30m') -> seconds` utility in TypeScript";

// 1) Orchestrator: decide the subtasks (not hardcoded — the model plans them).
const Plan = z.object({ subtasks: z.array(z.string()).min(2).max(3) });
const orchestrator = await devin.createSession();
const plan = await orchestrator.run(
  `Break this goal into 2-3 crisp, independent subtasks. No tools.\nGoal: ${goal}`,
  { output: Plan },
);
console.log("orchestrator plan:", plan.output.subtasks);

// 2) Workers: one session per subtask, in parallel.
const results = await Promise.all(
  plan.output.subtasks.map(async (task) => {
    const worker = await devin.createSession();
    const r = await worker.run(`Do this subtask in <= 6 lines of output. No tools.\n${task}`);
    return { task, result: r.text.trim() };
  }),
);

// 3) Orchestrator merges the workers' results — it still has its plan in context.
const merged = await orchestrator.run(
  "Merge your workers' results below into one final deliverable (code + one-line summary). No tools.\n" +
    JSON.stringify(results),
);
console.log("\n--- merged deliverable ---\n" + merged.text);
