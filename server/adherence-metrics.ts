import { pool } from "./db";
import { getSleepPlanSettings } from "./sleep-alignment";

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

function circDiffMin(actualMin: number, plannedMin: number): number {
  let d = actualMin - plannedMin;
  while (d > 720) d -= 1440;
  while (d < -720) d += 1440;
  return d;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DriftResult {
  bedtimeDriftLateNights7d: number;
  wakeDriftEarlyNights7d: number;
  measuredNights7d: number;
  bedtimeDriftNote: string | null;
  wakeDriftNote: string | null;
}

export async function computeDrift7d(
  date: string,
  userId: string = DEFAULT_USER_ID,
  lateThresholdMin = 30,
  earlyThresholdMin = -30,
): Promise<DriftResult> {
  const startDate = addDays(date, -6);

  const { rows } = await pool.query(
    `SELECT day, actual_bed_time, actual_wake_time,
            planned_bed_time, planned_wake_time
     FROM daily_log
     WHERE day >= $1 AND day <= $2 AND user_id = $3
     ORDER BY day ASC`,
    [startDate, date, userId],
  );

  const schedule = await getSleepPlanSettings(userId);
  const byDate = new Map<string, typeof rows[0]>();
  for (const r of rows) byDate.set(r.day, r);

  let measured = 0;
  let lateCount = 0;
  let earlyWakeCount = 0;

  for (let i = 0; i < 7; i++) {
    const d = addDays(startDate, i);
    const r = byDate.get(d);
    if (!r) continue;

    const plannedBed = r.planned_bed_time || schedule.bedtime;
    const plannedWake = r.planned_wake_time || schedule.wake;
    const actualBed = r.actual_bed_time || null;
    const actualWake = r.actual_wake_time || null;

    if (!actualBed && !actualWake) continue;
    measured++;

    if (actualBed && plannedBed) {
      const bedDev = circDiffMin(toMin(actualBed), toMin(plannedBed));
      if (bedDev > lateThresholdMin) lateCount++;
    }

    if (actualWake && plannedWake) {
      const wakeDev = circDiffMin(toMin(actualWake), toMin(plannedWake));
      if (wakeDev < earlyThresholdMin) earlyWakeCount++;
    }
  }

  return {
    bedtimeDriftLateNights7d: lateCount,
    wakeDriftEarlyNights7d: earlyWakeCount,
    measuredNights7d: measured,
    bedtimeDriftNote: measured === 0 ? "No bed/wake timing data in last 7d" :
      lateCount >= 3 ? `Bedtime drift: ${lateCount}/7 late nights (>30m) — avalanche risk` : null,
    wakeDriftNote: measured === 0 ? null :
      earlyWakeCount >= 3 ? `Early waking drift: ${earlyWakeCount}/7 (sleep debt risk)` : null,
  };
}

export interface PrimaryDriver {
  driver: string;
  severity: number;
  recommendation: string;
}

export function computePrimaryDriver(
  adequacyShortfallMin: number | null,
  wakeDevMin: number | null,
  bedDevMin: number | null,
  hrvPct: number | null,
  rhrBpm: number | null,
  proxyPct: number | null,
  awakeInBedMin: number | null = null,
  awakeInBedDeltaMin: number | null = null,
): PrimaryDriver | null {
  const candidates: PrimaryDriver[] = [];

  if (adequacyShortfallMin != null && adequacyShortfallMin > 30) {
    candidates.push({
      driver: "Sleep shortfall",
      severity: adequacyShortfallMin,
      recommendation: adequacyShortfallMin > 90
        ? "Sleep debt: reduce training intensity today."
        : `Sleep shortfall of ${Math.round(adequacyShortfallMin)}m — prioritize earlier bedtime tonight.`,
    });
  }

  if (wakeDevMin != null && Math.abs(wakeDevMin) > 30) {
    const absWake = Math.abs(wakeDevMin);
    if (wakeDevMin < 0) {
      candidates.push({
        driver: "Early wake",
        severity: absWake * 0.8,
        recommendation: absWake > 90
          ? "Protect wake window: stay in bed until planned wake or return to bed later."
          : `Woke ${absWake}m early — sleep debt accumulating.`,
      });
    }
  }

  if (bedDevMin != null && bedDevMin > 30) {
    const absBed = Math.round(bedDevMin);
    candidates.push({
      driver: "Late bedtime",
      severity: bedDevMin * 0.7,
      recommendation: `Circadian Drift: +${absBed}m past anchor (21:45)\nRecommendation: compress bedtime window by 10–15m nightly`,
    });
  }

  const awakeInBedTriggered = awakeInBedMin != null && (awakeInBedMin >= 45 || (awakeInBedDeltaMin != null && awakeInBedDeltaMin > 20));
  if (awakeInBedTriggered) {
    candidates.push({
      driver: "Awake in bed",
      severity: (awakeInBedMin! >= 60 ? awakeInBedMin! : awakeInBedMin! * 0.65),
      recommendation: awakeInBedMin! >= 60
        ? `${awakeInBedMin}m awake in bed — review sleep environment and evening routine.`
        : `${awakeInBedMin}m awake in bed${awakeInBedDeltaMin != null ? ` (+${Math.round(awakeInBedDeltaMin)}m vs baseline)` : ""} — monitor for pattern.`,
    });
  }

  if (hrvPct != null && hrvPct < -5) {
    candidates.push({
      driver: "HRV drop",
      severity: Math.abs(hrvPct) * 0.6,
      recommendation: hrvPct < -15
        ? "HRV significantly below baseline — consider a lighter session."
        : "HRV trending down — monitor recovery.",
    });
  }

  if (rhrBpm != null && rhrBpm > 3) {
    candidates.push({
      driver: "RHR elevated",
      severity: rhrBpm * 0.5,
      recommendation: rhrBpm > 5
        ? "Resting HR elevated — fatigue or illness possible, back off intensity."
        : "RHR slightly elevated — keep monitoring.",
    });
  }

  if (proxyPct != null && proxyPct < -10) {
    candidates.push({
      driver: "Androgen proxy drop",
      severity: Math.abs(proxyPct) * 0.4,
      recommendation: "Androgen proxy trending down — review sleep debt and stress load.",
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.severity - a.severity);
  return candidates[0];
}
