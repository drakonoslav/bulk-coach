import { pool } from "./db";
import { getCardioScheduleSettings } from "./adherence-metrics-range";
import { computeRecoveryModifiers, applyRecoveryModifiers } from "./recovery-helpers";
import { deriveScheduledToday } from "./schedule/deriveScheduledToday";
import { computeCardioContinuity } from "./cardio/computeCardioContinuity";
import { toDomainOutcomeCardio } from "./cardio/toDomainOutcomeCardio";
import { DomainOutcome } from "./types/domainOutcome";

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
  recoveryEventDay: string | null;
  recoveryEventMetric: string | null;
  recoveryThresholdUsed: string | null;
  recoveryFollowDaysK: number;
  recoveryFollowAvgDeviation: number | null;
  recoveryConfidence: "high" | "low";
  recoveryReason: "no_event" | "insufficient_post_event_days" | "partial_post_event_window" | "computed" | "missing_scheduled_data";
  debugDriftMags: number[];
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

export interface CardioOutcome {
  adequacyScore: number | null;
  adequacySource: "productive" | "total" | "none";
  productiveMin: number | null;
  cardioTotalMin: number | null;
  cardioTotalSource: "zones_sum" | "spanMinutes" | "cardio_min" | null;
  plannedDurationMin: number | null;
  efficiencyScore: number | null;
  continuityScore: number | null;
  continuityDenominator: "total_weighted_offband" | null;
  offBandMin: number | null;
  offBandWeighted: number | null;
  productiveMinSource: "zones_sum" | "none";
  outcomeDay: string | null;
  z1Min: number | null;
  z2Min: number | null;
  z3Min: number | null;
  z4Min: number | null;
  z5Min: number | null;
}

export interface CardioBlock {
  scheduleStability: CardioScheduleStability;
  outcome: CardioOutcome;
  domainOutcome: DomainOutcome;
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

  const alignmentRow = rows.find((r: any) => r.day === date) ?? rows[0] ?? null;
  let alignmentScore: number | null = null;
  let alignmentPenaltyMin: number | null = null;
  let actualStart: string | null = null;

  if (alignmentRow) {
    actualStart = alignmentRow.cardio_start_time;
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

  const allDays = rows.map((r: any) => {
    const actualMin = toMin(r.cardio_start_time);
    const driftMag = Math.abs(circularDeltaMinutes(actualMin, plannedStartMin));
    return { date: r.day as string, driftMag };
  });

  const plannedDurationMin = schedule.plannedMin;
  const outcomeRows = await pool.query(
    `SELECT day, zone1_min, zone2_min, zone3_min, zone4_min, zone5_min,
            cardio_start_time, cardio_end_time, cardio_min
     FROM daily_log
     WHERE user_id = $1
       AND day <= $2
       AND day >= ($2::date - 21)::text
     ORDER BY day DESC
     LIMIT 14`,
    [userId, date],
  );

  interface CardioSessionDay {
    date: string;
    productiveMin: number | null;
    totalMin: number | null;
    z1Ratio: number | null;
    missed: boolean;
  }

  const sessionDays: CardioSessionDay[] = outcomeRows.rows.map((r: any) => {
    const z1 = r.zone1_min != null ? Number(r.zone1_min) : null;
    const z2 = r.zone2_min != null ? Number(r.zone2_min) : null;
    const z3 = r.zone3_min != null ? Number(r.zone3_min) : null;
    const z4 = r.zone4_min != null ? Number(r.zone4_min) : null;
    const z5 = r.zone5_min != null ? Number(r.zone5_min) : null;
    const hasZones = z1 != null && z2 != null && z3 != null;

    let totalMin: number | null = null;
    if (hasZones) {
      totalMin = z1 + z2 + z3 + (z4 ?? 0) + (z5 ?? 0);
    } else if (r.cardio_start_time && r.cardio_end_time) {
      const s = toMin(r.cardio_start_time);
      const e = toMin(r.cardio_end_time);
      let d = e - s; if (d < 0) d += 1440;
      totalMin = d;
    } else if (r.cardio_min != null) {
      totalMin = Number(r.cardio_min);
    }

    const productiveMin = hasZones ? z2! + z3! : null;
    const z1Ratio = (z1 != null && totalMin != null && totalMin > 0) ? z1 / totalMin : null;
    const missed = totalMin == null || totalMin === 0;

    return { date: r.day as string, productiveMin, totalMin, z1Ratio, missed };
  });

  const sessionDaysSorted = [...sessionDays].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  const schedResult = deriveScheduledToday("cardio", date, null);
  const scheduledToday = schedResult.scheduledToday;
  const scheduledTodayReason = schedResult.reason;
  const scheduledTodayConfidence = schedResult.confidence;
  const todaySession = sessionDaysSorted.find(s => s.date === date);
  const hasActualDataToday = todaySession != null && !todaySession.missed;

  let missStreak = 0;
  {
    const priorDays = sessionDaysSorted.filter(s => s.date < date).sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
    const allPriorRows = await pool.query(
      `SELECT day FROM daily_log WHERE user_id = $1 AND day < $2 AND day >= ($2::date - 14)::text ORDER BY day DESC`,
      [userId, date],
    );
    const allPriorDates = allPriorRows.rows.map((r: any) => r.day as string);
    const priorSessionDates = new Set(priorDays.filter(s => !s.missed).map(s => s.date));
    for (const d of allPriorDates) {
      if (priorSessionDates.has(d)) break;
      missStreak++;
    }
  }

  const avgDeviationMin = allDays.length > 0
    ? allDays.slice(0, 7).reduce((s, d) => s + d.driftMag, 0) / Math.min(allDays.length, 7)
    : null;

  const mods = computeRecoveryModifiers(missStreak, avgDeviationMin);

  let recoveryScore: number | null = null;
  let recoveryEventFound = false;
  let recoveryEventDay: string | null = null;
  let recoveryEventMetric: string | null = null;
  let recoveryThresholdUsed: string | null = null;
  let recoveryFollowDaysK: number = 0;
  let recoveryFollowAvgDeviation: number | null = null;
  let recoveryReason: "no_event" | "insufficient_post_event_days" | "partial_post_event_window" | "computed" | "missing_scheduled_data" = "no_event";
  let recoveryConfidence: "high" | "low" = "low";
  let recoveryRaw: number | null = null;
  let recoverySuppressed: number | null = null;
  let recoveryFinal: number | null = null;

  if (scheduledToday && !hasActualDataToday) {
    recoveryEventFound = true;
    recoveryEventDay = date;
    recoveryEventMetric = "scheduled_miss";
    recoveryThresholdUsed = "no session data on scheduled day";
    recoveryReason = "missing_scheduled_data";
    recoveryConfidence = "high";
    recoveryRaw = 0;
    recoverySuppressed = 0;
    recoveryFinal = 0;
    recoveryScore = 0;
  } else {
    let eventIdx = -1;
    let fallbackEventIdx = -1;
    let fallbackMetric: string | null = null;
    let fallbackThreshold: string | null = null;

    function isCardioEvent(s: CardioSessionDay): { metric: string; threshold: string } | null {
      if (s.missed) return { metric: "session_missed", threshold: "no session data" };
      if (s.productiveMin != null && plannedDurationMin > 0 && s.productiveMin / plannedDurationMin < 0.75)
        return { metric: `productiveMin/plannedMin = ${(s.productiveMin / plannedDurationMin).toFixed(4)}`, threshold: "< 0.75" };
      if (s.totalMin != null && plannedDurationMin > 0 && s.totalMin / plannedDurationMin < 0.75)
        return { metric: `totalMin/plannedMin = ${(s.totalMin / plannedDurationMin).toFixed(4)}`, threshold: "< 0.75" };
      if (s.z1Ratio != null && s.z1Ratio > 0.30)
        return { metric: `z1/totalMin = ${s.z1Ratio.toFixed(4)}`, threshold: "> 0.30" };
      return null;
    }

    for (let i = sessionDaysSorted.length - 1; i >= 0; i--) {
      const ev = isCardioEvent(sessionDaysSorted[i]);
      if (!ev) continue;
      if (fallbackEventIdx === -1) {
        fallbackEventIdx = i;
        fallbackMetric = ev.metric;
        fallbackThreshold = ev.threshold;
      }
      const hasFollowUp = sessionDaysSorted.slice(i + 1).some(s => !s.missed);
      if (hasFollowUp) {
        eventIdx = i;
        recoveryEventMetric = ev.metric;
        recoveryThresholdUsed = ev.threshold;
        break;
      }
    }

    if (eventIdx === -1 && fallbackEventIdx !== -1) {
      eventIdx = fallbackEventIdx;
      recoveryEventMetric = fallbackMetric;
      recoveryThresholdUsed = fallbackThreshold;
    }

    if (eventIdx === -1) {
      recoveryEventFound = false;
      recoveryReason = "no_event";
      recoveryConfidence = "low";
    } else {
      recoveryEventFound = true;
      recoveryEventDay = sessionDaysSorted[eventIdx].date;

      const available = sessionDaysSorted.slice(eventIdx + 1).filter(s => !s.missed);
      const followDays = available.slice(0, Math.min(4, available.length));
      recoveryFollowDaysK = followDays.length;

      if (followDays.length === 0) {
        recoveryReason = "insufficient_post_event_days";
        recoveryConfidence = "low";
      } else if (plannedDurationMin > 0) {
        const deviations = followDays.map(s => {
          const ratio = (s.productiveMin ?? s.totalMin ?? 0) / plannedDurationMin;
          return Math.abs(1 - ratio);
        });
        const avgDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
        recoveryFollowAvgDeviation = avgDev;
        const avgDevMin = avgDev * plannedDurationMin;
        recoveryRaw = clamp(100 - (avgDevMin / 60) * 100, 0, 100);
        recoverySuppressed = recoveryRaw * mods.suppressionFactor;
        recoveryFinal = applyRecoveryModifiers(recoveryRaw, mods);
        recoveryScore = recoveryFinal;
        if (followDays.length < 4) {
          recoveryReason = "partial_post_event_window";
          recoveryConfidence = "low";
        } else {
          recoveryReason = "computed";
          recoveryConfidence = "high";
        }
      } else {
        recoveryReason = "insufficient_post_event_days";
        recoveryConfidence = "low";
      }
    }
  }

  const recoveryApplicable = recoveryReason !== "no_event";

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
    recoveryEventDay,
    recoveryEventMetric,
    recoveryThresholdUsed,
    recoveryFollowDaysK,
    recoveryFollowAvgDeviation,
    recoveryConfidence,
    recoveryReason,
    debugDriftMags: allDays.slice(0, 7).map((d) => d.driftMag),
    scheduledToday,
    scheduledTodayReason,
    scheduledTodayConfidence,
    hasActualDataToday,
    missStreak: mods.missStreak,
    suppressionFactor: mods.suppressionFactor,
    avgDeviationMin: mods.avgDeviationMin,
    driftPenalty: mods.driftPenalty,
    driftFactor: mods.driftFactor,
    recoveryRaw,
    recoverySuppressed,
    recoveryFinal,
    recoveryApplicable,
  };
}

export async function computeCardioOutcome(
  date: string,
  userId: string = DEFAULT_USER_ID,
): Promise<CardioOutcome> {
  const schedule = await getCardioScheduleSettings(userId);
  const plannedDurationMin = schedule.plannedMin;

  const { rows } = await pool.query(
    `SELECT day, cardio_start_time, cardio_end_time, cardio_min,
            zone1_min, zone2_min, zone3_min, zone4_min, zone5_min
     FROM daily_log
     WHERE user_id = $2
       AND day <= $1
       AND day >= ($1::date - 14)::text
       AND (cardio_start_time IS NOT NULL OR cardio_min IS NOT NULL
            OR zone1_min IS NOT NULL)
     ORDER BY day DESC
     LIMIT 1`,
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
  const adequacyNumerator = productiveMin ?? cardioTotalMin;
  if (adequacyNumerator != null && plannedDurationMin > 0) {
    adequacyScore = clamp(100 * adequacyNumerator / plannedDurationMin, 0, 110);
  }

  let efficiencyScore: number | null = null;
  if (productiveMin != null && cardioTotalMin != null && cardioTotalMin > 0) {
    efficiencyScore = clamp(100 * productiveMin / cardioTotalMin, 0, 100);
  }

  let continuityScore: number | null = null;
  let offBandMin: number | null = null;
  let offBandWeighted: number | null = null;
  let z1Grace: number | null = null;
  let z1Penalty: number | null = null;
  if (hasZones && cardioTotalMin != null && cardioTotalMin > 0) {
    const contResult = computeCardioContinuity({
      z1: z1!, z2: z2!, z3: z3!, z4: z4 ?? 0, z5: z5 ?? 0,
    });
    if ("continuity" in contResult && contResult.continuity != null) {
      continuityScore = contResult.continuity;
      offBandWeighted = contResult.offBandWeighted;
      z1Grace = contResult.z1Grace;
      z1Penalty = contResult.z1Penalty;
    }
    offBandMin = z1! + (z4 ?? 0) + (z5 ?? 0);
  }

  const adequacySource: "productive" | "total" | "none" =
    productiveMin != null ? "productive" : cardioTotalMin != null ? "total" : "none";

  return {
    adequacyScore,
    adequacySource,
    productiveMin,
    cardioTotalMin,
    cardioTotalSource,
    plannedDurationMin,
    efficiencyScore,
    continuityScore,
    continuityDenominator: continuityScore != null ? "total_weighted_offband" as const : null,
    offBandMin,
    offBandWeighted,
    productiveMinSource: hasZones ? "zones_sum" as const : "none" as const,
    outcomeDay: r?.day ?? null,
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
  const domainOutcome = toDomainOutcomeCardio({
    dateISO: date,
    scheduleStability,
    outcome,
  });
  return { scheduleStability, outcome, domainOutcome };
}
