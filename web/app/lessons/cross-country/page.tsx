"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wilco } from "../../components/Wilco";
import { serverBaseUrl } from "../../lib/api";

type Mood = "happy" | "grumpy" | "headset" | "salute";
type Quiz = { question: string; choices: string[]; answer: number; explanation: string };
type Step = {
  title: string;
  cfiText: string;
  x: number;
  y: number;
  highlight: string;
  radio?: Quiz;
  detail?: string;
};

const steps: Step[] = [
  { title: "Preflight brief", cfiText: "We will check weather, fuel, and our route before we ever key the mic.", x: 10, y: 78, highlight: "Brief: weather · fuel · route", detail: "VFR · 4,500 ft · 32 nm" },
  { title: 'Get ATIS "Alpha"', cfiText: "Start with the information broadcast. Listen for runway, wind, and the Alpha code.", x: 15, y: 69, highlight: "KSQK ATIS 127.65", radio: { question: "Which call gets the ATIS?", choices: ["Squawk Regional traffic, Cessna 123SQ, information Alpha.", "Squawk Regional, taxi to runway 27, Cessna 123SQ.", "Cessna 123SQ, information Bravo."], answer: 0, explanation: "Include the facility, your callsign, and the information letter." } },
  { title: "Call ground for taxi", cfiText: "Ground needs your callsign, position, information Alpha, and your request.", x: 21, y: 62, highlight: "Ground 121.9", radio: { question: "Choose the complete taxi call.", choices: ["Squawk Ground, Cessna one two three Sierra Quebec, at the ramp, Alpha, taxi for departure.", "Taxi for departure, at the ramp, Alpha.", "Squawk Ground, Cessna one two three Sierra Quebec, runway 27 cleared for takeoff."], answer: 0, explanation: "A taxi request is not a takeoff clearance, and your callsign must be present." } },
  { title: "Takeoff clearance", cfiText: "Read back the runway and callsign. Never launch on a taxi instruction.", x: 28, y: 54, highlight: "KSQK Tower 118.5", radio: { question: "Tower says runway 27 cleared for takeoff. Your readback?", choices: ["Cleared for takeoff runway 27, Cessna one two three Sierra Quebec.", "Cleared to land runway 27, Cessna one two three Sierra Quebec.", "Cleared for takeoff, runway 27."], answer: 0, explanation: "Read back the clearance and finish with your callsign." } },
  { title: "Call departure for flight following", cfiText: "Once airborne, contact departure with your callsign, altitude, and request.", x: 36, y: 45, highlight: "Departure 124.35", radio: { question: "What belongs in the departure call?", choices: ["Departure, Cessna one two three Sierra Quebec, 2,500 climbing 4,500, request flight following.", "Departure, Cessna one two three Sierra Quebec, landing runway 27.", "Flight following, 2,500."], answer: 0, explanation: "Give the controller enough context: callsign, altitude, and request." } },
  { title: "Checkpoint 1", cfiText: "At Lake Carnegie, make a time and fuel check. Good pilots notice trends early.", x: 48, y: 38, highlight: "Lake Carnegie · 12 min · 32 gal", detail: "Heading 090° · 4,500 ft · ETE 12 min" },
  { title: "Checkpoint 2", cfiText: "The wind is pushing us south. Correct heading ten degrees right and keep checking your track.", x: 61, y: 31, highlight: "Route 1 water tower · +10° correction", detail: "Heading 100° · 4,500 ft · ETE 9 min" },
  { title: "Position report", cfiText: "A concise position report tells the next controller where you are and where you are going.", x: 68, y: 27, highlight: "SQK VOR · position report", radio: { question: "Pick the useful position report.", choices: ["Pine Valley traffic, Cessna one two three Sierra Quebec, 10 miles west, 4,500, inbound Pine Valley.", "Hello tower, we are somewhere west.", "Cessna 123SQ, at the VOR."], answer: 0, explanation: "State callsign, position, altitude, and intentions." } },
  { title: "Get destination ATIS", cfiText: "Tune the destination broadcast and collect the runway and weather picture before calling tower.", x: 76, y: 21, highlight: "KPVL ATIS 128.25", radio: { question: "What information should you report?", choices: ["Pine Valley information Charlie, Cessna one two three Sierra Quebec, 10 miles west.", "KPVL, runway 27 cleared for takeoff.", "Information Alpha, departing Squawk Regional."], answer: 0, explanation: "Use the current letter and your callsign; do not invent a clearance." } },
  { title: "Call Pine Valley tower inbound", cfiText: "Tower wants a full inbound call: callsign, location, altitude, ATIS, and your landing request.", x: 83, y: 27, highlight: "KPVL Tower 119.1", radio: { question: "Which inbound call is complete?", choices: ["Pine Valley Tower, Cessna one two three Sierra Quebec, 10 miles west, 4,500, with Charlie, landing.", "Pine Valley, Cessna 123SQ.", "Tower, inbound runway 27."], answer: 0, explanation: "Include location, altitude, ATIS, and your intention to land." } },
  { title: "Enter left downwind runway 27", cfiText: "Fly the pattern you were given. Announce the leg and keep your eyes outside.", x: 90, y: 38, highlight: "Left downwind · runway 27", radio: { question: "Your downwind report?", choices: ["Pine Valley Tower, Cessna one two three Sierra Quebec, left downwind runway 27.", "Pine Valley Tower, Cessna one two three Sierra Quebec, final runway 27.", "Left downwind, runway 27."], answer: 0, explanation: "Name the leg and runway with your callsign." } },
  { title: "Land and taxi clear", cfiText: "After landing, keep the runway clear before switching. Nice work on the cross-country.", x: 94, y: 51, highlight: "Clear runway 27 · taxi clear", radio: { question: "What is the safe after-landing call?", choices: ["Pine Valley Tower, Cessna one two three Sierra Quebec, clear of runway 27.", "Cessna 123SQ, landed.", "Squawk Ground, cleared for takeoff runway 27."], answer: 0, explanation: "Tell tower when you are clear of the runway, then wait for taxi instructions." } },
];

// 10 ms of silence: played on the "Start lesson" click to unlock audio playback.
const SILENT_WAV = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const routePoints = steps.map(({ x, y }) => `${x},${y}`).join(" ");

export default function CrossCountryPage() {
  const [current, setCurrent] = useState(0);
  const [mood, setMood] = useState<Mood>("headset");
  const [muted, setMuted] = useState(false);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [xp, setXp] = useState(0);
  const [finished, setFinished] = useState(false);
  const [started, setStarted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const step = steps[current];
  const progress = Math.round((current / (steps.length - 1)) * 100);
  const isCorrect = quizChoice === step.radio?.answer;

  // Stop whatever the CFI is saying: in-flight /tts request, ElevenLabs clip, or browser speech.
  const stopVoice = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    audioRef.current?.pause();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speakWithBrowser = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }, []);

  // ElevenLabs CFI voice via POST /tts; falls back to speechSynthesis on error or 204.
  const speak = useCallback(async (text: string) => {
    stopVoice();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${serverBaseUrl}/tts`, {
        body: JSON.stringify({ text, voice: "cfi" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      if (response.status !== 200) throw new Error(`TTS unavailable (${response.status})`);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.setAttribute("src", url); // reuse the element unlocked by "Start lesson"
      await audio.play();
    } catch (error) {
      if (controller.signal.aborted) return; // moved to another step or muted
      console.warn("[cfi] ElevenLabs voice unavailable, using browser speech", error);
      speakWithBrowser(text);
    }
  }, [speakWithBrowser, stopVoice]);

  // Speak each step once the lesson has started; stop the clip when the step changes or on mute.
  useEffect(() => {
    if (!started || muted) return;
    void speak(step.cfiText);
    return stopVoice;
  }, [muted, speak, started, step.cfiText, stopVoice]);

  function startLesson() {
    // Runs inside the click, so the browser allows audio for the rest of the lesson.
    const audio = new Audio(SILENT_WAV);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
    if ("speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    setStarted(true);
  }

  const frequencies = useMemo(() => [
    ["KSQK ATIS", "127.65"], ["Ground", "121.9"], ["Tower", "118.5"], ["Departure", "124.35"], ["KPVL ATIS", "128.25"], ["KPVL Tower", "119.1"],
  ], []);

  function choose(index: number) {
    setQuizChoice(index);
    if (index === step.radio?.answer) {
      setMood("happy");
      setXp((value) => value + 10);
    } else setMood("grumpy");
  }

  function nextStep() {
    if (step.radio && quizChoice !== step.radio.answer) return;
    if (current === steps.length - 1) { setFinished(true); setMood("salute"); return; }
    setQuizChoice(null);
    setMood("headset");
    setCurrent((value) => value + 1);
  }

  return <main className="min-h-screen bg-slate-950 p-3 text-slate-100 sm:p-6"><div className="mx-auto max-w-7xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><Link className="text-sm text-sky-300 underline" href="/">← The Hangar</Link><h1 className="mt-2 text-3xl font-black text-sky-100">Cross-country: KSQK → KPVL</h1><p className="font-mono text-xs text-slate-400">Cessna one two three Sierra Quebec · {progress}% complete</p></div><button className="rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-200" onClick={() => setMuted(!muted)} type="button">{muted ? "🔇 CFI muted" : "🔊 CFI speaking"}</button></header>
    <div className="grid gap-4 lg:grid-cols-[1.35fr_.8fr]">
      <section className="rounded-2xl border border-sky-400/30 bg-slate-900 p-2 sm:p-4"><svg aria-label="Cross-country route map" className="h-auto w-full rounded-xl bg-sky-950" role="img" viewBox="0 0 100 100"><path d="M0 20C20 8 32 23 48 12S73 18 100 5V100H0Z" fill="#0c4a6e" opacity=".35"/><path d="M0 75C20 68 22 86 42 78S74 83 100 68" fill="none" stroke="#38bdf8" strokeDasharray="1 3" strokeWidth=".7"/><polyline fill="none" points={routePoints} stroke="#fbbf24" strokeDasharray="2 1" strokeWidth="1.2"/>{steps.map((item, index) => <g key={item.title}><circle cx={item.x} cy={item.y} fill={index <= current ? "#86efac" : "#fbbf24"} r={index === current ? 2.4 : 1.5} stroke="#082f49" strokeWidth=".5"/>{[0, 5, 6, 7, 11].includes(index) && <text fill="#e0f2fe" fontSize="3" x={item.x + 2} y={item.y - 2}>{index === 0 ? "KSQK" : index === 5 ? "Lake Carnegie" : index === 6 ? "Route 1 tower" : index === 7 ? "SQK VOR" : "KPVL"}</text>}</g>)}<g transform={`translate(${step.x - 2} ${step.y - 5})`}><path d="M2 0L4 7L2 6L0 7Z" fill="#f8fafc" stroke="#fbbf24" strokeWidth=".5"/></g><text fill="#94a3b8" fontSize="3" x="4" y="96">SQUAWK REGIONAL</text><text fill="#94a3b8" fontSize="3" x="74" y="96">PINE VALLEY</text></svg><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-green-300 transition-all" style={{ width: `${progress}%` }} /></div></section>
      <aside className="space-y-3 rounded-2xl border border-amber-300/30 bg-slate-900 p-4"><div className="flex items-start gap-3"><Wilco mood={finished ? "salute" : mood} size={72} /><div className="rounded-xl rounded-tl-none bg-sky-950 p-3 text-sm text-sky-100"><strong>AI CFI:</strong> {finished ? "You completed the cross-country. Wilco!" : step.cfiText}</div></div><div className="rounded-xl border border-sky-400/20 bg-slate-950 p-3"><p className="font-mono text-xs uppercase text-sky-300">Kneeboard · N123SQ</p><div className="mt-2 space-y-1 text-xs">{frequencies.map(([name, frequency]) => <div className="flex justify-between font-mono" key={name}><span className="text-slate-400">{name}</span><span className="text-amber-200">{frequency}</span></div>)}</div></div><div className="rounded-xl border border-sky-400/20 bg-slate-950 p-3"><p className="font-mono text-xs uppercase text-sky-300">Checkpoints</p><p className="mt-2 text-xs text-slate-300">Lake Carnegie · 090° · 4,500 ft · 12 min</p><p className="mt-1 text-xs text-slate-300">Route 1 tower · 100° · 4,500 ft · 9 min</p><p className="mt-1 text-xs text-slate-300">SQK VOR · 100° · 4,500 ft · 6 min</p></div><div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3"><p className="font-mono text-xs uppercase text-amber-200">Current step {current + 1} / {steps.length}</p><p className="mt-1 font-bold text-amber-50">{step.title}</p><p className="mt-1 text-sm text-amber-100">{step.highlight}</p>{step.detail && <p className="mt-1 font-mono text-xs text-slate-300">{step.detail}</p>}</div></aside>
    </div>
    {step.radio && !finished && <section className="rounded-2xl border border-sky-400/30 bg-slate-900 p-4"><p className="font-bold text-sky-100">{step.radio.question}</p><div className="mt-3 grid gap-2">{step.radio.choices.map((choice, index) => <button className={`rounded-lg border p-3 text-left text-sm ${quizChoice === index ? index === step.radio?.answer ? "border-green-300 bg-green-300/15 text-green-100" : "border-red-300 bg-red-300/10 text-red-100" : "border-slate-700 bg-slate-800 text-slate-200"}`} key={choice} onClick={() => choose(index)} type="button">{choice}</button>)}</div>{quizChoice !== null && <p className={`mt-3 text-sm ${isCorrect ? "text-green-300" : "text-amber-200"}`}>{isCorrect ? "Correct — +10 XP. Wilco!" : step.radio.explanation}</p>}</section>}
    {finished ? <section className="rounded-2xl border border-green-300/40 bg-green-300/10 p-6 text-center"><Wilco mood="salute" size={110} /><h2 className="text-3xl font-black text-green-100">Cross-country complete!</h2><p className="mt-2 font-mono text-amber-200">Total XP: {xp}</p><Link className="mt-5 inline-block rounded-xl bg-amber-300 px-6 py-3 font-bold text-slate-950" href="/fly">Fly it for real →</Link></section> : !started ? <button className="w-full rounded-xl bg-amber-300 px-5 py-4 text-lg font-black text-slate-950 shadow-lg shadow-amber-300/20" onClick={startLesson} type="button">▶ Start lesson</button> : <button className="w-full rounded-xl bg-sky-400 px-5 py-4 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40" disabled={Boolean(step.radio && quizChoice !== step.radio.answer)} onClick={nextStep} type="button">{current === steps.length - 1 ? "Finish flight" : "Next step →"}</button>}
  </div></main>;
}
