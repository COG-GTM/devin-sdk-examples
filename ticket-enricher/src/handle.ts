/** One ticket, end to end: open a session, enrich, decide, apply. */
import { createDevin, type PermissionHandler, type ToolCall } from "@cognition-ai/sdk";
import { decide } from "./decide.js";
import { enrich, type Ticket } from "./enrich.js";
import type { Sink } from "./sink.js";

/** The repository the tickets are about. Devin clones it in its own sandbox. */
const REPO = "your-org/your-product";

// Reject permission requests identified as edits. Allowed shell commands can
// still change files inside Devin's sandbox.
const noEdits: PermissionHandler = ({ call }) =>
  call?.kind === "edit" || call?.kind === "delete" || call?.kind === "move" ? "reject" : "allow";

export const devin = await createDevin({ onPermission: noEdits });

export async function handle(ticket: Ticket, sink: Sink): Promise<void> {
  const session = await devin.createSession({ repos: [REPO] });
  try {
    const turn = enrich(session, ticket);

    // Watching is optional — the turn settles whether or not you iterate it.
    for await (const event of turn) {
      if (event.type === "tool_call" && event.settled)
        console.log(`[${ticket.id}] ${describe(event.call)}`);
    }
    const { output } = await turn;
    if (session.url !== undefined) console.log(`[${ticket.id}] session: ${session.url}`);

    await sink.apply(ticket, decide(ticket, output));
  } finally {
    devin.releaseSession(session.id);
  }
}

/** One line per settled tool call; `detail` is the same for cloud and local sessions. */
function describe({ detail, title }: ToolCall): string {
  switch (detail.tool) {
    case "exec":
      return `$ ${detail.command ?? ""}`;
    case "read":
      return `read ${detail.path ?? ""}`;
    case "file_search":
      return `search ${detail.query ?? ""}`;
    default:
      return title ?? detail.tool;
  }
}
