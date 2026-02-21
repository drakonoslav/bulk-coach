import { pool } from "./db";

export type CalorieSource = "weight_only" | "mode_override";
export type Priority = "high" | "medium" | "low";

export interface CalorieDecisionRow {
  day: string;
  deltaKcal: number;
  source: CalorieSource;
  priority: Priority;
  reason: string;
  wkGainLb: number | null;
  mode: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function upsertCalorieDecision(
  userId: string,
  input: {
    day: string;
    deltaKcal: number;
    source: CalorieSource;
    priority: Priority;
    reason: string;
    wkGainLb?: number | null;
    mode?: string | null;
  }
): Promise<void> {
  const {
    day,
    deltaKcal,
    source,
    priority,
    reason,
    wkGainLb = null,
    mode = null,
  } = input;

  await pool.query(
    `
    INSERT INTO calorie_decisions (user_id, day, delta_kcal, source, priority, reason, wk_gain_lb, mode)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id, day) DO UPDATE SET
      delta_kcal = EXCLUDED.delta_kcal,
      source = EXCLUDED.source,
      priority = EXCLUDED.priority,
      reason = EXCLUDED.reason,
      wk_gain_lb = EXCLUDED.wk_gain_lb,
      mode = EXCLUDED.mode,
      updated_at = NOW()
    `,
    [userId, day, deltaKcal, source, priority, reason, wkGainLb, mode]
  );
}

export async function getCalorieDecisions(
  userId: string,
  days: number
): Promise<CalorieDecisionRow[]> {
  const n = Math.max(1, Math.min(days, 365));

  const res = await pool.query(
    `
    SELECT
      day::text AS day,
      delta_kcal AS "deltaKcal",
      source,
      priority,
      reason,
      wk_gain_lb AS "wkGainLb",
      mode,
      created_at::text AS "createdAt",
      updated_at::text AS "updatedAt"
    FROM calorie_decisions
    WHERE user_id = $1
      AND day >= (CURRENT_DATE - ($2::int - 1))::text
    ORDER BY day DESC
    `,
    [userId, n]
  );

  return res.rows;
}

export function chooseFinalCalorieDelta(
  weightDelta: number,
  modeDelta: number,
  modePriority: Priority
): { delta: number; source: CalorieSource } {
  if (modeDelta !== 0 && modePriority === "high") {
    return { delta: modeDelta, source: "mode_override" };
  }
  return { delta: weightDelta, source: "weight_only" };
}
