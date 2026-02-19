import { pool } from "./db";
import { getSleepPlanSettings } from "./sleep-alignment";

const DEFAULT_USER_ID = "local_default";

export async function getCardioScheduleSettings(userId: string = DEFAULT_USER_ID): Promise<{ start: string; end: string; type: string; plannedMin: number }> {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE user_id = $1 AND key IN ('cardio_schedule_start', 'cardio_schedule_end', 'cardio_schedule_type')`,
    [userId]
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);
  const start = map.get("cardio_schedule_start") || "06:00";
  const end = map.get("cardio_schedule_end") || "06:40";
  const type = map.get("cardio_schedule_type") || "Zone 2 Rebounder";
  const startMin = toMin(start);
  const endMin = toMin(end);
  let plannedMin = endMin - startMin;
  if (plannedMin < 0) plannedMin += 1440;
  return { start, end, type, plannedMin };
}

export async function getLiftScheduleSettings(userId: string = DEFAULT_USER_ID): Promise<{ start: string; end: string; type: string; plannedMin: number }> {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE user_id = $1 AND key IN ('lift_schedule_start', 'lift_schedule_end', 'lift_schedule_type')`,
    [userId]
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);
  const start = map.get("lift_schedule_start") || "17:00";
  const end = map.get("lift_schedule_end") || "18:15";
  const type = map.get("lift_schedule_type") || "Lift Session";
  const startMin = toMin(start);
  const endMin = toMin(end);
  let plannedMin = endMin - startMin;
  if (plannedMin < 0) plannedMin += 1440;
  return { start, end, type, plannedMin };
}

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

export interface DayAdherence {
  bedtimeDriftLateNights7d: number;
  bedtimeDriftMeasuredNights7d: number;
  wakeDriftEarlyNights7d: number;
  wakeDriftMeasuredNights7d: number;
  trainingAdherenceScore: number | null;
  trainingAdherenceAvg7d: number | null;
  trainingOverrunMin: number | null;
  liftOverrunMin: number | null;
  actualCardioMin: number | null;
  plannedCardioMin: number;
  actualLiftMin: number | null;
  plannedLiftMin: number;
  mealTimingAdherenceScore: number | null;
  mealTimingAdherenceAvg7d: number | null;
  mealTimingTracked: boolean;
}

export async function computeRangeAdherence(
  startDate: string,
  endDate: string,
  userId: string = DEFAULT_USER_ID,
): Promise<Map<string, DayAdherence>> {
  const WINDOW = 7;
  const lookbackStart = addDays(startDate, -(WINDOW - 1));

  const { rows } = await pool.query(
    `SELECT day, actual_bed_time, actual_wake_time,
            planned_bed_time, planned_wake_time,
            adherence, training_load, lift_done,
            cardio_start_time, cardio_end_time, cardio_min,
            lift_start_time, lift_end_time, lift_min
     FROM daily_log
     WHERE day >= $1 AND day <= $2 AND user_id = $3
     ORDER BY day ASC`,
    [lookbackStart, endDate, userId],
  );

  const schedule = await getSleepPlanSettings(userId);
  const cardioSchedule = await getCardioScheduleSettings(userId);
  const liftSchedule = await getLiftScheduleSettings(userId);

  const byDate = new Map<string, typeof rows[0]>();
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

  const bedLate: number[] = [];
  const bedMeasured: number[] = [];
  const earlyWake: number[] = [];
  const wakeMeasured: number[] = [];
  const trainScores: (number | null)[] = [];
  const trainOverrun: (number | null)[] = [];
  const liftOverrun: (number | null)[] = [];
  const actualCardioArr: (number | null)[] = [];
  const actualLiftArr: (number | null)[] = [];

  for (const dt of allDates) {
    const r = byDate.get(dt);

    if (r?.actual_bed_time) {
      const plannedBed = r.planned_bed_time || schedule.bedtime;
      if (plannedBed) {
        const dev = circDiffMin(toMin(r.actual_bed_time), toMin(plannedBed));
        bedLate.push(dev > LATE_THRESH ? 1 : 0);
        bedMeasured.push(1);
      } else {
        bedLate.push(0);
        bedMeasured.push(0);
      }
    } else {
      bedLate.push(0);
      bedMeasured.push(0);
    }

    if (r?.actual_wake_time) {
      const plannedWake = r.planned_wake_time || schedule.wake;
      if (plannedWake) {
        const dev = circDiffMin(toMin(r.actual_wake_time), toMin(plannedWake));
        earlyWake.push(dev < EARLY_THRESH ? 1 : 0);
        wakeMeasured.push(1);
      } else {
        earlyWake.push(0);
        wakeMeasured.push(0);
      }
    } else {
      earlyWake.push(0);
      wakeMeasured.push(0);
    }

    if (!r) {
      trainScores.push(null);
      trainOverrun.push(null);
      liftOverrun.push(null);
      actualCardioArr.push(null);
      actualLiftArr.push(null);
    } else {
      trainScores.push(r.adherence != null ? Number(r.adherence) : null);
      let cardioOverrun: number | null = null;
      let actualCardioMin: number | null = null;
      if (r.cardio_start_time && r.cardio_end_time) {
        const startM = toMin(r.cardio_start_time);
        const endM = toMin(r.cardio_end_time);
        let dur = endM - startM;
        if (dur < 0) dur += 1440;
        actualCardioMin = dur;
      } else if (r.cardio_min != null) {
        actualCardioMin = Number(r.cardio_min);
      }
      if (actualCardioMin != null) {
        cardioOverrun = actualCardioMin - cardioSchedule.plannedMin;
      }
      trainOverrun.push(cardioOverrun);
      actualCardioArr.push(actualCardioMin);

      let liftOv: number | null = null;
      let actualLiftMin: number | null = null;
      if (r.lift_start_time && r.lift_end_time) {
        const startM = toMin(r.lift_start_time);
        const endM = toMin(r.lift_end_time);
        let dur = endM - startM;
        if (dur < 0) dur += 1440;
        actualLiftMin = dur;
      } else if (r.lift_min != null) {
        actualLiftMin = Number(r.lift_min);
      }
      if (actualLiftMin != null) {
        liftOv = actualLiftMin - liftSchedule.plannedMin;
      }
      liftOverrun.push(liftOv);
      actualLiftArr.push(actualLiftMin);
    }
  }

  const bedLatePrefix = buildPrefix(bedLate);
  const bedMeasuredPrefix = buildPrefix(bedMeasured);
  const earlyWakePrefix = buildPrefix(earlyWake);
  const wakeMeasuredPrefix = buildPrefix(wakeMeasured);

  const startIdx = allDates.indexOf(startDate);
  const endIdx = allDates.indexOf(endDate);

  const trainAvg7d = slidingAvg(trainScores, WINDOW, startIdx, endIdx);

  const resultMap = new Map<string, DayAdherence>();

  for (let i = startIdx; i <= endIdx; i++) {
    const dt = allDates[i];
    const lo = Math.max(0, i - (WINDOW - 1));

    resultMap.set(dt, {
      bedtimeDriftLateNights7d: rangeSum(bedLatePrefix, lo, i),
      bedtimeDriftMeasuredNights7d: rangeSum(bedMeasuredPrefix, lo, i),
      wakeDriftEarlyNights7d: rangeSum(earlyWakePrefix, lo, i),
      wakeDriftMeasuredNights7d: rangeSum(wakeMeasuredPrefix, lo, i),
      trainingAdherenceScore: trainScores[i],
      trainingAdherenceAvg7d: trainAvg7d.get(i) ?? null,
      trainingOverrunMin: trainOverrun[i],
      liftOverrunMin: liftOverrun[i],
      actualCardioMin: actualCardioArr[i],
      plannedCardioMin: cardioSchedule.plannedMin,
      actualLiftMin: actualLiftArr[i],
      plannedLiftMin: liftSchedule.plannedMin,
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

function slidingAvg(
  scores: (number | null)[],
  windowSize: number,
  emitStart: number,
  emitEnd: number,
): Map<number, number | null> {
  const result = new Map<number, number | null>();
  let sum = 0;
  let count = 0;
  const q: (number | null)[] = [];

  const scanStart = Math.max(0, emitStart - (windowSize - 1));

  for (let i = scanStart; i <= emitEnd; i++) {
    const s = scores[i];
    q.push(s);
    if (s !== null) { sum += s; count++; }

    if (q.length > windowSize) {
      const old = q.shift()!;
      if (old !== null) { sum -= old; count--; }
    }

    if (i >= emitStart) {
      result.set(i, count > 0 ? Math.round((sum / count) * 100) / 100 : null);
    }
  }

  return result;
}
