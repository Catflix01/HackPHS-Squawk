"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wilco } from "./components/Wilco";
import { fetchWithFallback } from "./lib/api";

type FeedPost = { id: string; role: string; airport: string; text: string };
const mockFeed: FeedPost[] = [
  { id: "student", role: "Student pilot", airport: "KCDW", text: "N123SQ ready for taxi practice today." },
  { id: "cfi", role: "CFI", airport: "KSQK", text: "Short, clear, confident calls win the frequency." },
];

export default function Home() {
  const [today, setToday] = useState("Pattern work · 15 minutes");
  const [feed, setFeed] = useState(mockFeed);

  useEffect(() => {
    const saved = localStorage.getItem("squawk-planner");
    if (saved) {
      try {
        const items = JSON.parse(saved) as Array<{ date: string; lesson: string; minutes: number }>;
        const next = items.find((item) => item.date >= new Date().toISOString().slice(0, 10));
        if (next) Promise.resolve(`${next.lesson} · ${next.minutes} minutes`).then(setToday);
      } catch {
        // Keep the demo card when local planner data is unavailable.
      }
    }
    void fetchWithFallback<FeedPost[]>("/feed?limit=2", mockFeed).then(setFeed);
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3"><Wilco mood="happy" size={72} /><div><p className="font-mono text-xs uppercase tracking-[0.25em] text-sky-300">The Hangar</p><h1 className="text-3xl font-black text-sky-100">Welcome back, pilot.</h1></div></div>
          <Link className="hidden text-sm text-sky-300 underline sm:block" href="/join">Join the network</Link>
        </header>
        <section className="grid grid-cols-3 gap-3">
          {[
            ["🔥 4 days", "streak"],
            ["⛽ 82%", "fuel"],
            ["★ 1,240", "XP"],
          ].map(([value, label]) => <div className="rounded-2xl border border-sky-400/20 bg-slate-900 p-4 text-center" key={label}><p className="font-mono text-xl font-bold text-amber-200">{value}</p><p className="mt-1 text-xs uppercase text-slate-400">{label}</p></div>)}
        </section>
        <section className="rounded-2xl border border-sky-400/30 bg-slate-900 p-5">
          <div className="mb-5 flex items-center justify-between"><div><p className="font-mono text-xs uppercase text-sky-300">Training route</p><h2 className="text-xl font-bold">Fly the pattern</h2></div><span className="font-mono text-xs text-green-300">2 / 5 complete</span></div>
          <div className="flex items-start justify-between gap-1">{["Radio basics", "Taxi", "Takeoff", "Pattern", "Landing"].map((lesson, index) => <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center" key={lesson}><div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 font-mono text-sm ${index < 2 ? "border-green-300 bg-green-300/20 text-green-200" : "border-sky-400/50 text-sky-200"}`}>{index < 2 ? "✓" : index + 1}</div><span className="text-[10px] text-slate-300 sm:text-xs">{lesson}</span></div>)}</div>
          <Link className="mt-6 block rounded-xl bg-amber-300 px-5 py-4 text-center font-bold text-slate-950 shadow-lg shadow-amber-300/10" href="/fly">Fly the pattern →</Link>
        </section>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5"><p className="font-mono text-xs uppercase text-amber-200">Today</p><h2 className="mt-2 text-2xl font-bold text-amber-50">{today}</h2><Link className="mt-4 inline-block text-sm text-amber-200 underline" href="/planner">Open planner</Link></section>
          <section className="rounded-2xl border border-sky-400/20 bg-slate-900 p-5"><div className="flex items-center justify-between"><h2 className="font-bold text-sky-100">Network feed</h2><Link className="text-xs text-sky-300 underline" href="/hangar">See all</Link></div>{feed.map((post) => <div className="mt-3 border-t border-slate-700 pt-3 text-sm" key={post.id}><p className="font-mono text-xs text-sky-300">{post.role} · {post.airport}</p><p className="mt-1 text-slate-300">{post.text}</p></div>)}</section>
        </div>
        <footer className="pb-3 text-center text-xs text-slate-500">Practice tool only. Not a substitute for flight instruction.</footer>
      </div>
    </main>
  );
}
