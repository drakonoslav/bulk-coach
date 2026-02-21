import { pool } from "./db";
import { computeReadinessDeltas } from "./readiness-deltas";
import { computeRangeAdherence } from "./adherence-metrics-range";

const DEFAULT_USER_ID = "local_default";

export type ContextPhase =
  | "NOVELTY_DISTURBANCE"
  | "ADAPTIVE_STABILIZATION"
  | "CHRONIC_SUPPRESSION"
  | "INSUFFICIENT_DATA";

export interface PhaseResult {
  phase: ContextPhase;
  confidence: number;
  summary: string;
  metrics: {
    disturbanceScore: number;
    disturbanceSlope14d: number;
    taggedDays: number;
    adjustmentAttempted: boolean;
    cortisolFlagRate: number | null;
  };
}

export interface DisturbanceResult {
  score: number;
  reasons: string[];
  components: {
    hrv: number;
    rhr: number;
    slp: number;
    prx: number;
    drf: number;
    lateRate: number | null;
  };
}

export const FULL_SWING = {
  HRV_PCT: 8,
  RHR_BPM: 3,
  SLEEP_PCT: 10,
  PROXY_PCT: 10,
  LATE_RATE: 3 / 7,
} as const;

const W = {
  HRV: 0.30,
  RHR: 0.20,
  SLEEP: 0.20,
  PROXY: 0.20,
  DRIFT: 0.10,
} as const;

export const PHASE_THRESH = {
  DISTURB_MILD: 56,
  DISTURB_MOD: 62,
  DISTURB_HIGH: 70,
  IMPROVING_PER_WK: -2.0,
  WORSENING_PER_WK: +2.0,
  CORTISOL_RATE_HIGH: 0.30,
  STABILIZATION_DAYS: 14,
  MIN_TAGGED_DAYS: 3,
} as const;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function norm(value: number, swing: number): number {
  return clamp(value / swing, -1.5, 1.5);
}

export function computeDisturbanceScore(d: {
  hrv_pct?: number | null;
  sleep_pct?: number | null;
  proxy_pct?: number | null;
  rhr_bpm?: number | null;
  bedtimeDriftLateNights7d?: number | null;
  bedtimeDriftMeasuredNights7d?: number | null;
}): DisturbanceResult {
  const reasons: string[] = [];

  const hrv = d.hrv_pct == null ? 0 : -norm(d.hrv_pct, FULL_SWING.HRV_PCT);
  const slp = d.sleep_pct == null ? 0 : -norm(d.sleep_pct, FULL_SWING.SLEEP_PCT);
  const prx = d.proxy_pct == null ? 0 : -norm(d.proxy_pct, FULL_SWING.PROXY_PCT);
  const rhr = d.rhr_bpm == null ? 0 : norm(d.rhr_bpm, FULL_SWING.RHR_BPM);

  const hasDrift =
    d.bedtimeDriftLateNights7d != null &&
    d.bedtimeDriftMeasuredNights7d != null &&
    d.bedtimeDriftMeasuredNights7d > 0;

  const lateRate = hasDrift
    ? d.bedtimeDriftLateNights7d! / d.bedtimeDriftMeasuredNights7d!
    : null;

  const drf = lateRate == null ? 0 : clamp(norm(lateRate, FULL_SWING.LATE_RATE), 0, 1.5);

  if (d.hrv_pct != null) reasons.push("HRV delta");
  if (d.rhr_bpm != null) reasons.push("RHR delta");
  if (d.sleep_pct != null) reasons.push("Sleep delta");
  if (hasDrift) reasons.push("Bedtime drift");
  if (d.proxy_pct != null) reasons.push("Proxy delta");

  const raw =
    hrv * W.HRV +
    rhr * W.RHR +
    slp * W.SLEEP +
    prx * W.PROXY +
    drf * W.DRIFT;

  const score = clamp(Math.round((50 + raw * 25) * 10) / 10, 0, 100);

  return { score, reasons, components: { hrv, rhr, slp, prx, drf, lateRate } };
}

export function cortisolFlagAligned(d: {
  hrv_pct?: number | null;
  rhr_bpm?: number | null;
  sleep_pct?: number | null;
  proxy_pct?: number | null;
}): boolean {
  let hits = 0;
  if (d.hrv_pct != null && d.hrv_pct <= -8) hits++;
  if (d.rhr_bpm != null && d.rhr_bpm >= +3) hits++;
  if (d.sleep_pct != null && d.sleep_pct <= -10) hits++;
  if (d.proxy_pct != null && d.proxy_pct <= -10) hits++;
  return hits >= 3;
}

export function classifyContextPhase(args: {
  tag: string;
  taggedDaysInLast21: number;
  disturbanceNow: number;
  disturbanceSlope14d: number | null;
  adjustmentAttemptedInLast28: boolean;
  daysSinceAdjustmentAttempt: number | null;
  cortisolFlagRate: number | null;
}): PhaseResult {
  const {
    tag,
    taggedDaysInLast21,
    disturbanceNow,
    disturbanceSlope14d,
    adjustmentAttemptedInLast28,
    daysSinceAdjustmentAttempt,
    cortisolFlagRate,
  } = args;

  if (taggedDaysInLast21 < PHASE_THRESH.MIN_TAGGED_DAYS || disturbanceSlope14d == null) {
    return {
      phase: "INSUFFICIENT_DATA",
      confidence: 30,
      summary: `Not enough tagged data for "${tag}" yet. Log ${PHASE_THRESH.MIN_TAGGED_DAYS}+ tagged days over ~3 weeks.`,
      metrics: {
        disturbanceScore: disturbanceNow,
        disturbanceSlope14d: disturbanceSlope14d ?? 0,
        taggedDays: taggedDaysInLast21,
        adjustmentAttempted: adjustmentAttemptedInLast28,
        cortisolFlagRate,
      },
    };
  }

  const tooSoonForStabilization =
    !adjustmentAttemptedInLast28 ||
    (daysSinceAdjustmentAttempt != null && daysSinceAdjustmentAttempt < PHASE_THRESH.STABILIZATION_DAYS);

  if (tooSoonForStabilization) {
    const conf = disturbanceNow >= PHASE_THRESH.DISTURB_MOD ? 70 : 55;
    return {
      phase: "NOVELTY_DISTURBANCE",
      confidence: conf,
      summary: `Elevated disturbance around "${tag}" — early integration window. Observe for 2–4 weeks before concluding.`,
      metrics: {
        disturbanceScore: disturbanceNow,
        disturbanceSlope14d,
        taggedDays: taggedDaysInLast21,
        adjustmentAttempted: adjustmentAttemptedInLast28,
        cortisolFlagRate,
      },
    };
  }

  const isChronicByCortisol =
    cortisolFlagRate != null && cortisolFlagRate >= PHASE_THRESH.CORTISOL_RATE_HIGH;

  if (
    adjustmentAttemptedInLast28 &&
    (
      (disturbanceNow >= PHASE_THRESH.DISTURB_HIGH && disturbanceSlope14d >= PHASE_THRESH.WORSENING_PER_WK) ||
      isChronicByCortisol
    )
  ) {
    return {
      phase: "CHRONIC_SUPPRESSION",
      confidence: 90,
      summary: `Persistent physiological suppression around "${tag}" despite adjustments. Treat as a sustainability signal.`,
      metrics: {
        disturbanceScore: disturbanceNow,
        disturbanceSlope14d,
        taggedDays: taggedDaysInLast21,
        adjustmentAttempted: adjustmentAttemptedInLast28,
        cortisolFlagRate,
      },
    };
  }

  if (adjustmentAttemptedInLast28 && disturbanceSlope14d <= PHASE_THRESH.WORSENING_PER_WK) {
    const conf = disturbanceSlope14d <= PHASE_THRESH.IMPROVING_PER_WK ? 85 : 70;
    return {
      phase: "ADAPTIVE_STABILIZATION",
      confidence: conf,
      summary: `After adjustment attempts, disturbance is stabilizing. Keep the boundary and re-check in 2 weeks.`,
      metrics: {
        disturbanceScore: disturbanceNow,
        disturbanceSlope14d,
        taggedDays: taggedDaysInLast21,
        adjustmentAttempted: adjustmentAttemptedInLast28,
        cortisolFlagRate,
      },
    };
  }

  return {
    phase: "ADAPTIVE_STABILIZATION",
    confidence: 65,
    summary: `Mixed signal around "${tag}". Maintain boundaries and collect 2 more weeks.`,
    metrics: {
      disturbanceScore: disturbanceNow,
      disturbanceSlope14d,
      taggedDays: taggedDaysInLast21,
      adjustmentAttempted: adjustmentAttemptedInLast28,
      cortisolFlagRate,
    },
  };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysDiff(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000,
  );
}

function rollingMean(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

export interface ContextEvent {
  id: number;
  userId: string;
  day: string;
  tag: string;
  intensity: number;
  label: string | null;
  notes: string | null;
  adjustmentAttempted: boolean;
  adjustmentAttemptedDay: string | null;
}

export async function upsertContextEvent(
  event: {
    day: string;
    tag: string;
    intensity?: number;
    label?: string | null;
    notes?: string | null;
    adjustmentAttempted?: boolean;
    adjustmentAttemptedDay?: string | null;
  },
  userId: string = DEFAULT_USER_ID,
): Promise<ContextEvent> {
  const { rows } = await pool.query(
    `INSERT INTO context_events (user_id, day, tag, intensity, label, notes, adjustment_attempted, adjustment_attempted_day, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id, day, tag) DO UPDATE SET
       intensity = EXCLUDED.intensity,
       label = EXCLUDED.label,
       notes = EXCLUDED.notes,
       adjustment_attempted = EXCLUDED.adjustment_attempted,
       adjustment_attempted_day = EXCLUDED.adjustment_attempted_day,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      event.day,
      event.tag,
      event.intensity ?? 1,
      event.label ?? null,
      event.notes ?? null,
      event.adjustmentAttempted ?? false,
      event.adjustmentAttemptedDay ?? null,
    ],
  );
  return rowToEvent(rows[0]);
}

export async function updateContextEvent(
  id: number,
  updates: Partial<{
    tag: string;
    intensity: number;
    label: string | null;
    notes: string | null;
    adjustmentAttempted: boolean;
    adjustmentAttemptedDay: string | null;
  }>,
  userId: string = DEFAULT_USER_ID,
): Promise<ContextEvent | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (updates.tag !== undefined) { sets.push(`tag = $${idx++}`); vals.push(updates.tag); }
  if (updates.intensity !== undefined) { sets.push(`intensity = $${idx++}`); vals.push(updates.intensity); }
  if (updates.label !== undefined) { sets.push(`label = $${idx++}`); vals.push(updates.label); }
  if (updates.notes !== undefined) { sets.push(`notes = $${idx++}`); vals.push(updates.notes); }
  if (updates.adjustmentAttempted !== undefined) { sets.push(`adjustment_attempted = $${idx++}`); vals.push(updates.adjustmentAttempted); }
  if (updates.adjustmentAttemptedDay !== undefined) { sets.push(`adjustment_attempted_day = $${idx++}`); vals.push(updates.adjustmentAttemptedDay); }

  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(id, userId);

  const { rows } = await pool.query(
    `UPDATE context_events SET ${sets.join(", ")} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
    vals,
  );
  return rows.length > 0 ? rowToEvent(rows[0]) : null;
}

export async function deleteContextEvent(id: number, userId: string = DEFAULT_USER_ID): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM context_events WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getContextEvents(
  userId: string = DEFAULT_USER_ID,
  opts?: { tag?: string; from?: string; to?: string },
): Promise<ContextEvent[]> {
  let q = `SELECT * FROM context_events WHERE user_id = $1`;
  const vals: unknown[] = [userId];
  let idx = 2;

  if (opts?.tag) { q += ` AND tag = $${idx++}`; vals.push(opts.tag); }
  if (opts?.from) { q += ` AND day >= $${idx++}`; vals.push(opts.from); }
  if (opts?.to) { q += ` AND day <= $${idx++}`; vals.push(opts.to); }

  q += ` ORDER BY day DESC`;

  const { rows } = await pool.query(q, vals);
  return rows.map(rowToEvent);
}

export async function getDistinctTags(userId: string = DEFAULT_USER_ID): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT tag FROM context_events WHERE user_id = $1 ORDER BY tag ASC`,
    [userId],
  );
  return rows.map((r: any) => r.tag);
}

export async function markAdjustmentAttempted(
  tag: string,
  day: string,
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  await pool.query(
    `INSERT INTO context_events (user_id, day, tag, intensity, adjustment_attempted, adjustment_attempted_day, updated_at)
     VALUES ($1, $2, $3, 0, TRUE, $2, NOW())`,
    [userId, day, tag],
  );
}

export async function computeContextLens(
  tag: string,
  referenceDate: string,
  userId: string = DEFAULT_USER_ID,
): Promise<PhaseResult & { disturbance: DisturbanceResult }> {
  const from21 = addDays(referenceDate, -20);
  const from28 = addDays(referenceDate, -27);
  const from34 = addDays(referenceDate, -34);

  const { rows: taggedRows } = await pool.query(
    `SELECT day, adjustment_attempted, adjustment_attempted_day
     FROM context_events
     WHERE user_id = $1 AND tag = $2 AND day >= $3 AND day <= $4
     ORDER BY day ASC`,
    [userId, tag, from28, referenceDate],
  );

  const taggedDaysInLast21 = taggedRows.filter(
    (r: any) => r.day >= from21 && r.day <= referenceDate,
  ).length;

  const adjustmentRows = taggedRows.filter((r: any) => r.adjustment_attempted);
  const adjustmentAttemptedInLast28 = adjustmentRows.length > 0;

  let daysSinceAdjustmentAttempt: number | null = null;
  if (adjustmentAttemptedInLast28) {
    const latestAdjDay = adjustmentRows
      .map((r: any) => r.adjustment_attempted_day || r.day)
      .sort()
      .reverse()[0];
    daysSinceAdjustmentAttempt = daysDiff(latestAdjDay, referenceDate);
  }

  const taggedDaySet = new Set(taggedRows.map((r: any) => r.day as string));

  const { rows: vitalsRows } = await pool.query(
    `SELECT date::text as date, hrv_rmssd_ms, resting_hr_bpm
     FROM vitals_daily WHERE date BETWEEN $1::date AND $2::date AND user_id = $3 ORDER BY date ASC`,
    [from34, referenceDate, userId],
  );

  const { rows: sleepRows } = await pool.query(
    `SELECT date::text as date, total_sleep_minutes
     FROM sleep_summary_daily WHERE date BETWEEN $1::date AND $2::date AND user_id = $3 ORDER BY date ASC`,
    [from34, referenceDate, userId],
  );

  const { rows: proxyRows } = await pool.query(
    `SELECT date::text as date, proxy_score
     FROM androgen_proxy_daily WHERE date BETWEEN $1::date AND $2::date AND user_id = $3 AND computed_with_imputed = FALSE ORDER BY date ASC`,
    [from34, referenceDate, userId],
  );

  const vitalsMap = new Map<string, { hrv: number | null; rhr: number | null }>();
  for (const r of vitalsRows) {
    vitalsMap.set(r.date, {
      hrv: r.hrv_rmssd_ms != null ? Number(r.hrv_rmssd_ms) : null,
      rhr: r.resting_hr_bpm != null ? Number(r.resting_hr_bpm) : null,
    });
  }

  const sleepMap = new Map<string, number>();
  for (const r of sleepRows) {
    if (r.total_sleep_minutes != null) sleepMap.set(r.date, Number(r.total_sleep_minutes));
  }

  const proxyMap = new Map<string, number>();
  for (const r of proxyRows) {
    if (r.proxy_score != null) proxyMap.set(r.date, Number(r.proxy_score));
  }

  const allDates: string[] = [];
  let cur = from34;
  while (cur <= referenceDate) {
    allDates.push(cur);
    cur = addDays(cur, 1);
  }

  const len = allDates.length;
  const hrvAll = allDates.map(d => vitalsMap.get(d)?.hrv ?? null);
  const rhrAll = allDates.map(d => vitalsMap.get(d)?.rhr ?? null);
  const sleepAll = allDates.map(d => sleepMap.get(d) ?? null);
  const proxyAll = allDates.map(d => proxyMap.get(d) ?? null);

  const last7 = (arr: (number | null)[]) => arr.slice(Math.max(0, len - 7));
  const last28 = (arr: (number | null)[]) => arr.slice(Math.max(0, len - 28));

  const deltas = computeReadinessDeltas({
    hrvMs_7d: rollingMean(last7(hrvAll)),
    hrvMs_28d: rollingMean(last28(hrvAll)),
    rhrBpm_7d: rollingMean(last7(rhrAll)),
    rhrBpm_28d: rollingMean(last28(rhrAll)),
    sleepMin_7d: rollingMean(last7(sleepAll)),
    sleepMin_28d: rollingMean(last28(sleepAll)),
    proxy_7d: rollingMean(last7(proxyAll)),
    proxy_28d: rollingMean(last28(proxyAll)),
  });

  const adherenceMap = await computeRangeAdherence(referenceDate, referenceDate, userId);
  const todayAdherence = adherenceMap.get(referenceDate);

  const disturbance = computeDisturbanceScore({
    hrv_pct: deltas.hrv_pct,
    sleep_pct: deltas.sleep_pct,
    proxy_pct: deltas.proxy_pct,
    rhr_bpm: deltas.rhr_bpm,
    bedtimeDriftLateNights7d: todayAdherence?.bedtimeDriftLateNights7d ?? null,
    bedtimeDriftMeasuredNights7d: todayAdherence?.bedtimeDriftMeasuredNights7d ?? null,
  });

  let disturbanceSlope14d: number | null = null;
  if (taggedDaysInLast21 >= PHASE_THRESH.MIN_TAGGED_DAYS) {
    const midpoint = addDays(referenceDate, -14);

    const midHrvAll = allDates.filter(d => d <= midpoint).map(d => vitalsMap.get(d)?.hrv ?? null);
    const midRhrAll = allDates.filter(d => d <= midpoint).map(d => vitalsMap.get(d)?.rhr ?? null);
    const midSleepAll = allDates.filter(d => d <= midpoint).map(d => sleepMap.get(d) ?? null);
    const midProxyAll = allDates.filter(d => d <= midpoint).map(d => proxyMap.get(d) ?? null);

    const midLen = midHrvAll.length;
    const mid7 = (arr: (number | null)[]) => arr.slice(Math.max(0, midLen - 7));
    const mid28 = (arr: (number | null)[]) => arr.slice(Math.max(0, midLen - 28));

    const midDeltas = computeReadinessDeltas({
      hrvMs_7d: rollingMean(mid7(midHrvAll)),
      hrvMs_28d: rollingMean(mid28(midHrvAll)),
      rhrBpm_7d: rollingMean(mid7(midRhrAll)),
      rhrBpm_28d: rollingMean(mid28(midRhrAll)),
      sleepMin_7d: rollingMean(mid7(midSleepAll)),
      sleepMin_28d: rollingMean(mid28(midSleepAll)),
      proxy_7d: rollingMean(mid7(midProxyAll)),
      proxy_28d: rollingMean(mid28(midProxyAll)),
    });

    const midAdherenceMap = await computeRangeAdherence(midpoint, midpoint, userId);
    const midAdherence = midAdherenceMap.get(midpoint);

    const midDisturbance = computeDisturbanceScore({
      hrv_pct: midDeltas.hrv_pct,
      sleep_pct: midDeltas.sleep_pct,
      proxy_pct: midDeltas.proxy_pct,
      rhr_bpm: midDeltas.rhr_bpm,
      bedtimeDriftLateNights7d: midAdherence?.bedtimeDriftLateNights7d ?? null,
      bedtimeDriftMeasuredNights7d: midAdherence?.bedtimeDriftMeasuredNights7d ?? null,
    });

    disturbanceSlope14d = Math.round(((disturbance.score - midDisturbance.score) / 2) * 10) / 10;
  }

  let cortisolFlagRate: number | null = null;
  const taggedDaysWithReadiness = Array.from(taggedDaySet).filter(d => d >= from21);
  if (taggedDaysWithReadiness.length > 0) {
    const { rows: readinessRows } = await pool.query(
      `SELECT date::text as date, cortisol_flag FROM readiness_daily
       WHERE user_id = $1 AND date = ANY($2::date[])`,
      [userId, taggedDaysWithReadiness],
    );
    const flagged = readinessRows.filter((r: any) => r.cortisol_flag).length;
    cortisolFlagRate = Math.round((flagged / taggedDaysWithReadiness.length) * 100) / 100;
  }

  const phase = classifyContextPhase({
    tag,
    taggedDaysInLast21,
    disturbanceNow: disturbance.score,
    disturbanceSlope14d,
    adjustmentAttemptedInLast28,
    daysSinceAdjustmentAttempt,
    cortisolFlagRate,
  });

  return { ...phase, disturbance };
}

function rowToEvent(r: any): ContextEvent {
  return {
    id: r.id,
    userId: r.user_id,
    day: r.day,
    tag: r.tag,
    intensity: Number(r.intensity),
    label: r.label ?? null,
    notes: r.notes ?? null,
    adjustmentAttempted: !!r.adjustment_attempted,
    adjustmentAttemptedDay: r.adjustment_attempted_day ?? null,
  };
}
