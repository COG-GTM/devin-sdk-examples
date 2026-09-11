/**
 * Where actions land. This one prints; a real deployment swaps in the help
 * desk and issue tracker clients (Pylon internal notes and replies, a Linear
 * or GitHub issue) without touching enrich() or decide().
 */
import type { Action } from "./decide.js";
import type { Ticket } from "./enrich.js";

export interface Sink {
  apply(ticket: Ticket, actions: Action[]): Promise<void>;
}

export const consoleSink: Sink = {
  apply(ticket, actions) {
    for (const action of actions) {
      switch (action.type) {
        case "internal_note":
          console.log(`\n[${ticket.id}] internal note\n${indent(action.text)}`);
          break;
        case "reply":
          console.log(`\n[${ticket.id}] reply to ${ticket.customer.name}\n${indent(action.text)}`);
          break;
        case "open_issue":
          console.log(
            `\n[${ticket.id}] open ${action.severity.toUpperCase()} issue: ${action.title}\n${indent(action.body)}`,
          );
          break;
        case "assign_human":
          console.log(`\n[${ticket.id}] assign to a human — ${action.reason}`);
          break;
      }
    }
    return Promise.resolve();
  },
};

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
