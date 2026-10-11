"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { diffCalls, type DiffWord } from "../wordDiff";

type Call = {
  id: string;
  speaker: string;
  phase: string;
  transcript: string;
  expectedCall: string;
  score: number | null;
  issues: string[];
  tip?: string;
  createdAt: string;
};
type Highlight = { id: string; phase: string; score: number; transcript: string; tip: string } | null;
type Debrief = {
  sessionId: string;
  averageScore: number;
  bestCall?: Highlight;
  needsWork?: Highlight;
  transmissions: Call[];
  cfiAlerts: { id: string; transmissionId: string; phase: string; text: string; createdAt: string }[];
};

const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";

const scoreColor = (score: number) => (score >= 85 ? "text-[#3FB27F]" : score >= 70 ? "text-[#F5B83D]" : "text-red-400");

function Words({ words, missColor }: { words: DiffWord[]; missColor: string }) {
  return (
    <p className="leading-relaxed">
      {words.map((item, index) => (
        <span key={index}>
          <span className={item.ok ? "text-slate-200" : `${missColor} font-bold underline decoration-2 underline-offset-4`}>{item.word}</span>{" "}
        </span>
      ))}
    </p>
  );
}

function CallCard({ call, index }: { call: Call; index: number }) {
  const diff = diffCalls(call.transcript, call.expectedCall);
  const score = call.score ?? 0;
  return (
    <article className="rounded border border-[#29466B] bg-[#10203A] p-4">
      <div className="flex items-center justify-between font-mono text-xs tracking-widest text-slate-500">
        <span>CALL {index + 1} · {call.phase.toUpperCase()}</span>
        <span className={`text-lg font-bold ${scoreColor(score)}`}>{score}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-[#29466B] bg-black/40 p-3">
          <p className="mb-1 font-mono text-[10px] tracking-[0.25em] text-slate-500">YOU SAID</p>
          <Words words={diff.said} missColor="text-red-400 decoration-red-400" />
        </div>
        <div className="rounded border border-[#3FB27F]/25 bg-black/40 p-3">
          <p className="mb-1 font-mono text-[10px] tracking-[0.25em] text-[#3FB27F]">CORRECT CALL</p>
          <Words words={diff.correct} missColor="text-[#F5B83D] decoration-[#F5B83D]" />
        </div>
      </div>
      {call.issues.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-[#F5B83D]">{call.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      )}
      {call.tip && <p className="mt-3 text-sm text-sky-200"><span className="font-mono font-bold text-[#F5B83D]">CFI TIP · </span>{call.tip}</p>}
    </article>
  );
}

function SummaryCard({ label, call, tone }: { label: string; call: Highlight | undefined; tone: string }) {
  return (
    <div className={`rounded border bg-[#10203A] p-3 ${tone}`}>
      <p className="font-mono text-[10px] tracking-[0.25em]">{label}</p>
      {call ? (
        <>
          <p className="mt-1 font-mono text-sm text-slate-400">{call.phase.toUpperCase()} · <span className={scoreColor(call.score)}>{call.score}</span></p>
          <p className="mt-1 line-clamp-2 text-sm text-slate-200">&ldquo;{call.transcript}&rdquo;</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Nothing here: keep flying!</p>
      )}
    </div>
  );
}

export default function DebriefPage() {
  const [sessionId, setSessionId] = useState("");
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const currentSessionId = decodeURIComponent(window.location.pathname.split("/").pop() || "DEMO");
    Promise.resolve(currentSessionId).then(setSessionId);
    fetch(`${serverBaseUrl}/debrief/${encodeURIComponent(currentSessionId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load debrief (${response.status})`);
        return (await response.json()) as Debrief;
      })
      .then(setDebrief)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load debrief."));
  }, []);

  const pilotCalls = debrief?.transmissions.filter((call) => call.speaker === "pilot" && call.expectedCall) ?? [];

  return (
    <main className="min-h-screen bg-[#0B1526] p-4 text-slate-100 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="rounded border border-[#29466B] bg-[#10203A] p-5">
          <p className="font-mono text-xs tracking-widest text-slate-500">SESSION {sessionId || "..."} · N123SQ</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-3xl font-bold text-[#F5B83D]">Flight debrief</h1>
            {debrief && (
              <p className="font-mono">
                <span className="mr-2 text-xs tracking-widest text-slate-500">OVERALL</span>
                <span className={`text-4xl font-bold ${scoreColor(debrief.averageScore)}`}>{debrief.averageScore}</span>
                <span className="text-slate-500">/100</span>
              </p>
            )}
          </div>
          {debrief && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SummaryCard label="BEST CALL" call={debrief.bestCall} tone="border-[#3FB27F]/40 text-[#3FB27F]" />
              <SummaryCard label="NEEDS WORK" call={debrief.needsWork} tone="border-[#F5B83D]/40 text-[#F5B83D]" />
            </div>
          )}
          <p className="mt-4 font-mono text-[11px] text-slate-500">
            <span className="font-bold text-red-400 underline">red</span> = wrong or extra words you said ·{" "}
            <span className="font-bold text-[#F5B83D] underline">amber</span> = words missing from your call
          </p>
        </header>

        {error && <div className="rounded border border-red-400/50 bg-red-500/10 p-4 text-red-200">{error}</div>}
        {debrief?.cfiAlerts.map((alert) => (
          <div key={alert.id} className="rounded border border-[#F5B83D]/50 bg-[#F5B83D]/10 p-4 text-[#E6EDF5]">
            <strong className="font-mono text-[#F5B83D]">CFI ({alert.phase}):</strong> {alert.text}
          </div>
        ))}
        {debrief && pilotCalls.length === 0 && <p className="text-center text-sm text-slate-500">No pilot calls in this session yet.</p>}
        {pilotCalls.map((call, index) => <CallCard key={call.id} call={call} index={index} />)}

        <Link href={sessionId ? `/fly?session=${encodeURIComponent(sessionId)}` : "/fly"} className="block rounded border border-[#F5B83D]/40 px-4 py-3 text-center font-mono font-bold tracking-widest text-[#F5B83D]">BACK TO FLIGHT DECK</Link>
        <footer className="text-center text-xs text-slate-600">Practice tool only. Not a substitute for flight instruction.</footer>
      </div>
    </main>
  );
}
