/**
 * Everything a turn tells you, typed: reasoning, messages, each tool call with
 * what it did, the plan, and the outcome — the same code for the cloud and the
 * local CLI.
 *
 *   bun run events            # in Devin's cloud
 *   bun run events --local    # in the Devin CLI, in this directory
 */
import { createDevin, type ToolCall } from "@cognition-ai/sdk";

const local = process.argv.includes("--local");
await using devin = await createDevin(local ? { cwd: process.cwd() } : {});

const session = await devin.createSession();
const turn = session.run(
  "Create hello.txt containing a one-line greeting, read it back, then run `ls -la`. " +
    "Finish with one sentence saying what you did.",
);

// `event` is a discriminated union: each `case` narrows it to that event's fields.
let lastThought: string | undefined;
for await (const event of turn) {
  switch (event.type) {
    case "thought_delta":
      // A new thought starts a new line; chunks of the same thought run on.
      if (event.messageId !== lastThought) process.stdout.write("\n");
      lastThought = event.messageId;
      process.stdout.write(dim(event.text));
      break;
    case "message_delta":
      process.stdout.write(event.text);
      break;
    case "tool_call":
      // A merged snapshot of the call so far; print it once it settles.
      if (event.settled) console.log(`\n${describe(event.call)}`);
      break;
    case "plan":
      console.log(
        "\nplan:",
        event.entries.map((e) => `[${e.status ?? " "}] ${e.content}`).join("\n      "),
      );
      break;
    case "turn_state":
      // ACP v2 only (the cloud); the local CLI ends the turn via the prompt result instead.
      if (event.state === "idle") console.log(`\nturn ended: ${event.stopReason ?? "?"}`);
      break;
    default:
      // status / activity / typing / raw … — everything else is still typed, just not printed here.
      break;
  }
}

const { text, toolCalls, stopReason } = await turn;
console.log(`\n--\n${String(toolCalls.length)} tool calls, stopped: ${stopReason}`);
console.log(`final message: ${text.trim().split("\n").at(-1) ?? ""}`);
console.log(session.url ?? session.id);

/** `call.detail` says which tool it was and what it was given — identical for cloud and local. */
function describe(call: ToolCall): string {
  const { detail } = call;
  const status = call.status.padEnd(9);
  switch (detail.tool) {
    case "exec":
      return `${status} $ ${detail.command ?? ""}${detail.exitCode !== undefined ? `  → exit ${String(detail.exitCode)}` : ""}`;
    case "write":
    case "edit":
    case "read":
      return `${status} ${detail.tool} ${detail.path ?? ""}`;
    case "list_directory":
      return `${status} ls ${detail.path ?? ""}`;
    case "file_search":
      return `${status} search ${detail.query ?? ""}`;
    case "mcp":
      return `${status} mcp ${detail.server ?? ""}/${detail.name}`;
    case "permission_request":
      return `${status} needs approval: ${detail.permissionType} ${detail.command ?? ""}`;
    case "ask_user_question":
      return `${status} question: ${detail.questions.map((q) => q.question).join(" | ")}`;
    case "report_blocker":
      return `${status} blocked: ${detail.headline ?? detail.impact}`;
    case "computer_use":
      return `${status} browser ${detail.actions.map((action) => action.action_type).join(", ")}`;
    case "other":
      return `${status} ${(call.title ?? call.kind ?? "tool").trim()}`;
  }
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}
