"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wilco } from "../../components/Wilco";
import { fetchFallback } from "../../lib/api";

type Lesson = { id: string; title: string; brief: string; flashcards: Array<{ front: string; back: string }> };
const fallback: Lesson = { id: "unit1", title: "Radio basics", brief: "Learn the building blocks of a clear, confident aviation call.", flashcards: [{ front: "Phraseology", back: "Use standard words and keep the call brief." }, { front: "Readbacks", back: "Read back clearances and runway assignments accurately." }, { front: "Callsigns", back: "Say the facility, your callsign, and your position." }, { front: "Wilco", back: "Wilco means you understand and will comply." }, { front: "Say again", back: "Use say again when you need a transmission repeated." }] };

export default function LessonPage() {
  const [lesson, setLesson] = useState(fallback);
  const [card, setCard] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { const id = window.location.pathname.split("/").pop() || "unit1"; void fetchFallback<Lesson>(`/lessons/${encodeURIComponent(id)}`, fallback).then(setLesson); }, []);
  const current = lesson.flashcards[card] || fallback.flashcards[0];
  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8"><div className="mx-auto max-w-2xl space-y-5"><Link className="text-sm text-sky-300 underline" href="/">← The Hangar</Link><header className="rounded-2xl border border-sky-400/30 bg-slate-900 p-5"><p className="font-mono text-xs uppercase text-sky-300">Lesson brief</p><h1 className="mt-1 text-3xl font-black text-sky-100">{lesson.title}</h1><p className="mt-3 text-slate-300">{lesson.brief}</p></header><section className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-5 text-center"><p className="mb-4 font-mono text-xs uppercase text-amber-200">Card {card + 1} / {lesson.flashcards.length}</p><button className="min-h-48 w-full rounded-xl border border-amber-200/30 bg-slate-900 p-8 text-xl font-bold text-amber-50" onClick={() => setFlipped(!flipped)} type="button">{flipped ? current.back : current.front}<span className="mt-5 block text-xs font-normal text-slate-400">Tap to flip</span></button><button className="mt-4 rounded-lg border border-sky-300/40 px-4 py-2 text-sm text-sky-200" onClick={() => { setCard((card + 1) % lesson.flashcards.length); setFlipped(false); }} type="button">Next card</button></section><Link className="block rounded-xl bg-sky-400 px-5 py-4 text-center font-bold text-slate-950" href="/fly">Fly it →</Link><button className="mx-auto flex items-center gap-3 text-sm text-green-200" onClick={() => setDone(true)} type="button">{done && <Wilco mood="salute" size={56} />}{done ? "Wilco! Lesson complete." : "Mark lesson complete"}</button></div></main>;
}
