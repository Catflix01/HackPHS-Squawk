"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { postWithFallback } from "../lib/api";

type PlanItem = { date: string; lesson: string; minutes: number };
const fallback: PlanItem[] = [{ date: new Date().toISOString().slice(0, 10), lesson: "Pattern calls", minutes: 15 }];

export default function PlannerPage() {
  const [lesson, setLesson] = useState("Pattern calls");
  const [flightDate, setFlightDate] = useState("");
  const [examDate, setExamDate] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [items, setItems] = useState<PlanItem[]>(fallback);
  useEffect(() => { const saved = localStorage.getItem("squawk-planner"); if (saved) { try { Promise.resolve(JSON.parse(saved) as PlanItem[]).then(setItems); } catch { /* Keep the demo plan. */ } } }, []);
  function submit(event: FormEvent) { event.preventDefault(); const next = [...items, { date: flightDate || new Date().toISOString().slice(0, 10), lesson: `${lesson}${examDate ? ` · Exam ${examDate}` : ""}`, minutes: Number(minutes) || 15 }]; setItems(next); localStorage.setItem("squawk-planner", JSON.stringify(next)); void postWithFallback("/planner", { examDate, flightDate, lesson, minutes: Number(minutes) }, { planItems: next }); }
  function downloadCalendar() { const body = items.map((item) => `BEGIN:VEVENT\nDTSTART:${item.date.replaceAll("-", "")}\nSUMMARY:Squawk ${item.lesson}\nDESCRIPTION:${item.minutes} minutes of radio practice\nEND:VEVENT`).join("\n"); const blob = new Blob([`BEGIN:VCALENDAR\nVERSION:2.0\n${body}\nEND:VCALENDAR`], { type: "text/calendar" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "squawk-plan.ics"; anchor.click(); URL.revokeObjectURL(url); }
  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8"><div className="mx-auto max-w-2xl space-y-5"><Link className="text-sm text-sky-300 underline" href="/">← The Hangar</Link><h1 className="text-3xl font-black text-sky-100">Flight planner</h1><form className="space-y-4 rounded-2xl border border-sky-400/30 bg-slate-900 p-5" onSubmit={submit}><label className="block text-sm text-slate-300">Lesson<input className="mt-1 w-full rounded-lg bg-slate-800 p-3" onChange={(e) => setLesson(e.target.value)} value={lesson} /></label><label className="block text-sm text-slate-300">Flight lesson date<input className="mt-1 w-full rounded-lg bg-slate-800 p-3 font-mono" onChange={(e) => setFlightDate(e.target.value)} type="date" value={flightDate} /></label><label className="block text-sm text-slate-300">Exam date<input className="mt-1 w-full rounded-lg bg-slate-800 p-3 font-mono" onChange={(e) => setExamDate(e.target.value)} type="date" value={examDate} /></label><label className="block text-sm text-slate-300">Minutes per day<input className="mt-1 w-full rounded-lg bg-slate-800 p-3 font-mono" min="5" onChange={(e) => setMinutes(e.target.value)} type="number" value={minutes} /></label><button className="w-full rounded-xl bg-amber-300 px-4 py-3 font-bold text-slate-950" type="submit">Build my plan</button></form><section className="rounded-2xl border border-sky-400/20 bg-slate-900 p-5"><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Plan items</h2><button className="text-sm text-sky-300 underline" onClick={downloadCalendar} type="button">Add to calendar (.ics)</button></div>{items.map((item, index) => <div className="flex justify-between border-t border-slate-700 py-3 text-sm" key={`${item.date}-${index}`}><span>{item.lesson}</span><span className="font-mono text-amber-200">{item.date} · {item.minutes}m</span></div>)}</section></div></main>;
}
