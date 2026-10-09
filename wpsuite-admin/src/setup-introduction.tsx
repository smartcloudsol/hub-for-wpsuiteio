import { useState, type ReactNode } from "react";

/** Persist an explicit disclosure choice independently from configuration state. */
export default function SetupIntroduction({ endpoint, defaultOpen, children }: { endpoint: string; defaultOpen: boolean; children: ReactNode }) {
  const key = `wpsuite-introduction:${new URL(".", window.location.href).pathname}:${endpoint}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "open" || saved === "closed") return saved === "open";
    } catch { /* Storage is optional. */ }
    return defaultOpen;
  });
  return <details open={open} onClick={event => {
    const summary = event.target instanceof Element ? event.target.closest("summary") : null;
    if (summary?.parentElement !== event.currentTarget) return;
    event.preventDefault();
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(key, next ? "open" : "closed"); } catch { /* Storage is optional. */ }
  }}>{children}</details>;
}
