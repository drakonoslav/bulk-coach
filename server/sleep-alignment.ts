import { pool } from "./db";

export async function computeSleepAlignment(date: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT sleep_minutes, sleep_start, sleep_end FROM daily_log WHERE day = $1`,
    [date]
  );
  if (!rows[0] || !rows[0].sleep_start || !rows[0].sleep_end || !rows[0].sleep_minutes) return;

  const PLAN_BED = "21:45";
  const PLAN_WAKE = "05:30";

  const toMin = (t: string): number => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const sleepStart = rows[0].sleep_start;
  const sleepEnd = rows[0].sleep_end;
  const sleepMin = Number(rows[0].sleep_minutes);

  const startTime = sleepStart.includes(" ") ? sleepStart.split(" ")[1] : sleepStart;
  const endTime = sleepEnd.includes(" ") ? sleepEnd.split(" ")[1] : sleepEnd;

  const startMin = toMin(startTime.slice(0, 5));
  const endMin = toMin(endTime.slice(0, 5));
  const planBedMin = toMin(PLAN_BED);
  const planWakeMin = toMin(PLAN_WAKE);

  let timeInBed = endMin - startMin;
  if (timeInBed < 0) timeInBed += 1440;

  const efficiency = timeInBed > 0 ? Math.min(1.0, sleepMin / timeInBed) : null;

  let bedDev = startMin - planBedMin;
  if (bedDev > 720) bedDev -= 1440;
  if (bedDev < -720) bedDev += 1440;

  let wakeDev = endMin - planWakeMin;
  if (wakeDev > 720) wakeDev -= 1440;
  if (wakeDev < -720) wakeDev += 1440;

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
}
