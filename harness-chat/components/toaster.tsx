"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast, Toaster as Sonner, type ToasterProps } from "sonner";

import { cn } from "@/lib/utils";

/**
 * shadcn's Sonner wrapper, in this console's idiom: mono, thin borders,
 * square corners, panel colours. Light theme only, like the rest of the app.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-3.5 text-emerald-600" />,
        info: <InfoIcon className="size-3.5" />,
        warning: <TriangleAlertIcon className="size-3.5 text-amber-600" />,
        error: <OctagonXIcon className="size-3.5 text-destructive" />,
        loading: <LoaderCircleIcon className="size-3.5 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            "flex w-[340px] items-center gap-2.5 rounded-sm border border-primary/18 bg-background px-3 py-2.5",
            "font-mono text-xs text-foreground shadow-sm",
          ),
          title: "font-semibold",
          description: "text-muted-foreground",
          actionButton:
            "ml-auto shrink-0 rounded-sm border border-primary/18 bg-secondary px-2 py-1 text-[11px] hover:bg-primary hover:text-primary-foreground cursor-pointer",
          cancelButton:
            "ml-auto shrink-0 rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:text-primary cursor-pointer",
          closeButton: "text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

/**
 * A toast whose whole surface is the action — click anywhere to act. Used for
 * "session X finished" so one click jumps to it. The frame comes from the
 * shared `toast` class above; this only provides the content, stretched over
 * the wrapper's padding so the hover and hit area cover the whole toast.
 */
export function notify({
  icon,
  title,
  description,
  onClick,
  duration = 8000,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
  duration?: number;
}): void {
  toast.custom(
    (id) => (
      <button
        type="button"
        className={cn(
          "-mx-3 -my-2.5 flex w-[calc(100%+1.5rem)] items-center gap-2.5 rounded-sm px-3 py-2.5 text-left",
          onClick && "cursor-pointer hover:bg-secondary/70",
        )}
        onClick={() => {
          onClick?.();
          toast.dismiss(id);
        }}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{title}</span>
          {description !== undefined && (
            <span className="block truncate text-muted-foreground">{description}</span>
          )}
        </span>
      </button>
    ),
    { duration },
  );
}
