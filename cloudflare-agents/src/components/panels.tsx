import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PanelGroup, Panel as ResizablePanel, PanelResizeHandle } from "react-resizable-panels";

import { cn } from "../lib/utils";

interface Props {
  className?: string;
  children: ReactNode;
}

export function Panel({ className, children }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col relative border border-primary/18 w-full h-full shadow-sm rounded-sm bg-background",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ className, children }: Props) {
  return (
    <div
      className={cn(
        "text-sm flex items-center border-b border-primary/18 px-2.5 py-1.5 text-secondary-foreground bg-secondary",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center font-mono font-semibold uppercase">
      <Icon className="mr-2 w-4" />
      {children}
    </div>
  );
}

export function Columns({
  left,
  center,
  right,
}: {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}) {
  return (
    <PanelGroup direction="horizontal">
      <ResizablePanel defaultSize={18} minSize={12}>
        {left}
      </ResizablePanel>
      <PanelResizeHandle className="w-2" />
      <ResizablePanel defaultSize={50} minSize={30}>
        {center}
      </ResizablePanel>
      <PanelResizeHandle className="w-2" />
      <ResizablePanel defaultSize={32} minSize={20}>
        {right}
      </ResizablePanel>
    </PanelGroup>
  );
}

export function Rows({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  return (
    <PanelGroup direction="vertical">
      <ResizablePanel defaultSize={45} minSize={20}>
        {top}
      </ResizablePanel>
      <PanelResizeHandle className="h-2" />
      <ResizablePanel defaultSize={55} minSize={20}>
        {bottom}
      </ResizablePanel>
    </PanelGroup>
  );
}
