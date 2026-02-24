import { pool } from "./db";

const DEFAULT_USER_ID = "local_default";

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

function circularDeltaMinutes(actualMin: number, plannedMin: number): number {
  let d = actualMin - plannedMin;
  while (d > 720) d -= 1440;
  while (d < -720) d += 1440;
  return d;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function stddevPop(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

export interface ScheduleStability {
  scheduleConsistencyScore: number | null;
  scheduleConsistencySdMin: number | null;
  scheduleConsistencyNSamples: number;
  scheduleRecoveryScore: number | null;
  recoveryEventFound: boolean;
  recoveryEventDriftMag0: number | null;
  recoveryFollowDaysK: number | null;
  recoveryFollowAvgDriftMag: number | null;
  debugDriftMags7d: number[];
  debugRecoveryDays: { date: string; driftMag: number }[];
}

export async function computeScheduleStability(
  date: string,
  plannedBed: string,
  plannedWake: string,
  userId: string = DEFAULT_USER_ID,
): Promise<ScheduleStability> {
  const { rows } = await pool.query(
    `SELECT day, actual_bed_time, actual_wake_time
     FROM daily_log
     WHERE user_id = $1
       AND day <= $2
       AND day >= ($2::date - 21)::text
       AND actual_bed_time IS NOT NULL
       AND actual_wake_time IS NOT NULL
     ORDER BY day DESC
     LIMIT 14`,
    [userId, date],
  );

  const plannedBedMin = toMin(plannedBed);
  const plannedWakeMin = toMin(plannedWake);

  interface DayDrift {
    date: string;
    bedDevMin: number;
    wakeDevMin: number;
    driftMag: number;
  }

  const allDays: DayDrift[] = rows.map((r: any) => {
    const bedDev = circularDeltaMinutes(toMin(r.actual_bed_time), plannedBedMin);
    const wakeDev = circularDeltaMinutes(toMin(r.actual_wake_time), plannedWakeMin);
    const driftMag = (Math.abs(bedDev) + Math.abs(wakeDev)) / 2;
    return { date: r.day, bedDevMin: bedDev, wakeDevMin: wakeDev, driftMag };
  });

  const last7 = allDays.slice(0, 7);

  let scheduleConsistencyScore: number | null = null;
  let scheduleConsistencySdMin: number | null = null;
  const scheduleConsistencyNSamples = last7.length;

  if (last7.length >= 4) {
    const mags = last7.map((d) => d.driftMag);
    const sd = stddevPop(mags);
    const CONSISTENCY_SD_CAP = 60;
    scheduleConsistencySdMin = Math.round(sd * 100) / 100;
    scheduleConsistencyScore = clamp(Math.round(100 * (1 - sd / CONSISTENCY_SD_CAP)), 0, 100);
  }

  let scheduleRecoveryScore: number | null = null;
  let recoveryEventFound = false;
  let recoveryEventDriftMag0: number | null = null;
  let recoveryFollowDaysK: number | null = null;
  let recoveryFollowAvgDriftMag: number | null = null;
  const debugRecoveryDays: { date: string; driftMag: number }[] = [];

  const DRIFT_EVENT_THRESHOLD = 45;

  const allDaysSorted = [...allDays].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let eventIdx = -1;
  for (let i = allDaysSorted.length - 1; i >= 0; i--) {
    if (allDaysSorted[i].driftMag >= DRIFT_EVENT_THRESHOLD) {
      eventIdx = i;
      break;
    }
  }

  if (eventIdx === -1) {
    scheduleRecoveryScore = 100;
    recoveryEventFound = false;
  } else {
    recoveryEventFound = true;
    const d0 = allDaysSorted[eventIdx];
    recoveryEventDriftMag0 = Math.round(d0.driftMag * 100) / 100;
    debugRecoveryDays.push({ date: d0.date, driftMag: d0.driftMag });

    const followDays = allDaysSorted.slice(eventIdx + 1, eventIdx + 4);
    recoveryFollowDaysK = followDays.length;

    if (followDays.length > 0) {
      const avgFollow = followDays.reduce((s, d) => s + d.driftMag, 0) / followDays.length;
      recoveryFollowAvgDriftMag = Math.round(avgFollow * 100) / 100;
      const improvement = (d0.driftMag - avgFollow) / d0.driftMag;
      scheduleRecoveryScore = clamp(Math.round(100 * improvement), 0, 100);
      followDays.forEach((d) => debugRecoveryDays.push({ date: d.date, driftMag: d.driftMag }));
    } else {
      scheduleRecoveryScore = null;
    }
  }

  return {
    scheduleConsistencyScore,
    scheduleConsistencySdMin,
    scheduleConsistencyNSamples,
    scheduleRecoveryScore,
    recoveryEventFound,
    recoveryEventDriftMag0,
    recoveryFollowDaysK,
    recoveryFollowAvgDriftMag,
    debugDriftMags7d: last7.map((d) => Math.round(d.driftMag * 100) / 100),
    debugRecoveryDays,
  };
}
