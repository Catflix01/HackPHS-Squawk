type WilcoMood = "happy" | "grumpy" | "headset" | "salute";

export function Wilco({ mood = "happy", size = 96 }: { mood?: WilcoMood; size?: number }) {
  const face = mood === "grumpy"
    ? <><path d="M43 56l25 10M117 56L92 66M50 105c18-15 42-15 60 0" /><circle cx="59" cy="76" r="5" fill="#082f49" /><circle cx="101" cy="76" r="5" fill="#082f49" /></>
    : mood === "salute"
      ? <path d="M48 105c20 12 44 12 64 0M55 72h15M90 72h15M111 54l19-14M108 55h22" />
      : mood === "headset"
        ? <path d="M42 82a38 38 0 0176 0v23M42 82v20h18V82M118 82v20h-18" />
        : <><path d="M45 66h18M97 66h18M48 96c18 22 46 22 64 0" /><path d="M49 48c8-12 18-16 27-15M111 48c-8-12-18-16-27-15" /></>;
  return <svg aria-label={`Wilco ${mood}`} height={size} role="img" viewBox="0 0 160 160" width={size}><circle cx="80" cy="80" fill="#38bdf8" r="68" stroke="#fbbf24" strokeWidth="6" /><g fill="none" stroke="#082f49" strokeLinecap="round" strokeWidth="8">{face}</g></svg>;
}
