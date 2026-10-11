"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Wilco } from "./Wilco";

const NAV = [
  { href: "/", label: "Hangar", match: (path: string) => path === "/" },
  { href: "/lessons/cross-country", label: "Lessons", match: (path: string) => path.startsWith("/lessons") },
  { href: "/planner", label: "Planner", match: (path: string) => path.startsWith("/planner") },
  { href: "/hangar", label: "Network", match: (path: string) => path.startsWith("/hangar") },
  { href: "/fly", label: "Fly", match: (path: string) => path.startsWith("/fly") },
];

function TopBarView({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const links = (vertical: boolean) =>
    NAV.map((item) => {
      const active = pathname !== null && item.match(pathname);
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={active ? "page" : undefined}
          className={`${vertical ? "block border-b border-line px-4 py-3" : "px-3 py-2"} text-sm font-bold uppercase tracking-widest ${
            active ? "text-amber underline decoration-2 underline-offset-8" : "text-muted hover:text-text"
          }`}
        >
          {item.label}
        </Link>
      );
    });

  return (
    <header className="relative z-20 border-b border-line bg-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 text-text hover:text-amber" onClick={() => setOpen(false)}>
          <Wilco mood="happy" cloud={false} size={34} />
          <span className="font-display text-2xl font-bold tracking-widest">SQUAWK</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center md:flex">{links(false)}</nav>
        <button
          type="button"
          className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm font-bold uppercase tracking-widest text-text hover:text-amber md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            {open ? <path d="M3 3l10 10M13 3 3 13" /> : <path d="M2 4h12M2 8h12M2 12h12" />}
          </svg>
          Menu
        </button>
      </div>
      {open && <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-panel md:hidden">{links(true)}</nav>}
    </header>
  );
}

function TopBarWithPath() {
  return <TopBarView pathname={usePathname() || "/"} />;
}

// usePathname() reads URL data, so it renders inside Suspense (cacheComponents); the
// prerendered shell shows the same bar without an active item.
export function TopBar() {
  return (
    <Suspense fallback={<TopBarView pathname={null} />}>
      <TopBarWithPath />
    </Suspense>
  );
}
