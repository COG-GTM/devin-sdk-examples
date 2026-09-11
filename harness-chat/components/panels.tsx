"use client";

import type { ReactNode } from "react";
import { PanelGroup, Panel as ResizablePanel, PanelResizeHandle } from "react-resizable-panels";

import { cn } from "@/lib/utils";

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
      <ResizablePanel defaultSize={47} minSize={30}>
        {center}
      </ResizablePanel>
      <PanelResizeHandle className="w-2" />
      <ResizablePanel defaultSize={35} minSize={20}>
        {right}
      </ResizablePanel>
    </PanelGroup>
  );
}

export function Rows({
  top,
  middle,
  bottom,
}: {
  top: ReactNode;
  middle: ReactNode;
  bottom: ReactNode;
}) {
  return (
    <PanelGroup direction="vertical">
      <ResizablePanel defaultSize={24} minSize={12}>
        {top}
      </ResizablePanel>
      <PanelResizeHandle className="h-2" />
      <ResizablePanel defaultSize={40} minSize={15}>
        {middle}
      </ResizablePanel>
      <PanelResizeHandle className="h-2" />
      <ResizablePanel defaultSize={36} minSize={15}>
        {bottom}
      </ResizablePanel>
    </PanelGroup>
  );
}
