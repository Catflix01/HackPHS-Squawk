type WilcoMood = "happy" | "grumpy" | "headset" | "salute";

export function Wilco({ mood = "happy", size = 96 }: { mood?: WilcoMood; size?: number }) {
  return (
    <svg aria-label={`Wilco feeling ${mood}`} height={size} role="img" viewBox="0 0 160 160" width={size}>
      <use href={`/wilco-moods.svg#${mood}`} />
    </svg>
  );
}
