import { pool } from "./db";
import { getLiftScheduleSettings } from "./adherence-metrics-range";

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

export interface LiftScheduleStability {
  alignmentScore: number | null;
  alignmentPenalty: number | null;
  plannedStart: string | null;
  actualStart: string | null;
  consistencyScore: number | null;
  consistencySdMin: number | null;
  consistencyNSamples: number;
  recoveryScore: number | null;
  recoveryEventFound: boolean;
  recoveryEventDay: string | null;
  recoveryEventMetric: string | null;
  recoveryThresholdUsed: string | null;
  recoveryFollowDaysK: number | null;
  recoveryFollowAvgDeviation: number | null;
  recoveryConfidence: "full" | "low" | null;
  recoveryReason: string | null;
  debugStartMins7d: number[];
}

export interface LiftOutcome {
  adequacyScore: number | null;
  actualMin: number | null;
  plannedMin: number | null;
  workingMin: number | null;
  idleMin: number | null;
  efficiencyScore: number | null;
  continuityScore: number | null;
  continuityDenominator: "actual" | null;
  actualSource: "duration_span" | "duration_field" | "none";
  workingSource: "daily_log" | "none";
  outcomeDay: string | null;
}

export interface LiftBlock {
  scheduleStability: LiftScheduleStability;
  outcome: LiftOutcome;
}

export async function computeLiftScheduleStability(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<LiftScheduleStability> {
  const schedule = await getLiftScheduleSettings(userId);
  const plannedStartMin = toMin(schedule.start);

  const { rows } = await pool.query(
    `SELECT day, lift_start_time
     FROM daily_log
     WHERE user_id = $1
       AND day <= $2
       AND day >= ($2::date - 21)::text
       AND lift_start_time IS NOT NULL
     ORDER BY day DESC`,
    [userId, date],
  );

  interface DayDrift {
    date: string;
    startMin: number;
    driftMag: number;
  }

  const allDays: DayDrift[] = rows.map((r: any) => {
    const startMin = toMin(r.lift_start_time);
    const driftMag = Math.abs(circularDeltaMinutes(startMin, plannedStartMin));
    return { date: r.day, startMin, driftMag };
  });

  const last7 = allDays.slice(0, 7);

  let alignmentScore: number | null = null;
  let alignmentPenalty: number | null = null;
  let actualStart: string | null = null;

  const alignmentRow = rows.find((r: any) => r.day === date) ?? rows[0] ?? null;
  if (alignmentRow) {
    actualStart = alignmentRow.lift_start_time;
    const actualStartMin = toMin(alignmentRow.lift_start_time);
    alignmentPenalty = Math.abs(circularDeltaMinutes(actualStartMin, plannedStartMin));
    alignmentScore = clamp(100 - alignmentPenalty * 100 / 180, 0, 100);
  }

  let consistencyScore: number | null = null;
  let consistencySdMin: number | null = null;
  const consistencyNSamples = last7.length;

  if (last7.length >= 4) {
    const startMins = last7.map((d) => d.startMin);
    const sd = stddevPop(startMins);
    consistencySdMin = sd;
    consistencyScore = clamp(100 * (1 - sd / 60), 0, 100);
  }

  const liftPlannedMin = schedule.plannedMin;
  const outcomeRows = await pool.query(
    `SELECT day, lift_start_time, lift_end_time, lift_min, lift_done, lift_working_min
     FROM daily_log
     WHERE user_id = $1
       AND day <= $2
       AND day >= ($2::date - 21)::text
     ORDER BY day DESC
     LIMIT 14`,
    [userId, date],
  );

  interface LiftSessionDay {
    date: string;
    actualMin: number | null;
    workingMin: number | null;
    idleRatio: number | null;
    missed: boolean;
  }

  const sessionDays: LiftSessionDay[] = outcomeRows.rows.map((r: any) => {
    let actualMin: number | null = null;
    if (r.lift_start_time && r.lift_end_time) {
      const s = toMin(r.lift_start_time);
      const e = toMin(r.lift_end_time);
      let d = e - s; if (d < 0) d += 1440;
      actualMin = d;
    } else if (r.lift_min != null) {
      actualMin = Number(r.lift_min);
    }
    const workingMin = r.lift_working_min != null ? Number(r.lift_working_min) : null;
    const idleMin = (actualMin != null && workingMin != null) ? actualMin - workingMin : null;
    const idleRatio = (idleMin != null && actualMin != null && actualMin > 0) ? idleMin / actualMin : null;
    const missed = actualMin == null || actualMin === 0;

    return { date: r.day as string, actualMin, workingMin, idleRatio, missed };
  });

  const sessionDaysSorted = [...sessionDays].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  let recoveryScore: number | null = null;
  let recoveryEventFound = false;
  let recoveryEventDay: string | null = null;
  let recoveryEventMetric: string | null = null;
  let recoveryThresholdUsed: string | null = null;
  let recoveryFollowDaysK: number | null = null;
  let recoveryFollowAvgDeviation: number | null = null;
  let recoveryReason: string | null = null;

  let eventIdx = -1;
  for (let i = sessionDaysSorted.length - 1; i >= 0; i--) {
    const s = sessionDaysSorted[i];
    if (s.missed) {
      eventIdx = i;
      recoveryEventMetric = "session_missed";
      recoveryThresholdUsed = "no session data";
      break;
    }
    if (s.workingMin != null && liftPlannedMin > 0 && s.workingMin / liftPlannedMin < 0.80) {
      eventIdx = i;
      recoveryEventMetric = `workingMin/plannedMin = ${(s.workingMin / liftPlannedMin).toFixed(4)}`;
      recoveryThresholdUsed = "< 0.80";
      break;
    }
    if (s.actualMin != null && liftPlannedMin > 0 && s.actualMin < liftPlannedMin) {
      eventIdx = i;
      recoveryEventMetric = `actualMin < plannedMin (${s.actualMin} < ${liftPlannedMin})`;
      recoveryThresholdUsed = "actualMin < plannedMin";
      break;
    }
    if (s.idleRatio != null && s.idleRatio > 0.25) {
      eventIdx = i;
      recoveryEventMetric = `idleMin/actualMin = ${s.idleRatio.toFixed(4)}`;
      recoveryThresholdUsed = "> 0.25";
      break;
    }
  }

  if (eventIdx === -1) {
    recoveryScore = null;
    recoveryEventFound = false;
    recoveryReason = "no outcome event in last 21d";
  } else {
    recoveryEventFound = true;
    recoveryEventDay = sessionDaysSorted[eventIdx].date;

    const available = sessionDaysSorted.slice(eventIdx + 1).filter(s => !s.missed);
    const followDays = available.slice(0, Math.min(4, available.length));
    recoveryFollowDaysK = followDays.length;

    if (followDays.length > 0 && liftPlannedMin > 0) {
      const deviations = followDays.map(s => {
        const ratio = (s.workingMin ?? s.actualMin ?? 0) / liftPlannedMin;
        return Math.abs(1 - ratio);
      });
      const avgDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
      recoveryFollowAvgDeviation = avgDev;
      recoveryScore = clamp(100 - avgDev * 100, 0, 100);
    } else {
      recoveryScore = null;
    }
  }

  const recoveryConfidence: "full" | "low" | null =
    !recoveryEventFound ? null :
    recoveryFollowDaysK != null && recoveryFollowDaysK >= 4 ? "full" : "low";

  return {
    alignmentScore,
    alignmentPenalty,
    plannedStart: schedule.start,
    actualStart,
    consistencyScore,
    consistencySdMin,
    consistencyNSamples,
    recoveryScore,
    recoveryEventFound,
    recoveryEventDay,
    recoveryEventMetric,
    recoveryThresholdUsed,
    recoveryFollowDaysK,
    recoveryFollowAvgDeviation,
    recoveryConfidence,
    recoveryReason,
    debugStartMins7d: last7.map((d) => d.startMin),
  };
}

export async function computeLiftOutcome(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<LiftOutcome> {
  const schedule = await getLiftScheduleSettings(userId);
  const plannedMin = schedule.plannedMin;

  const { rows } = await pool.query(
    `SELECT day, lift_start_time, lift_end_time, lift_min, lift_done, lift_working_min
     FROM daily_log
     WHERE user_id = $2
       AND day <= $1
       AND day >= ($1::date - 14)::text
       AND (lift_start_time IS NOT NULL OR lift_min IS NOT NULL OR lift_working_min IS NOT NULL)
     ORDER BY day DESC
     LIMIT 1`,
    [date, userId],
  );

  const r = rows[0] ?? null;

  let actualMin: number | null = null;
  let actualSource: "duration_span" | "duration_field" | "none" = "none";

  if (r) {
    if (r.lift_start_time && r.lift_end_time) {
      const startM = toMin(r.lift_start_time);
      const endM = toMin(r.lift_end_time);
      let dur = endM - startM;
      if (dur < 0) dur += 1440;
      actualMin = dur;
      actualSource = "duration_span";
    } else if (r.lift_min != null) {
      actualMin = Number(r.lift_min);
      actualSource = "duration_field";
    }
  }

  let adequacyScore: number | null = null;
  if (actualMin != null && plannedMin > 0) {
    adequacyScore = clamp(100 * actualMin / plannedMin, 0, 110);
  }

  const workingMin = r?.lift_working_min != null ? Number(r.lift_working_min) : null;
  const workingSource: "daily_log" | "none" = workingMin != null ? "daily_log" : "none";
  const idleMin = (actualMin != null && workingMin != null) ? actualMin - workingMin : null;

  let efficiencyScore: number | null = null;
  if (workingMin != null && actualMin != null && actualMin > 0) {
    efficiencyScore = clamp(100 * workingMin / actualMin, 0, 100);
  }

  let continuityScore: number | null = null;
  if (idleMin != null && actualMin != null && actualMin > 0) {
    continuityScore = clamp(100 * (1 - idleMin / actualMin), 0, 100);
  }

  return {
    adequacyScore,
    actualMin,
    plannedMin,
    workingMin,
    idleMin,
    efficiencyScore,
    continuityScore,
    continuityDenominator: continuityScore != null ? "actual" as const : null,
    actualSource,
    workingSource,
    outcomeDay: r?.day ?? null,
  };
}

export async function computeLiftBlock(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<LiftBlock> {
  const [scheduleStability, outcome] = await Promise.all([
    computeLiftScheduleStability(date, userId),
    computeLiftOutcome(date, userId),
  ]);
  return { scheduleStability, outcome };
}
