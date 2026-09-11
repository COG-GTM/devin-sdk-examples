/**
 * The business logic. It never sees Devin — only the typed Enrichment — so it
 * is ordinary TypeScript you can unit test, and the thresholds are yours.
 */
import type { Enrichment, Ticket } from "./enrich.js";

export type Action =
  | { type: "internal_note"; text: string }
  | { type: "reply"; text: string }
  | { type: "open_issue"; title: string; severity: Enrichment["severity"]; body: string }
  | { type: "assign_human"; reason: string };

const AUTO_REPLY_CONFIDENCE = 0.85;

export function decide(ticket: Ticket, e: Enrichment): Action[] {
  const autoReply =
    e.confidence >= AUTO_REPLY_CONFIDENCE && (e.kind === "question" || e.kind === "config");

  const actions: Action[] = [
    { type: "internal_note", text: internalNote(e, { draft: !autoReply }) },
  ];

  if (e.kind === "bug") {
    actions.push({
      type: "open_issue",
      title: `[${ticket.id}] ${e.summary}`,
      severity: e.severity,
      body: `${e.rootCause ?? "Root cause not established."}\n\n${affected(e)}`,
    });
  }

  if (autoReply) {
    actions.push({ type: "reply", text: e.customerReply });
  } else {
    actions.push({
      type: "assign_human",
      reason:
        e.kind === "bug" || e.kind === "feature"
          ? `${e.kind}: engineering owns the answer`
          : `confidence ${e.confidence.toFixed(2)} below ${String(AUTO_REPLY_CONFIDENCE)}`,
    });
  }

  return actions;
}

function internalNote(e: Enrichment, { draft }: { draft: boolean }): string {
  return [
    `${e.kind.toUpperCase()} · ${e.severity.toUpperCase()} · confidence ${e.confidence.toFixed(2)}`,
    e.summary,
    e.rootCause === null ? undefined : `Root cause: ${e.rootCause}`,
    affected(e),
    draft ? `Draft reply:\n${e.customerReply}` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join("\n\n");
}

function affected(e: Enrichment): string {
  if (e.affectedCode.length === 0) return "Affected code: none identified.";
  return `Affected code:\n${e.affectedCode.map((c) => `- ${c.path} — ${c.why}`).join("\n")}`;
}
