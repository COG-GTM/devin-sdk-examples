import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `1789263839` → `12s`, `4m`, `3h`, `2d`. */
export function ago(now: number, at: number | string | null | undefined): string {
  if (at === null || at === undefined) return "";
  const then = typeof at === "number" ? at : Date.parse(at);
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${String(s)}s`;
  if (s < 3600) return `${String(Math.round(s / 60))}m`;
  if (s < 86400) return `${String(Math.round(s / 3600))}h`;
  return `${String(Math.round(s / 86400))}d`;
}

/** `finish_executing_actions` → `finish executing actions`. */
export function humanize(value: string | null | undefined): string | undefined {
  return value == null ? undefined : value.replaceAll("_", " ");
}

/** `acme/storefront` → `storefront`. */
export function repoShort(name: string): string {
  return name.split("/").at(-1) ?? name;
}
