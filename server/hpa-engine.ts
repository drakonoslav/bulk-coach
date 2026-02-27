import { pool } from "./db";

const DEFAULT_USER_ID = "local_default";

type DailyVitals = {
  date: string;
  sleepMin: number | null;
  hrvMs: number | null;
  rhrBpm: number | null;
  pain010: number | null;
};

type Baseline = {
  sleep28: number | null;
  hrv28: number | null;
  rhr28: number | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pctDelta(current: number, baseline: number): number {
  return (current - baseline) / baseline;
}

export function computeHpaScore(
  daily: DailyVitals,
  base: Baseline
): { score: number; drivers: Record<string, any> } {
  let score = 0;

  const drivers: Record<string, any> = {
    date: daily.date,
    sleep: { current: daily.sleepMin, baseline28: base.sleep28, pct: null, fired: false, points: 0 },
    hrv: { current: daily.hrvMs, baseline28: base.hrv28, pct: null, fired: false, points: 0 },
    rhr: { current: daily.rhrBpm, baseline28: base.rhr28, diff: null, fired: false, points: 0 },
    pain: { current: daily.pain010 ?? null, fired: false, points: 0 },
  };

  if (daily.sleepMin != null && base.sleep28 != null && base.sleep28 > 0) {
    const p = pctDelta(daily.sleepMin, base.sleep28);
    drivers.sleep.pct = p;
    if (p <= -0.10) {
      score += 30;
      drivers.sleep.fired = true;
      drivers.sleep.points = 30;
    }
  }

  if (daily.hrvMs != null && base.hrv28 != null && base.hrv28 > 0) {
    const p = pctDelta(daily.hrvMs, base.hrv28);
    drivers.hrv.pct = p;
    if (p <= -0.08) {
      score += 25;
      drivers.hrv.fired = true;
      drivers.hrv.points = 25;
    }
  }

  if (daily.rhrBpm != null && base.rhr28 != null) {
    const d = daily.rhrBpm - base.rhr28;
    drivers.rhr.diff = d;
    if (d >= 3) {
      score += 25;
      drivers.rhr.fired = true;
      drivers.rhr.points = 25;
    }
  }

  if (daily.pain010 != null && daily.pain010 >= 4) {
    score += 20;
    drivers.pain.fired = true;
    drivers.pain.points = 20;
  }

  return { score: clamp(score, 0, 100), drivers };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function computeAndUpsertHpa(
  date: string,
  userId: string = DEFAULT_USER_ID
): Promise<{ score: number; suppressionFlag: boolean; drivers: any } | null> {

  const LOOKBACK_DAYS = 14;

  const [sleepRes, vitalsRes, painRes, baselineSleepRes, baselineVitalsRes, proxyRes] = await Promise.all([
    pool.query(
      `SELECT total_sleep_minutes, date::text as src_date FROM sleep_summary_daily
       WHERE user_id = $2
         AND date <= $1::date
         AND date >= ($1::date - ${LOOKBACK_DAYS})
       ORDER BY date DESC LIMIT 1`,
      [date, userId]
    ),
    pool.query(
      `SELECT hrv_rmssd_ms, resting_hr_bpm, date::text as src_date FROM vitals_daily
       WHERE user_id = $2
         AND date <= $1::date
         AND date >= ($1::date - ${LOOKBACK_DAYS})
         AND (hrv_rmssd_ms IS NOT NULL OR resting_hr_bpm IS NOT NULL)
       ORDER BY date DESC LIMIT 1`,
      [date, userId]
    ),
    pool.query(
      `SELECT pain_0_10, day as src_date FROM daily_log
       WHERE user_id = $2
         AND day <= $1
         AND day >= ($1::date - ${LOOKBACK_DAYS})::text
         AND pain_0_10 IS NOT NULL
       ORDER BY day DESC LIMIT 1`,
      [date, userId]
    ),
    pool.query(
      `SELECT AVG(total_sleep_minutes)::numeric as sleep28
       FROM sleep_summary_daily
       WHERE user_id = $1
         AND date >= ($2::date - interval '28 days')
         AND date < $2::date`,
      [userId, date]
    ),
    pool.query(
      `SELECT AVG(hrv_rmssd_ms)::numeric as hrv28, AVG(resting_hr_bpm)::numeric as rhr28
       FROM vitals_daily
       WHERE user_id = $1
         AND date >= ($2::date - interval '28 days')
         AND date < $2::date`,
      [userId, date]
    ),
    pool.query(
      `SELECT proxy_score FROM androgen_proxy_daily
       WHERE date = $1::date AND computed_with_imputed = FALSE
       UNION ALL
       SELECT proxy_score FROM androgen_proxy_daily
       WHERE date = $1::date AND computed_with_imputed = TRUE
       LIMIT 1`,
      [date]
    ),
  ]);

  const sleepMin = sleepRes.rows[0]?.total_sleep_minutes != null
    ? Number(sleepRes.rows[0].total_sleep_minutes)
    : null;
  const hrvMs = vitalsRes.rows[0]?.hrv_rmssd_ms != null
    ? Number(vitalsRes.rows[0].hrv_rmssd_ms)
    : null;
  const rhrBpm = vitalsRes.rows[0]?.resting_hr_bpm != null
    ? Number(vitalsRes.rows[0].resting_hr_bpm)
    : null;
  const pain010 = painRes.rows[0]?.pain_0_10 != null
    ? Number(painRes.rows[0].pain_0_10)
    : null;

  const hasAnyData = sleepMin != null || hrvMs != null || rhrBpm != null || pain010 != null;
  if (!hasAnyData) return null;

  const daily: DailyVitals = { date, sleepMin, hrvMs, rhrBpm, pain010 };

  const base: Baseline = {
    sleep28: baselineSleepRes.rows[0]?.sleep28 != null ? Number(baselineSleepRes.rows[0].sleep28) : null,
    hrv28: baselineVitalsRes.rows[0]?.hrv28 != null ? Number(baselineVitalsRes.rows[0].hrv28) : null,
    rhr28: baselineVitalsRes.rows[0]?.rhr28 != null ? Number(baselineVitalsRes.rows[0].rhr28) : null,
  };

  const { score, drivers } = computeHpaScore(daily, base);

  const proxyScore = proxyRes.rows[0]?.proxy_score != null ? Number(proxyRes.rows[0].proxy_score) : null;
  let proxyDelta: number | null = null;
  if (proxyScore != null) {
    const proxy28Res = await pool.query(
      `SELECT AVG(proxy_score)::numeric as proxy28
       FROM androgen_proxy_daily
       WHERE date >= ($1::date - interval '28 days')
         AND date < $1::date
         AND computed_with_imputed = FALSE`,
      [date]
    );
    const proxy28 = proxy28Res.rows[0]?.proxy28 != null ? Number(proxy28Res.rows[0].proxy28) : null;
    if (proxy28 != null && proxy28 > 0) {
      proxyDelta = pctDelta(proxyScore, proxy28);
    }
  }

  const suppressionFlag = score >= 60 && proxyDelta != null && proxyDelta <= -0.10;
  drivers.suppression = {
    hpaAbove60: score >= 60,
    proxyDelta,
    proxyDropped10pct: proxyDelta != null && proxyDelta <= -0.10,
    flag: suppressionFlag,
  };

  await pool.query(
    `INSERT INTO hpa_activation_daily (user_id, date, hpa_score, suppression_flag, drivers, computed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (user_id, date)
     DO UPDATE SET
       hpa_score = EXCLUDED.hpa_score,
       suppression_flag = EXCLUDED.suppression_flag,
       drivers = EXCLUDED.drivers,
       computed_at = NOW()`,
    [userId, date, score, suppressionFlag, JSON.stringify(drivers)]
  );

  return { score, suppressionFlag, drivers };
}

export async function getHpaForDate(
  date: string,
  userId: string = DEFAULT_USER_ID
): Promise<{ hpaScore: number; suppressionFlag: boolean; drivers: any } | null> {
  const { rows } = await pool.query(
    `SELECT hpa_score, suppression_flag, drivers FROM hpa_activation_daily
     WHERE user_id = $1 AND date = $2`,
    [userId, date]
  );
  if (rows.length === 0) return null;
  return {
    hpaScore: Number(rows[0].hpa_score),
    suppressionFlag: rows[0].suppression_flag,
    drivers: rows[0].drivers,
  };
}

export async function getHpaRange(
  startDate: string,
  endDate: string,
  userId: string = DEFAULT_USER_ID
): Promise<Array<{ date: string; hpaScore: number | null; suppressionFlag: boolean }>> {
  const { rows } = await pool.query(
    `SELECT s.day::date::text AS spine_day, h.hpa_score, h.suppression_flag
     FROM generate_series($2::date, $3::date, interval '1 day') s(day)
     LEFT JOIN hpa_activation_daily h
       ON h.date = s.day::date::text AND h.user_id = $1
     ORDER BY s.day ASC`,
    [userId, startDate, endDate]
  );
  return rows.map(r => ({
    date: r.spine_day,
    hpaScore: r.hpa_score != null ? Number(r.hpa_score) : null,
    suppressionFlag: !!r.suppression_flag,
  }));
}
