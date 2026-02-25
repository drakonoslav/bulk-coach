import { Pool } from "pg";
import { MEAL_PLAN, MEAL_KEYS, BASELINE_KCAL, type MealKey } from "./mealPlan";

export type PerMealStat = {
  key: string;
  label: string;
  hitDays: number;
  missDays: number;
  hitPct: number | null;
  currentStreak: number;
  longestStreak: number;
  currentMissStreak: number;
  longestMissStreak: number;
};

export type MealAdherence14d = {
  startDateISO: string;
  endDateISO: string;
  daysWithLogs: number;
  daysTotal: number;

  kcal: {
    baselineKcal: number;
    avgEarnedKcal: number | null;
    avgMissedKcal: number | null;
    avgBaselineHitPct: number | null;
    p7AvgEarnedKcal: number | null;
    p14AvgEarnedKcal: number | null;
    trendKcalPerDay: number | null;
  };

  meals: {
    avgMealsChecked: number | null;
    avgMealsMissed: number | null;
    mostMissedMealKey: string | null;
    mostMissedMealLabel: string | null;
    mostVolatileMealKey: string | null;
    mostVolatileMealLabel: string | null;
    adherenceConsistencyPct: number | null;
  };

  confidence: "low" | "medium" | "high";

  perMeal: PerMealStat[];

  nextBestMeal: {
    key: string | null;
    label: string | null;
    reason: "lowest_hit_pct" | "highest_kcal_and_frequently_missed" | null;
  };

  avgEarnedKcal: number | null;
  avgMissedKcal: number | null;
  avgBaselineHitPct: number | null;
  avgMealsChecked: number | null;
  avgMealsMissed: number | null;
  biggestMiss: string | null;
};

export type MealAdherenceRow = {
  day: string;
  meal_checklist: Record<string, boolean>;
};

function computeConfidence(daysWithLogs: number): "low" | "medium" | "high" {
  if (daysWithLogs <= 4) return "low";
  if (daysWithLogs <= 10) return "medium";
  return "high";
}

function leastSquaresSlope(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 5) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function reduceMealAdherenceRows(
  rows: MealAdherenceRow[],
  startDateISO: string,
  endDateISO: string,
): MealAdherence14d {
  const start = new Date(startDateISO);
  const end = new Date(endDateISO);
  const daysTotal = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const daysWithLogs = rows.length;

  const nullPerMeal: PerMealStat[] = MEAL_KEYS.map((k) => ({
    key: k,
    label: MEAL_PLAN[k].label,
    hitDays: 0,
    missDays: 0,
    hitPct: null,
    currentStreak: 0,
    longestStreak: 0,
    currentMissStreak: 0,
    longestMissStreak: 0,
  }));

  if (daysWithLogs === 0) {
    return {
      startDateISO,
      endDateISO,
      daysWithLogs: 0,
      daysTotal,
      kcal: {
        baselineKcal: BASELINE_KCAL,
        avgEarnedKcal: null,
        avgMissedKcal: null,
        avgBaselineHitPct: null,
        p7AvgEarnedKcal: null,
        p14AvgEarnedKcal: null,
        trendKcalPerDay: null,
      },
      meals: {
        avgMealsChecked: null,
        avgMealsMissed: null,
        mostMissedMealKey: null,
        mostMissedMealLabel: null,
        mostVolatileMealKey: null,
        mostVolatileMealLabel: null,
        adherenceConsistencyPct: null,
      },
      confidence: "low",
      perMeal: nullPerMeal,
      nextBestMeal: { key: null, label: null, reason: null },
      avgEarnedKcal: null,
      avgMissedKcal: null,
      avgBaselineHitPct: null,
      avgMealsChecked: null,
      avgMealsMissed: null,
      biggestMiss: null,
    };
  }

  let totalEarned = 0;
  let totalMissed = 0;
  let totalChecked = 0;
  const perMealHits: Record<string, number> = {};
  const perMealCurrentStreak: Record<string, number> = {};
  const perMealLongestStreak: Record<string, number> = {};
  const perMealCurrentMissStreak: Record<string, number> = {};
  const perMealLongestMissStreak: Record<string, number> = {};
  for (const k of MEAL_KEYS) {
    perMealHits[k] = 0;
    perMealCurrentStreak[k] = 0;
    perMealLongestStreak[k] = 0;
    perMealCurrentMissStreak[k] = 0;
    perMealLongestMissStreak[k] = 0;
  }

  const dayEarnedValues: number[] = [];
  const dayCheckedValues: number[] = [];
  const trendPoints: { x: number; y: number }[] = [];

  const midpointDate = new Date(endDateISO);
  midpointDate.setDate(midpointDate.getDate() - 6);
  const midpointISO = midpointDate.toISOString().slice(0, 10);

  let p7Total = 0;
  let p7Count = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const checklist = row.meal_checklist ?? {};
    let dayEarned = 0;
    let dayChecked = 0;

    for (const k of MEAL_KEYS) {
      if (checklist[k]) {
        dayEarned += MEAL_PLAN[k].kcal;
        dayChecked++;
        perMealHits[k]++;
        perMealCurrentStreak[k]++;
        if (perMealCurrentStreak[k] > perMealLongestStreak[k]) {
          perMealLongestStreak[k] = perMealCurrentStreak[k];
        }
        perMealCurrentMissStreak[k] = 0;
      } else {
        perMealCurrentMissStreak[k]++;
        if (perMealCurrentMissStreak[k] > perMealLongestMissStreak[k]) {
          perMealLongestMissStreak[k] = perMealCurrentMissStreak[k];
        }
        perMealCurrentStreak[k] = 0;
      }
    }

    totalEarned += dayEarned;
    totalMissed += Math.max(0, BASELINE_KCAL - dayEarned);
    totalChecked += dayChecked;
    dayEarnedValues.push(dayEarned);
    dayCheckedValues.push(dayChecked);

    trendPoints.push({ x: i, y: dayEarned });

    if (row.day >= midpointISO) {
      p7Total += dayEarned;
      p7Count++;
    }
  }

  const avgEarnedKcal = totalEarned / daysWithLogs;
  const avgMissedKcal = totalMissed / daysWithLogs;
  const avgBaselineHitPct = (avgEarnedKcal / BASELINE_KCAL) * 100;
  const avgMealsChecked = totalChecked / daysWithLogs;
  const avgMealsMissed = MEAL_KEYS.length - avgMealsChecked;

  const p7AvgEarnedKcal = p7Count > 0 ? p7Total / p7Count : null;
  const p14AvgEarnedKcal = avgEarnedKcal;
  const trendKcalPerDay = leastSquaresSlope(trendPoints);

  const checkedStddev = stddev(dayCheckedValues);
  const adherenceConsistencyPct = Math.max(0, (1 - checkedStddev / 6) * 100);

  const perMeal: PerMealStat[] = MEAL_KEYS.map((k) => ({
    key: k,
    label: MEAL_PLAN[k].label,
    hitDays: perMealHits[k],
    missDays: daysWithLogs - perMealHits[k],
    hitPct: (perMealHits[k] / daysWithLogs) * 100,
    currentStreak: perMealCurrentStreak[k],
    longestStreak: perMealLongestStreak[k],
    currentMissStreak: perMealCurrentMissStreak[k],
    longestMissStreak: perMealLongestMissStreak[k],
  }));

  let mostMissedKey: MealKey | null = null;
  let mostMissedDays = 0;
  let mostMissedKcal = 0;
  for (const k of MEAL_KEYS) {
    const md = daysWithLogs - perMealHits[k];
    if (md > mostMissedDays || (md === mostMissedDays && MEAL_PLAN[k].kcal > mostMissedKcal)) {
      mostMissedKey = k;
      mostMissedDays = md;
      mostMissedKcal = MEAL_PLAN[k].kcal;
    }
  }

  const biggestMiss = mostMissedKey && mostMissedDays > 0 ? MEAL_PLAN[mostMissedKey].label : null;

  let mostVolatileKey: MealKey | null = null;
  let lowestHitPct = Infinity;
  for (const k of MEAL_KEYS) {
    const hp = (perMealHits[k] / daysWithLogs) * 100;
    if (hp < lowestHitPct) {
      lowestHitPct = hp;
      mostVolatileKey = k;
    }
  }

  let nextBestKey: MealKey | null = null;
  let nextBestReason: "lowest_hit_pct" | "highest_kcal_and_frequently_missed" | null = null;

  let lowestHpKey: MealKey | null = null;
  let lowestHp = Infinity;
  let lowestHpKcal = 0;
  for (const k of MEAL_KEYS) {
    const hp = (perMealHits[k] / daysWithLogs) * 100;
    if (hp < lowestHp || (hp === lowestHp && MEAL_PLAN[k].kcal > lowestHpKcal)) {
      lowestHpKey = k;
      lowestHp = hp;
      lowestHpKcal = MEAL_PLAN[k].kcal;
    }
  }

  const highKcalThreshold = BASELINE_KCAL / MEAL_KEYS.length;
  let highKcalMissKey: MealKey | null = null;
  let highKcalMissScore = 0;
  for (const k of MEAL_KEYS) {
    const md = daysWithLogs - perMealHits[k];
    if (MEAL_PLAN[k].kcal >= highKcalThreshold && md > 0) {
      const score = MEAL_PLAN[k].kcal * md;
      if (score > highKcalMissScore) {
        highKcalMissKey = k;
        highKcalMissScore = score;
      }
    }
  }

  if (highKcalMissKey && highKcalMissScore > (lowestHpKcal * (daysWithLogs - (lowestHpKey ? perMealHits[lowestHpKey] : 0)))) {
    nextBestKey = highKcalMissKey;
    nextBestReason = "highest_kcal_and_frequently_missed";
  } else if (lowestHpKey && lowestHp < 100) {
    nextBestKey = lowestHpKey;
    nextBestReason = "lowest_hit_pct";
  }

  return {
    startDateISO,
    endDateISO,
    daysWithLogs,
    daysTotal,
    kcal: {
      baselineKcal: BASELINE_KCAL,
      avgEarnedKcal,
      avgMissedKcal,
      avgBaselineHitPct,
      p7AvgEarnedKcal,
      p14AvgEarnedKcal,
      trendKcalPerDay,
    },
    meals: {
      avgMealsChecked,
      avgMealsMissed,
      mostMissedMealKey: mostMissedKey && mostMissedDays > 0 ? mostMissedKey : null,
      mostMissedMealLabel: biggestMiss,
      mostVolatileMealKey: mostVolatileKey,
      mostVolatileMealLabel: mostVolatileKey ? MEAL_PLAN[mostVolatileKey].label : null,
      adherenceConsistencyPct,
    },
    confidence: computeConfidence(daysWithLogs),
    perMeal,
    nextBestMeal: {
      key: nextBestKey,
      label: nextBestKey ? MEAL_PLAN[nextBestKey].label : null,
      reason: nextBestReason,
    },
    avgEarnedKcal,
    avgMissedKcal,
    avgBaselineHitPct,
    avgMealsChecked,
    avgMealsMissed,
    biggestMiss,
  };
}

export async function computeMealAdherenceRange(
  pool: Pool,
  startDateISO: string,
  endDateISO: string,
  userId: number,
): Promise<MealAdherence14d> {
  const { rows } = await pool.query<MealAdherenceRow>(
    `SELECT day, meal_checklist FROM daily_log
     WHERE day >= $1 AND day <= $2 AND user_id = $3 AND meal_checklist IS NOT NULL
     ORDER BY day`,
    [startDateISO, endDateISO, userId],
  );

  return reduceMealAdherenceRows(rows, startDateISO, endDateISO);
}
