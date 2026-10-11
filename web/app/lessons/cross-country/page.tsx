"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wilco } from "../../components/Wilco";

type Mood = "happy" | "grumpy" | "headset" | "salute";
type Quiz = { question: string; choices: string[]; answer: number; explanation: string };
type Step = { title: string; cfiText: string; x: number; y: number; highlight: string; detail?: string; radio?: Quiz };

const steps: Step[] = [
  { title: "Preflight brief", cfiText: "We will check weather, fuel, and our route before we key the mic.", x: 9, y: 76, highlight: "Weather · fuel · route", detail: "VFR · 4,500 ft · 32 nm" },
  { title: 'Get ATIS "Alpha"', cfiText: "Listen for runway, wind, and the Alpha code before calling ground.", x: 16, y: 67, highlight: "KSQK ATIS 127.65", radio: { question: "Which call gets the ATIS?", choices: ["Squawk Regional, Cessna one two three Sierra Quebec, information Alpha.", "Squawk Regional, taxi to runway 27.", "Cessna one two three Sierra Quebec, information Bravo."], answer: 0, explanation: "Include the facility, your callsign, and the information letter." } },
  { title: "Call ground for taxi", cfiText: "Ground needs your callsign, position, information Alpha, and request.", x: 23, y: 59, highlight: "Ground 121.9", radio: { question: "Choose the complete taxi call.", choices: ["Squawk Ground, Cessna one two three Sierra Quebec, at the ramp, Alpha, taxi for departure.", "Taxi for departure, at the ramp, Alpha.", "Squawk Ground, runway 27 cleared for takeoff."], answer: 0, explanation: "A taxi request needs your callsign and is not a takeoff clearance." } },
  { title: "Takeoff clearance", cfiText: "Read back the runway and callsign. Never launch on a taxi instruction.", x: 30, y: 51, highlight: "KSQK Tower 118.5", radio: { question: "Tower says runway 27 cleared for takeoff. Your readback?", choices: ["Cleared for takeoff runway 27, Cessna one two three Sierra Quebec.", "Cleared to land runway 27.", "Cleared for takeoff, runway 27."], answer: 0, explanation: "Read back the clearance and finish with your callsign." } },
  { title: "Call departure for flight following", cfiText: "Once airborne, give departure your callsign, altitude, and request.", x: 39, y: 42, highlight: "Departure 124.35", radio: { question: "What belongs in the departure call?", choices: ["Departure, Cessna one two three Sierra Quebec, 2,500 climbing 4,500, request flight following.", "Departure, Cessna one two three Sierra Quebec, landing runway 27.", "Flight following, 2,500."], answer: 0, explanation: "Give callsign, altitude, and request so the controller has context." } },
  { title: "Checkpoint 1", cfiText: "At Lake Carnegie, make a time and fuel check. Notice trends early.", x: 50, y: 35, highlight: "Lake Carnegie · time and fuel", detail: "Heading 090° · 4,500 ft · ETE 12 min" },
  { title: "Checkpoint 2", cfiText: "The wind is pushing us south. Correct heading ten degrees right and check your track.", x: 63, y: 28, highlight: "Route 1 water tower · +10°", detail: "Heading 100° · 4,500 ft · ETE 9 min" },
  { title: "Position report", cfiText: "A concise position report tells the next controller where you are and where you are going.", x: 70, y: 24, highlight: "SQK VOR · position report", radio: { question: "Pick the useful position report.", choices: ["Pine Valley traffic, Cessna one two three Sierra Quebec, 10 miles west, 4,500, inbound.", "Hello tower, we are somewhere west.", "Cessna one two three Sierra Quebec, at the VOR."], answer: 0, explanation: "State callsign, position, altitude, and intentions." } },
  { title: "Get destination ATIS", cfiText: "Tune the destination broadcast before calling tower.", x: 78, y: 19, highlight: "KPVL ATIS 128.25", radio: { question: "What information should you report?", choices: ["Pine Valley information Charlie, Cessna one two three Sierra Quebec, 10 miles west.", "KPVL, runway 27 cleared for takeoff.", "Information Alpha, departing Squawk Regional."], answer: 0, explanation: "Use the current letter and your callsign." } },
  { title: "Call Pine Valley tower inbound", cfiText: "Tower wants callsign, location, altitude, ATIS, and landing request.", x: 85, y: 26, highlight: "KPVL Tower 119.1", radio: { question: "Which inbound call is complete?", choices: ["Pine Valley Tower, Cessna one two three Sierra Quebec, 10 miles west, 4,500, with Charlie, landing.", "Pine Valley, Cessna one two three Sierra Quebec.", "Tower, inbound runway 27."], answer: 0, explanation: "Include location, altitude, ATIS, and intention to land." } },
  { title: "Enter left downwind runway 27", cfiText: "Fly the assigned pattern and announce the leg with your callsign.", x: 91, y: 37, highlight: "Left downwind · runway 27", radio: { question: "Your downwind report?", choices: ["Pine Valley Tower, Cessna one two three Sierra Quebec, left downwind runway 27.", "Pine Valley Tower, Cessna one two three Sierra Quebec, final runway 27.", "Left downwind, runway 27."], answer: 0, explanation: "Name the leg and runway with your callsign." } },
  { title: "Land and taxi clear", cfiText: "After landing, clear the runway before switching. Nice work.", x: 95, y: 50, highlight: "Clear runway 27 · taxi clear", radio: { question: "What is the safe after-landing call?", choices: ["Pine Valley Tower, Cessna one two three Sierra Quebec, clear of runway 27.", "Cessna one two three Sierra Quebec, landed.", "Squawk Ground, cleared for takeoff runway 27."], answer: 0, explanation: "Tell tower when you are clear of the runway." } },
];

export default function CrossCountryPage() {
  const [current, setCurrent] = useState(0);
  const [mood, setMood] = useState<Mood>("headset");
  const [muted, setMuted] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [xp, setXp] = useState(0);
  const [finished, setFinished] = useState(false);
  const step = steps[current];
  const points = steps.map((item) => `${item.x},${item.y}`).join(" ");
  const correct = choice === step.radio?.answer;

  useEffect(() => {
    if (muted || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(step.cfiText);
    speech.rate = 0.96;
    window.speechSynthesis.speak(speech);
  }, [current, muted, step.cfiText]);

  function answer(index: number) {
    setChoice(index);
    if (index === step.radio?.answer) {
      setMood("happy");
      setXp((value) => value + 10);
    } else setMood("grumpy");
  }

  function next() {
    if (step.radio && choice !== step.radio.answer) return;
    if (current === steps.length - 1) {
      setFinished(true);
      setMood("salute");
      return;
    }
    setChoice(null);
    setMood("headset");
    setCurrent((value) => value + 1);
  }

  return (
    <main className="min-h-screen bg-transparent px-3 py-6 text-[#E6EDF5] sm:px-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-[#4A9BD9]">Cross-country lesson</p><h1 className="mt-2 font-display text-3xl font-semibold">KSQK to KPVL</h1><p className="mt-1 break-words font-mono text-xs text-[#9FB2C8]">Cessna one two three Sierra Quebec · Step {current + 1} of {steps.length}</p></div>
          <button className="min-h-11 border border-[#29466B] px-3 py-2 text-sm text-[#E6EDF5] hover:border-[#F5B83D] hover:text-[#F5B83D]" onClick={() => setMuted((value) => !value)} type="button">{muted ? "CFI muted" : "Mute CFI"}</button>
        </header>
        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <section className="border border-[#29466B] bg-[#10203A] p-2 sm:p-4">
            <svg aria-label="Cross-country route map" className="h-auto w-full bg-[#0B1526]" role="img" viewBox="0 0 100 100">
              <path d="M0 20C20 8 32 23 48 12S73 18 100 5V100H0Z" fill="#10203A" />
              <path d="M0 75C20 68 22 86 42 78S74 83 100 68" fill="none" stroke="#29466B" strokeDasharray="1 3" strokeWidth=".7" />
              <polyline fill="none" points={points} stroke="#F5B83D" strokeDasharray="2 1" strokeWidth="1.2" />
              {steps.map((item, index) => <g key={item.title}><circle cx={item.x} cy={item.y} fill={index <= current ? "#3FB27F" : "#F5B83D"} r={index === current ? 2.4 : 1.4} stroke="#0B1526" strokeWidth=".5" />{[0, 5, 6, 7, 11].includes(index) && <text fill="#E6EDF5" fontSize="3" x={item.x + 2} y={item.y - 2}>{index === 0 ? "KSQK" : index === 5 ? "Lake Carnegie" : index === 6 ? "Route 1 tower" : index === 7 ? "SQK VOR" : "KPVL"}</text>}</g>)}
              <g transform={`translate(${step.x - 2} ${step.y - 5})`}><path d="M2 0L4 7L2 6L0 7Z" fill="#E6EDF5" stroke="#F5B83D" strokeWidth=".5" /></g>
            </svg>
            <div className="mt-3 h-1 bg-[#29466B]"><div className="h-full bg-[#3FB27F]" style={{ width: `${Math.round((current / (steps.length - 1)) * 100)}%` }} /></div>
          </section>
          <aside className="space-y-3 border border-[#29466B] bg-[#10203A] p-4">
            <div className="flex items-start gap-3"><Wilco mood={finished ? "salute" : mood} size={68} /><p className="min-w-0 flex-1 border border-[#29466B] bg-[#0B1526] p-3 text-sm text-[#E6EDF5]"><span className="font-semibold text-[#4A9BD9]">AI CFI:</span> {finished ? "You completed the cross-country. Wilco!" : step.cfiText}</p></div>
            <div className="border border-[#29466B] bg-[#0B1526] p-3"><p className="font-mono text-xs uppercase text-[#4A9BD9]">Kneeboard · N123SQ</p><div className="mt-2 space-y-1 text-xs">{[["KSQK ATIS", "127.65"], ["Ground", "121.9"], ["Tower", "118.5"], ["Departure", "124.35"], ["KPVL ATIS", "128.25"], ["KPVL Tower", "119.1"]].map(([name, frequency]) => <div className="flex justify-between gap-2 font-mono" key={name}><span className="text-[#9FB2C8]">{name}</span><span className="text-[#F5B83D]">{frequency}</span></div>)}</div></div>
            <div className="border border-[#29466B] bg-[#0B1526] p-3 text-xs text-[#9FB2C8]"><p className="font-mono uppercase text-[#4A9BD9]">Checkpoints</p><p className="mt-2">Lake Carnegie · 090° · 4,500 ft · 12 min</p><p className="mt-1">Route 1 water tower · 100° · 4,500 ft · 9 min</p><p className="mt-1">SQK VOR · 100° · 4,500 ft · 6 min</p></div>
            <div className="border border-[#F5B83D] bg-[#10203A] p-3"><p className="font-mono text-xs uppercase text-[#F5B83D]">Your call</p><p className="mt-1 break-words font-semibold">{step.title}</p><p className="mt-1 break-words text-sm text-[#9FB2C8]">{step.highlight}</p>{step.detail && <p className="mt-1 break-words font-mono text-xs text-[#E6EDF5]">{step.detail}</p>}</div>
          </aside>
        </div>
        {step.radio && !finished && <section className="border border-[#29466B] bg-[#10203A] p-4"><p className="font-semibold text-[#E6EDF5]">{step.radio.question}</p><div className="mt-3 grid gap-2">{step.radio.choices.map((text, index) => <button className={`min-h-11 border p-3 text-left text-sm ${choice === index ? index === step.radio?.answer ? "border-[#3FB27F] text-[#3FB27F]" : "border-[#D64545] text-[#D64545]" : "border-[#29466B] text-[#E6EDF5] hover:border-[#F5B83D]"}`} key={text} onClick={() => answer(index)} type="button">{text}</button>)}</div>{choice !== null && <p className={`mt-3 text-sm ${correct ? "text-[#3FB27F]" : "text-[#D64545]"}`}>{correct ? "Correct. Plus 10 XP." : step.radio.explanation}</p>}</section>}
        {finished ? <section className="border border-[#3FB27F] bg-[#10203A] p-6 text-center"><Wilco mood="salute" size={100} /><h2 className="font-display text-3xl font-semibold text-[#3FB27F]">Cross-country complete</h2><p className="mt-2 font-mono text-[#F5B83D]">Total XP: {xp}</p><Link className="mt-5 inline-flex min-h-11 items-center border border-[#F5B83D] bg-[#F5B83D] px-6 py-3 font-semibold text-[#0B1526] hover:bg-[#E6A92D]" href="/fly">Fly it for real</Link></section> : <button className="min-h-11 w-full border border-[#4A9BD9] bg-[#4A9BD9] px-5 py-3 font-semibold text-[#0B1526] hover:bg-[#3988C4] disabled:cursor-not-allowed disabled:opacity-40" disabled={Boolean(step.radio && choice !== step.radio.answer)} onClick={next} type="button">{current === steps.length - 1 ? "Finish flight" : "Next step"}</button>}
      </div>
    </main>
  );
}
