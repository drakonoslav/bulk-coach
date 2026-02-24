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
  recoveryEventDriftMag0: number | null;
  recoveryFollowDaysK: number | null;
  recoveryFollowAvgDriftMag: number | null;
  recoveryConfidence: "full" | "low" | null;
  debugStartMins7d: number[];
  debugRecoveryDays: { date: string; driftMag: number }[];
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

  const todayRow = rows.find((r: any) => r.day === date);
  if (todayRow) {
    actualStart = todayRow.lift_start_time;
    const actualStartMin = toMin(todayRow.lift_start_time);
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

  let recoveryScore: number | null = null;
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
    recoveryScore = 100;
    recoveryEventFound = false;
  } else {
    recoveryEventFound = true;
    const d0 = allDaysSorted[eventIdx];
    recoveryEventDriftMag0 = d0.driftMag;
    debugRecoveryDays.push({ date: d0.date, driftMag: d0.driftMag });

    const available = allDaysSorted.slice(eventIdx + 1);
    const followDays = available.slice(0, Math.min(4, available.length));
    recoveryFollowDaysK = followDays.length;

    if (followDays.length > 0) {
      const avgFollow = followDays.reduce((s, d) => s + d.driftMag, 0) / followDays.length;
      recoveryFollowAvgDriftMag = avgFollow;
      const improvement = (d0.driftMag - avgFollow) / d0.driftMag;
      recoveryScore = clamp(100 * improvement, 0, 100);
      followDays.forEach((d) => debugRecoveryDays.push({ date: d.date, driftMag: d.driftMag }));
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
    recoveryEventDriftMag0,
    recoveryFollowDaysK,
    recoveryFollowAvgDriftMag,
    recoveryConfidence,
    debugStartMins7d: last7.map((d) => d.startMin),
    debugRecoveryDays,
  };
}

export async function computeLiftOutcome(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<LiftOutcome> {
  const schedule = await getLiftScheduleSettings(userId);
  const plannedMin = schedule.plannedMin;

  const { rows } = await pool.query(
    `SELECT lift_start_time, lift_end_time, lift_min, lift_done, lift_working_min
     FROM daily_log
     WHERE day = $1 AND user_id = $2`,
    [date, userId],
  );

  const r = rows[0] ?? null;

  let actualMin: number | null = null;

  if (r) {
    if (r.lift_start_time && r.lift_end_time) {
      const startM = toMin(r.lift_start_time);
      const endM = toMin(r.lift_end_time);
      let dur = endM - startM;
      if (dur < 0) dur += 1440;
      actualMin = dur;
    } else if (r.lift_min != null) {
      actualMin = Number(r.lift_min);
    }
  }

  let adequacyScore: number | null = null;
  if (actualMin != null && plannedMin > 0) {
    adequacyScore = clamp(100 * actualMin / plannedMin, 0, 110);
  }

  const workingMin = r?.lift_working_min != null ? Number(r.lift_working_min) : null;
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
