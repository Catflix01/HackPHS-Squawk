"use client";

import Link from "next/link";
import { TypingGreeting } from "./components/TypingGreeting";
import { Wilco } from "./components/Wilco";

const lessons = [
  ["unit1", "Radio basics"],
  ["taxi", "Taxi"],
  ["takeoff", "Takeoff"],
  ["pattern", "Pattern"],
  ["landing", "Landing"],
  ["cross-country", "Cross-country"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-transparent px-4 py-8 text-[#E6EDF5] sm:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <section className="flex items-center gap-4">
          <Wilco mood="happy" size={88} />
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#4A9BD9]">The Hangar</p>
            <TypingGreeting />
          </div>
        </section>

        <section aria-label="Flight stats" className="grid grid-cols-3 gap-2 sm:gap-4">
          {[["04", "day streak"], ["82%", "fuel"], ["1240", "XP"]].map(([value, label]) => (
            <div className="border border-[#29466B] bg-[#10203A] p-3 text-center sm:p-5" key={label}>
              <p className="font-mono text-lg font-semibold text-[#F5B83D] sm:text-2xl">{value}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-[#9FB2C8]">{label}</p>
            </div>
          ))}
        </section>

        <section className="border border-[#29466B] bg-[#10203A] p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#4A9BD9]">Training route</p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-[#E6EDF5]">Build the pattern</h2>
            </div>
            <p className="font-mono text-xs text-[#9FB2C8]">6 lessons</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
            {lessons.map(([id, label], index) => (
              <Link className="group min-h-11 text-center" href={`/lessons/${id}`} key={id}>
                <span className="mx-auto flex h-11 w-11 items-center justify-center border border-[#4A9BD9] font-mono text-sm text-[#E6EDF5] group-hover:border-[#F5B83D] group-hover:text-[#F5B83D]">{index + 1}</span>
                <span className="mt-2 block break-words text-xs text-[#9FB2C8] group-hover:text-[#E6EDF5]">{label}</span>
              </Link>
            ))}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link className="flex min-h-11 items-center justify-center border border-[#F5B83D] bg-[#F5B83D] px-5 py-3 text-center font-semibold text-[#0B1526] hover:bg-[#E6A92D]" href="/fly">Open Flight Deck</Link>
            <Link className="flex min-h-11 items-center justify-center border border-[#4A9BD9] px-5 py-3 text-center font-semibold text-[#E6EDF5] hover:border-[#F5B83D] hover:text-[#F5B83D]" href="/lessons/cross-country">Cross-country lesson</Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <Link className="border border-[#29466B] bg-[#10203A] p-5 hover:border-[#F5B83D]" href="/planner">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#F5B83D]">Today</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-[#E6EDF5]">Pattern work · 15 minutes</h2>
            <p className="mt-2 text-sm text-[#9FB2C8]">Open planner</p>
          </Link>
          <Link className="border border-[#29466B] bg-[#10203A] p-5 hover:border-[#4A9BD9]" href="/hangar">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#4A9BD9]">Network feed</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-[#E6EDF5]">Share the frequency</h2>
            <p className="mt-2 text-sm text-[#9FB2C8]">Read pilots, CFIs, ATC, and aviators in the Hangar.</p>
          </Link>
        </section>
      </div>
    </main>
  );
}
