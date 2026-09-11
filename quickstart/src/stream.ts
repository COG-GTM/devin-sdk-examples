/**
 * The smallest useful program: start a session, send a prompt, print Devin's
 * reply as it streams, then read the outcome.
 *
 *   bun run stream            # in Devin's cloud
 *   bun run stream --local    # in the Devin CLI, in this directory
 */
import { createDevin } from "@cognition-ai/sdk";

const local = process.argv.includes("--local");
await using devin = await createDevin(local ? { cwd: process.cwd() } : {});

const session = await devin.createSession();
const turn = session.run("Explain in one paragraph what a coding agent SDK is for. No tools.");

for await (const event of turn) {
  if (event.type === "message_delta") process.stdout.write(event.text);
}

const { stopReason } = await turn;
console.log(`\n\n[${stopReason}] ${session.url ?? session.id}`);
