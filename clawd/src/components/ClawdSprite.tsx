import type { ClawdState } from "@/lib/mascot";

// Each atlas is a 3 × 3 set of standalone poses, not animation frames.
const activityCells: Partial<Record<ClawdState, number>> = {
  spawning: 2, waking: 2, sleeping: 3, drowsy: 3, "powering-down": 3,
  alerting: 4, notifying: 4, surprised: 4, scared: 4,
  confused: 5, suspicious: 5, curious: 5,
  working: 6, writing: 6, loading: 6, progress: 6,
  searching: 7, radar: 7, uploading: 7, sending: 7, receiving: 7,
  celebrate: 8, excited: 8,
};
const poseCells: Partial<Record<ClawdState, number>> = {
  happy: 2, laughing: 2, playful: 1, proud: 7,
  thinking: 3, listening: 6, dictating: 6,
  sad: 8, bored: 8, shy: 8,
};

export function ClawdSprite({ state, size, label }: {
  state: ClawdState; size: number; label?: string;
}) {
  const activity = activityCells[state];
  const cell = activity ?? poseCells[state] ?? 0;
  const sheet = activity === undefined ? "clawd-poses" : "clawd-activities";
  // The generated pose atlas has slightly uneven row spacing. Use its
  // inspected row boundaries so raised claws and feet stay inside the crop.
  const row = Math.floor(cell / 3);
  const edges = activity === undefined ? [0, 460, 820, 1254] : [0, 418, 836, 1254];
  const top = edges[row];
  const height = edges[row + 1] - top;
  return <span
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    className="block shrink-0"
    style={{
      width: size, height: size, borderRadius: "24%",
      backgroundColor: "#160624",
      backgroundImage: `url(${import.meta.env.BASE_URL}brand/${sheet}.png)`,
      backgroundSize: `300% ${(1254 / height) * 100}%`,
      backgroundPosition: `${(cell % 3) * 50}% ${(top / (1254 - height)) * 100}%`,
    }}
  />;
}
