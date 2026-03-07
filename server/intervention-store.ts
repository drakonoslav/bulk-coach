import { pool } from "./db";
import type {
  InterventionExperience,
  InterventionAction,
  InterventionStateSnapshot,
  InterventionOutcomeWindow,
} from "../lib/intervention-types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export async function saveInterventionExperience(
  userId: string,
  state: InterventionStateSnapshot,
  action: InterventionAction,
  notes?: string | null,
): Promise<string> {
  const id = generateId();
  await pool.query(
    `INSERT INTO intervention_experiences
       (id, user_id, created_at, state_json, action_json, notes)
     VALUES ($1, $2, NOW(), $3, $4, $5)`,
    [id, userId, JSON.stringify(state), JSON.stringify(action), notes ?? null],
  );
  return id;
}

export async function listInterventionExperiences(
  userId: string,
  limit = 100,
): Promise<InterventionExperience[]> {
  const { rows } = await pool.query(
    `SELECT id, created_at, state_json, action_json,
            outcome_3d_json, outcome_7d_json, outcome_14d_json,
            effectiveness_score, notes
     FROM intervention_experiences
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return rows.map(rowToExperience);
}

export async function getExperienceById(
  userId: string,
  id: string,
): Promise<InterventionExperience | null> {
  const { rows } = await pool.query(
    `SELECT id, created_at, state_json, action_json,
            outcome_3d_json, outcome_7d_json, outcome_14d_json,
            effectiveness_score, notes
     FROM intervention_experiences
     WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (rows.length === 0) return null;
  return rowToExperience(rows[0]);
}

export async function updateInterventionOutcome(
  userId: string,
  id: string,
  windowDays: 3 | 7 | 14,
  outcome: InterventionOutcomeWindow,
  effectivenessScore: number | null,
): Promise<void> {
  const col =
    windowDays === 3
      ? "outcome_3d_json"
      : windowDays === 7
        ? "outcome_7d_json"
        : "outcome_14d_json";

  await pool.query(
    `UPDATE intervention_experiences
     SET ${col} = $1, effectiveness_score = $2
     WHERE user_id = $3 AND id = $4`,
    [JSON.stringify(outcome), effectivenessScore, userId, id],
  );
}

export async function listPendingOutcomeEvaluations(
  userId: string,
): Promise<
  Array<{
    id: string;
    createdAt: string;
    state: InterventionStateSnapshot;
    missingWindows: Array<3 | 7 | 14>;
  }>
> {
  const { rows } = await pool.query(
    `SELECT id, created_at, state_json,
            outcome_3d_json, outcome_7d_json, outcome_14d_json
     FROM intervention_experiences
     WHERE user_id = $1
       AND (outcome_3d_json IS NULL OR outcome_7d_json IS NULL OR outcome_14d_json IS NULL)
     ORDER BY created_at ASC`,
    [userId],
  );

  const now = Date.now();
  const results: Array<{
    id: string;
    createdAt: string;
    state: InterventionStateSnapshot;
    missingWindows: Array<3 | 7 | 14>;
  }> = [];

  for (const row of rows) {
    const createdMs = new Date(row.created_at).getTime();
    const daysElapsed = (now - createdMs) / 86400000;
    const missing: Array<3 | 7 | 14> = [];

    if (row.outcome_3d_json == null && daysElapsed >= 3) missing.push(3);
    if (row.outcome_7d_json == null && daysElapsed >= 7) missing.push(7);
    if (row.outcome_14d_json == null && daysElapsed >= 14) missing.push(14);

    if (missing.length > 0) {
      results.push({
        id: row.id,
        createdAt: row.created_at,
        state: row.state_json as InterventionStateSnapshot,
        missingWindows: missing,
      });
    }
  }

  return results;
}

function rowToExperience(row: any): InterventionExperience {
  return {
    id: row.id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    state: row.state_json as InterventionStateSnapshot,
    action: row.action_json as InterventionAction,
    outcome3d: (row.outcome_3d_json as InterventionOutcomeWindow) ?? undefined,
    outcome7d: (row.outcome_7d_json as InterventionOutcomeWindow) ?? undefined,
    outcome14d: (row.outcome_14d_json as InterventionOutcomeWindow) ?? undefined,
    effectivenessScore: row.effectiveness_score ?? null,
    notes: row.notes ?? null,
  };
}
