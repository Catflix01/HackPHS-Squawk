"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Role = "pilot" | "atc";
type FlightPhase = "taxi" | "takeoff" | "pattern" | "landing";
type Mode = "ai" | "human";
type Transmission = {
  id: string;
  speaker: "pilot" | "atc" | "ai_atc";
  phase: FlightPhase;
  transcript: string;
  expectedCall?: string;
  score?: number;
  issues: string[];
};
type ServerMessage = {
  type: string;
  phase?: FlightPhase;
  mode?: Mode;
  peers?: string[];
  freqHolder?: Role | null;
  holder?: Role;
  state?: "down" | "up" | "started" | "stopped";
  speaker?: Transmission["speaker"];
  id?: string;
  transcript?: string;
  expectedCall?: string;
  score?: number;
  issues?: string[];
  audioBase64?: string | null;
  mimeType?: string;
  text?: string;
};

const PHASES: FlightPhase[] = ["taxi", "takeoff", "pattern", "landing"];
const PHASE_GAIN: Record<FlightPhase, { engine: number; wind: number }> = {
  taxi: { engine: 0.4, wind: 0.3 },
  takeoff: { engine: 1.0, wind: 0.5 },
  pattern: { engine: 0.7, wind: 0.4 },
  landing: { engine: 0.5, wind: 0.3 },
};
const COCKPIT_AUDIO = "/audio/cockpit1.mp3";
const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";
const wsBaseUrl = serverBaseUrl.replace(/^http/i, "ws");

export default function FlyPage() {
  const [role, setRole] = useState<Role>("pilot");
  const [sessionId, setSessionId] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_SESSION_ID || "DEMO",
  );
  const [phase, setPhase] = useState<FlightPhase>("taxi");
  const [mode, setMode] = useState<Mode>("ai");
  const [peers, setPeers] = useState<string[]>([]);
  const [freqHolder, setFreqHolder] = useState<Role | null>(null);
  const [recording, setRecording] = useState(false);
  const [flightStarted, setFlightStarted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [entries, setEntries] = useState<Transmission[]>([]);
  const [cfiAlerts, setCfiAlerts] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busyFlash, setBusyFlash] = useState(false);
  const [awaitingTower, setAwaitingTower] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("audio/webm;codecs=opus");
  const pttPendingRef = useRef(false);
  const releasePendingRef = useRef(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressPttRef = useRef<() => void>(() => {});
  const releasePttRef = useRef<() => void>(() => {});
  const phaseRef = useRef(phase);
  const audioContextRef = useRef<AudioContext | null>(null);
  const engineGainRef = useRef<GainNode | null>(null);
  const windGainRef = useRef<GainNode | null>(null);
  const noiseAudioRef = useRef<HTMLAudioElement[]>([]);
  const playQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queueGenerationRef = useRef(0);
  const stopCurrentClipRef = useRef<(() => void) | null>(null);
  const playedIdsRef = useRef<Set<string>>(new Set());
  const receivingRef = useRef(false);
  const awaitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRole(params.get("role") === "atc" ? "atc" : "pilot");
    setSessionId(
      params.get("session") ||
        process.env.NEXT_PUBLIC_DEFAULT_SESSION_ID ||
        "DEMO",
    );
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const setNoiseGain = useCallback((nextPhase: FlightPhase, duck = false) => {
    const multiplier = duck ? 0.28 : 1;
    const gains = PHASE_GAIN[nextPhase];
    if (engineGainRef.current) engineGainRef.current.gain.value = gains.engine * multiplier;
    if (windGainRef.current) windGainRef.current.gain.value = gains.wind * multiplier;
  }, []);

  const startNoise = useCallback(async () => {
    if (role !== "pilot") return;
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    if (noiseAudioRef.current.length > 0) return;

    const cockpit = new Audio(COCKPIT_AUDIO);
    cockpit.loop = true;
    cockpit.crossOrigin = "anonymous";
    const cockpitGain = context.createGain();
    engineGainRef.current = cockpitGain;
    windGainRef.current = null;
    context.createMediaElementSource(cockpit).connect(cockpitGain).connect(context.destination);
    noiseAudioRef.current = [cockpit];
    setNoiseGain(phaseRef.current);
    await cockpit.play().catch(() => undefined);
  }, [role, setNoiseGain]);

  // Plays one clip. ALWAYS resolves (ended, error, play() rejected, stopped by PTT, or the
  // watchdog fires) so one bad clip can never block the clips queued behind it.
  const playClip = useCallback(
    (audioBase64: string, mimeType: string, label: string) =>
      new Promise<void>((resolve) => {
        let audio: HTMLAudioElement;
        try {
          audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
        } catch (error) {
          console.warn(`[radio] could not create audio for ${label}`, error);
          resolve();
          return;
        }
        let finished = false;
        let watchdog = setTimeout(() => {
          console.warn(`[radio] ${label} never finished loading/playing; skipping it`);
          finish();
        }, 30000);
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(watchdog);
          audio.onended = null;
          audio.onerror = null;
          audio.onloadedmetadata = null;
          audio.pause();
          if (stopCurrentClipRef.current === finish) stopCurrentClipRef.current = null;
          receivingRef.current = false;
          send({ type: "rx", state: "stopped" });
          setNoiseGain(phaseRef.current);
          resolve();
        };
        stopCurrentClipRef.current = finish;
        audio.onended = finish;
        audio.onerror = () => {
          console.warn(`[radio] ${label} failed to decode/play (${mimeType})`, audio.error);
          finish();
        };
        audio.onloadedmetadata = () => {
          if (!Number.isFinite(audio.duration)) return;
          clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            console.warn(`[radio] ${label} did not fire "ended"; moving on`);
            finish();
          }, (audio.duration + 3) * 1000);
        };
        receivingRef.current = true;
        setNoiseGain(phaseRef.current, true);
        send({ type: "rx", state: "started" });
        audio.play().catch((error: unknown) => {
          const name = error instanceof Error ? error.name : String(error);
          console.warn(`[radio] play() rejected for ${label}: ${name}`, error);
          if (name === "NotAllowedError") {
            setWarnings((current) => [
              ...new Set([...current, "The browser blocked radio audio. Click Start flight (or anywhere on the page) and try again."]),
            ]);
          }
          finish();
        });
      }),
    [send, setNoiseGain],
  );

  // Radio audio plays one clip at a time, in arrival order.
  const enqueueAudio = useCallback(
    (audioBase64: string | null | undefined, mimeType = "audio/mpeg", label = "clip") => {
      if (!audioBase64) {
        console.warn(`[radio] ${label} arrived without audio (server TTS failed or DEMO_MODE); showing text only`);
        return;
      }
      const generation = queueGenerationRef.current;
      playQueueRef.current = playQueueRef.current
        .then(async () => {
          if (generation !== queueGenerationRef.current) return; // queue was cleared by PTT
          const context = audioContextRef.current;
          if (context?.state === "suspended") await context.resume().catch(() => undefined);
          await playClip(audioBase64, mimeType, label);
        })
        .catch((error: unknown) => console.warn(`[radio] queue error for ${label}`, error));
    },
    [playClip],
  );

  const stopPlayback = useCallback(() => {
    queueGenerationRef.current += 1;
    stopCurrentClipRef.current?.();
  }, []);

  const startRecording = useCallback(async () => {
    if (!streamRef.current || recording || releasePendingRef.current) return;
    const recorder = new MediaRecorder(streamRef.current, { mimeType: mimeTypeRef.current });
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start();
    setRecording(true);
  }, [recording]);

  const stopAndTransmit = useCallback(async () => {
    if (!recorderRef.current || recorderRef.current.state === "inactive") return;
    const recorder = recorderRef.current;
    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunksRef.current, { type: mimeTypeRef.current }));
      recorder.stop();
    });
    recorderRef.current = null;
    setRecording(false);
    const formData = new FormData();
    formData.append("audio", audioBlob, role === "pilot" ? "pilot.webm" : "atc.webm");
    formData.append("sessionId", sessionId);
    formData.append("role", role);
    formData.append("phase", phaseRef.current);
    try {
      const response = await fetch(`${serverBaseUrl}/transmit`, { method: "POST", body: formData });
      if (!response.ok) throw new Error(`Transmit failed (${response.status})`);
      if (role === "pilot" && mode === "ai") {
        // The tower may legitimately stay silent (correct readback), so never spin forever.
        setAwaitingTower(true);
        if (awaitingTimerRef.current) clearTimeout(awaitingTimerRef.current);
        awaitingTimerRef.current = setTimeout(() => setAwaitingTower(false), 10000);
      }
    } catch (error) {
      setWarnings((current) => [
        ...new Set([...current, error instanceof Error ? error.message : "Transmit failed."]),
      ]);
    }
  }, [mode, role, sessionId]);

  const pressPtt = useCallback(() => {
    if (!flightStarted || freqHolder && freqHolder !== role || pttPendingRef.current || recording) return;
    stopPlayback(); // talking cuts off (and drops) any queued radio audio
    pttPendingRef.current = true;
    releasePendingRef.current = false;
    send({ type: "ptt.down" });
    startTimerRef.current = setTimeout(() => {
      if (pttPendingRef.current && !releasePendingRef.current) void startRecording();
    }, 120);
  }, [flightStarted, freqHolder, recording, role, send, startRecording, stopPlayback]);

  const releasePtt = useCallback(() => {
    if (!pttPendingRef.current && !recording) return;
    releasePendingRef.current = true;
    pttPendingRef.current = false;
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    send({ type: "ptt.up" });
    void stopAndTransmit();
  }, [recording, send, stopAndTransmit]);

  useEffect(() => {
    pressPttRef.current = pressPtt;
    releasePttRef.current = releasePtt;
  }, [pressPtt, releasePtt]);

  const startFlight = useCallback(async () => {
    if (flightStarted) return;
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const supported = ["audio/webm;codecs=opus", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!supported) throw new Error("This browser cannot record a supported radio format.");
      mimeTypeRef.current = supported;
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      await context.resume();
      await startNoise();
      setFlightStarted(true);
    } catch (error) {
      setWarnings((current) => [
        ...new Set([...current, error instanceof Error ? error.message : "Unable to start flight."]),
      ]);
    }
  }, [flightStarted, startNoise]);

  useEffect(() => {
    const detectedWarnings: string[] = [];
    if (!process.env.NEXT_PUBLIC_SERVER_URL) {
      detectedWarnings.push("NEXT_PUBLIC_SERVER_URL is not set. Using http://localhost:8000 by default.");
    }
    fetch(`${serverBaseUrl}/health`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to reach server health endpoint.");
        return response.json();
      })
      .then((payload: { missingEnv?: unknown; demoMode?: unknown }) => {
        if (Array.isArray(payload.missingEnv) && payload.missingEnv.length > 0) {
          detectedWarnings.push(`Server env missing: ${payload.missingEnv.join(", ")}.`);
        }
        if (payload.demoMode === true) {
          detectedWarnings.push("Server DEMO_MODE is on: tower replies are text only (no voice).");
        }
        setWarnings((current) => [...new Set([...current, ...detectedWarnings])]);
      })
      .catch(() => setWarnings((current) => [
        ...new Set([...current, ...detectedWarnings, "Server is unreachable. Start the FastAPI server before transmitting."]),
      ]));
    const cockpitMissing = "cockpit1.mp3 missing, add it to /web/public/audio/cockpit1.mp3";
    fetch(COCKPIT_AUDIO, { method: "HEAD" })
      .then((response) => {
        if (!response.ok) setWarnings((current) => [...new Set([...current, cockpitMissing])]);
      })
      .catch(() => setWarnings((current) => [...new Set([...current, cockpitMissing])]));
  }, []);

  useEffect(() => {
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(`${wsBaseUrl}/ws/session/${encodeURIComponent(sessionId)}?role=${role}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) reconnectRef.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (event) => {
        let data: ServerMessage;
        try {
          data = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (data.type === "session.state") {
          if (data.phase) setPhase(data.phase);
          if (data.mode) setMode(data.mode);
          setPeers(data.peers ?? []);
          setFreqHolder(data.freqHolder ?? null);
        } else if (data.type === "phase.changed" && data.phase) {
          setPhase(data.phase);
        } else if (data.type === "freq.busy") {
          setFreqHolder(data.holder ?? null);
          if (data.holder !== role) setBusyFlash(true);
        } else if (data.type === "freq.clear") {
          setFreqHolder(null);
        } else if (data.type === "ptt.denied") {
          pttPendingRef.current = false;
          setBusyFlash(true);
          setTimeout(() => setBusyFlash(false), 1200);
        } else if (data.type === "device.ptt" && role === "pilot") {
          if (data.state === "down") pressPttRef.current();
          else releasePttRef.current();
        } else if (data.type === "transmission" && data.speaker && data.transcript !== undefined) {
          const entry: Transmission = {
            id: data.id ?? `${Date.now()}`,
            speaker: data.speaker,
            phase: data.phase ?? phaseRef.current,
            transcript: data.transcript,
            expectedCall: data.expectedCall,
            score: data.score,
            issues: data.issues ?? [],
          };
          setEntries((current) =>
            current.some((item) => item.id === entry.id) ? current : [...current, entry],
          );
          if (entry.speaker === "ai_atc") {
            setAwaitingTower(false);
            if (awaitingTimerRef.current) clearTimeout(awaitingTimerRef.current);
          }
          // Never play your own voice; the controller never hears the AI tower (that's "their" voice).
          const shouldPlay = entry.speaker !== role && !(role === "atc" && entry.speaker === "ai_atc");
          if (shouldPlay && !playedIdsRef.current.has(entry.id)) {
            playedIdsRef.current.add(entry.id);
            enqueueAudio(data.audioBase64, data.mimeType, `${entry.speaker} ${entry.id.slice(0, 6)}`);
          }
        } else if (data.type === "cfi.alert" && role === "pilot") {
          if (data.text) setCfiAlerts((current) => [...current, data.text as string]);
          enqueueAudio(data.audioBase64, data.mimeType, "cfi.alert");
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [enqueueAudio, role, sessionId]);

  useEffect(() => {
    setNoiseGain(phase, receivingRef.current);
  }, [phase, setNoiseGain]);

  // Spacebar push-to-talk for both roles (laptop fallback for the Pi button). Key events only
  // reach the focused window, so two windows on one Mac never both transmit.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !flightStarted || isTyping(event.target)) return;
      event.preventDefault(); // also stops a focused button (phase/PTT) from being "clicked"
      if (!event.repeat) pressPtt();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !flightStarted || isTyping(event.target)) return;
      event.preventDefault();
      releasePtt();
    };
    // Releasing Space in another window never sends keyup here: unkey when focus is lost.
    const onBlur = () => releasePtt();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releasePtt();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flightStarted, pressPtt, releasePtt]);

  const pttDisabled = !flightStarted || Boolean(freqHolder && freqHolder !== role);
  const roleLabel = role === "pilot" ? "PILOT · N123SQ" : "TOWER · TWR 118.5";

  return (
    <main className="min-h-screen bg-slate-950 p-3 text-slate-100 sm:p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-2xl border border-sky-400/30 bg-slate-900 p-4 shadow-xl">
          <div>
            <p className="font-mono text-lg font-bold tracking-wide text-sky-200">{roleLabel}</p>
            <p className="font-mono text-sm text-slate-400">SESSION {sessionId} · {mode === "ai" ? "AI TOWER" : "LIVE TOWER"}</p>
          </div>
          <div className="text-right text-xs">
            <p className={connected ? "text-green-300" : "text-amber-300"}>{connected ? "● CONNECTED" : "○ RECONNECTING"}</p>
            <p className="text-slate-400">{peers.length} peer{peers.length === 1 ? "" : "s"}</p>
          </div>
        </header>

        {warnings.length > 0 && (
          <section className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-sm text-amber-200">
            {warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}
          </section>
        )}

        {!flightStarted && (
          <section className="rounded-2xl border border-sky-400/40 bg-sky-950/50 p-5 text-center">
            <p className="mb-3 text-slate-300">Connect your headset and start the flight deck before transmitting.</p>
            <button type="button" onClick={() => void startFlight()} className="rounded-xl bg-amber-300 px-6 py-3 font-bold text-slate-950 shadow-lg shadow-amber-300/20">
              Start flight
            </button>
          </section>
        )}

        {busyFlash && <div className="rounded-xl border border-red-400/50 bg-red-500/15 p-3 text-center font-mono font-bold text-red-200">FREQ BUSY</div>}
        {freqHolder && <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-center font-mono text-amber-200">FREQ BUSY · {freqHolder.toUpperCase()} transmitting</div>}
        {role === "pilot" && cfiAlerts.map((alert, index) => (
          <div key={`${alert}-${index}`} className="rounded-xl border border-amber-300/60 bg-amber-400/15 p-3 text-amber-100"><strong>CFI:</strong> {alert}</div>
        ))}

        <section className="grid grid-cols-4 gap-2">
          {PHASES.map((item) => (
            <button key={item} type="button" onClick={() => { setPhase(item); send({ type: "phase.set", phase: item }); }} className={`rounded-lg border px-2 py-3 text-sm font-semibold capitalize ${phase === item ? "border-amber-300 bg-amber-300/20 text-amber-100" : "border-sky-500/30 bg-slate-900 text-sky-200"}`}>{item}</button>
          ))}
        </section>

        <section className="flex flex-col items-center gap-3 rounded-2xl border border-sky-400/30 bg-slate-900 p-5">
          <button
            type="button"
            disabled={pttDisabled}
            onPointerDown={(event) => { event.preventDefault(); pressPtt(); }}
            onPointerUp={(event) => { event.preventDefault(); releasePtt(); }}
            onPointerCancel={releasePtt}
            className={`h-44 w-44 rounded-full border-4 text-lg font-bold uppercase shadow-2xl transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${recording ? "border-red-400 bg-red-500/30 text-red-100" : "border-sky-400 bg-sky-500/20 text-sky-100"}`}
          >
            {recording ? "Transmitting" : "Hold to talk · Space"}
          </button>
          {awaitingTower && <p className="animate-pulse text-sm text-sky-300">Tower is responding...</p>}
        </section>

        <section className="rounded-2xl border border-sky-400/30 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-sky-200">Radio log</h2>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {entries.length === 0 && <p className="text-sm text-slate-400">Your transmissions and tower replies will appear here.</p>}
            {entries.map((entry) => (
              <article key={entry.id} className="rounded-lg bg-slate-800/80 p-3 text-sm">
                <p><span className="font-mono font-bold text-sky-300">{entry.speaker === "ai_atc" ? "ATC" : entry.speaker.toUpperCase()}</span> <span className="text-slate-400">· {entry.phase}</span></p>
                <p className="mt-1 text-slate-100">{entry.transcript}</p>
                {typeof entry.score === "number" && <p className={`mt-1 font-mono text-xs ${entry.score >= 80 ? "text-green-300" : "text-amber-300"}`}>Score {entry.score}</p>}
                {entry.issues.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-amber-200">{entry.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
              </article>
            ))}
          </div>
        </section>

        <Link href={`/debrief/${encodeURIComponent(sessionId)}`} className="rounded-xl border border-amber-300/50 bg-amber-300/10 px-4 py-3 text-center font-semibold text-amber-100">End flight · View debrief</Link>
        <footer className="pb-3 text-center text-xs text-slate-500">Practice tool only. Not a substitute for flight instruction.</footer>
      </div>
    </main>
  );
}
