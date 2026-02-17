import { pool } from "./db";

export const DEFAULT_USER_ID = "local_default";

export type DayColor =
  | "LEAN_GAIN"
  | "CUT"
  | "RECOMP"
  | "DELOAD"
  | "SUPPRESSED"
  | "UNKNOWN";

export interface DayMark {
  date: string;
  color: DayColor;
  label: string;
  confidence: "high" | "medium" | "low";
  weekendSymbol?: string;
  reasons: string[];
  missing?: string[];
}

export const CLASSIFIER_THRESHOLDS = {
  suppressedHrvRatio: 0.90,
  suppressedSleepRatio: 0.85,
  suppressedAndrogenRatio: 0.80,
  suppressedMinSignals: 2,

  leanGainMinLbPerWeek: 0.25,
  leanGainMaxLbPerWeek: 0.75,

  cutMaxLbPerWeek: -0.25,

  recompWeightBand: 0.25,
  recompWaistMinDelta: -0.25,

  deloadHardDaysRequired: 3,

  hysteresisMinDays: 4,

  baselineHrvDays: 14,
  baselineSleepDays: 14,
  baselineAndrogenDays: 14,
  baselineWeightShortDays: 7,
  baselineWeightLongDays: 14,
  waistTrendDays: 14,

  minWeightEntries: 4,
} as const;

interface DayRow {
  day: string;
  morning_weight_lb: number | null;
  waist_in: number | null;
  sleep_minutes: number | null;
  resting_hr: number | null;
  hrv: number | null;
  lift_done: boolean | null;
  deload_week: boolean | null;
  adherence: number | null;
}

interface AndrogenRow {
  date: string;
  proxy_score: number | null;
}

interface WorkoutRow {
  date: string;
  session_strain_score: number | null;
}

async function fetchDayLogs(
  startDate: string,
  endDate: string,
  userId: string,
): Promise<DayRow[]> {
  const { rows } = await pool.query(
    `SELECT day, morning_weight_lb, waist_in, sleep_minutes, resting_hr, hrv,
            lift_done, deload_week, adherence
     FROM daily_log
     WHERE day >= $1 AND day <= $2 AND user_id = $3
     ORDER BY day ASC`,
    [startDate, endDate, userId],
  );
  return rows;
}

async function fetchAndrogenProxy(
  startDate: string,
  endDate: string,
  userId: string,
): Promise<AndrogenRow[]> {
  const { rows } = await pool.query(
    `SELECT date::text as date, proxy_score
     FROM androgen_proxy_daily
     WHERE date >= $1 AND date <= $2
       AND computed_with_imputed = false
       AND user_id = $3
     ORDER BY date ASC`,
    [startDate, endDate, userId],
  );
  return rows;
}

async function fetchWorkoutSessions(
  startDate: string,
  endDate: string,
  userId: string,
): Promise<WorkoutRow[]> {
  const { rows } = await pool.query(
    `SELECT date::text as date, session_strain_score
     FROM workout_session
     WHERE date >= $1 AND date <= $2 AND user_id = $3
     ORDER BY date ASC`,
    [startDate, endDate, userId],
  );
  return rows;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return dow === 0 || dow === 6;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function classifyDayRange(
  startDate: string,
  endDate: string,
  userId: string = DEFAULT_USER_ID,
): Promise<DayMark[]> {
  const T = CLASSIFIER_THRESHOLDS;

  const lookbackStart = addDays(startDate, -28);
  const [allDays, androgenRows, workoutRows] = await Promise.all([
    fetchDayLogs(lookbackStart, endDate, userId),
    fetchAndrogenProxy(lookbackStart, endDate, userId),
    fetchWorkoutSessions(lookbackStart, endDate, userId),
  ]);

  const dayMap = new Map<string, DayRow>();
  for (const d of allDays) dayMap.set(d.day, d);

  const androgenMap = new Map<string, number>();
  const androgenDateSet = new Set<string>();
  for (const a of androgenRows) {
    if (a.proxy_score != null) {
      androgenMap.set(a.date, Number(a.proxy_score));
      androgenDateSet.add(a.date);
    }
  }

  const androgenCoverage7 = new Map<string, number>();
  const androgenCoverage28 = new Map<string, number>();
  {
    const allDates: string[] = [];
    let d = lookbackStart;
    while (d <= endDate) {
      allDates.push(d);
      d = addDays(d, 1);
    }
    const has: number[] = allDates.map(dt => androgenDateSet.has(dt) ? 1 : 0);
    const prefix: number[] = new Array(has.length + 1).fill(0);
    for (let i = 0; i < has.length; i++) {
      prefix[i + 1] = prefix[i] + has[i];
    }
    for (let i = 0; i < allDates.length; i++) {
      const dt = allDates[i];
      const lo7 = Math.max(0, i - 6);
      androgenCoverage7.set(dt, prefix[i + 1] - prefix[lo7]);
      const lo28 = Math.max(0, i - 27);
      androgenCoverage28.set(dt, prefix[i + 1] - prefix[lo28]);
    }
  }

  const workoutMap = new Map<string, WorkoutRow[]>();
  for (const w of workoutRows) {
    const existing = workoutMap.get(w.date) || [];
    existing.push(w);
    workoutMap.set(w.date, existing);
  }

  function getWindowValues(
    field: keyof DayRow,
    beforeDate: string,
    windowDays: number,
  ): number[] {
    const vals: number[] = [];
    for (let i = 1; i <= windowDays; i++) {
      const d = addDays(beforeDate, -i);
      const row = dayMap.get(d);
      if (row) {
        const v = row[field];
        if (v != null && typeof v === "number") vals.push(v);
      }
    }
    return vals;
  }

  function getWeightWindow(beforeDate: string, windowDays: number): number[] {
    return getWindowValues("morning_weight_lb", beforeDate, windowDays);
  }

  function getAndrogenWindow(
    beforeDate: string,
    windowDays: number,
  ): number[] {
    const vals: number[] = [];
    for (let i = 1; i <= windowDays; i++) {
      const d = addDays(beforeDate, -i);
      const v = androgenMap.get(d);
      if (v != null) vals.push(v);
    }
    return vals;
  }

  function getWaistWindow(beforeDate: string, windowDays: number): number[] {
    return getWindowValues("waist_in", beforeDate, windowDays);
  }

  function trainingLoadForDate(date: string): "hard" | "light" | "none" {
    const day = dayMap.get(date);
    const sessions = workoutMap.get(date) || [];

    if (sessions.length > 0) {
      const maxStrain = Math.max(
        ...sessions.map((s) => s.session_strain_score ?? 0),
      );
      if (maxStrain >= 70) return "hard";
      if (maxStrain >= 30) return "light";
      return "light";
    }

    if (day?.lift_done) return "hard";
    return "none";
  }

  const results: DayMark[] = [];
  let prevColor: DayColor | null = null;
  let candidateColor_hysteresis: DayColor | null = null;
  let candidateStreak = 0;

  let curDate = startDate;
  while (curDate <= endDate) {
    const mark = classifyOneDay(curDate);
    results.push(mark);
    curDate = addDays(curDate, 1);
  }

  function classifyOneDay(date: string): DayMark {
    const row = dayMap.get(date);
    const reasons: string[] = [];
    const missing: string[] = [];

    const hrvValues = getWindowValues("hrv", date, T.baselineHrvDays);
    const sleepValues = getWindowValues(
      "sleep_minutes",
      date,
      T.baselineSleepDays,
    );
    const androgenValues = getAndrogenWindow(date, T.baselineAndrogenDays);

    const baselineHrv = median(hrvValues);
    const baselineSleep = median(sleepValues);
    const baselineAndrogen = median(androgenValues);

    const todayHrv = row?.hrv ?? null;
    const todaySleep = row?.sleep_minutes ?? null;
    const todayAndrogen = androgenMap.get(date) ?? null;

    const hrvRatio =
      todayHrv != null && baselineHrv != null && baselineHrv > 0
        ? todayHrv / baselineHrv
        : null;
    const sleepRatio =
      todaySleep != null && baselineSleep != null && baselineSleep > 0
        ? todaySleep / baselineSleep
        : null;
    const androgenRatio =
      todayAndrogen != null && baselineAndrogen != null && baselineAndrogen > 0
        ? todayAndrogen / baselineAndrogen
        : null;

    let suppressedSignals = 0;
    let suppressedAvailable = 0;

    if (hrvRatio != null) {
      suppressedAvailable++;
      if (hrvRatio < T.suppressedHrvRatio) {
        suppressedSignals++;
        reasons.push(
          `HRV ${Math.round((1 - hrvRatio) * 100)}% below baseline`,
        );
      }
    } else if (hrvValues.length < 3) {
      missing.push("hrv (daily, need >=3 in last 14d)");
    }

    if (sleepRatio != null) {
      suppressedAvailable++;
      if (sleepRatio < T.suppressedSleepRatio) {
        suppressedSignals++;
        reasons.push(
          `Sleep ${Math.round((1 - sleepRatio) * 100)}% below baseline`,
        );
      }
    } else if (sleepValues.length < 3) {
      missing.push("sleep_minutes (daily, need >=3 in last 14d)");
    }

    const androgenLast7 = androgenCoverage7.get(date) ?? 0;
    const androgenLast28 = androgenCoverage28.get(date) ?? 0;
    const androgenCoverageOk = androgenLast7 >= 4 && androgenLast28 >= 10;

    if (androgenRatio != null && androgenCoverageOk) {
      suppressedAvailable++;
      if (androgenRatio < T.suppressedAndrogenRatio) {
        suppressedSignals++;
        reasons.push(
          `Androgen proxy ${Math.round((1 - androgenRatio) * 100)}% below baseline`,
        );
      }
    } else if (!androgenCoverageOk) {
      missing.push("androgen log (need >=4 of last 7d and >=10 of last 28d)");
    }

    if (suppressedSignals >= T.suppressedMinSignals) {
      const conf: "high" | "medium" | "low" =
        suppressedAvailable >= 3
          ? "high"
          : suppressedAvailable >= 2
            ? "medium"
            : "low";

      prevColor = "SUPPRESSED";
      candidateColor_hysteresis = null;
      candidateStreak = 0;

      return {
        date,
        color: "SUPPRESSED",
        label: "Suppressed",
        confidence: conf,
        reasons,
        ...(missing.length > 0 ? { missing } : {}),
        ...(isWeekend(date) ? { weekendSymbol: buildWeekendSymbol(date, "SUPPRESSED") } : {}),
      };
    }

    const todayLoad = trainingLoadForDate(date);
    if (todayLoad === "light" || todayLoad === "none") {
      let hardDays = 0;
      for (let i = 1; i <= 7; i++) {
        if (trainingLoadForDate(addDays(date, -i)) === "hard") hardDays++;
      }
      if (hardDays >= T.deloadHardDaysRequired) {
        const deloadRow = dayMap.get(date);
        if (deloadRow?.deload_week) {
          reasons.push(
            `Deload: ${hardDays} hard days in prior week, light/rest today, deload_week flagged`,
          );
        } else {
          reasons.push(
            `Deload: ${hardDays} hard days in prior week, light/rest today`,
          );
        }

        prevColor = "DELOAD";
        candidateColor_hysteresis = null;
        candidateStreak = 0;

        return {
          date,
          color: "DELOAD",
          label: "Deload",
          confidence: "high",
          reasons,
          ...(missing.length > 0 ? { missing } : {}),
          ...(isWeekend(date) ? { weekendSymbol: buildWeekendSymbol(date, "DELOAD") } : {}),
        };
      }
    }

    const weights7d = getWeightWindow(date, T.baselineWeightShortDays);
    const weights14d = getWeightWindow(date, T.baselineWeightLongDays);
    const avg7d = avg(weights7d);
    const avg14d = avg(weights14d);

    let weightTrend: number | null = null;
    if (
      avg7d != null &&
      avg14d != null &&
      weights14d.length >= T.minWeightEntries
    ) {
      weightTrend = avg7d - avg14d;
    }

    if (
      weightTrend == null &&
      weights14d.length < T.minWeightEntries
    ) {
      missing.push(
        `weight (need >=${T.minWeightEntries} entries in last 14d, have ${weights14d.length})`,
      );
    }

    let candidateColor: DayColor = "UNKNOWN";
    const candidateReasons: string[] = [];

    if (weightTrend != null) {
      const trendStr = `${weightTrend >= 0 ? "+" : ""}${weightTrend.toFixed(2)} lb/wk`;

      if (
        weightTrend >= T.leanGainMinLbPerWeek &&
        weightTrend <= T.leanGainMaxLbPerWeek
      ) {
        candidateColor = "LEAN_GAIN";
        candidateReasons.push(`Weight trend ${trendStr} (lean gain range)`);
      } else if (weightTrend <= T.cutMaxLbPerWeek) {
        candidateColor = "CUT";
        candidateReasons.push(`Weight trend ${trendStr} (cut range)`);
      } else if (Math.abs(weightTrend) < T.recompWeightBand) {
        const waistVals = getWaistWindow(date, T.waistTrendDays);
        if (waistVals.length >= 2) {
          const waistDelta = waistVals[0] - waistVals[waistVals.length - 1];
          if (waistDelta <= T.recompWaistMinDelta) {
            candidateColor = "RECOMP";
            candidateReasons.push(
              `Weight stable (${trendStr}), waist trending down (${waistDelta.toFixed(2)}")`,
            );
          } else {
            candidateReasons.push(
              `Weight stable (${trendStr}), waist flat/up`,
            );
          }
        } else {
          missing.push(
            "waist_in (need >=2 entries in last 14d for recomp detection)",
          );
          candidateReasons.push(`Weight stable (${trendStr}), no waist data`);
        }
      } else if (weightTrend > T.leanGainMaxLbPerWeek) {
        candidateColor = "LEAN_GAIN";
        candidateReasons.push(
          `Weight trend ${trendStr} (above lean gain range, consider slowing surplus)`,
        );
      }
    }

    if (candidateColor !== "UNKNOWN") {
      if (candidateColor === candidateColor_hysteresis) {
        candidateStreak++;
      } else {
        candidateColor_hysteresis = candidateColor;
        candidateStreak = 1;
      }

      if (
        prevColor != null &&
        prevColor !== candidateColor &&
        prevColor !== "SUPPRESSED" &&
        prevColor !== "DELOAD" &&
        prevColor !== "UNKNOWN" &&
        candidateStreak < T.hysteresisMinDays
      ) {
        reasons.push(
          ...candidateReasons,
          `Hysteresis: holding ${prevColor} (candidate ${candidateColor} ${candidateStreak}/${T.hysteresisMinDays}d)`,
        );

        return {
          date,
          color: prevColor,
          label: labelFor(prevColor),
          confidence: "medium",
          reasons,
          ...(missing.length > 0 ? { missing } : {}),
          ...(isWeekend(date) ? { weekendSymbol: buildWeekendSymbol(date, prevColor) } : {}),
        };
      }

      prevColor = candidateColor;
      reasons.push(...candidateReasons);

      return {
        date,
        color: candidateColor,
        label: labelFor(candidateColor),
        confidence:
          weightTrend != null && weights14d.length >= 7 ? "high" : "medium",
        reasons,
        ...(missing.length > 0 ? { missing } : {}),
        ...(isWeekend(date) ? { weekendSymbol: buildWeekendSymbol(date, candidateColor) } : {}),
      };
    }

    return {
      date,
      color: "UNKNOWN",
      label: "Unknown",
      confidence: "low",
      reasons:
        candidateReasons.length > 0
          ? candidateReasons
          : ["Insufficient data to classify"],
      missing: missing.length > 0 ? missing : undefined,
      ...(isWeekend(date) ? { weekendSymbol: buildWeekendSymbol(date, "UNKNOWN") } : {}),
    };
  }

  function buildWeekendSymbol(date: string, color: DayColor): string {
    const weights7d = getWeightWindow(date, CLASSIFIER_THRESHOLDS.baselineWeightShortDays);
    const weights14d = getWeightWindow(date, CLASSIFIER_THRESHOLDS.baselineWeightLongDays);
    const a7 = avg(weights7d);
    const a14 = avg(weights14d);

    let trend = "▬";
    if (a7 != null && a14 != null) {
      const delta = a7 - a14;
      if (delta >= 0.25) trend = "▲";
      else if (delta <= -0.25) trend = "▼";
    }

    if (color === "SUPPRESSED") trend += "!";
    if (color === "RECOMP") trend += "*";

    return trend;
  }

  return results;
}

function labelFor(color: DayColor): string {
  switch (color) {
    case "LEAN_GAIN":
      return "Lean Gain";
    case "CUT":
      return "Cut";
    case "RECOMP":
      return "Recomp";
    case "DELOAD":
      return "Deload";
    case "SUPPRESSED":
      return "Suppressed";
    case "UNKNOWN":
      return "Unknown";
  }
}
