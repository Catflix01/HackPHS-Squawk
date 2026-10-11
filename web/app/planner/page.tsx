"use client";

import { FormEvent, useEffect, useState } from "react";
import { postFallback, serverBaseUrl } from "../lib/api";

type PlanItem = { date: string; lesson: string; minutes: number };
const mockPlan = (start: string, lesson: string, minutes: number): PlanItem[] => Array.from({ length: 14 }, (_, index) => {
  const date = new Date(`${start || new Date().toISOString().slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + index);
  return { date: date.toISOString().slice(0, 10), lesson, minutes };
});

export default function PlannerPage() {
  const [lesson, setLesson] = useState("Radio basics");
  const [flightDate, setFlightDate] = useState("");
  const [examDate, setExamDate] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [items, setItems] = useState<PlanItem[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("squawk-planner");
    if (saved) {
      try {
        Promise.resolve(JSON.parse(saved) as PlanItem[]).then(setItems);
        return;
      } catch {
        // Use the scripted plan below.
      }
    }
    Promise.resolve(mockPlan("", "Radio basics", 15)).then(setItems);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const fallback = mockPlan(flightDate, lesson, Number(minutes) || 15);
    void postFallback<{ planId?: string; planItems?: PlanItem[] }>("/planner", { examDate, flightDate, lesson, minutes: Number(minutes) || 15 }, { planItems: fallback }).then((result) => {
      const next = result.planItems?.length ? result.planItems : fallback;
      setItems(next);
      setPlanId(result.planId || null);
      localStorage.setItem("squawk-planner", JSON.stringify(next));
    });
  }

  function downloadCalendar() {
    if (planId) {
      window.open(`${serverBaseUrl}/planner/${encodeURIComponent(planId)}.ics`, "_blank");
      return;
    }
    const body = items.map((item) => `BEGIN:VEVENT\nDTSTART:${item.date.replaceAll("-", "")}\nSUMMARY:Squawk ${item.lesson}\nDESCRIPTION:${item.minutes} minutes\nEND:VEVENT`).join("\n");
    const blob = new Blob([`BEGIN:VCALENDAR\nVERSION:2.0\n${body}\nEND:VCALENDAR`], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "squawk-plan.ics";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-transparent px-4 py-8 text-[#E6EDF5] sm:px-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="font-display text-4xl font-semibold text-[#E6EDF5]">Flight planner</h1>
        <form className="space-y-4 border border-[#29466B] bg-[#10203A] p-5" onSubmit={submit}>
          <label className="block text-sm text-[#9FB2C8]">Lesson<input className="mt-1 min-h-11 w-full border border-[#29466B] bg-[#0B1526] p-3 text-[#E6EDF5] outline-none focus:border-[#F5B83D]" onChange={(event) => setLesson(event.target.value)} value={lesson} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-[#9FB2C8]">Flight lesson date<input className="mt-1 min-h-11 w-full border border-[#29466B] bg-[#0B1526] p-3 font-mono text-[#E6EDF5]" onChange={(event) => setFlightDate(event.target.value)} type="date" value={flightDate} /></label>
            <label className="block text-sm text-[#9FB2C8]">Exam date<input className="mt-1 min-h-11 w-full border border-[#29466B] bg-[#0B1526] p-3 font-mono text-[#E6EDF5]" onChange={(event) => setExamDate(event.target.value)} type="date" value={examDate} /></label>
          </div>
          <label className="block text-sm text-[#9FB2C8]">Minutes per day<input className="mt-1 min-h-11 w-full border border-[#29466B] bg-[#0B1526] p-3 font-mono text-[#E6EDF5]" min="5" onChange={(event) => setMinutes(event.target.value)} type="number" value={minutes} /></label>
          <button className="min-h-11 w-full border border-[#F5B83D] bg-[#F5B83D] px-4 py-3 font-semibold text-[#0B1526] hover:bg-[#E6A92D]" type="submit">Build my plan</button>
        </form>
        <section className="border border-[#29466B] bg-[#10203A] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">Plan by day</h2><button className="min-h-11 border border-[#4A9BD9] px-3 py-2 text-sm text-[#E6EDF5] hover:border-[#F5B83D] hover:text-[#F5B83D]" onClick={downloadCalendar} type="button">Add to calendar</button></div>
          <div className="mt-3 divide-y divide-[#29466B]">{items.map((item, index) => <div className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={`${item.date}-${index}`}><span className="break-words text-[#E6EDF5]">{item.lesson}</span><span className="font-mono text-[#F5B83D]">{item.date} · {item.minutes} min</span></div>)}</div>
        </section>
      </div>
    </main>
  );
}
