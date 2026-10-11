"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

// The year is read only in the browser: with cacheComponents, `new Date()` may not run during prerender.
function useYear(): number | null {
  return useSyncExternalStore(noopSubscribe, () => new Date().getFullYear(), () => null);
}

export function Footer() {
  const year = useYear();
  return (
    <footer className="relative z-10 border-t border-line px-4 py-5 text-center text-xs text-muted">
      © {year !== null && <span className="font-mono">{year}</span>} Squawk. Practice tool only. Not a substitute for flight instruction.
    </footer>
  );
}
