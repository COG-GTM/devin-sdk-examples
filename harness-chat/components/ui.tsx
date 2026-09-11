import type { ButtonHTMLAttributes } from "react";
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors h-9 px-4 py-2 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        variant === "outline" &&
          "border border-border bg-background shadow-sm hover:bg-secondary hover:text-primary",
        variant === "ghost" && "text-muted-foreground hover:bg-secondary hover:text-primary",
        className,
      )}
      {...props}
    />
  );
}

/** A placeholder bar for content that is still loading. Size it with className. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-sm bg-muted", className)} aria-hidden />;
}

/** Several skeleton lines of decreasing width, for a text block. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ["w-11/12", "w-4/5", "w-3/5", "w-2/3", "w-1/2"];
  return (
    <div className={cn("space-y-1.5", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", widths[i % widths.length])} />
      ))}
    </div>
  );
}

/** Inline spinner + label, for panel bodies waiting on the sandbox. */
export function Loading({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center gap-2 font-mono text-xs text-muted-foreground",
        className,
      )}
      role="status"
    >
      <LoaderCircleIcon className="w-3.5 h-3.5 animate-spin" />
      {label !== undefined && <span>{label}</span>}
    </div>
  );
}

/** A failed load, with a retry. */
export function LoadError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center font-mono text-xs text-muted-foreground",
        className,
      )}
      role="alert"
    >
      <span className="flex items-center gap-1.5 text-destructive">
        <TriangleAlertIcon className="size-3.5" />
        {message}
      </span>
      {onRetry && (
        <Button variant="outline" className="h-6 px-2 text-xs" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
