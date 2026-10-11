"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wilco } from "../../components/Wilco";
import { fetchFallback } from "../../lib/api";

type Lesson = { id: string; title: string; brief: string; flashcards: Array<{ front: string; back: string }> };
const fallback: Lesson = {
  id: "unit1",
  title: "Radio basics",
  brief: "Learn the building blocks of a clear, confident aviation call.",
  flashcards: [
    { front: "Phraseology", back: "Use standard words and keep the call brief." },
    { front: "Readbacks", back: "Read back clearances and runway assignments accurately." },
    { front: "Callsigns", back: "Say the facility, your callsign, and your position." },
    { front: "Wilco", back: "Wilco means you understand and will comply." },
    { front: "Say again", back: "Use say again when you need a transmission repeated." },
  ],
};

export default function LessonPage() {
  const [lesson, setLesson] = useState(fallback);
  const [card, setCard] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const id = window.location.pathname.split("/").pop() || "unit1";
    void fetchFallback<{ lessons?: Array<{ id: string }> }>("/lessons", { lessons: [] }).then((list) => {
      if ((list.lessons ?? []).some((item) => item.id === id)) {
        void fetchFallback<Lesson>(`/lessons/${encodeURIComponent(id)}`, fallback).then(setLesson);
      }
    });
  }, []);

  const current = lesson.flashcards[card] ?? fallback.flashcards[0];

  return (
    <main className="min-h-screen bg-transparent px-4 py-8 text-[#E6EDF5] sm:px-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <section className="border border-[#29466B] bg-[#10203A] p-5 sm:p-7">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#4A9BD9]">Lesson brief</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[#E6EDF5]">{lesson.title}</h1>
          <p className="mt-3 max-w-prose text-[#9FB2C8]">{lesson.brief}</p>
        </section>
        <section className="border border-[#29466B] bg-[#10203A] p-4 text-center sm:p-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#F5B83D]">Flashcard {card + 1} / {lesson.flashcards.length}</p>
          <button className="mt-4 min-h-48 w-full border border-[#29466B] bg-[#0B1526] p-6 text-left text-xl font-semibold text-[#E6EDF5] hover:border-[#F5B83D]" onClick={() => setFlipped((value) => !value)} type="button">
            {flipped ? current.back : current.front}
            <span className="mt-6 block text-xs font-normal text-[#9FB2C8]">Select to flip</span>
          </button>
          <button className="mt-4 min-h-11 border border-[#4A9BD9] px-5 py-2 text-sm text-[#E6EDF5] hover:border-[#F5B83D] hover:text-[#F5B83D]" onClick={() => { setCard((value) => (value + 1) % lesson.flashcards.length); setFlipped(false); }} type="button">Next card</button>
        </section>
        <Link className="flex min-h-11 items-center justify-center border border-[#4A9BD9] bg-[#4A9BD9] px-5 py-3 font-semibold text-[#0B1526] hover:bg-[#3988C4]" href="/fly">Fly it</Link>
        <button className="mx-auto flex min-h-11 items-center gap-3 border border-[#3FB27F] px-4 py-2 text-sm text-[#3FB27F] hover:bg-[#3FB27F] hover:text-[#0B1526]" onClick={() => setDone(true)} type="button">
          {done && <Wilco mood="salute" size={56} />}
          {done ? "Wilco! Lesson complete." : "Mark lesson complete"}
        </button>
      </div>
    </main>
  );
}
