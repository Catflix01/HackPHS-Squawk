"use client";

import { useEffect, useState } from "react";

type FlightPhase = "taxi" | "takeoff" | "pattern" | "landing";
type Instruments = { airspeed: number; altitude: number; heading: number };

// Where the needles settle in each phase (runway 27, left traffic).
const TARGETS: Record<FlightPhase, Instruments> = {
  taxi: { airspeed: 10, altitude: 0, heading: 180 },
  takeoff: { airspeed: 65, altitude: 800, heading: 270 },
  pattern: { airspeed: 90, altitude: 1000, heading: 90 },
  landing: { airspeed: 60, altitude: 0, heading: 270 },
};

const TICK_MS = 100;
const CLIMB_FT_PER_TICK = 12; // ~700 fpm
const TURN_DEG_PER_TICK = 3; // standard-rate turn

function useInstruments(phase: FlightPhase): Instruments {
  const [values, setValues] = useState<Instruments>(TARGETS.taxi);
  useEffect(() => {
    const target = TARGETS[phase];
    const timer = setInterval(() => {
      setValues((current) => {
        const airspeed = current.airspeed + (target.airspeed - current.airspeed) * 0.05;
        const altDelta = target.altitude - current.altitude;
        const altitude = current.altitude + Math.sign(altDelta) * Math.min(Math.abs(altDelta), CLIMB_FT_PER_TICK);
        const turn = ((target.heading - current.heading + 540) % 360) - 180; // shortest way round
        const heading = (current.heading + Math.sign(turn) * Math.min(Math.abs(turn), TURN_DEG_PER_TICK) + 360) % 360;
        return { airspeed, altitude, heading };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);
  return values;
}

const polar = (angleDeg: number, radius: number) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  // Rounded so server-rendered and client SVG attributes match exactly (no hydration warning).
  const round = (value: number) => Math.round(value * 100) / 100;
  return { x: round(100 + radius * Math.cos(rad)), y: round(100 + radius * Math.sin(rad)) };
};

const arc = (fromDeg: number, toDeg: number, radius: number) => {
  const start = polar(fromDeg, radius);
  const end = polar(toDeg, radius);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;
};

function Bezel({ children, title, readout }: { children: React.ReactNode; title: string; readout: string }) {
  return (
    <figure className="flex flex-col items-center rounded-xl border border-[#1c2a45] bg-[#0b1426] p-2">
      <svg viewBox="0 0 200 200" className="w-full max-w-[11rem]" role="img" aria-label={`${title} ${readout}`}>
        <circle cx="100" cy="100" r="96" fill="#02060e" stroke="#26344f" strokeWidth="4" />
        {children}
        <circle cx="100" cy="100" r="6" fill="#1c2a45" />
      </svg>
      <figcaption className="mt-1 text-center font-mono">
        <span className="block text-[10px] tracking-[0.25em] text-slate-500">{title}</span>
        <span className="text-lg font-bold tabular-nums text-[#39ff88]">{readout}</span>
      </figcaption>
    </figure>
  );
}

const Needle = ({ angle, length, width = 4, color = "#f8fafc" }: { angle: number; length: number; width?: number; color?: string }) => (
  <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "100px 100px" }}>
    <line x1="100" y1="112" x2="100" y2={100 - length} stroke={color} strokeWidth={width} strokeLinecap="round" />
  </g>
);

// Airspeed: 0-160 kt over a 300 degree sweep, with the usual coloured arcs.
function AirspeedIndicator({ knots }: { knots: number }) {
  const angleFor = (kt: number) => -150 + (Math.min(kt, 160) / 160) * 300;
  return (
    <Bezel title="AIRSPEED" readout={`${Math.round(knots)} KT`}>
      <path d={arc(angleFor(40), angleFor(85), 84)} stroke="#f8fafc" strokeWidth="5" fill="none" />
      <path d={arc(angleFor(50), angleFor(130), 78)} stroke="#22c55e" strokeWidth="5" fill="none" />
      <path d={arc(angleFor(130), angleFor(160), 78)} stroke="#eab308" strokeWidth="5" fill="none" />
      {Array.from({ length: 17 }, (_, i) => {
        const angle = angleFor(i * 10);
        const outer = polar(angle, 90);
        const inner = polar(angle, i % 2 === 0 ? 72 : 80);
        const label = polar(angle, 60);
        return (
          <g key={i}>
            <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#cbd5e1" strokeWidth="2" />
            {i % 4 === 0 && <text x={label.x} y={label.y + 5} textAnchor="middle" fontSize="14" fill="#ffb000" fontFamily="monospace">{i * 10}</text>}
          </g>
        );
      })}
      <text x="100" y="140" textAnchor="middle" fontSize="11" fill="#64748b" fontFamily="monospace">KNOTS</text>
      <Needle angle={angleFor(knots)} length={80} />
    </Bezel>
  );
}

// Altimeter: long needle = hundreds, short needle = thousands.
function Altimeter({ feet }: { feet: number }) {
  return (
    <Bezel title="ALTITUDE AGL" readout={`${Math.round(feet).toLocaleString("en-US")} FT`}>
      {Array.from({ length: 50 }, (_, i) => {
        const angle = i * 7.2;
        const outer = polar(angle, 90);
        const inner = polar(angle, i % 5 === 0 ? 76 : 84);
        return <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#cbd5e1" strokeWidth={i % 5 === 0 ? 2.5 : 1} />;
      })}
      {Array.from({ length: 10 }, (_, i) => {
        const p = polar(i * 36, 63);
        return <text key={i} x={p.x} y={p.y + 6} textAnchor="middle" fontSize="16" fill="#ffb000" fontFamily="monospace">{i}</text>;
      })}
      <Needle angle={(feet / 10000) * 360} length={45} width={7} />
      <Needle angle={((feet % 1000) / 1000) * 360} length={80} />
    </Bezel>
  );
}

// Heading indicator: the compass card rotates under a fixed aircraft symbol.
function HeadingIndicator({ heading }: { heading: number }) {
  const cardinal: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };
  const shown = Math.round(heading) % 360;
  return (
    <Bezel title="HEADING" readout={`${String(shown === 0 ? 360 : shown).padStart(3, "0")}°`}>
      <g style={{ transform: `rotate(${-heading}deg)`, transformOrigin: "100px 100px" }}>
        {Array.from({ length: 36 }, (_, i) => {
          const angle = i * 10;
          const outer = polar(angle, 90);
          const inner = polar(angle, i % 3 === 0 ? 76 : 83);
          const label = polar(angle, 64);
          return (
            <g key={i}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#cbd5e1" strokeWidth={i % 3 === 0 ? 2.5 : 1} />
              {i % 3 === 0 && (
                <text x={label.x} y={label.y + 6} textAnchor="middle" fontSize={cardinal[angle] ? 18 : 13}
                  fill={cardinal[angle] ? "#ffb000" : "#cbd5e1"} fontFamily="monospace"
                  transform={`rotate(${angle} ${label.x} ${label.y})`}>
                  {cardinal[angle] ?? i}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <polygon points="100,4 94,16 106,16" fill="#ffb000" />
      <path d="M100 74 L100 128 M78 100 L122 100 M90 122 L110 122" stroke="#ffb000" strokeWidth="4" strokeLinecap="round" />
    </Bezel>
  );
}

export function Gauges({ phase }: { phase: FlightPhase }) {
  const { airspeed, altitude, heading } = useInstruments(phase);
  return (
    <section className="grid grid-cols-3 gap-2" aria-label="Flight instruments">
      <AirspeedIndicator knots={airspeed} />
      <Altimeter feet={altitude} />
      <HeadingIndicator heading={heading} />
    </section>
  );
}
