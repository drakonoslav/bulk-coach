import { Pool } from "pg";
import { MEAL_PLAN, MEAL_KEYS, BASELINE_KCAL, type MealKey } from "./mealPlan";

export type PerMealStat = {
  key: string;
  label: string;
  hitDays: number;
  missDays: number;
  hitPct: number | null;
};

export type MealAdherence14d = {
  startDateISO: string;
  endDateISO: string;
  daysWithLogs: number;
  daysTotal: number;

  avgEarnedKcal: number | null;
  avgMissedKcal: number | null;
  avgBaselineHitPct: number | null;

  avgMealsChecked: number | null;
  avgMealsMissed: number | null;

  perMeal: PerMealStat[];

  biggestMiss: string | null;
};

export type MealAdherenceRow = {
  day: string;
  meal_checklist: Record<string, boolean>;
};

export function reduceMealAdherenceRows(
  rows: MealAdherenceRow[],
  startDateISO: string,
  endDateISO: string,
): MealAdherence14d {
  const start = new Date(startDateISO);
  const end = new Date(endDateISO);
  const daysTotal = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  const daysWithLogs = rows.length;

  if (daysWithLogs === 0) {
    return {
      startDateISO,
      endDateISO,
      daysWithLogs: 0,
      daysTotal,
      avgEarnedKcal: null,
      avgMissedKcal: null,
      avgBaselineHitPct: null,
      avgMealsChecked: null,
      avgMealsMissed: null,
      perMeal: MEAL_KEYS.map((k) => ({
        key: k,
        label: MEAL_PLAN[k].label,
        hitDays: 0,
        missDays: 0,
        hitPct: null,
      })),
      biggestMiss: null,
    };
  }

  let totalEarned = 0;
  let totalMissed = 0;
  let totalChecked = 0;
  const perMealHits: Record<string, number> = {};
  for (const k of MEAL_KEYS) perMealHits[k] = 0;

  for (const row of rows) {
    const checklist = row.meal_checklist ?? {};
    let dayEarned = 0;
    let dayChecked = 0;
    for (const k of MEAL_KEYS) {
      if (checklist[k]) {
        dayEarned += MEAL_PLAN[k].kcal;
        dayChecked++;
        perMealHits[k]++;
      }
    }
    totalEarned += dayEarned;
    totalMissed += Math.max(0, BASELINE_KCAL - dayEarned);
    totalChecked += dayChecked;
  }

  const avgEarnedKcal = totalEarned / daysWithLogs;
  const avgMissedKcal = totalMissed / daysWithLogs;
  const avgBaselineHitPct = (avgEarnedKcal / BASELINE_KCAL) * 100;
  const avgMealsChecked = totalChecked / daysWithLogs;
  const avgMealsMissed = MEAL_KEYS.length - avgMealsChecked;

  const perMeal: PerMealStat[] = MEAL_KEYS.map((k) => ({
    key: k,
    label: MEAL_PLAN[k].label,
    hitDays: perMealHits[k],
    missDays: daysWithLogs - perMealHits[k],
    hitPct: (perMealHits[k] / daysWithLogs) * 100,
  }));

  let biggestMissKey: MealKey | null = null;
  let biggestMissDays = 0;
  let biggestMissKcal = 0;
  for (const k of MEAL_KEYS) {
    const missDays = daysWithLogs - perMealHits[k];
    if (
      missDays > biggestMissDays ||
      (missDays === biggestMissDays && MEAL_PLAN[k].kcal > biggestMissKcal)
    ) {
      biggestMissKey = k;
      biggestMissDays = missDays;
      biggestMissKcal = MEAL_PLAN[k].kcal;
    }
  }

  const biggestMiss =
    biggestMissKey && biggestMissDays > 0
      ? MEAL_PLAN[biggestMissKey].label
      : null;

  return {
    startDateISO,
    endDateISO,
    daysWithLogs,
    daysTotal,
    avgEarnedKcal,
    avgMissedKcal,
    avgBaselineHitPct,
    avgMealsChecked,
    avgMealsMissed,
    perMeal,
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
