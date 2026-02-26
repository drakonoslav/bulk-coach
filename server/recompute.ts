import { pool } from "./db";

const DEFAULT_USER_ID = 'local_default';

interface LogRow {
  day: string;
  morning_weight_lb: number;
  evening_weight_lb: number | null;
  waist_in: number | null;
  bf_morning_pct: number | null;
  cardio_min: number | null;
  lean_mass_lb: number | null;
  fat_mass_lb: number | null;
}

const CARDIO_THRESHOLD = 45;
const CARDIO_ADD_CARBS = 25;

function computeLeanMass(weight: number, bfPct: number | null): number | null {
  if (bfPct == null) return null;
  return Math.round(weight * (1 - bfPct / 100) * 100) / 100;
}

function computeFatMass(weight: number, bfPct: number | null): number | null {
  if (bfPct == null) return null;
  return Math.round(weight * (bfPct / 100) * 100) / 100;
}

function avg(values: (number | null)[], minCount: number): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length < minCount) return null;
  return Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 100) / 100;
}

function cardioFuelNote(cardioMin: number | null): string | null {
  if (cardioMin == null) return null;
  if (cardioMin > CARDIO_THRESHOLD) {
    return `Cardio ${cardioMin}min > ${CARDIO_THRESHOLD} → add +${CARDIO_ADD_CARBS}g carbs: +${CARDIO_ADD_CARBS}g dextrin.`;
  }
  return null;
}

export async function backfillDashboardCacheForUser(userId: string, startDay: string, endDay: string): Promise<number> {
  const { rows: missingDays } = await pool.query(
    `SELECT dl.day
     FROM daily_log dl
     LEFT JOIN dashboard_cache dc ON dc.user_id = dl.user_id AND dc.day = dl.day
     WHERE dl.user_id = $1 AND dl.day BETWEEN $2 AND $3 AND dc.day IS NULL
     ORDER BY dl.day`,
    [userId, startDay, endDay],
  );

  if (missingDays.length === 0) return 0;

  for (const { day } of missingDays) {
    await recomputeRange(day, userId);
  }

  return missingDays.length;
}

export async function recomputeRange(targetDay: string, userId: string = DEFAULT_USER_ID): Promise<void> {
  const targetDate = new Date(targetDay + "T00:00:00Z");
  const recomputeStart = new Date(targetDate);
  recomputeStart.setUTCDate(recomputeStart.getUTCDate() - 20);
  const recomputeEnd = new Date(targetDate);
  recomputeEnd.setUTCDate(recomputeEnd.getUTCDate() + 20);
  const pullStart = new Date(recomputeStart);
  pullStart.setUTCDate(pullStart.getUTCDate() - 14);

  const pullStartStr = pullStart.toISOString().slice(0, 10);
  const recomputeStartStr = recomputeStart.toISOString().slice(0, 10);
  const recomputeEndStr = recomputeEnd.toISOString().slice(0, 10);

  const { rows } = await pool.query<LogRow>(
    `SELECT day, morning_weight_lb, evening_weight_lb, waist_in, bf_morning_pct, cardio_min
     FROM daily_log
     WHERE day >= $1 AND day <= $2 AND user_id = $3
     ORDER BY day ASC`,
    [pullStartStr, recomputeEndStr, userId],
  );

  const enriched = rows.map((r) => ({
    ...r,
    lean_mass_lb: computeLeanMass(r.morning_weight_lb, r.bf_morning_pct),
    fat_mass_lb: computeFatMass(r.morning_weight_lb, r.bf_morning_pct),
  }));

  const recomputeRows = enriched.filter(
    (r) => r.day >= recomputeStartStr && r.day <= recomputeEndStr,
  );

  for (const row of recomputeRows) {
    const idx = enriched.findIndex((e) => e.day === row.day);

    const w7Window = enriched.slice(Math.max(0, idx - 6), idx + 1);
    const weight7dAvg = avg(
      w7Window.map((r) => r.morning_weight_lb),
      7,
    );
    const waist7dAvg = avg(
      w7Window.map((r) => r.waist_in),
      3,
    );
    const leanMass7dAvg = avg(
      w7Window.map((r) => r.lean_mass_lb),
      3,
    );

    let lgrRoll: number | null = null;
    const endDate = new Date(row.day + "T00:00:00Z");
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 13);
    const startStr = startDate.toISOString().slice(0, 10);

    const window14 = enriched.filter(
      (r) => r.day >= startStr && r.day <= row.day && r.lean_mass_lb != null,
    );
    if (window14.length >= 2) {
      const first = window14[0];
      const last = window14[window14.length - 1];
      const dw = last.morning_weight_lb - first.morning_weight_lb;
      if (Math.abs(dw) >= 0.1) {
        const ratio = (last.lean_mass_lb! - first.lean_mass_lb!) / dw;
        lgrRoll = Math.max(-1.0, Math.min(2.0, ratio));
        lgrRoll = Math.round(lgrRoll * 100) / 100;
      }
    }

    const fuelNote = cardioFuelNote(row.cardio_min);

    await pool.query(
      `INSERT INTO dashboard_cache (user_id, day, lean_mass_lb, fat_mass_lb, weight_7d_avg, waist_7d_avg, lean_mass_7d_avg, lean_gain_ratio_14d_roll, cardio_fuel_note, recomputed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (user_id, day) DO UPDATE SET
         lean_mass_lb = EXCLUDED.lean_mass_lb,
         fat_mass_lb = EXCLUDED.fat_mass_lb,
         weight_7d_avg = EXCLUDED.weight_7d_avg,
         waist_7d_avg = EXCLUDED.waist_7d_avg,
         lean_mass_7d_avg = EXCLUDED.lean_mass_7d_avg,
         lean_gain_ratio_14d_roll = EXCLUDED.lean_gain_ratio_14d_roll,
         cardio_fuel_note = EXCLUDED.cardio_fuel_note,
         recomputed_at = NOW()`,
      [
        userId,
        row.day,
        row.lean_mass_lb,
        row.fat_mass_lb,
        weight7dAvg,
        waist7dAvg,
        leanMass7dAvg,
        lgrRoll,
        fuelNote,
      ],
    );
  }
}
