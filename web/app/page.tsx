import Link from "next/link";

const lessons = [
  ["unit1", "Radio basics"],
  ["taxi", "Taxi"],
  ["takeoff", "Takeoff"],
  ["pattern", "Pattern"],
  ["landing", "Landing"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100 sm:p-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header><p className="font-mono text-xs uppercase tracking-[.25em] text-sky-300">The Hangar</p><h1 className="mt-2 text-4xl font-black text-sky-100">Welcome back, pilot.</h1><p className="mt-2 text-slate-400">Build calm, clear radio habits one flight at a time.</p></header>
        <section className="grid grid-cols-3 gap-3">{[["🔥 4", "streak"], ["⛽ 82%", "fuel"], ["★ 1,240", "XP"]].map(([value, label]) => <div className="rounded-2xl border border-sky-400/20 bg-slate-900 p-4 text-center" key={label}><p className="font-mono text-xl font-bold text-amber-200">{value}</p><p className="text-xs uppercase text-slate-400">{label}</p></div>)}</section>
        <section className="rounded-2xl border border-sky-400/30 bg-slate-900 p-5"><p className="font-mono text-xs uppercase text-sky-300">Training route</p><h2 className="mt-1 text-2xl font-bold">Fly the pattern</h2><div className="mt-5 grid grid-cols-5 gap-2">{lessons.map(([id, label], index) => <Link className="text-center" href={`/lessons/${id}`} key={id}><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border-2 border-sky-400/60 text-sky-200">{index + 1}</span><span className="mt-2 block text-[10px] text-slate-300 sm:text-xs">{label}</span></Link>)}</div><Link className="mt-6 block rounded-xl bg-amber-300 px-5 py-4 text-center font-bold text-slate-950" href="/fly">Fly the pattern →</Link></section>
        <div className="grid gap-4 sm:grid-cols-2"><Link className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5" href="/planner"><p className="font-mono text-xs uppercase text-amber-200">Today</p><h2 className="mt-2 text-xl font-bold">Pattern work · 15 minutes</h2><p className="mt-2 text-sm text-amber-100/70">Open planner →</p></Link><Link className="rounded-2xl border border-sky-400/20 bg-slate-900 p-5" href="/hangar"><p className="font-mono text-xs uppercase text-sky-300">Network feed</p><p className="mt-3 text-sm text-slate-300">Student pilots, CFIs, ATC, and aviators sharing the frequency.</p><p className="mt-2 text-sm text-sky-300 underline">See all →</p></Link></div>
        <p className="text-center text-xs text-slate-500"><Link href="/join" className="text-sky-300 underline">Join the network</Link> · Practice tool only. Not a substitute for flight instruction.</p>
      </div>
    </main>
  );
}
