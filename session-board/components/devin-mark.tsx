import { cn } from "@/lib/utils";

/** Dashed-outline mark, shared with the other examples. */
export function DevinDashed({ className }: { className?: string }) {
  return (
    <svg
      className={cn("w-6 h-6 text-foreground", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 2.5"
      />
      <path
        d="M9 8.25h2.6a3.75 3.75 0 0 1 0 7.5H9v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
