type RadioLight = "tx" | "rx" | "idle";

type Props = {
  active: { label: string; freq: string };
  standby: { label: string; freq: string };
  callsign: string;
  roleLabel: string;
  light: RadioLight;
  connected: boolean;
  modeLabel: string;
  sessionId: string;
  peers: number;
};

const LIGHT_STYLE: Record<RadioLight, string> = {
  tx: "bg-red-500",
  rx: "bg-success",
  idle: "bg-slate-700",
};

function Window({ caption, label, freq, dim = false }: { caption: string; label: string; freq: string; dim?: boolean }) {
  return (
    <div className="flex-1 rounded border border-line bg-black/60 px-3 py-2">
      <p className="text-[10px] tracking-[0.25em] text-slate-500">{caption}</p>
      <p className={`font-mono text-2xl font-bold tabular-nums sm:text-3xl ${dim ? "text-amber/55" : "text-amber"}`}>
        <span className="mr-2 text-sm align-middle">{label}</span>
        {freq}
      </p>
    </div>
  );
}

// COM radio stack: active/standby frequency, callsign, and the TX/RX annunciator.
export function RadioStack({ active, standby, callsign, roleLabel, light, connected, modeLabel, sessionId, peers }: Props) {
  return (
    <section className="rounded border border-line bg-panel p-3">
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-widest">
        <span className="text-success">COM1 · {roleLabel}</span>
        <span className={connected ? "text-success" : "text-amber"}>{connected ? "● LINK" : "○ NO LINK"}</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        <Window caption="ACTIVE" label={active.label} freq={active.freq} />
        <Window caption="STANDBY" label={standby.label} freq={standby.freq} dim />
        <div className="flex min-w-[7.5rem] flex-col items-center justify-center rounded border border-line bg-black/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={`h-4 w-4 rounded-full transition-colors ${LIGHT_STYLE[light]}`} aria-hidden />
            <span className={`font-mono text-lg font-bold ${light === "tx" ? "text-red-400" : light === "rx" ? "text-success" : "text-slate-600"}`}>
              {light === "rx" ? "RX" : "TX"}
            </span>
          </div>
          <p className="mt-1 font-mono text-sm font-bold tracking-wider text-success">{callsign}</p>
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] tracking-wider text-slate-500">
        SESSION {sessionId} · {modeLabel} · {peers} PEER{peers === 1 ? "" : "S"}
      </p>
    </section>
  );
}
