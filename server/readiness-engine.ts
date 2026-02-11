import { pool } from "./db";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function rollingMean(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

export interface ReadinessResult {
  date: string;
  readinessScore: number;
  readinessTier: "GREEN" | "YELLOW" | "RED";
  confidenceGrade: "High" | "Med" | "Low" | "None";
  hrvDelta: number | null;
  rhrDelta: number | null;
  sleepDelta: number | null;
  proxyDelta: number | null;
  hrv7d: number | null;
  hrv28d: number | null;
  rhr7d: number | null;
  rhr28d: number | null;
  sleep7d: number | null;
  sleep28d: number | null;
  proxy7d: number | null;
  proxy28d: number | null;
  drivers: string[];
}

export async function computeReadiness(date: string): Promise<ReadinessResult> {
  const pullFrom = addDays(date, -34);

  const { rows: logRows } = await pool.query(
    `SELECT day, hrv, resting_hr, sleep_minutes
     FROM daily_log
     WHERE day BETWEEN $1 AND $2
     ORDER BY day ASC`,
    [pullFrom, date],
  );

  const { rows: proxyRows } = await pool.query(
    `SELECT date::text as date, proxy_score
     FROM androgen_proxy_daily
     WHERE date BETWEEN $1::date AND $2::date
       AND computed_with_imputed = FALSE
     ORDER BY date ASC`,
    [pullFrom, date],
  );

  const logMap = new Map<string, { hrv: number | null; rhr: number | null; sleep: number | null }>();
  for (const r of logRows) {
    logMap.set(r.day, {
      hrv: r.hrv != null ? Number(r.hrv) : null,
      rhr: r.resting_hr != null ? Number(r.resting_hr) : null,
      sleep: r.sleep_minutes != null ? Number(r.sleep_minutes) : null,
    });
  }

  const proxyMap = new Map<string, number>();
  for (const r of proxyRows) {
    if (r.proxy_score != null) proxyMap.set(r.date, Number(r.proxy_score));
  }

  const allDates: string[] = [];
  let cur = pullFrom;
  while (cur <= date) {
    allDates.push(cur);
    cur = addDays(cur, 1);
  }

  const hrvAll: (number | null)[] = [];
  const rhrAll: (number | null)[] = [];
  const sleepAll: (number | null)[] = [];
  const proxyAll: (number | null)[] = [];

  for (const d of allDates) {
    const log = logMap.get(d);
    hrvAll.push(log?.hrv ?? null);
    rhrAll.push(log?.rhr ?? null);
    sleepAll.push(log?.sleep ?? null);
    proxyAll.push(proxyMap.get(d) ?? null);
  }

  const len = allDates.length;
  const last7 = (arr: (number | null)[]) => arr.slice(Math.max(0, len - 7));
  const last28 = (arr: (number | null)[]) => arr.slice(Math.max(0, len - 28));

  const hrv7d = rollingMean(last7(hrvAll));
  const hrv28d = rollingMean(last28(hrvAll));
  const rhr7d = rollingMean(last7(rhrAll));
  const rhr28d = rollingMean(last28(rhrAll));
  const sleep7d = rollingMean(last7(sleepAll));
  const sleep28d = rollingMean(last28(sleepAll));
  const proxy7d = rollingMean(last7(proxyAll));
  const proxy28d = rollingMean(last28(proxyAll));

  let hrvDelta: number | null = null;
  let rhrDelta: number | null = null;
  let sleepDelta: number | null = null;
  let proxyDelta: number | null = null;

  if (hrv7d != null && hrv28d != null && hrv28d !== 0) hrvDelta = (hrv7d - hrv28d) / hrv28d;
  if (rhr7d != null && rhr28d != null && rhr28d !== 0) rhrDelta = (rhr7d - rhr28d) / rhr28d;
  if (sleep7d != null && sleep28d != null && sleep28d !== 0) sleepDelta = (sleep7d - sleep28d) / sleep28d;
  if (proxy7d != null && proxy28d != null && proxy28d !== 0) proxyDelta = (proxy7d - proxy28d) / proxy28d;

  let score = 50;
  const drivers: string[] = [];

  if (hrvDelta != null) {
    const contribution = 35 * clamp(hrvDelta / 0.10, -1, 1);
    score += contribution;
    const pct = Math.round(hrvDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`HRV ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }

  if (rhrDelta != null) {
    const contribution = -25 * clamp(rhrDelta / 0.05, -1, 1);
    score += contribution;
    const pct = Math.round(rhrDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`RHR ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }

  if (sleepDelta != null) {
    const contribution = 20 * clamp(sleepDelta / 0.10, -1, 1);
    score += contribution;
    const pct = Math.round(sleepDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`Sleep ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }

  if (proxyDelta != null) {
    const contribution = 20 * clamp(proxyDelta / 0.10, -1, 1);
    score += contribution;
    const pct = Math.round(proxyDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`Proxy ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }

  score = Math.round(clamp(score, 0, 100));

  if (drivers.length === 0) {
    drivers.push("All signals near baseline");
  }

  const measuredNightsLast7 = last7(proxyAll).filter((v): v is number => v != null).length;
  const { rows: confRows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM erection_sessions
     WHERE date BETWEEN $1::date AND $2::date AND is_imputed = FALSE`,
    [addDays(date, -6), date],
  );
  const measuredSessions = Number(confRows[0]?.cnt ?? 0);

  let confidenceGrade: "High" | "Med" | "Low" | "None";
  if (measuredSessions >= 5 && measuredNightsLast7 >= 4) {
    confidenceGrade = "High";
  } else if (measuredSessions >= 3 && measuredNightsLast7 >= 2) {
    confidenceGrade = "Med";
  } else if (measuredSessions >= 1 || measuredNightsLast7 >= 1) {
    confidenceGrade = "Low";
  } else {
    confidenceGrade = "None";
  }

  let tier: "GREEN" | "YELLOW" | "RED";
  if (score >= 65) {
    tier = "GREEN";
  } else if (score >= 35) {
    tier = "YELLOW";
  } else {
    tier = "RED";
  }

  return {
    date,
    readinessScore: score,
    readinessTier: tier,
    confidenceGrade,
    hrvDelta: hrvDelta != null ? Math.round(hrvDelta * 10000) / 10000 : null,
    rhrDelta: rhrDelta != null ? Math.round(rhrDelta * 10000) / 10000 : null,
    sleepDelta: sleepDelta != null ? Math.round(sleepDelta * 10000) / 10000 : null,
    proxyDelta: proxyDelta != null ? Math.round(proxyDelta * 10000) / 10000 : null,
    hrv7d: hrv7d != null ? Math.round(hrv7d * 100) / 100 : null,
    hrv28d: hrv28d != null ? Math.round(hrv28d * 100) / 100 : null,
    rhr7d: rhr7d != null ? Math.round(rhr7d * 100) / 100 : null,
    rhr28d: rhr28d != null ? Math.round(rhr28d * 100) / 100 : null,
    sleep7d: sleep7d != null ? Math.round(sleep7d * 100) / 100 : null,
    sleep28d: sleep28d != null ? Math.round(sleep28d * 100) / 100 : null,
    proxy7d: proxy7d != null ? Math.round(proxy7d * 100) / 100 : null,
    proxy28d: proxy28d != null ? Math.round(proxy28d * 100) / 100 : null,
    drivers,
  };
}

export async function persistReadiness(r: ReadinessResult): Promise<void> {
  await pool.query(
    `INSERT INTO readiness_daily (date, readiness_score, readiness_tier, confidence_grade,
       hrv_delta, rhr_delta, sleep_delta, proxy_delta,
       hrv_7d, hrv_28d, rhr_7d, rhr_28d, sleep_7d, sleep_28d, proxy_7d, proxy_28d,
       drivers, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,NOW())
     ON CONFLICT (date) DO UPDATE SET
       readiness_score = EXCLUDED.readiness_score,
       readiness_tier = EXCLUDED.readiness_tier,
       confidence_grade = EXCLUDED.confidence_grade,
       hrv_delta = EXCLUDED.hrv_delta,
       rhr_delta = EXCLUDED.rhr_delta,
       sleep_delta = EXCLUDED.sleep_delta,
       proxy_delta = EXCLUDED.proxy_delta,
       hrv_7d = EXCLUDED.hrv_7d,
       hrv_28d = EXCLUDED.hrv_28d,
       rhr_7d = EXCLUDED.rhr_7d,
       rhr_28d = EXCLUDED.rhr_28d,
       sleep_7d = EXCLUDED.sleep_7d,
       sleep_28d = EXCLUDED.sleep_28d,
       proxy_7d = EXCLUDED.proxy_7d,
       proxy_28d = EXCLUDED.proxy_28d,
       drivers = EXCLUDED.drivers,
       computed_at = NOW()`,
    [
      r.date, r.readinessScore, r.readinessTier, r.confidenceGrade,
      r.hrvDelta, r.rhrDelta, r.sleepDelta, r.proxyDelta,
      r.hrv7d, r.hrv28d, r.rhr7d, r.rhr28d, r.sleep7d, r.sleep28d, r.proxy7d, r.proxy28d,
      JSON.stringify(r.drivers),
    ],
  );
}

export async function recomputeReadinessRange(targetDate: string): Promise<void> {
  const start = addDays(targetDate, -7);
  const end = addDays(targetDate, 1);
  let cur = start;
  while (cur <= end) {
    const result = await computeReadiness(cur);
    await persistReadiness(result);
    cur = addDays(cur, 1);
  }
}

export async function getReadiness(date: string): Promise<ReadinessResult | null> {
  const { rows } = await pool.query(
    `SELECT * FROM readiness_daily WHERE date = $1::date`,
    [date],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    date: (r.date as Date).toISOString().slice(0, 10),
    readinessScore: Number(r.readiness_score),
    readinessTier: r.readiness_tier as "GREEN" | "YELLOW" | "RED",
    confidenceGrade: r.confidence_grade as "High" | "Med" | "Low" | "None",
    hrvDelta: r.hrv_delta != null ? Number(r.hrv_delta) : null,
    rhrDelta: r.rhr_delta != null ? Number(r.rhr_delta) : null,
    sleepDelta: r.sleep_delta != null ? Number(r.sleep_delta) : null,
    proxyDelta: r.proxy_delta != null ? Number(r.proxy_delta) : null,
    hrv7d: r.hrv_7d != null ? Number(r.hrv_7d) : null,
    hrv28d: r.hrv_28d != null ? Number(r.hrv_28d) : null,
    rhr7d: r.rhr_7d != null ? Number(r.rhr_7d) : null,
    rhr28d: r.rhr_28d != null ? Number(r.rhr_28d) : null,
    sleep7d: r.sleep_7d != null ? Number(r.sleep_7d) : null,
    sleep28d: r.sleep_28d != null ? Number(r.sleep_28d) : null,
    proxy7d: r.proxy_7d != null ? Number(r.proxy_7d) : null,
    proxy28d: r.proxy_28d != null ? Number(r.proxy_28d) : null,
    drivers: Array.isArray(r.drivers) ? r.drivers : [],
  };
}

export async function getReadinessRange(from: string, to: string): Promise<ReadinessResult[]> {
  const { rows } = await pool.query(
    `SELECT * FROM readiness_daily WHERE date BETWEEN $1::date AND $2::date ORDER BY date ASC`,
    [from, to],
  );
  return rows.map((r: Record<string, unknown>) => ({
    date: (r.date as Date).toISOString().slice(0, 10),
    readinessScore: Number(r.readiness_score),
    readinessTier: r.readiness_tier as "GREEN" | "YELLOW" | "RED",
    confidenceGrade: r.confidence_grade as "High" | "Med" | "Low" | "None",
    hrvDelta: r.hrv_delta != null ? Number(r.hrv_delta) : null,
    rhrDelta: r.rhr_delta != null ? Number(r.rhr_delta) : null,
    sleepDelta: r.sleep_delta != null ? Number(r.sleep_delta) : null,
    proxyDelta: r.proxy_delta != null ? Number(r.proxy_delta) : null,
    hrv7d: r.hrv_7d != null ? Number(r.hrv_7d) : null,
    hrv28d: r.hrv_28d != null ? Number(r.hrv_28d) : null,
    rhr7d: r.rhr_7d != null ? Number(r.rhr_7d) : null,
    rhr28d: r.rhr_28d != null ? Number(r.rhr_28d) : null,
    sleep7d: r.sleep_7d != null ? Number(r.sleep_7d) : null,
    sleep28d: r.sleep_28d != null ? Number(r.sleep_28d) : null,
    proxy7d: r.proxy_7d != null ? Number(r.proxy_7d) : null,
    proxy28d: r.proxy_28d != null ? Number(r.proxy_28d) : null,
    drivers: Array.isArray(r.drivers) ? r.drivers : [],
  }));
}

export interface TrainingTemplate {
  templateType: string;
  sessions: Array<{
    name: string;
    highLabel: string;
    medLabel: string;
    lowLabel: string;
  }>;
}

export async function getTrainingTemplate(): Promise<TrainingTemplate> {
  const { rows } = await pool.query(`SELECT template_type, sessions FROM training_template WHERE id = 1`);
  if (rows.length === 0) {
    return {
      templateType: "push_pull_legs",
      sessions: [
        { name: "Push", highLabel: "Heavy Bench / OHP", medLabel: "Normal Hypertrophy", lowLabel: "Machine Press / Flyes / Pump" },
        { name: "Pull", highLabel: "Heavy Rows / Deadlift", medLabel: "Normal Hypertrophy", lowLabel: "Cables / Light Rows / Technique" },
        { name: "Legs", highLabel: "Heavy Squat / RDL", medLabel: "Normal Hypertrophy", lowLabel: "Leg Press / Machines / Pump" },
      ],
    };
  }
  return {
    templateType: rows[0].template_type,
    sessions: rows[0].sessions,
  };
}

export async function updateTrainingTemplate(templateType: string, sessions: TrainingTemplate["sessions"]): Promise<void> {
  await pool.query(
    `INSERT INTO training_template (id, template_type, sessions, updated_at)
     VALUES (1, $1, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       template_type = EXCLUDED.template_type,
       sessions = EXCLUDED.sessions,
       updated_at = NOW()`,
    [templateType, JSON.stringify(sessions)],
  );
}
