export type Atis = {
  icao: string;
  letter: string;
  frequency: string;
  metar: string;
  source: "live" | "canned";
  script: string;
  audioBase64: string | null;
  generatedAt: string;
};

type Props = {
  atis: Atis | null;
  loading: boolean;
  error: string | null;
  highlight: boolean; // before taxi: the ATIS is the first thing to do
  onListen: () => void;
};

// Kneeboard: ATIS 127.65 button plus the current ATIS text and raw METAR.
export function Kneeboard({ atis, loading, error, highlight, onListen }: Props) {
  const time = atis ? new Date(atis.generatedAt).toISOString().slice(11, 16) + "Z" : "";
  return (
    <section className="rounded border border-line bg-panel p-3" aria-label="Kneeboard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg uppercase tracking-widest text-text">Kneeboard</h2>
        <button
          type="button"
          onClick={onListen}
          disabled={loading}
          className={`rounded border px-4 py-2 font-mono text-sm font-bold tracking-widest disabled:opacity-50 ${
            highlight && !atis
              ? "border-amber bg-amber text-bg hover:bg-text"
              : "border-amber text-amber hover:bg-amber hover:text-bg"
          }`}
        >
          {loading ? "TUNING ATIS 127.65" : atis ? "REPLAY ATIS 127.65" : "ATIS 127.65"}
        </button>
      </div>
      {highlight && !atis && !loading && (
        <p className="mt-2 text-sm text-muted">Before you call for taxi, listen to the ATIS and note the information letter.</p>
      )}
      {error && <p className="mt-2 text-sm text-red">{error}</p>}
      {atis && (
        <div className="mt-3 space-y-2">
          <p className="font-mono text-xs tracking-wider text-muted">
            {atis.icao} INFORMATION <span className="text-amber">{atis.letter.toUpperCase()}</span> · {time} ·{" "}
            {atis.source === "live" ? "LIVE METAR" : "SAMPLE METAR"}
          </p>
          <p className="text-sm leading-relaxed text-text">{atis.script}</p>
          <p className="break-all font-mono text-xs text-muted">{atis.metar}</p>
        </div>
      )}
    </section>
  );
}
