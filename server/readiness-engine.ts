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

function computeDeltas(x7: number | null, x28: number | null): number | null {
  if (x7 == null || x28 == null || x28 === 0) return null;
  return (x7 - x28) / x28;
}

function scoreFromDelta(delta: number | null, fullSwing: number, invert: boolean = false): number {
  if (delta == null) return 50;
  const scaled = clamp(delta / fullSwing, -1, 1);
  const base = 50 + 50 * scaled;
  return invert ? (100 - base) : base;
}

export interface ReadinessResult {
  date: string;
  readinessScore: number;
  readinessTier: "GREEN" | "YELLOW" | "BLUE";
  confidenceGrade: "High" | "Med" | "Low" | "None";
  typeLean: number;
  exerciseBias: number;
  cortisolFlag: boolean;
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
  analysisStartDate: string;
  daysInWindow: number;
  gate: "NONE" | "LOW" | "MED" | "HIGH";
}

export async function getAnalysisStartDate(): Promise<string> {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'analysis_start_date'`);
  if (rows.length > 0) return rows[0].value;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 60);
  return d.toISOString().slice(0, 10);
}

export async function setAnalysisStartDate(date: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('analysis_start_date', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [date],
  );
}

export interface DataSufficiency {
  analysisStartDate: string;
  daysWithData: number;
  totalDaysInRange: number;
  gate7: boolean;
  gate14: boolean;
  gate30: boolean;
  gateLabel: string | null;
  signals: {
    hrv: number;
    rhr: number;
    sleep: number;
    steps: number;
    proxy: number;
  };
}

export async function getDataSufficiency(): Promise<DataSufficiency> {
  const startDate = await getAnalysisStartDate();
  const today = new Date().toISOString().slice(0, 10);

  const totalDays = Math.max(1, Math.round((new Date(today + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime()) / 86400000) + 1);

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE morning_weight_lb IS NOT NULL OR steps IS NOT NULL OR sleep_minutes IS NOT NULL OR resting_hr IS NOT NULL OR hrv IS NOT NULL) AS days_with_data,
       COUNT(*) FILTER (WHERE hrv IS NOT NULL) AS hrv_days,
       COUNT(*) FILTER (WHERE resting_hr IS NOT NULL) AS rhr_days,
       COUNT(*) FILTER (WHERE sleep_minutes IS NOT NULL) AS sleep_days,
       COUNT(*) FILTER (WHERE steps IS NOT NULL) AS steps_days
     FROM daily_log WHERE day >= $1 AND day <= $2`,
    [startDate, today],
  );

  const { rows: proxyRows } = await pool.query(
    `SELECT COUNT(*) AS proxy_days FROM androgen_proxy_daily
     WHERE date >= $1::date AND date <= $2::date AND computed_with_imputed = FALSE`,
    [startDate, today],
  );

  const daysWithData = Number(rows[0]?.days_with_data ?? 0);
  const gate7 = daysWithData >= 7;
  const gate14 = daysWithData >= 14;
  const gate30 = daysWithData >= 30;

  let gateLabel: string | null = null;
  if (!gate7) gateLabel = `Need ${7 - daysWithData} more days for basic trends`;
  else if (!gate14) gateLabel = `Need ${14 - daysWithData} more days for rolling averages`;
  else if (!gate30) gateLabel = `Need ${30 - daysWithData} more days for full baselines`;

  return {
    analysisStartDate: startDate,
    daysWithData,
    totalDaysInRange: totalDays,
    gate7,
    gate14,
    gate30,
    gateLabel,
    signals: {
      hrv: Number(rows[0]?.hrv_days ?? 0),
      rhr: Number(rows[0]?.rhr_days ?? 0),
      sleep: Number(rows[0]?.sleep_days ?? 0),
      steps: Number(rows[0]?.steps_days ?? 0),
      proxy: Number(proxyRows[0]?.proxy_days ?? 0),
    },
  };
}

export async function computeReadiness(date: string): Promise<ReadinessResult> {
  const analysisStart = await getAnalysisStartDate();
  const effectiveStart = date < analysisStart ? date : analysisStart;
  const pullFrom = effectiveStart > addDays(date, -34) ? effectiveStart : addDays(date, -34);

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

  const hrvDelta = computeDeltas(hrv7d, hrv28d);
  const rhrDelta = computeDeltas(rhr7d, rhr28d);
  const sleepDelta = computeDeltas(sleep7d, sleep28d);
  const proxyDelta = computeDeltas(proxy7d, proxy28d);

  const HRV_score = scoreFromDelta(hrvDelta, 0.10, false);
  const RHR_score = scoreFromDelta(rhrDelta, 0.05, true);
  const Sleep_score = scoreFromDelta(sleepDelta, 0.10, false);
  const Proxy_score = scoreFromDelta(proxyDelta, 0.10, false);

  const readiness_raw =
    0.30 * HRV_score +
    0.20 * RHR_score +
    0.20 * Sleep_score +
    0.20 * Proxy_score;

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

  const confMap: Record<string, number> = { High: 1.0, Med: 0.9, Low: 0.75, None: 0.6 };
  const conf = confMap[confidenceGrade] ?? 0.75;

  let readiness = clamp(readiness_raw * conf, 0, 100);

  const drivers: string[] = [];

  if (hrvDelta != null) {
    const pct = Math.round(hrvDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`HRV ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }
  if (rhrDelta != null) {
    const pct = Math.round(rhrDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`RHR ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }
  if (sleepDelta != null) {
    const pct = Math.round(sleepDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`Sleep ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }
  if (proxyDelta != null) {
    const pct = Math.round(proxyDelta * 100);
    if (Math.abs(pct) >= 2) {
      drivers.push(`Proxy ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs baseline`);
    }
  }

  const hrv_suppressed = (hrvDelta ?? 0) <= -0.08;
  const rhr_elevated = (rhrDelta ?? 0) >= 0.03;
  const sleep_low = (sleepDelta ?? 0) <= -0.10;
  const proxy_low = (proxyDelta ?? 0) <= -0.10;
  const flagCount = [hrv_suppressed, rhr_elevated, sleep_low, proxy_low].filter(Boolean).length;
  const cortisolFlag = confidenceGrade !== "None" && flagCount >= 3;

  if (cortisolFlag) {
    readiness = Math.min(readiness, 74);
    drivers.unshift("Recovery suppressed (cortisol flag)");
  }

  readiness = Math.round(readiness);

  if (drivers.length === 0) {
    drivers.push("All signals near baseline");
  }

  let tier: "GREEN" | "YELLOW" | "BLUE";
  if (readiness >= 75) {
    tier = "GREEN";
  } else if (readiness >= 60) {
    tier = "YELLOW";
  } else {
    tier = "BLUE";
  }

  let typeLean = clamp((readiness - 60) / 20, -1, 1);
  let exerciseBias = clamp((readiness - 65) / 20, -1, 1);

  if (cortisolFlag) {
    exerciseBias = Math.min(exerciseBias, 0);
  }

  typeLean = Math.round(typeLean * 100) / 100;
  exerciseBias = Math.round(exerciseBias * 100) / 100;

  const sufficiency = await getDataSufficiency();

  return {
    date,
    readinessScore: readiness,
    readinessTier: tier,
    confidenceGrade,
    typeLean,
    exerciseBias,
    cortisolFlag,
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
    analysisStartDate: sufficiency.analysisStartDate,
    daysInWindow: sufficiency.daysWithData,
    gate: sufficiency.gate30 ? "HIGH" : sufficiency.gate14 ? "MED" : sufficiency.gate7 ? "LOW" : "NONE",
  };
}

export async function persistReadiness(r: ReadinessResult): Promise<void> {
  await pool.query(
    `INSERT INTO readiness_daily (date, readiness_score, readiness_tier, confidence_grade,
       hrv_delta, rhr_delta, sleep_delta, proxy_delta,
       hrv_7d, hrv_28d, rhr_7d, rhr_28d, sleep_7d, sleep_28d, proxy_7d, proxy_28d,
       type_lean, exercise_bias, cortisol_flag,
       drivers, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,NOW())
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
       type_lean = EXCLUDED.type_lean,
       exercise_bias = EXCLUDED.exercise_bias,
       cortisol_flag = EXCLUDED.cortisol_flag,
       drivers = EXCLUDED.drivers,
       computed_at = NOW()`,
    [
      r.date, r.readinessScore, r.readinessTier, r.confidenceGrade,
      r.hrvDelta, r.rhrDelta, r.sleepDelta, r.proxyDelta,
      r.hrv7d, r.hrv28d, r.rhr7d, r.rhr28d, r.sleep7d, r.sleep28d, r.proxy7d, r.proxy28d,
      r.typeLean, r.exerciseBias, r.cortisolFlag,
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
  const sufficiency = await getDataSufficiency();
  return {
    date: (r.date as Date).toISOString().slice(0, 10),
    readinessScore: Number(r.readiness_score),
    readinessTier: r.readiness_tier as "GREEN" | "YELLOW" | "BLUE",
    confidenceGrade: r.confidence_grade as "High" | "Med" | "Low" | "None",
    typeLean: r.type_lean != null ? Number(r.type_lean) : 0,
    exerciseBias: r.exercise_bias != null ? Number(r.exercise_bias) : 0,
    cortisolFlag: !!r.cortisol_flag,
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
    analysisStartDate: sufficiency.analysisStartDate,
    daysInWindow: sufficiency.daysWithData,
    gate: sufficiency.gate30 ? "HIGH" : sufficiency.gate14 ? "MED" : sufficiency.gate7 ? "LOW" : "NONE",
  };
}

export async function getReadinessRange(from: string, to: string): Promise<ReadinessResult[]> {
  const { rows } = await pool.query(
    `SELECT * FROM readiness_daily WHERE date BETWEEN $1::date AND $2::date ORDER BY date ASC`,
    [from, to],
  );
  const sufficiency = await getDataSufficiency();
  const gateValue: "NONE" | "LOW" | "MED" | "HIGH" = sufficiency.gate30 ? "HIGH" : sufficiency.gate14 ? "MED" : sufficiency.gate7 ? "LOW" : "NONE";
  return rows.map((r: Record<string, unknown>) => ({
    date: (r.date as Date).toISOString().slice(0, 10),
    readinessScore: Number(r.readiness_score),
    readinessTier: r.readiness_tier as "GREEN" | "YELLOW" | "BLUE",
    confidenceGrade: r.confidence_grade as "High" | "Med" | "Low" | "None",
    typeLean: r.type_lean != null ? Number(r.type_lean) : 0,
    exerciseBias: r.exercise_bias != null ? Number(r.exercise_bias) : 0,
    cortisolFlag: !!(r.cortisol_flag),
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
    analysisStartDate: sufficiency.analysisStartDate,
    daysInWindow: sufficiency.daysWithData,
    gate: gateValue,
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

export const TYPE_A_SESSIONS: TrainingTemplate["sessions"] = [
  { name: "Push", highLabel: "Heavy Bench / OHP", medLabel: "Normal Hypertrophy", lowLabel: "Machine Press / Flyes / Pump" },
  { name: "Pull", highLabel: "Heavy Rows / Deadlift", medLabel: "Normal Hypertrophy", lowLabel: "Cables / Light Rows / Technique" },
  { name: "Legs", highLabel: "Heavy Squat / RDL", medLabel: "Normal Hypertrophy", lowLabel: "Leg Press / Machines / Pump" },
];

export const TYPE_B_SESSIONS: TrainingTemplate["sessions"] = [
  { name: "Arms", highLabel: "Heavy Curls / Dips", medLabel: "Normal Bi/Tri/Forearm", lowLabel: "Cables / Pump / Technique" },
  { name: "Delts", highLabel: "Heavy OHP / Laterals", medLabel: "Normal Delt Work", lowLabel: "Light Laterals / Cables" },
  { name: "Legs", highLabel: "Heavy Squat / RDL", medLabel: "Normal Quads/Hams/Calves", lowLabel: "Leg Press / Machines / Pump" },
  { name: "Torso", highLabel: "Weighted Core / Planks", medLabel: "Normal Core/Abs", lowLabel: "Bodyweight Core / Technique" },
  { name: "Posterior", highLabel: "Heavy Rows / Pulls", medLabel: "Normal Lats/Traps", lowLabel: "Cables / Light Pulls / Technique" },
];

export async function getTrainingTemplate(): Promise<{ typeA: TrainingTemplate; typeB: TrainingTemplate }> {
  const { rows } = await pool.query(`SELECT template_type, sessions FROM training_template ORDER BY id`);
  let typeA: TrainingTemplate = { templateType: "type_a", sessions: TYPE_A_SESSIONS };
  let typeB: TrainingTemplate = { templateType: "type_b", sessions: TYPE_B_SESSIONS };

  for (const r of rows) {
    if (r.template_type === "type_a") typeA = { templateType: "type_a", sessions: r.sessions };
    if (r.template_type === "type_b") typeB = { templateType: "type_b", sessions: r.sessions };
  }

  return { typeA, typeB };
}

export async function updateTrainingTemplate(templateType: string, sessions: TrainingTemplate["sessions"]): Promise<void> {
  const id = templateType === "type_b" ? 2 : 1;
  await pool.query(
    `INSERT INTO training_template (id, template_type, sessions, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       template_type = EXCLUDED.template_type,
       sessions = EXCLUDED.sessions,
       updated_at = NOW()`,
    [id, templateType, JSON.stringify(sessions)],
  );
}
