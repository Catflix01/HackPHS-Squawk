"use client";

import { useEffect, useRef, useState } from "react";

type FlightPhase = "taxi" | "takeoff" | "pattern" | "landing";

type TranscriptEntry = {
  speaker: "Pilot" | "ATC";
  text: string;
  score?: number;
};

type TransmitResponse = {
  transcript: string;
  atcReply: string;
  expectedCall: string;
  score: number;
  issues: string[];
  audioBase64: string;
};

const PHASES: FlightPhase[] = ["taxi", "takeoff", "pattern", "landing"];

const PHASE_GAIN: Record<FlightPhase, { engine: number; wind: number }> = {
  taxi: { engine: 0.2, wind: 0.08 },
  takeoff: { engine: 0.45, wind: 0.25 },
  pattern: { engine: 0.3, wind: 0.18 },
  landing: { engine: 0.25, wind: 0.14 },
};

const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";
const wsBaseUrl = serverBaseUrl.replace(/^http/i, "ws");

export default function FlyPage() {
  const [phase, setPhase] = useState<FlightPhase>("taxi");
  const [recording, setRecording] = useState(false);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [atcTalking, setAtcTalking] = useState(false);

  const [sessionId] = useState(
    () => process.env.NEXT_PUBLIC_DEFAULT_SESSION_ID || "demo-session"
  );

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const engineGainRef = useRef<GainNode | null>(null);
  const windGainRef = useRef<GainNode | null>(null);

  const startRecordingRef = useRef<() => Promise<void>>(async () => {});
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});

  function updateNoiseGains(targetPhase: FlightPhase, shouldDuck: boolean) {
    const multiplier = shouldDuck ? 0.35 : 1;
    const gains = PHASE_GAIN[targetPhase];
    if (engineGainRef.current) {
      engineGainRef.current.gain.value = gains.engine * multiplier;
    }
    if (windGainRef.current) {
      windGainRef.current.gain.value = gains.wind * multiplier;
    }
  }

  async function ensureNoiseBed() {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      return;
    }

    const context = new AudioContext();
    audioContextRef.current = context;

    const engineAudio = new Audio("/audio/engine.mp3");
    engineAudio.loop = true;
    engineAudio.crossOrigin = "anonymous";

    const windAudio = new Audio("/audio/wind.mp3");
    windAudio.loop = true;
    windAudio.crossOrigin = "anonymous";

    const engineSource = context.createMediaElementSource(engineAudio);
    const windSource = context.createMediaElementSource(windAudio);

    const engineGain = context.createGain();
    const windGain = context.createGain();

    engineGainRef.current = engineGain;
    windGainRef.current = windGain;

    engineSource.connect(engineGain).connect(context.destination);
    windSource.connect(windGain).connect(context.destination);

    updateNoiseGains(phase, atcTalking);
    await Promise.allSettled([engineAudio.play(), windAudio.play()]);
  }

  async function playAtcAudio(base64Audio: string) {
    if (!base64Audio) {
      return;
    }

    setAtcTalking(true);
    wsRef.current?.send(JSON.stringify({ type: "atc.talking", state: "started" }));

    const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
    audio.onended = () => {
      setAtcTalking(false);
      wsRef.current?.send(JSON.stringify({ type: "atc.talking", state: "stopped" }));
    };
    await audio.play();
  }

  async function startRecording() {
    if (recording || busy) {
      return;
    }

    await ensureNoiseBed();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.start();
    setRecording(true);
  }

  async function stopRecordingAndTransmit() {
    if (!recorderRef.current || !recording || busy) {
      return;
    }

    setBusy(true);
    const recorder = recorderRef.current;

    const dataPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
    });

    recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
    setRecording(false);

    try {
      const audioBlob = await dataPromise;
      const formData = new FormData();
      formData.append("audio", audioBlob, "pilot.webm");
      formData.append("sessionId", sessionId);
      formData.append("phase", phase);

      const response = await fetch(`${serverBaseUrl}/transmit`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("Transmit failed.");
      }

      const payload = (await response.json()) as TransmitResponse;
      setEntries((current) => [
        ...current,
        { speaker: "Pilot", text: payload.transcript },
        { speaker: "ATC", text: payload.atcReply, score: payload.score },
      ]);
      setIssues(payload.issues ?? []);
      await playAtcAudio(payload.audioBase64);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown error";
      setWarnings((current) => Array.from(new Set([...current, `Transmit failed: ${text}`])));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecordingAndTransmit;
  });

  useEffect(() => {
    updateNoiseGains(phase, atcTalking);
  }, [atcTalking, phase]);

  useEffect(() => {
    const detectedWarnings: string[] = [];
    if (!process.env.NEXT_PUBLIC_SERVER_URL) {
      detectedWarnings.push(
        "NEXT_PUBLIC_SERVER_URL is not set. Using http://localhost:8000 by default."
      );
    }

    fetch(`${serverBaseUrl}/health`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to reach server health endpoint.");
        }
        return response.json();
      })
      .then((payload) => {
        const missingEnv = Array.isArray(payload.missingEnv)
          ? payload.missingEnv
          : [];
        if (missingEnv.length > 0) {
          detectedWarnings.push(
            `Server env missing: ${missingEnv.join(", ")}. Transmit features will run in fallback mode.`
          );
        }
        setWarnings((current) => Array.from(new Set([...current, ...detectedWarnings])));
      })
      .catch(() => {
        detectedWarnings.push(
          "Server is unreachable. Start the FastAPI server before transmitting."
        );
        setWarnings((current) => Array.from(new Set([...current, ...detectedWarnings])));
      });

    Promise.all([
      fetch("/audio/engine.mp3", { method: "HEAD" }),
      fetch("/audio/wind.mp3", { method: "HEAD" }),
    ]).then(([engineRes, windRes]) => {
      const fileWarnings: string[] = [];
      if (!engineRes.ok) {
        fileWarnings.push(
          "engine.mp3 missing, add it to /web/public/audio/engine.mp3"
        );
      }
      if (!windRes.ok) {
        fileWarnings.push("wind.mp3 missing, add it to /web/public/audio/wind.mp3");
      }
      if (fileWarnings.length > 0) {
        setWarnings((current) => Array.from(new Set([...current, ...fileWarnings])));
      }
    });
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`${wsBaseUrl}/ws/session/${sessionId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.sender === "web") {
          return;
        }
        if (data.type === "ptt.down") {
          void startRecordingRef.current();
        }
        if (data.type === "ptt.up") {
          void stopRecordingRef.current();
        }
      } catch {
        // Ignore malformed websocket payloads to keep demo stable.
      }
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }
      event.preventDefault();
      wsRef.current?.send(JSON.stringify({ type: "ptt.down", sender: "web" }));
      void startRecordingRef.current();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      wsRef.current?.send(JSON.stringify({ type: "ptt.up", sender: "web" }));
      void stopRecordingRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-sky-400/30 bg-slate-900/80 p-4 shadow-2xl">
        <header className="flex items-center justify-between rounded-lg border border-sky-400/30 bg-slate-900 p-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-sky-300">Frequency</p>
            <p className="font-mono text-xl text-sky-200">TWR 118.5</p>
          </div>
          <p className="text-xs text-amber-300">Session: {sessionId.slice(0, 12)}</p>
        </header>

        {warnings.length > 0 && (
          <section className="rounded-lg border border-amber-400/50 bg-amber-500/10 p-3 text-sm text-amber-200">
            {warnings.map((warning) => (
              <p key={warning}>⚠ {warning}</p>
            ))}
          </section>
        )}

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PHASES.map((phaseName) => (
            <button
              key={phaseName}
              type="button"
              onClick={() => setPhase(phaseName)}
              className={`rounded-md border px-3 py-2 text-sm font-semibold capitalize transition ${
                phase === phaseName
                  ? "border-amber-300 bg-amber-300/20 text-amber-100"
                  : "border-sky-500/40 bg-slate-800 text-sky-200"
              }`}
            >
              {phaseName}
            </button>
          ))}
        </section>

        <button
          type="button"
          onMouseDown={() => {
            wsRef.current?.send(JSON.stringify({ type: "ptt.down", sender: "web" }));
            void startRecordingRef.current();
          }}
          onMouseUp={() => {
            wsRef.current?.send(JSON.stringify({ type: "ptt.up", sender: "web" }));
            void stopRecordingRef.current();
          }}
          onTouchStart={(event) => {
            event.preventDefault();
            wsRef.current?.send(JSON.stringify({ type: "ptt.down", sender: "web" }));
            void startRecordingRef.current();
          }}
          onTouchEnd={(event) => {
            event.preventDefault();
            wsRef.current?.send(JSON.stringify({ type: "ptt.up", sender: "web" }));
            void stopRecordingRef.current();
          }}
          className={`h-36 rounded-full border-4 text-lg font-bold uppercase transition ${
            recording
              ? "border-red-400 bg-red-500/30 text-red-100"
              : "border-sky-400 bg-sky-500/20 text-sky-100"
          }`}
        >
          {recording ? "Transmitting..." : "Hold to Talk"}
        </button>

        <section className="rounded-lg border border-sky-400/30 bg-slate-900 p-3">
          <h2 className="mb-2 text-sm uppercase tracking-wide text-sky-200">Radio Log</h2>
          <div className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {entries.length === 0 && (
              <p className="text-slate-400">
                Hold the button (or spacebar) to record your call. Pi PTT events also work
                over WebSocket.
              </p>
            )}
            {entries.map((entry, index) => (
              <div
                key={`${entry.speaker}-${index}`}
                className="rounded bg-slate-800/80 p-2 text-slate-100"
              >
                <p>
                  <span className="font-semibold text-sky-300">{entry.speaker}: </span>
                  {entry.text}
                </p>
                {typeof entry.score === "number" && (
                  <p className={`text-xs ${entry.score >= 80 ? "text-green-300" : "text-amber-300"}`}>
                    Score: {entry.score}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {issues.length > 0 && (
          <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            <h3 className="font-semibold">ATC Feedback</h3>
            <ul className="list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
