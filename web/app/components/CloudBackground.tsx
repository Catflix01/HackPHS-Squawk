// Three layers of soft cloud shapes drifting left behind the content.
// Each layer repeats its pattern twice across 200% width so the -50% loop is seamless.
const CLOUD = "M20 60c0-11 9-20 20-20 3-12 14-21 27-21 13 0 24 8 27 20 2-1 5-1 7-1 11 0 20 9 20 20s-9 20-20 20H40c-11 0-20-7-20-18z";

const LAYERS = [
  { top: "8%", height: 140, opacity: 0.07, duration: "60s", clouds: [[40, 10, 1.4], [420, 40, 1], [760, 0, 1.2]] },
  { top: "38%", height: 120, opacity: 0.05, duration: "90s", clouds: [[150, 20, 1.1], [560, 0, 1.5], [880, 30, 0.9]] },
  { top: "68%", height: 160, opacity: 0.04, duration: "120s", clouds: [[0, 30, 1.6], [470, 10, 1.2], [820, 40, 1.4]] },
] as const;

export function CloudBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {LAYERS.map((layer) => (
        <div
          key={layer.top}
          className="sq-cloud-layer absolute left-0 flex w-[200%]"
          style={{ top: layer.top, height: layer.height, opacity: layer.opacity, animationDuration: layer.duration }}
        >
          {[0, 1].map((copy) => (
            <svg key={copy} className="h-full w-1/2" viewBox="0 0 1000 160" preserveAspectRatio="none" fill="#FFFFFF">
              {layer.clouds.map(([x, y, scale]) => (
                <path key={x} d={CLOUD} transform={`translate(${x} ${y}) scale(${scale})`} />
              ))}
            </svg>
          ))}
        </div>
      ))}
    </div>
  );
}
