import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast, Toaster as Sonner, type ToasterProps } from "sonner";

import { cn } from "../lib/utils";

/** Sonner in this console's idiom: mono, thin borders, square corners. */
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
          icon: "shrink-0 flex items-center",
          content: "flex flex-col gap-0.5 min-w-0",
        },
      }}
      {...props}
    />
  );
}

/** A custom toast with the same chrome, for events that carry an action. */
export function notify({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
}) {
  toast.custom((id) => (
    <button
      type="button"
      className={cn(
        "flex w-[340px] items-center gap-2.5 rounded-sm border border-primary/18 bg-background px-3 py-2.5 text-left",
        "font-mono text-xs text-foreground shadow-sm cursor-pointer hover:bg-secondary",
      )}
      onClick={() => {
        toast.dismiss(id);
        onClick?.();
      }}
    >
      <span className="shrink-0 flex items-center">{icon}</span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="font-semibold">{title}</span>
        {description !== undefined && (
          <span className="text-muted-foreground truncate">{description}</span>
        )}
      </span>
    </button>
  ));
}
