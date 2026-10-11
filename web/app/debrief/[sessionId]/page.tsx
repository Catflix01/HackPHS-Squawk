"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Debrief = {
  sessionId: string;
  averageScore: number;
  transmissions: Array<{
    id: string;
    speaker: string;
    phase: string;
    transcript: string;
    expectedCall: string;
    score: number | null;
    issues: string[];
    createdAt: string;
  }>;
  cfiAlerts: { id: string; transmissionId: string; phase: string; text: string; createdAt: string }[];
};

const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";

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

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-2xl border border-sky-400/30 bg-slate-900 p-5">
          <p className="font-mono text-sm text-sky-300">SESSION {sessionId || "..."}</p>
          <h1 className="mt-1 text-3xl font-bold text-sky-100">Flight debrief</h1>
          {debrief && <p className="mt-3 font-mono text-2xl text-green-300">Average score: {debrief.averageScore}</p>}
        </header>
        {error && <div className="rounded-xl border border-red-400/50 bg-red-500/10 p-4 text-red-200">{error}</div>}
        {debrief?.cfiAlerts.map((alert) => <div key={alert.id} className="rounded-xl border border-amber-300/50 bg-amber-300/10 p-4 text-amber-100"><strong>CFI ({alert.phase}):</strong> {alert.text}</div>)}
        {debrief?.transmissions.map((call) => (
          <article key={call.id} className="rounded-2xl border border-sky-400/20 bg-slate-900 p-4">
            <div className="flex flex-wrap justify-between gap-2 text-xs font-mono text-slate-400"><span>{call.speaker.toUpperCase()} · {call.phase}</span>{typeof call.score === "number" && <span className={call.score >= 80 ? "text-green-300" : "text-amber-300"}>Score {call.score}</span>}</div>
            <p className="mt-3 text-lg">{call.transcript}</p>
            {call.expectedCall && <p className="mt-2 text-sm text-sky-200">Expected: {call.expectedCall}</p>}
            {call.issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-amber-200">{call.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          </article>
        ))}
        <Link href={`/fly?session=${encodeURIComponent(sessionId)}`} className="block rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 py-3 text-center text-sky-100">Back to flight deck</Link>
        <footer className="text-center text-xs text-slate-500">Practice tool only. Not a substitute for flight instruction.</footer>
      </div>
    </main>
  );
}
