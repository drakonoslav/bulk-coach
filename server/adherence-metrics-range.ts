import { pool } from "./db";
import { getSleepPlanSettings } from "./sleep-alignment";

const DEFAULT_USER_ID = "local_default";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toMin(t: string): number {
  const s = t.trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return h * 60 + m;
  }
  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return parseInt(iso[1], 10) * 60 + parseInt(iso[2], 10);
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  return 0;
}

function circDiffMin(actualMin: number, plannedMin: number): number {
  let d = actualMin - plannedMin;
  while (d > 720) d -= 1440;
  while (d < -720) d += 1440;
  return d;
}

interface DayTimingRow {
  day: string;
  actual_bed_time: string | null;
  actual_wake_time: string | null;
  planned_bed_time: string | null;
  planned_wake_time: string | null;
  adherence: number | null;
  training_load: string | null;
  lift_done: boolean | null;
}

export interface DayAdherence {
  bedtimeDriftLateNights7d: number;
  bedtimeDriftMeasuredNights7d: number;
  wakeDriftEarlyNights7d: number;
  wakeDriftMeasuredNights7d: number;
  trainingAdherenceScore: number | null;
  trainingAdherenceAvg7d: number | null;
  trainingOverrunMin: number | null;
  mealTimingAdherenceScore: number | null;
  mealTimingAdherenceAvg7d: number | null;
  mealTimingTracked: boolean;
}

export async function computeRangeAdherence(
  startDate: string,
  endDate: string,
  userId: string = DEFAULT_USER_ID,
): Promise<Map<string, DayAdherence>> {
  const lookbackStart = addDays(startDate, -6);

  const { rows } = await pool.query(
    `SELECT day, actual_bed_time, actual_wake_time,
            planned_bed_time, planned_wake_time,
            adherence, training_load, lift_done
     FROM daily_log
     WHERE day >= $1 AND day <= $2 AND user_id = $3
     ORDER BY day ASC`,
    [lookbackStart, endDate, userId],
  );

  const schedule = await getSleepPlanSettings(userId);

  const byDate = new Map<string, DayTimingRow>();
  for (const r of rows) byDate.set(r.day, r);

  const allDates: string[] = [];
  {
    let d = lookbackStart;
    while (d <= endDate) {
      allDates.push(d);
      d = addDays(d, 1);
    }
  }

  const LATE_THRESH = 30;
  const EARLY_THRESH = -30;

  const bedLate: number[] = allDates.map((dt) => {
    const r = byDate.get(dt);
    if (!r || !r.actual_bed_time) return 0;
    const plannedBed = r.planned_bed_time || schedule.bedtime;
    if (!plannedBed) return 0;
    const dev = circDiffMin(toMin(r.actual_bed_time), toMin(plannedBed));
    return dev > LATE_THRESH ? 1 : 0;
  });

  const bedMeasured: number[] = allDates.map((dt) => {
    const r = byDate.get(dt);
    return r?.actual_bed_time ? 1 : 0;
  });

  const earlyWake: number[] = allDates.map((dt) => {
    const r = byDate.get(dt);
    if (!r || !r.actual_wake_time) return 0;
    const plannedWake = r.planned_wake_time || schedule.wake;
    if (!plannedWake) return 0;
    const dev = circDiffMin(toMin(r.actual_wake_time), toMin(plannedWake));
    return dev < EARLY_THRESH ? 1 : 0;
  });

  const wakeMeasured: number[] = allDates.map((dt) => {
    const r = byDate.get(dt);
    return r?.actual_wake_time ? 1 : 0;
  });

  const trainingScore: (number | null)[] = allDates.map((dt) => {
    const r = byDate.get(dt);
    if (!r) return null;
    return r.adherence != null ? Number(r.adherence) : null;
  });

  const trainingOverrun: (number | null)[] = allDates.map((dt) => {
    const r = byDate.get(dt);
    if (!r) return null;
    if (r.training_load) {
      const match = r.training_load.match(/overrun[:\s]*(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  });

  const bedLatePrefix = buildPrefix(bedLate);
  const bedMeasuredPrefix = buildPrefix(bedMeasured);
  const earlyWakePrefix = buildPrefix(earlyWake);
  const wakeMeasuredPrefix = buildPrefix(wakeMeasured);

  const resultMap = new Map<string, DayAdherence>();

  const startIdx = allDates.indexOf(startDate);
  const endIdx = allDates.indexOf(endDate);

  for (let i = startIdx; i <= endIdx; i++) {
    const dt = allDates[i];
    const lo = Math.max(0, i - 6);

    const bedLate7 = rangeSum(bedLatePrefix, lo, i);
    const bedMeas7 = rangeSum(bedMeasuredPrefix, lo, i);
    const wake7 = rangeSum(earlyWakePrefix, lo, i);
    const wakeMeas7 = rangeSum(wakeMeasuredPrefix, lo, i);

    const train7vals: number[] = [];
    let overrunToday: number | null = null;
    for (let j = lo; j <= i; j++) {
      if (trainingScore[j] != null) train7vals.push(trainingScore[j]!);
    }
    overrunToday = trainingOverrun[i];

    const trainAvg7 = train7vals.length > 0
      ? Math.round((train7vals.reduce((a, b) => a + b, 0) / train7vals.length) * 100) / 100
      : null;

    resultMap.set(dt, {
      bedtimeDriftLateNights7d: bedLate7,
      bedtimeDriftMeasuredNights7d: bedMeas7,
      wakeDriftEarlyNights7d: wake7,
      wakeDriftMeasuredNights7d: wakeMeas7,
      trainingAdherenceScore: trainingScore[i],
      trainingAdherenceAvg7d: trainAvg7,
      trainingOverrunMin: overrunToday,
      mealTimingAdherenceScore: null,
      mealTimingAdherenceAvg7d: null,
      mealTimingTracked: false,
    });
  }

  return resultMap;
}

function buildPrefix(arr: number[]): number[] {
  const p = new Array(arr.length + 1).fill(0);
  for (let i = 0; i < arr.length; i++) {
    p[i + 1] = p[i] + arr[i];
  }
  return p;
}

function rangeSum(prefix: number[], lo: number, hi: number): number {
  return prefix[hi + 1] - prefix[lo];
}
