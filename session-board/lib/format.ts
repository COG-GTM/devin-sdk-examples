import type { Card } from "./card";

/** `12s`, `3m`, `2h`, `4d`. */
export function ago(now: number, at: string | number | undefined): string {
  if (at === undefined) return "";
  const s = Math.max(0, Math.round((now - (typeof at === "number" ? at : Date.parse(at))) / 1000));
  if (s < 60) return `${String(s)}s`;
  if (s < 3600) return `${String(Math.round(s / 60))}m`;
  if (s < 86400) return `${String(Math.round(s / 3600))}h`;
  return `${String(Math.round(s / 86400))}d`;
}

/** `https://github.com/acme/api/pull/812` → `812`. */
export function prNumber(url: string): string {
  return url.split("/").filter(Boolean).at(-1) ?? url;
}

/** `usacognition/sdk` → `sdk`. */
export function repoShort(name: string): string {
  return name.split("/").at(-1) ?? name;
}

/** The first non-empty line of a message, clipped. */
export function firstLine(message: string): string | undefined {
  return clip(message.split("\n").find((line) => line.trim() !== ""));
}

/** The last line of a message, clipped. */
export function lastLine(message: string | undefined): string | undefined {
  return clip(message?.trim().split("\n").at(-1));
}

function clip(line: string | undefined, max = 200): string | undefined {
  const trimmed = line?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export interface Badge {
  label: string;
  tone: "danger" | "muted";
}

/**
 * The sidebar's lead status, when there is one: crashed, out of quota,
 * expired, stopped. Anything ordinary shows no badge.
 */
export function statusBadge(card: Card): Badge | undefined {
  if (card.reason === "error" || card.outcome === "crashed") {
    return { label: "Crashed", tone: "danger" };
  }
  if (card.reason !== undefined && /quota|credit|limit|payment/.test(card.reason)) {
    return { label: "Limit reached", tone: "danger" };
  }
  if (card.outcome === "expired") return { label: "Expired", tone: "muted" };
  if (card.status === "stopped" || card.outcome === "stopped") {
    return { label: "Stopped", tone: "muted" };
  }
  return undefined;
}
