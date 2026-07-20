import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}

/**
 * Lightweight menu/popover: a trigger + a floating panel that closes on outside-click
 * or Escape. For a searchable combobox use the ga4Reports MetaPicker pattern instead.
 */
export function Dropdown({ trigger, children, align = "left", className, panelClassName }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-30 mt-1.5 min-w-[10rem] animate-pop-in rounded-xl border border-ink/15 bg-white p-1 shadow-pop",
            align === "right" ? "right-0" : "left-0",
            panelClassName
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** A row inside a Dropdown panel. */
export function MenuItem({ className, type, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink/80 transition-colors hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:outline-none disabled:opacity-40",
        className
      )}
      {...props}
    />
  );
}
