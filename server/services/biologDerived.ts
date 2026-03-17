/**
 * server/services/biologDerived.ts
 *
 * Derived metrics layer on top of canonical biolog fields.
 * Input: raw workbook row (raw_json from biolog_rows).
 * Output: { canonical, derived }.
 *
 * Boundary rules:
 *   - Does NOT override workbook phase_rec
 *   - Does NOT silently reclassify the day
 *   - Does NOT fallback to legacy daily_log
 *   - Does NOT invent missing values from other sources
 *   - Computes ONLY from values present in the workbook row
 */

import {
  canonicalizeBiologRaw,
  type CanonicalBiologRow,
} from "./biologCanonical.js";

export type BiologDerived = {
  rem_min: number | null;
  core_min: number | null;
  deep_min: number | null;
  awake_min: number | null;

  total_sleep_min: number | null;
  total_in_bed_min: number | null;
  sleep_efficiency_pct: number | null;

  rem_pct_of_sleep: number | null;
  core_pct_of_sleep: number | null;
  deep_pct_of_sleep: number | null;
  awake_pct_of_bed: number | null;

  actual_bedtime_min_of_day: number | null;
  scheduled_bedtime_min_of_day: number | null;
  scheduled_waketime_min_of_day: number | null;

  bedtime_deviation_min: number | null;

  fat_mass_lb: number | null;
  skeletal_mass_lb: number | null;
  ffm_calc_lb: number | null;
  ffm_gap_lb: number | null;

  waist_to_navel_delta_in: number | null;
  arm_avg_in: number | null;
  arm_asymmetry_in: number | null;

  usable_sleep_row: boolean;
  usable_bodycomp_row: boolean;
  usable_measurement_row: boolean;
};

export type BiologDerivedRow = {
  canonical: CanonicalBiologRow;
  derived: BiologDerived;
};

/**
 * Parse "HH:MM", "HH:MM:SS", or bare numeric string → minutes.
 * Returns null for unparseable input.
 */
function parseDurationToMinutes(value: string | null): number | null {
  if (!value) return null;
  const raw = value.trim();

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hh = Number(hhmm[1]);
    const mm = Number(hhmm[2]);
    if (Number.isFinite(hh) && Number.isFinite(mm)) return hh * 60 + mm;
  }

  const hhmmss = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hhmmss) {
    const hh = Number(hhmmss[1]);
    const mm = Number(hhmmss[2]);
    if (Number.isFinite(hh) && Number.isFinite(mm)) return hh * 60 + mm;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;

  return null;
}

/**
 * Parse "22:30", "22:30:00", or "10:30 PM" → minutes since midnight.
 * Handles overnight times (22:xx → 1320+).
 * Returns null for unparseable input.
 */
function parseClockToMinutesOfDay(value: string | null): number | null {
  if (!value) return null;
  const raw = value.trim();

  const m1 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m1) {
    const hh = Number(m1[1]);
    const mm = Number(m1[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return hh * 60 + mm;
  }

  const m2 = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (m2) {
    let hh = Number(m2[1]);
    const mm = Number(m2[2]);
    const ap = m2[3].toUpperCase();
    if (hh === 12) hh = 0;
    if (ap === "PM") hh += 12;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return hh * 60 + mm;
  }

  return null;
}

function safePct(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (
    numerator === null ||
    denominator === null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return Math.round((numerator / denominator) * 10000) / 100;
}

/**
 * Compute overnight delta in minutes, collapsing wrap-around.
 * e.g. actual=22:31, scheduled=22:30 → +1 min
 *      actual=23:45, scheduled=22:30 → +75 min
 *      actual=02:00, scheduled=22:30 → +210 min (late)
 */
function overnightDeltaMinutes(
  actual: number | null,
  scheduled: number | null
): number | null {
  if (actual === null || scheduled === null) return null;
  let delta = actual - scheduled;
  if (delta > 720) delta -= 1440;
  if (delta < -720) delta += 1440;
  return delta;
}

/**
 * Derive physiological metrics from a raw workbook biolog row.
 * Returns both canonical (mapped) fields and derived computations.
 */
export function deriveBiologRow(
  raw: Record<string, unknown>
): BiologDerivedRow {
  const canonical = canonicalizeBiologRaw(raw);

  const remMin = parseDurationToMinutes(canonical.rem_sleep);
  const coreMin = parseDurationToMinutes(canonical.core_sleep);
  const deepMin = parseDurationToMinutes(canonical.deep_sleep);
  const awakeMin = parseDurationToMinutes(canonical.awake_sleep);

  const totalSleepMin =
    remMin !== null || coreMin !== null || deepMin !== null
      ? (remMin ?? 0) + (coreMin ?? 0) + (deepMin ?? 0)
      : null;

  const totalInBedMin =
    totalSleepMin !== null || awakeMin !== null
      ? (totalSleepMin ?? 0) + (awakeMin ?? 0)
      : null;

  const actualBedMin = parseClockToMinutesOfDay(canonical.actual_bedtime);
  const scheduledBedMin = parseClockToMinutesOfDay(canonical.scheduled_bedtime);
  const scheduledWakeMin = parseClockToMinutesOfDay(canonical.scheduled_waketime);

  const fatMassLb =
    canonical.bodyweight_lb !== null && canonical.bodyfat_pct !== null
      ? canonical.bodyweight_lb * (canonical.bodyfat_pct / 100)
      : null;

  const ffmCalcLb =
    canonical.bodyweight_lb !== null && fatMassLb !== null
      ? canonical.bodyweight_lb - fatMassLb
      : null;

  const skeletalMassLb =
    canonical.bodyweight_lb !== null && canonical.skeletal_mass_pct !== null
      ? canonical.bodyweight_lb * (canonical.skeletal_mass_pct / 100)
      : null;

  const ffmGapLb =
    canonical.ffm_lb !== null && ffmCalcLb !== null
      ? Math.round((canonical.ffm_lb - ffmCalcLb) * 10000) / 10000
      : null;

  const armAvg =
    canonical.arm_left_in !== null && canonical.arm_right_in !== null
      ? (canonical.arm_left_in + canonical.arm_right_in) / 2
      : null;

  const armAsym =
    canonical.arm_left_in !== null && canonical.arm_right_in !== null
      ? Math.abs(canonical.arm_left_in - canonical.arm_right_in)
      : null;

  return {
    canonical,
    derived: {
      rem_min: remMin,
      core_min: coreMin,
      deep_min: deepMin,
      awake_min: awakeMin,

      total_sleep_min: totalSleepMin,
      total_in_bed_min: totalInBedMin,
      sleep_efficiency_pct: safePct(totalSleepMin, totalInBedMin),

      rem_pct_of_sleep: safePct(remMin, totalSleepMin),
      core_pct_of_sleep: safePct(coreMin, totalSleepMin),
      deep_pct_of_sleep: safePct(deepMin, totalSleepMin),
      awake_pct_of_bed: safePct(awakeMin, totalInBedMin),

      actual_bedtime_min_of_day: actualBedMin,
      scheduled_bedtime_min_of_day: scheduledBedMin,
      scheduled_waketime_min_of_day: scheduledWakeMin,

      bedtime_deviation_min: overnightDeltaMinutes(actualBedMin, scheduledBedMin),

      fat_mass_lb:
        fatMassLb !== null ? Math.round(fatMassLb * 10000) / 10000 : null,
      skeletal_mass_lb:
        skeletalMassLb !== null
          ? Math.round(skeletalMassLb * 10000) / 10000
          : null,
      ffm_calc_lb:
        ffmCalcLb !== null ? Math.round(ffmCalcLb * 10000) / 10000 : null,
      ffm_gap_lb: ffmGapLb,

      waist_to_navel_delta_in:
        canonical.waist_in !== null && canonical.navel_waist_in !== null
          ? Math.round((canonical.navel_waist_in - canonical.waist_in) * 100) /
            100
          : null,
      arm_avg_in: armAvg !== null ? Math.round(armAvg * 100) / 100 : null,
      arm_asymmetry_in: armAsym !== null ? Math.round(armAsym * 100) / 100 : null,

      usable_sleep_row: totalSleepMin !== null || totalInBedMin !== null,
      usable_bodycomp_row:
        canonical.bodyweight_lb !== null ||
        canonical.bodyfat_pct !== null ||
        canonical.ffm_lb !== null,
      usable_measurement_row:
        canonical.waist_in !== null ||
        canonical.navel_waist_in !== null ||
        canonical.chest_in !== null ||
        canonical.hips_in !== null,
    },
  };
}
