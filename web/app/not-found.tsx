import type { Metadata } from "next";
import Link from "next/link";
import { Wilco } from "./components/Wilco";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-16 text-center text-text">
      <Wilco mood="grumpy" size={140} />
      <p className="font-mono text-xs tracking-[0.25em] text-muted">ERROR 404</p>
      <h1 className="font-display text-3xl uppercase tracking-wider text-amber sm:text-4xl">Say again? That page is off the chart.</h1>
      <Link
        href="/"
        className="rounded border border-amber px-5 py-2.5 font-mono text-sm font-bold tracking-widest text-amber hover:bg-amber hover:text-bg"
      >
        BACK TO THE HANGAR
      </Link>
    </main>
  );
}
