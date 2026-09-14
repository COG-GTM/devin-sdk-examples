import { SendIcon, SquareIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui";

/** Grows with its content up to this height, then scrolls. */
const MAX_HEIGHT_PX = 250;

/**
 * Message composer: starts one line tall, grows with the text, caps and
 * scrolls. Enter sends, Shift+Enter inserts a newline.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${String(next)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);
  useLayoutEffect(fit, [value, fit]);

  // Type ahead while Devin works, but send only between turns: a message sent
  // mid-stream makes the client drop the running reply and misattribute the rest.
  const canSend = value.trim() !== "" && !busy && !disabled;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <form
      className="flex items-end gap-1 p-2 border-t border-primary/18 bg-background"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "flex-1 resize-none bg-transparent px-3 py-2 font-mono text-sm leading-5",
          "placeholder:text-muted-foreground focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      {busy ? (
        <Button type="button" variant="outline" className="shrink-0" onClick={onStop} title="Stop">
          <SquareIcon className="w-4 h-4" />
        </Button>
      ) : (
        <Button type="submit" className="shrink-0" disabled={!canSend} title="Send (Enter)">
          <SendIcon className="w-4 h-4" />
        </Button>
      )}
    </form>
  );
}
