import { pool } from "./db";
import { computeRecoveryModifiers, applyRecoveryModifiers } from "./recovery-helpers";

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
  recoveryConfidence: "high" | "low";
  recoveryReason: "no_event" | "insufficient_post_event_days" | "partial_post_event_window" | "computed" | "missing_scheduled_data";
  debugDriftMags7d: number[];
  debugRecoveryDays: { date: string; driftMag: number }[];
  scheduledToday: boolean;
  hasActualDataToday: boolean;
  missStreak: number;
  suppressionFactor: number;
  avgDeviationMin: number | null;
  driftPenalty: number;
  driftFactor: number;
  recoveryRaw: number | null;
  recoverySuppressed: number | null;
  recoveryFinal: number | null;
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
  let recoveryReason: "no_event" | "insufficient_post_event_days" | "partial_post_event_window" | "computed" | "missing_scheduled_data" = "no_event";
  let recoveryRaw: number | null = null;
  let recoverySuppressed: number | null = null;
  let recoveryFinal: number | null = null;
  let recoveryConfidence_override: "high" | "low" | null = null;

  const scheduledToday = true;
  const todayData = allDays.find(d => d.date === date);

  const sleepDataRow = await pool.query(
    `SELECT
       dl.actual_bed_time, dl.actual_wake_time,
       COALESCE(
         dl.sleep_minutes,
         (SELECT ssd.total_sleep_minutes FROM sleep_summary_daily ssd WHERE ssd.user_id = dl.user_id AND ssd.date = dl.day::date)
       ) AS resolved_tst,
       COALESCE(
         (SELECT ssd.time_in_bed_minutes FROM sleep_summary_daily ssd WHERE ssd.user_id = dl.user_id AND ssd.date = dl.day::date),
         CASE WHEN dl.sleep_rem_min IS NOT NULL OR dl.sleep_core_min IS NOT NULL OR dl.sleep_deep_min IS NOT NULL OR dl.sleep_awake_min IS NOT NULL
           THEN COALESCE(dl.sleep_rem_min, 0) + COALESCE(dl.sleep_core_min, 0) + COALESCE(dl.sleep_deep_min, 0) + COALESCE(dl.sleep_awake_min, 0)
           ELSE NULL END
       ) AS resolved_tib
     FROM daily_log dl
     WHERE dl.user_id = $1 AND dl.day = $2
     LIMIT 1`,
    [userId, date],
  );
  const sdRow = sleepDataRow.rows[0];
  const resolvedTst = sdRow?.resolved_tst != null ? Number(sdRow.resolved_tst) : null;
  const resolvedTib = sdRow?.resolved_tib != null ? Number(sdRow.resolved_tib) : null;
  const hasActualDataToday =
    (resolvedTst != null && resolvedTst > 0) ||
    (resolvedTib != null && resolvedTib > 0) ||
    todayData != null;

  let missStreak = 0;
  {
    const allPriorRows = await pool.query(
      `SELECT dl.day,
              CASE WHEN dl.actual_bed_time IS NOT NULL AND dl.actual_wake_time IS NOT NULL THEN true
                   WHEN dl.sleep_minutes IS NOT NULL AND dl.sleep_minutes > 0 THEN true
                   WHEN dl.sleep_rem_min IS NOT NULL OR dl.sleep_core_min IS NOT NULL OR dl.sleep_deep_min IS NOT NULL THEN true
                   WHEN EXISTS (SELECT 1 FROM sleep_summary_daily ssd WHERE ssd.user_id = dl.user_id AND ssd.date = dl.day::date AND ssd.total_sleep_minutes > 0) THEN true
                   ELSE false END AS has_sleep
       FROM daily_log dl
       WHERE dl.user_id = $1 AND dl.day < $2 AND dl.day >= ($2::date - 14)::text
       ORDER BY dl.day DESC`,
      [userId, date],
    );
    for (const r of allPriorRows.rows) {
      if (r.has_sleep) break;
      missStreak++;
    }
  }

  const avgDeviationMin = allDays.length > 0
    ? allDays.slice(0, 7).reduce((s, d) => s + d.driftMag, 0) / Math.min(allDays.length, 7)
    : null;

  const mods = computeRecoveryModifiers(missStreak, avgDeviationMin);

  const DRIFT_EVENT_THRESHOLD = 45;

  const allDaysSorted = [...allDays].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (scheduledToday && !hasActualDataToday) {
    recoveryEventFound = true;
    recoveryEventDriftMag0 = null;
    recoveryReason = "missing_scheduled_data";
    recoveryRaw = 0;
    recoverySuppressed = 0;
    recoveryFinal = 0;
    scheduleRecoveryScore = 0;
  } else {
    let eventIdx = -1;
    for (let i = allDaysSorted.length - 1; i >= 0; i--) {
      if (allDaysSorted[i].driftMag >= DRIFT_EVENT_THRESHOLD) {
        eventIdx = i;
        break;
      }
    }

    if (eventIdx === -1) {
      recoveryEventFound = false;
      recoveryReason = "no_event";
    } else {
      recoveryEventFound = true;
      const d0 = allDaysSorted[eventIdx];
      recoveryEventDriftMag0 = Math.round(d0.driftMag * 100) / 100;
      debugRecoveryDays.push({ date: d0.date, driftMag: d0.driftMag });

      const available = allDaysSorted.slice(eventIdx + 1);
      const followDays = available.slice(0, Math.min(4, available.length));
      recoveryFollowDaysK = followDays.length;

      if (followDays.length > 0) {
        const avgFollow = followDays.reduce((s, d) => s + d.driftMag, 0) / followDays.length;
        recoveryFollowAvgDriftMag = Math.round(avgFollow * 100) / 100;
        const improvement = (d0.driftMag - avgFollow) / d0.driftMag;
        recoveryRaw = clamp(Math.round(100 * improvement), 0, 100);
        recoverySuppressed = recoveryRaw * mods.suppressionFactor;
        recoveryFinal = applyRecoveryModifiers(recoveryRaw, mods);
        scheduleRecoveryScore = recoveryFinal;
        followDays.forEach((d) => debugRecoveryDays.push({ date: d.date, driftMag: d.driftMag }));
        if (followDays.length < 4) {
          recoveryReason = "partial_post_event_window";
        } else {
          recoveryReason = "computed";
        }
      } else {
        recoveryReason = "insufficient_post_event_days";
        scheduleRecoveryScore = null;
      }
    }
  }

  if (scheduledToday && hasActualDataToday && scheduleRecoveryScore == null && recoveryReason === "no_event") {
    scheduleRecoveryScore = 100;
    recoveryConfidence_override = "high";
  }

  const recoveryConfidence: "high" | "low" =
    recoveryConfidence_override ?? (
      recoveryReason === "missing_scheduled_data" ? "high" :
      recoveryReason === "computed" ? "high" : "low"
    );

  return {
    scheduleConsistencyScore,
    scheduleConsistencySdMin,
    scheduleConsistencyNSamples,
    scheduleRecoveryScore,
    recoveryEventFound,
    recoveryEventDriftMag0,
    recoveryFollowDaysK,
    recoveryFollowAvgDriftMag,
    recoveryConfidence,
    recoveryReason,
    debugDriftMags7d: last7.map((d) => Math.round(d.driftMag * 100) / 100),
    debugRecoveryDays,
    scheduledToday,
    hasActualDataToday,
    missStreak: mods.missStreak,
    suppressionFactor: mods.suppressionFactor,
    avgDeviationMin: mods.avgDeviationMin,
    driftPenalty: mods.driftPenalty,
    driftFactor: mods.driftFactor,
    recoveryRaw,
    recoverySuppressed,
    recoveryFinal,
  };
}
