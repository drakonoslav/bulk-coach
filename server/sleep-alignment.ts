import { pool } from "./db";

const DEFAULT_PLAN_BED = "21:45";
const DEFAULT_PLAN_WAKE = "05:30";

const toMin = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

function wrapDev(raw: number): number {
  let d = raw;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

export interface SleepAlignmentResult {
  sleepEfficiency: number | null;
  bedtimeDeviationMin: number | null;
  wakeDeviationMin: number | null;
  alignmentScore: number | null;
  planBedtime: string;
  planWake: string;
  observedStart: string | null;
  observedEnd: string | null;
  observedMinutes: number | null;
  tossedMinutes: number | null;
  sleepEfficiencyProxy: number | null;
}

export async function computeSleepAlignment(date: string): Promise<SleepAlignmentResult | null> {
  const { rows } = await pool.query(
    `SELECT sleep_minutes, sleep_start, sleep_end,
            sleep_start_local, sleep_end_local,
            sleep_plan_bedtime, sleep_plan_wake, tossed_minutes
     FROM daily_log WHERE day = $1`,
    [date]
  );
  if (!rows[0]) return null;

  const r = rows[0];
  const sleepMin = r.sleep_minutes != null ? Number(r.sleep_minutes) : null;
  const tossed = r.tossed_minutes != null ? Number(r.tossed_minutes) : null;

  const planBed = r.sleep_plan_bedtime || DEFAULT_PLAN_BED;
  const planWake = r.sleep_plan_wake || DEFAULT_PLAN_WAKE;

  const observedStart = r.sleep_start_local || r.sleep_start || null;
  const observedEnd = r.sleep_end_local || r.sleep_end || null;

  if (!observedStart || !observedEnd || sleepMin == null) {
    return {
      sleepEfficiency: null,
      bedtimeDeviationMin: null,
      wakeDeviationMin: null,
      alignmentScore: null,
      planBedtime: planBed,
      planWake: planWake,
      observedStart,
      observedEnd,
      observedMinutes: sleepMin,
      tossedMinutes: tossed,
      sleepEfficiencyProxy: null,
    };
  }

  const startTime = observedStart.includes(" ") ? observedStart.split(" ")[1] : observedStart;
  const endTime = observedEnd.includes(" ") ? observedEnd.split(" ")[1] : observedEnd;

  const startMin = toMin(startTime.slice(0, 5));
  const endMin = toMin(endTime.slice(0, 5));
  const planBedMin = toMin(planBed);
  const planWakeMin = toMin(planWake);

  let timeInBed = endMin - startMin;
  if (timeInBed < 0) timeInBed += 1440;

  const efficiency = timeInBed > 0 ? Math.min(1.0, sleepMin / timeInBed) : null;

  const efficiencyProxy = tossed != null && sleepMin > 0
    ? Math.min(1.0, Math.max(0, (sleepMin - tossed) / sleepMin))
    : null;

  const bedDev = wrapDev(startMin - planBedMin);
  const wakeDev = wrapDev(endMin - planWakeMin);

  const alignment = Math.max(0, Math.min(100, 100 - (Math.abs(bedDev) + Math.abs(wakeDev)) / 2));

  await pool.query(
    `UPDATE daily_log SET
       sleep_efficiency = $2,
       bedtime_deviation_min = $3,
       wake_deviation_min = $4,
       sleep_plan_alignment_score = $5
     WHERE day = $1`,
    [date, efficiency, bedDev, wakeDev, alignment]
  );

  return {
    sleepEfficiency: efficiency,
    bedtimeDeviationMin: bedDev,
    wakeDeviationMin: wakeDev,
    alignmentScore: alignment,
    planBedtime: planBed,
    planWake: planWake,
    observedStart,
    observedEnd,
    observedMinutes: sleepMin,
    tossedMinutes: tossed,
    sleepEfficiencyProxy: efficiencyProxy,
  };
}

export async function getSleepPlanSettings(): Promise<{ bedtime: string; wake: string }> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'sleep_plan_bedtime'`
  );
  const { rows: rows2 } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'sleep_plan_wake'`
  );
  return {
    bedtime: rows[0]?.value || DEFAULT_PLAN_BED,
    wake: rows2[0]?.value || DEFAULT_PLAN_WAKE,
  };
}

export async function setSleepPlanSettings(bedtime: string, wake: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('sleep_plan_bedtime', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [bedtime]
  );
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('sleep_plan_wake', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [wake]
  );
}
