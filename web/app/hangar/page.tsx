"use client";

import { useMemo, useState } from "react";

type Post = { id: string; role: string; airport: "KCDW" | "KSQK"; text: string };
const posts: Post[] = [
  { id: "1", role: "Student pilot", airport: "KCDW", text: "N123SQ ready for taxi practice. Any tips for concise calls?" },
  { id: "2", role: "CFI", airport: "KCDW", text: "Say who you are, where you are, and what you need." },
  { id: "3", role: "ATC", airport: "KSQK", text: "The best calls are the ones I never need repeated." },
  { id: "4", role: "Commercial pilot", airport: "KSQK", text: "Pattern work is where calm habits become automatic." },
  { id: "5", role: "Drone pilot", airport: "KCDW", text: "Shared phraseology helps every aircraft share the sky." },
];

export default function HangarPage() {
  const [role, setRole] = useState("All");
  const [airport, setAirport] = useState("All");
  const visible = useMemo(() => posts.filter((post) => (role === "All" || post.role === role) && (airport === "All" || post.airport === airport)), [airport, role]);

  return (
    <main className="min-h-screen bg-transparent px-4 py-8 text-[#E6EDF5] sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <header><p className="font-mono text-xs uppercase tracking-[0.18em] text-[#4A9BD9]">The Hangar</p><h1 className="mt-2 font-display text-4xl font-semibold">Network feed</h1></header>
        <section className="grid gap-4 border border-[#29466B] bg-[#10203A] p-5 sm:grid-cols-2">
          <label className="block text-sm text-[#9FB2C8]">Role<select className="mt-1 min-h-11 w-full border border-[#29466B] bg-[#0B1526] p-3 text-[#E6EDF5] focus:border-[#F5B83D]" onChange={(event) => setRole(event.target.value)} value={role}><option>All</option>{["Student pilot", "CFI", "ATC", "Commercial pilot", "Drone pilot"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="block text-sm text-[#9FB2C8]">Airport<select className="mt-1 min-h-11 w-full border border-[#29466B] bg-[#0B1526] p-3 font-mono text-[#E6EDF5] focus:border-[#F5B83D]" onChange={(event) => setAirport(event.target.value)} value={airport}><option>All</option><option>KCDW</option><option>KSQK</option></select></label>
        </section>
        <section className="space-y-3">{visible.map((post) => <article className="border border-[#29466B] bg-[#10203A] p-4" key={post.id}><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-[#E6EDF5]">{post.role}</p><span className="font-mono text-xs text-[#F5B83D]">{post.airport}</span></div><p className="mt-3 break-words text-[#9FB2C8]">{post.text}</p></article>)}</section>
      </div>
    </main>
  );
}
