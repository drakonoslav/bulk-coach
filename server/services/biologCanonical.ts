/**
 * server/services/biologCanonical.ts
 *
 * TRANSLATION LAYER ONLY.
 * Maps raw workbook biolog headers → canonical field names.
 * Stores canonical fields + raw_json for every row.
 *
 * Rules:
 *   - Normalize headers (lowercase, trim, remove spaces/underscores)
 *   - Map to canonical field names via BIOLOG_HEADER_MAP + BIOLOG_HEADER_ALIASES
 *   - Do NOT infer missing fields
 *   - Do NOT fallback to legacy data sources
 *   - workbook_snapshot_id remains the sole operational authority
 *
 * Data flow:
 *   Excel header names → canonical parser field names → Postgres snapshot rows → API payloads
 */

export type CanonicalBiologRow = {
  biolog_date: string | null;
  phase_rec: string | null;

  body_temp: number | null;
  actual_bedtime: string | null;

  rem_sleep: string | null;
  core_sleep: string | null;
  deep_sleep: string | null;
  awake_sleep: string | null;

  resting_hr: number | null;
  hrv: number | null;

  scheduled_bedtime: string | null;
  scheduled_waketime: string | null;

  bodyweight_lb: number | null;
  bodyfat_pct: number | null;
  skeletal_mass_pct: number | null;
  ffm_lb: number | null;

  waist_in: number | null;
  navel_waist_in: number | null;
  chest_in: number | null;
  hips_in: number | null;
  neck_in: number | null;

  arm_left_in: number | null;
  arm_right_in: number | null;
  thigh_in: number | null;

  raw: Record<string, unknown>;
};

export const BIOLOG_HEADER_MAP: Record<string, string> = {
  date: "biolog_date",
  phaserec: "phase_rec",
  bodytemp: "body_temp",
  actualbedtime: "actual_bedtime",

  rem_hhmm: "rem_sleep",
  core_hhmm: "core_sleep",
  deep_hhmm: "deep_sleep",
  awake_hhmm: "awake_sleep",

  rhr: "resting_hr",
  hrv: "hrv",

  schedulebedtime: "scheduled_bedtime",
  schedulewaketime: "scheduled_waketime",

  bodyweight_lb: "bodyweight_lb",
  bodyfat_pct: "bodyfat_pct",
  skeletal_mass_pct: "skeletal_mass_pct",
  ffm_lb: "ffm_lb",

  waist_in: "waist_in",
  navel_waist_in: "navel_waist_in",
  chest_in: "chest_in",
  hips_in: "hips_in",
  neck_in: "neck_in",

  arm_left_in: "arm_left_in",
  arm_right_in: "arm_right_in",

  thigh_in: "thigh_in",
};

export const BIOLOG_HEADER_ALIASES: Record<string, string[]> = {
  biolog_date: ["date", "log_date", "entry_date"],

  phase_rec: ["phaserec", "phase_rec", "phase"],

  body_temp: ["bodytemp", "body_temp"],

  actual_bedtime: ["actualbedtime", "actual_bedtime"],

  rem_sleep: ["rem_hhmm", "rem"],
  core_sleep: ["core_hhmm", "core"],
  deep_sleep: ["deep_hhmm", "deep"],
  awake_sleep: ["awake_hhmm", "awake"],

  resting_hr: ["rhr"],
  hrv: ["hrv"],

  scheduled_bedtime: ["schedulebedtime", "scheduled_bedtime"],
  scheduled_waketime: ["schedulewaketime", "scheduled_waketime"],

  bodyweight_lb: ["bodyweight_lb", "weight_lb"],
  bodyfat_pct: ["bodyfat_pct", "bodyfat"],
  skeletal_mass_pct: ["skeletal_mass_pct"],
  ffm_lb: ["ffm_lb", "ffm"],

  waist_in: ["waist_in"],
  navel_waist_in: ["navel_waist_in", "navel_waist"],
  chest_in: ["chest_in"],
  hips_in: ["hips_in"],
  neck_in: ["neck_in"],

  arm_left_in: ["arm_left_in", "left_arm"],
  arm_right_in: ["arm_right_in", "right_arm"],

  thigh_in: ["thigh_in", "thigh_left_in", "thigh_right_in"],
};

/**
 * Normalize a raw workbook header for comparison.
 * Strips spaces, underscores, and lowercases.
 * e.g. "Body Temp" → "bodytemp", "rem_hhmm" → "remhhmm"
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "")
    .trim();
}

/**
 * Resolve a raw workbook header to its canonical field name.
 * First tries BIOLOG_HEADER_MAP direct lookup, then BIOLOG_HEADER_ALIASES.
 * Returns null if no mapping exists (unmapped columns are dropped).
 */
export function resolveCanonicalHeader(header: string): string | null {
  const normalized = normalizeHeader(header);

  for (const [raw, canonical] of Object.entries(BIOLOG_HEADER_MAP)) {
    if (normalizeHeader(raw) === normalized) return canonical;
  }

  for (const [canonical, aliases] of Object.entries(BIOLOG_HEADER_ALIASES)) {
    if (aliases.some((a) => normalizeHeader(a) === normalized)) {
      return canonical;
    }
  }

  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value).replace(/,/g, "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  return raw === "" ? null : raw;
}

/**
 * Map a raw biolog workbook row (from raw_json) to canonical field names.
 * Preserves original raw in `.raw`.
 * Does NOT infer missing fields. Does NOT fallback to other sources.
 */
export function canonicalizeBiologRaw(
  raw: Record<string, unknown>
): CanonicalBiologRow {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const canonical = resolveCanonicalHeader(key);
    if (canonical) mapped[canonical] = value;
  }

  return {
    biolog_date: toText(mapped.biolog_date),
    phase_rec: toText(mapped.phase_rec),

    body_temp: toNumber(mapped.body_temp),
    actual_bedtime: toText(mapped.actual_bedtime),

    rem_sleep: toText(mapped.rem_sleep),
    core_sleep: toText(mapped.core_sleep),
    deep_sleep: toText(mapped.deep_sleep),
    awake_sleep: toText(mapped.awake_sleep),

    resting_hr: toNumber(mapped.resting_hr),
    hrv: toNumber(mapped.hrv),

    scheduled_bedtime: toText(mapped.scheduled_bedtime),
    scheduled_waketime: toText(mapped.scheduled_waketime),

    bodyweight_lb: toNumber(mapped.bodyweight_lb),
    bodyfat_pct: toNumber(mapped.bodyfat_pct),
    skeletal_mass_pct: toNumber(mapped.skeletal_mass_pct),
    ffm_lb: toNumber(mapped.ffm_lb),

    waist_in: toNumber(mapped.waist_in),
    navel_waist_in: toNumber(mapped.navel_waist_in),
    chest_in: toNumber(mapped.chest_in),
    hips_in: toNumber(mapped.hips_in),
    neck_in: toNumber(mapped.neck_in),

    arm_left_in: toNumber(mapped.arm_left_in),
    arm_right_in: toNumber(mapped.arm_right_in),
    thigh_in: toNumber(mapped.thigh_in),

    raw,
  };
}
