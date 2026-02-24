import { pool } from "./db";
import { getCardioScheduleSettings } from "./adherence-metrics-range";

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

export interface CardioScheduleStability {
  alignmentScore: number | null;
  alignmentPenaltyMin: number | null;
  plannedStart: string | null;
  actualStart: string | null;
  consistencyScore: number | null;
  consistencySdMin: number | null;
  consistencyNSessions: number;
  recoveryScore: number | null;
  recoveryEventFound: boolean;
  recoveryEventDriftMag0: number | null;
  recoveryFollowDaysK: number | null;
  recoveryFollowAvgDriftMag: number | null;
  recoveryConfidence: "full" | "low" | null;
  debugDriftMags: number[];
  debugRecoveryDays: { date: string; driftMag: number }[];
}

export interface CardioOutcome {
  adequacyScore: number | null;
  productiveMin: number | null;
  cardioTotalMin: number | null;
  cardioTotalSource: "zones_sum" | "spanMinutes" | "cardio_min" | null;
  plannedDurationMin: number | null;
  efficiencyScore: number | null;
  continuityScore: number | null;
  z1Min: number | null;
  z2Min: number | null;
  z3Min: number | null;
  z4Min: number | null;
  z5Min: number | null;
}

export interface CardioBlock {
  scheduleStability: CardioScheduleStability;
  outcome: CardioOutcome;
}

export async function computeCardioScheduleStability(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<CardioScheduleStability> {
  const schedule = await getCardioScheduleSettings(userId);
  const plannedStartMin = toMin(schedule.start);

  const { rows } = await pool.query(
    `SELECT day, cardio_start_time
     FROM daily_log
     WHERE user_id = $1
       AND day <= $2
       AND day >= ($2::date - 21)::text
       AND cardio_start_time IS NOT NULL
     ORDER BY day DESC
     LIMIT 14`,
    [userId, date],
  );

  const todayRow = rows.find((r: any) => r.day === date);
  let alignmentScore: number | null = null;
  let alignmentPenaltyMin: number | null = null;
  let actualStart: string | null = null;

  if (todayRow) {
    actualStart = todayRow.cardio_start_time;
    const actualStartMin = toMin(actualStart!);
    alignmentPenaltyMin = Math.abs(circularDeltaMinutes(actualStartMin, plannedStartMin));
    alignmentScore = clamp(100 - alignmentPenaltyMin * 100 / 180, 0, 100);
  }

  const last7Sessions = rows.slice(0, 7);
  let consistencyScore: number | null = null;
  let consistencySdMin: number | null = null;
  const consistencyNSessions = last7Sessions.length;

  if (last7Sessions.length >= 4) {
    const startMins = last7Sessions.map((r: any) => toMin(r.cardio_start_time));
    const sd = stddevPop(startMins);
    consistencySdMin = sd;
    consistencyScore = clamp(100 * (1 - sd / 60), 0, 100);
  }

  interface DayDrift {
    date: string;
    driftMag: number;
  }

  const allDays: DayDrift[] = rows.map((r: any) => {
    const actualMin = toMin(r.cardio_start_time);
    const driftMag = Math.abs(circularDeltaMinutes(actualMin, plannedStartMin));
    return { date: r.day, driftMag };
  });

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
    alignmentPenaltyMin,
    plannedStart: schedule.start,
    actualStart,
    consistencyScore,
    consistencySdMin,
    consistencyNSessions,
    recoveryScore,
    recoveryEventFound,
    recoveryEventDriftMag0,
    recoveryFollowDaysK,
    recoveryFollowAvgDriftMag,
    recoveryConfidence,
    debugDriftMags: allDays.slice(0, 7).map((d) => d.driftMag),
    debugRecoveryDays,
  };
}

export async function computeCardioOutcome(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<CardioOutcome> {
  const schedule = await getCardioScheduleSettings(userId);
  const plannedDurationMin = schedule.plannedMin;

  const { rows } = await pool.query(
    `SELECT cardio_start_time, cardio_end_time, cardio_min,
            zone1_min, zone2_min, zone3_min, zone4_min, zone5_min
     FROM daily_log
     WHERE day = $1 AND user_id = $2`,
    [date, userId],
  );

  const r = rows[0] ?? null;

  const z1 = r?.zone1_min != null ? Number(r.zone1_min) : null;
  const z2 = r?.zone2_min != null ? Number(r.zone2_min) : null;
  const z3 = r?.zone3_min != null ? Number(r.zone3_min) : null;
  const z4 = r?.zone4_min != null ? Number(r.zone4_min) : null;
  const z5 = r?.zone5_min != null ? Number(r.zone5_min) : null;
  const hasZones = z1 != null && z2 != null && z3 != null;

  let cardioTotalMin: number | null = null;
  let cardioTotalSource: "zones_sum" | "spanMinutes" | "cardio_min" | null = null;

  if (hasZones) {
    cardioTotalMin = z1 + z2 + z3 + (z4 ?? 0) + (z5 ?? 0);
    cardioTotalSource = "zones_sum";
  } else if (r) {
    if (r.cardio_start_time && r.cardio_end_time) {
      const startM = toMin(r.cardio_start_time);
      const endM = toMin(r.cardio_end_time);
      let dur = endM - startM;
      if (dur < 0) dur += 1440;
      cardioTotalMin = dur;
      cardioTotalSource = "spanMinutes";
    } else if (r.cardio_min != null) {
      cardioTotalMin = Number(r.cardio_min);
      cardioTotalSource = "cardio_min";
    }
  }

  let productiveMin: number | null = null;
  if (hasZones) {
    productiveMin = z2! + z3!;
  }

  let adequacyScore: number | null = null;
  if (productiveMin != null && plannedDurationMin > 0) {
    adequacyScore = clamp(100 * productiveMin / plannedDurationMin, 0, 110);
  }

  let efficiencyScore: number | null = null;
  if (productiveMin != null && cardioTotalMin != null && cardioTotalMin > 0) {
    efficiencyScore = clamp(100 * productiveMin / cardioTotalMin, 0, 100);
  }

  let continuityScore: number | null = null;
  if (hasZones && cardioTotalMin != null && cardioTotalMin > 0) {
    continuityScore = clamp(100 * (1 - z1! / cardioTotalMin), 0, 100);
  }

  return {
    adequacyScore,
    productiveMin,
    cardioTotalMin,
    cardioTotalSource,
    plannedDurationMin,
    efficiencyScore,
    continuityScore,
    z1Min: z1,
    z2Min: z2,
    z3Min: z3,
    z4Min: z4,
    z5Min: z5,
  };
}

export async function computeCardioBlock(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<CardioBlock> {
  const [scheduleStability, outcome] = await Promise.all([
    computeCardioScheduleStability(date, userId),
    computeCardioOutcome(date, userId),
  ]);
  return { scheduleStability, outcome };
}
