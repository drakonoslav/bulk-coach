export type HpaBucket =
  | "Minimal"
  | "Low"
  | "Medium"
  | "High"
  | "Extreme";

export type HpaHrvState =
  | "Calm / Recovered"
  | "Activated (buffered)"
  | "Stressed (unbuffered)"
  | "Fatigued"
  | "Mixed / Neutral";

export function bucketHpa(score: number): HpaBucket {
  if (!Number.isFinite(score)) return "Minimal";
  if (score <= 19) return "Minimal";
  if (score <= 39) return "Low";
  if (score <= 59) return "Medium";
  if (score <= 79) return "High";
  return "Extreme";
}

function classifyHrvState(hrvPct: number): "up" | "neutral" | "down" {
  if (!Number.isFinite(hrvPct)) return "neutral";
  if (hrvPct >= 0.08) return "up";
  if (hrvPct <= -0.08) return "down";
  return "neutral";
}

export function classifyHpaHrv(
  hpaScore: number,
  hrvPct: number
): { hpaBucket: HpaBucket; stateLabel: HpaHrvState } {
  const hpaBucket = bucketHpa(hpaScore);
  const hrvState = classifyHrvState(hrvPct);

  const highHpa = Number.isFinite(hpaScore) && hpaScore >= 60;
  const lowHpa = Number.isFinite(hpaScore) && hpaScore < 40;

  let stateLabel: HpaHrvState = "Mixed / Neutral";

  if (highHpa && hrvState === "up") stateLabel = "Activated (buffered)";
  else if (highHpa && hrvState === "down") stateLabel = "Stressed (unbuffered)";
  else if (lowHpa && hrvState === "down") stateLabel = "Fatigued";
  else if (lowHpa && hrvState === "up") stateLabel = "Calm / Recovered";

  return { hpaBucket, stateLabel };
}

export function stateTooltip(state: HpaHrvState): string {
  switch (state) {
    case "Calm / Recovered":
      return "Low stress activation with strong autonomic recovery capacity.";
    case "Activated (buffered)":
      return "Elevated stress drive, but recovery systems are compensating well.";
    case "Stressed (unbuffered)":
      return "High stress activation with reduced recovery buffering \u2014 monitor load.";
    case "Fatigued":
      return "Low stress drive but suppressed recovery tone \u2014 prioritize sleep and restoration.";
    case "Mixed / Neutral":
      return "Physiology is within normal variance \u2014 no strong stress or recovery signal.";
    default:
      return "";
  }
}
