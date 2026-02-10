export interface DailyEntry {
  day: string;
  morningWeightLb: number;
  eveningWeightLb?: number;
  waistIn?: number;
  sleepStart?: string;
  sleepEnd?: string;
  sleepQuality?: number;
  waterLiters?: number;
  steps?: number;
  cardioMin?: number;
  liftDone?: boolean;
  deloadWeek?: boolean;
  performanceNote?: string;
  adherence: number;
  notes?: string;
}

export interface CardioFuel {
  thresholdMin: number;
  addCarbsG: number;
  preferredSource: string;
}

export interface Baseline {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  items: Record<string, number>;
  adjustPriority: string[];
  cardioFuel: CardioFuel;
}

export const BASELINE: Baseline = {
  calories: 2695.2,
  proteinG: 173.9,
  carbsG: 330.9,
  fatG: 54.4,
  items: {
    oats_g: 244,
    dextrin_g: 120,
    whey_g: 90,
    mct_g: 30,
    flax_g: 60,
    yogurt_cups: 1,
    eggs: 2,
    bananas: 2,
  },
  adjustPriority: [
    "mct_g",
    "dextrin_g",
    "oats_g",
    "bananas",
    "eggs",
    "flax_g",
    "whey_g",
    "yogurt_cups",
  ],
  cardioFuel: {
    thresholdMin: 45,
    addCarbsG: 25,
    preferredSource: "dextrin_g",
  },
};

export interface ChecklistItem {
  time: string;
  label: string;
  detail: string;
}

export const DAILY_CHECKLIST: ChecklistItem[] = [
  { time: "05:30", label: "Wake", detail: "Water + electrolytes" },
  { time: "05:30", label: "Pre-cardio", detail: "1 banana + water + pinch salt" },
  { time: "06:00-06:40", label: "Zone 2 rebounder", detail: "Steady Zone 2" },
  { time: "06:45", label: "Post-cardio shake", detail: "Oats 120g + Whey 25g + MCT 10g" },
  { time: "07:00-15:00", label: "Work", detail: "Anchor block" },
  { time: "10:30", label: "Mid-morning shake", detail: "Greek yogurt 1 cup + Flax 30g + Whey 15g" },
  { time: "14:45", label: "Pre-lift shake", detail: "Dextrin 80g + Whey 20g" },
  { time: "15:45-17:00", label: "Lift", detail: "Push/Pull" },
  { time: "17:10", label: "Post-lift shake", detail: "Dextrin 40g + Whey 30g" },
  { time: "20:00", label: "Evening recovery meal", detail: "Oats 124g + Flax 30g + MCT 20g + Eggs 2 + Banana 1" },
  { time: "21:30", label: "Wind down", detail: "Evening protein + downshift" },
  { time: "21:45", label: "Sleep", detail: "Lights out" },
];

export const KCAL_PER_G: Record<string, number> = {
  oats_g: 4.0,
  dextrin_g: 3.87,
  whey_g: 3.76,
  mct_g: 7.0,
  flax_g: 3.24,
  bananas: 104.0,
  eggs: 77.5,
  yogurt_cups: 149.5,
};

export const ITEM_LABELS: Record<string, string> = {
  oats_g: "Oats",
  dextrin_g: "Dextrin",
  whey_g: "Whey",
  mct_g: "MCT Oil",
  flax_g: "Flaxseed",
  bananas: "Bananas",
  eggs: "Eggs",
  yogurt_cups: "Yogurt",
};

export const ITEM_UNITS: Record<string, string> = {
  oats_g: "g",
  dextrin_g: "g",
  whey_g: "g",
  mct_g: "g",
  flax_g: "g",
  bananas: "",
  eggs: "",
  yogurt_cups: "cup",
};

export const MACRO_DELTA: Record<string, { carbs: number; protein: number; fat: number }> = {
  oats_g: { carbs: 0.67, protein: 0.17, fat: 0.07 },
  dextrin_g: { carbs: 1.0, protein: 0.0, fat: 0.0 },
  whey_g: { carbs: 0.1, protein: 0.8, fat: 0.05 },
  mct_g: { carbs: 0.0, protein: 0.0, fat: 1.0 },
  flax_g: { carbs: 0.1, protein: 0.2, fat: 0.35 },
  bananas: { carbs: 27.0, protein: 1.3, fat: 0.3 },
  eggs: { carbs: 0.6, protein: 6.5, fat: 5.3 },
  yogurt_cups: { carbs: 9.0, protein: 23.0, fat: 0.0 },
};

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function rollingAvg(entries: DailyEntry[], days: number = 7): Array<{ day: string; avg: number }> {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const weights = sorted.map((e) => ({ date: parseDate(e.day), weight: e.morningWeightLb, day: e.day }));
  const out: Array<{ day: string; avg: number }> = [];

  for (let i = 0; i < weights.length; i++) {
    const di = weights[i].date;
    const window = weights.filter((w) => {
      const diff = daysBetween(w.date, di);
      return diff >= 0 && diff < days;
    });
    if (window.length >= Math.min(days, 3)) {
      const avg = window.reduce((s, w) => s + w.weight, 0) / window.length;
      out.push({ day: weights[i].day, avg: Math.round(avg * 100) / 100 });
    }
  }
  return out;
}

export function weeklyDelta(entries: DailyEntry[]): number | null {
  const ra = rollingAvg(entries, 7);
  if (ra.length < 2) return null;

  const last = ra[ra.length - 1];
  const prev = ra.length >= 8 ? ra[ra.length - 8] : ra[0];
  const daysDiff = daysBetween(parseDate(prev.day), parseDate(last.day));
  if (daysDiff === 0) return null;
  const weeklyChange = ((last.avg - prev.avg) / daysDiff) * 7;
  return Math.round(weeklyChange * 100) / 100;
}

export function waistDelta(entries: DailyEntry[], days: number = 14): number | null {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const recent = [...sorted].reverse().find((e) => e.waistIn != null);
  if (!recent || recent.waistIn == null) return null;

  const recentDate = parseDate(recent.day);
  const targetDate = new Date(recentDate);
  targetDate.setDate(targetDate.getDate() - days);

  const older = sorted
    .filter((e) => e.waistIn != null && parseDate(e.day) <= targetDate)
    .pop();

  if (!older || older.waistIn == null) return null;
  return Math.round((recent.waistIn - older.waistIn) * 100) / 100;
}

export function suggestCalorieAdjustment(wkGainLb: number): number {
  if (wkGainLb < 0.1) return 100;
  if (wkGainLb > 0.75) return -100;
  if (wkGainLb >= 0.1 && wkGainLb < 0.25) return 75;
  if (wkGainLb >= 0.25 && wkGainLb <= 0.5) return 0;
  if (wkGainLb > 0.5 && wkGainLb <= 0.75) return -50;
  return 0;
}

export interface AdjustmentItem {
  item: string;
  deltaAmount: number;
  achievedKcal: number;
}

function gramsForKcal(itemKey: string, kcal: number): number {
  const k = KCAL_PER_G[itemKey];
  if (["bananas", "eggs", "yogurt_cups"].includes(itemKey)) {
    return Math.round(kcal / k);
  }
  const grams = Math.round(kcal / k);
  if (["mct_g", "dextrin_g"].includes(itemKey)) {
    return Math.round(grams / 5) * 5;
  }
  if (["oats_g", "whey_g", "flax_g"].includes(itemKey)) {
    return Math.round(grams / 10) * 10;
  }
  return grams;
}

export function proposeMacroSafeAdjustment(kcalChange: number, baseline: Baseline): AdjustmentItem[] {
  if (kcalChange === 0) return [];

  const plan: AdjustmentItem[] = [];
  let remaining = kcalChange;

  for (const item of baseline.adjustPriority) {
    if (remaining === 0) break;
    if (["whey_g", "yogurt_cups"].includes(item) && Math.abs(remaining) <= 150) continue;

    let deltaAmt = gramsForKcal(item, remaining);
    if (deltaAmt === 0) {
      deltaAmt = item.endsWith("_g") ? 5 : 1;
      if (remaining < 0) deltaAmt *= -1;
    }

    let achieved = Math.round(deltaAmt * KCAL_PER_G[item]);
    if (Math.abs(achieved) > Math.abs(remaining) && Math.abs(remaining) < 150) {
      if (item.endsWith("_g")) {
        const step = ["mct_g", "dextrin_g"].includes(item) ? 5 : 10;
        deltaAmt = remaining > 0 ? step : -step;
        achieved = Math.round(deltaAmt * KCAL_PER_G[item]);
      } else {
        deltaAmt = remaining > 0 ? 1 : -1;
        achieved = Math.round(deltaAmt * KCAL_PER_G[item]);
      }
    }

    plan.push({ item, deltaAmount: deltaAmt, achievedKcal: achieved });
    remaining -= achieved;

    if (Math.abs(remaining) <= 25) break;
  }

  return plan;
}

export function cardioFuelNote(cardioMin: number | undefined, baseline: Baseline): string | null {
  if (cardioMin == null) return null;
  const cf = baseline.cardioFuel;
  if (cardioMin > cf.thresholdMin) {
    const add = cf.addCarbsG;
    const src = cf.preferredSource;
    if (src === "oats_g") {
      const oatsG = Math.round((add / 0.67) / 10) * 10;
      return `Cardio ${cardioMin}min > ${cf.thresholdMin} — add ~${add}g carbs: +${oatsG}g oats (or +${add}g dextrin)`;
    }
    return `Cardio ${cardioMin}min > ${cf.thresholdMin} — add +${add}g carbs: +${add}g dextrin`;
  }
  return null;
}

export type DiagnosisType = "adherence" | "overshoot" | "undershoot" | "training" | "deload" | "ok" | "insufficient";

export interface Diagnosis {
  type: DiagnosisType;
  message: string;
}

export function diagnoseDietVsTraining(entries: DailyEntry[]): Diagnosis {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const recent = sorted.slice(-14);

  if (recent.length < 7) {
    return { type: "insufficient", message: "Need at least 7 days of data to analyze trends." };
  }

  const avgAdherence = recent.reduce((s, e) => s + (e.adherence ?? 1), 0) / recent.length;
  const wkGain = weeklyDelta(entries);
  const wDelta = waistDelta(entries, 14);
  const deload = recent.some((e) => e.deloadWeek === true);

  const perfNotes = recent.filter((e) => e.performanceNote).map((e) => e.performanceNote!);
  let perfFlagFlat = false;
  if (perfNotes.length > 0) {
    const badWords = ["flat", "tired", "stalled", "no progress", "weak"];
    const hits = perfNotes.filter((n) => badWords.some((b) => n.toLowerCase().includes(b))).length;
    perfFlagFlat = hits >= Math.max(2, Math.floor(perfNotes.length / 3));
  }

  if (avgAdherence < 0.9) {
    return { type: "adherence", message: "Focus on consistency first. Plan adherence is below 90%." };
  }

  if (deload) {
    if (wkGain != null && wkGain < 0.1) {
      return { type: "deload", message: "Deload flagged. Weight not moving is acceptable — hold diet steady and reassess after deload." };
    }
    return { type: "deload", message: "Deload flagged. Avoid training conclusions — reassess next week." };
  }

  if (wkGain == null) {
    return { type: "insufficient", message: "Need 14+ days of data to diagnose weight trends." };
  }

  if (wkGain > 0.75 && wDelta != null && wDelta > 0.25) {
    return { type: "overshoot", message: "Gaining too fast with waist rising. Consider reducing calories slightly." };
  }

  if (wkGain < 0.1 && perfFlagFlat) {
    return { type: "undershoot", message: "Not gaining and performance is flat. Add calories or reduce cardio/stress." };
  }

  if (wkGain >= 0.25 && wkGain <= 0.5 && perfFlagFlat) {
    return { type: "training", message: "Weight trend is on track. Look at training variables (volume, intensity, exercise selection) and sleep." };
  }

  return { type: "ok", message: "No red flags detected. Keep running the plan and monitor 7-day averages." };
}

export function getWeightTrend(entries: DailyEntry[]): "up" | "down" | "flat" | "unknown" {
  const wk = weeklyDelta(entries);
  if (wk == null) return "unknown";
  if (wk > 0.1) return "up";
  if (wk < -0.1) return "down";
  return "flat";
}

export function getCurrentAvgWeight(entries: DailyEntry[]): number | null {
  const ra = rollingAvg(entries, 7);
  if (ra.length === 0) return null;
  return ra[ra.length - 1].avg;
}

export function getSleepHours(entry: DailyEntry): number | null {
  if (!entry.sleepStart || !entry.sleepEnd) return null;
  const [sh, sm] = entry.sleepStart.split(":").map(Number);
  const [eh, em] = entry.sleepEnd.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.round(((endMin - startMin) / 60) * 10) / 10;
}

export function formatDate(dateStr: string): string {
  const d = parseDate(dateStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
