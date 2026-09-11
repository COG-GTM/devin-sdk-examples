"use client";

import { SearchIcon } from "lucide-react";

import { WINDOWS, type Window } from "@/lib/card";
import { cn } from "@/lib/utils";

export function WindowPicker({
  value,
  onChange,
}: {
  value: Window;
  onChange: (window: Window) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Sessions updated in the last"
      className="inline-flex rounded-md border border-primary/18 bg-secondary p-0.5 font-mono text-[11px]"
    >
      {WINDOWS.map((window) => (
        <button
          key={window}
          type="button"
          role="radio"
          aria-checked={window === value}
          className={cn(
            "rounded-sm px-2 py-0.5 tabular-nums transition-colors cursor-pointer",
            window === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            onChange(window);
          }}
        >
          {window}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: string;
}) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
      <input
        type="checkbox"
        className="size-3 accent-foreground"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      {children}
    </label>
  );
}

export function Search({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative inline-flex items-center">
      <SearchIcon className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
      <input
        type="search"
        value={value}
        placeholder="Filter"
        aria-label="Filter sessions"
        className="h-7 w-40 rounded-md border border-primary/18 bg-background pl-6 pr-2 font-mono text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </label>
  );
}
