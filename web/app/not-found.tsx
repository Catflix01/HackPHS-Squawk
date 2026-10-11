import type { Metadata } from "next";
import Link from "next/link";
import { Wilco } from "./components/Wilco";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 bg-[#0B1526] px-4 py-16 text-center text-[#E6EDF5]">
      <Wilco mood="grumpy" size={140} />
      <p className="font-mono text-xs tracking-[0.25em] text-[#9FB2C8]">404</p>
      <h1 className="text-2xl font-bold text-[#F5B83D] sm:text-3xl">Say again? That page is off the chart.</h1>
      <Link
        href="/"
        className="rounded border border-[#F5B83D] px-5 py-2.5 font-mono text-sm font-bold tracking-widest text-[#F5B83D] hover:bg-[#F5B83D] hover:text-[#0B1526]"
      >
        BACK TO THE HANGAR
      </Link>
    </main>
  );
}
