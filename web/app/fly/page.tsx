"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gauges } from "./components/Gauges";
import { type Atis, Kneeboard } from "./components/Kneeboard";
import { RadioStack } from "./components/RadioStack";

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
  const [atis, setAtis] = useState<Atis | null>(null);
  const [atisLoading, setAtisLoading] = useState(false);
  const [atisError, setAtisError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false); // display only (RX light)

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
          setReceiving(false);
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
        setReceiving(true);
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

  // ATIS 127.65: fetch the broadcast and play it through the same radio queue as the tower
  // (ducking, rx light, PTT clears it). Browser speech if the server has no audio.
  const listenToAtis = useCallback(async () => {
    setAtisLoading(true);
    setAtisError(null);
    try {
      const response = await fetch(`${serverBaseUrl}/atis`);
      if (!response.ok) throw new Error(`ATIS unavailable (${response.status})`);
      const data = (await response.json()) as Atis;
      setAtis(data);
      if (data.audioBase64) {
        enqueueAudio(data.audioBase64, "audio/mpeg", "atis");
      } else if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(data.script));
      }
    } catch (error) {
      console.warn("[atis] could not load the ATIS", error);
      setAtisError("ATIS unavailable. Check that the server is running.");
    } finally {
      setAtisLoading(false);
    }
  }, [enqueueAudio]);

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
  const roleLabel = role === "pilot" ? "PILOT" : "TOWER";

  return (
    <main className="flex-1 p-3 font-mono text-amber sm:p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        <RadioStack
          active={{ label: "TWR", freq: "118.5" }}
          standby={{ label: "GND", freq: "121.9" }}
          callsign="N123SQ"
          roleLabel={roleLabel}
          light={recording ? "tx" : receiving ? "rx" : "idle"}
          connected={connected}
          modeLabel={mode === "ai" ? "AI TOWER" : "LIVE TOWER"}
          sessionId={sessionId}
          peers={peers.length}
        />

        {warnings.length > 0 && (
          <section className="rounded border border-amber/40 bg-amber/10 p-3 text-xs text-amber">
            {warnings.map((warning) => <p key={warning} className="flex items-start gap-2"><svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 1.5 15 14H1z" strokeLinejoin="round"/><path d="M8 6v4M8 11.5v.5" strokeLinecap="round"/></svg><span>{warning}</span></p>)}
          </section>
        )}

        {!flightStarted && (
          <section className="rounded border border-line bg-panel p-5 text-center">
            <p className="mb-3 text-sm text-slate-400">Connect your headset and start the flight deck before transmitting.</p>
            <button type="button" onClick={() => void startFlight()} className="rounded bg-amber px-6 py-3 font-bold tracking-widest text-bg">
              START FLIGHT
            </button>
          </section>
        )}

        {busyFlash && <div className="rounded border border-red-500/60 bg-red-500/15 p-2 text-center font-bold tracking-widest text-red-300">FREQ BUSY</div>}
        {freqHolder && <div className="rounded border border-amber/50 bg-amber/10 p-2 text-center text-sm tracking-wider">FREQ BUSY · {freqHolder.toUpperCase()} TRANSMITTING</div>}
        {role === "pilot" && cfiAlerts.map((alert, index) => (
          <div key={`${alert}-${index}`} className="rounded border border-amber/60 bg-amber/10 p-3 font-sans text-sm text-text"><strong className="font-mono text-amber">CFI:</strong> {alert}</div>
        ))}

        <Gauges phase={phase} />

        <Kneeboard atis={atis} loading={atisLoading} error={atisError} highlight={phase === "taxi"} onListen={() => void listenToAtis()} />

        <section className="grid grid-cols-4 gap-1 rounded border border-line bg-panel p-1" aria-label="Flight phase">
          {PHASES.map((item, index) => {
            const current = PHASES.indexOf(phase);
            const style = item === phase
              ? "bg-success/15 text-success border-success/60"
              : index < current
                ? "text-success/50 border-transparent"
                : "text-slate-500 border-transparent";
            return (
              <button key={item} type="button" onClick={() => { setPhase(item); send({ type: "phase.set", phase: item }); }} className={`rounded border px-2 py-2.5 text-xs font-bold uppercase tracking-widest sm:text-sm ${style}`}>
                {index < current && <svg aria-hidden viewBox="0 0 16 16" className="mr-1 inline h-3 w-3 align-[-1px]" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M2.5 8.5 6 12l7.5-8" strokeLinecap="round" strokeLinejoin="round"/></svg>}{item}
              </button>
            );
          })}
        </section>

        <div className="grid gap-3 md:grid-cols-[auto_1fr]">
          <section className="flex flex-col items-center justify-center gap-2 rounded border border-line bg-panel p-4">
            <button
              type="button"
              disabled={pttDisabled}
              onPointerDown={(event) => { event.preventDefault(); pressPtt(); }}
              onPointerUp={(event) => { event.preventDefault(); releasePtt(); }}
              onPointerCancel={releasePtt}
              className={`h-40 w-40 rounded-full border-4 text-base font-bold uppercase tracking-wider transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${recording ? "border-red-500 bg-red-500/25 text-red-200" : "border-amber bg-amber/10 text-amber"}`}
            >
              {recording ? "Transmitting" : "Hold to talk · Space"}
            </button>
            {awaitingTower && <p className=" text-xs tracking-widest text-success">TOWER RESPONDING…</p>}
          </section>

          <section className="rounded border border-line bg-panel p-3">
            <h2 className="mb-2 font-display text-lg uppercase tracking-widest text-success">Transcript</h2>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {entries.length === 0 && <p className="text-xs text-slate-500">Your transmissions and tower replies will appear here.</p>}
              {entries.map((entry) => (
                <article key={entry.id} className="rounded border border-line bg-black/40 p-2.5 text-sm">
                  <p className="text-xs">
                    <span className={`font-bold ${entry.speaker === role ? "text-amber" : "text-success"}`}>{entry.speaker === "ai_atc" ? "TWR" : entry.speaker.toUpperCase()}</span>{" "}
                    <span className="text-slate-500">· {entry.phase.toUpperCase()}</span>
                    {typeof entry.score === "number" && <span className={`float-right ${entry.score >= 80 ? "text-success" : "text-amber"}`}>SCORE {entry.score}</span>}
                  </p>
                  <p className="mt-1 font-sans text-slate-100">{entry.transcript}</p>
                  {entry.issues.length > 0 && <ul className="mt-1 list-disc pl-5 font-sans text-xs text-amber">{entry.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
                </article>
              ))}
            </div>
          </section>
        </div>

        <Link href={`/debrief/${encodeURIComponent(sessionId)}`} className="rounded border border-amber/40 px-4 py-2.5 text-center text-sm font-bold tracking-widest hover:bg-amber/10">END FLIGHT · DEBRIEF</Link>
      </div>
    </main>
  );
}
