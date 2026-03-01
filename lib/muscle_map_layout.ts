export type MuscleKey =
  | "neck" | "delts_front" | "delts_side" | "delts_rear" | "delts"
  | "pecs" | "traps" | "traps_upper" | "traps_mid" | "traps_lower"
  | "upper_back" | "middle_back" | "lower_back" | "lats"
  | "biceps" | "triceps" | "forearms" | "hands_grip"
  | "abs" | "obliques"
  | "glutes" | "quads" | "hamstrings" | "calves" | "shins"
  | "adductors" | "abductors";

export type MuscleState = {
  key: MuscleKey;
  total_dose: number;
  direct_dose: number;
  load_7d: number;
  fatigue: number;
  readiness: number;
  last_hit?: string;
};

export type IntelMuscleMap = {
  date: string;
  updated_at: string;
  muscles: MuscleState[];
};

export interface GridCell {
  key: MuscleKey;
  label: string;
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  lane: "front_upper" | "front_lower" | "rear_upper" | "rear_lower";
}

export type RowDef =
  | { type: "flat"; cells: { key: MuscleKey; label: string; flex: number }[] }
  | { type: "split"; left: { key: MuscleKey; label: string; flex: number; rowSpan: number };
      midRows: { key: MuscleKey; label: string }[][];
      right: { key: MuscleKey; label: string; flex: number; rowSpan: number } | null;
      farRight: { key: MuscleKey; label: string }[];
    }
  | { type: "quad"; subRows: { key: MuscleKey; label: string }[][]; tall: { col: number; key: MuscleKey; label: string } | null };

export const BODY_ROWS: RowDef[] = [
  { type: "flat", cells: [
    { key: "delts",       label: "Deltoids",   flex: 3 },
    { key: "neck",        label: "Neck",        flex: 1 },
  ]},
  { type: "flat", cells: [
    { key: "delts_front", label: "Front Delt",  flex: 1 },
    { key: "delts_side",  label: "Side Delt",   flex: 1 },
    { key: "delts_rear",  label: "Rear Delt",   flex: 1 },
    { key: "traps_upper", label: "Upper Traps", flex: 1 },
  ]},
  { type: "split",
    left:  { key: "pecs",  label: "Pectorals", flex: 1, rowSpan: 2 },
    midRows: [
      [{ key: "triceps", label: "Triceps" }],
      [{ key: "biceps",  label: "Biceps" }],
    ],
    right: { key: "traps", label: "Traps", flex: 1, rowSpan: 2 },
    farRight: [
      { key: "traps_mid",   label: "Mid Traps" },
      { key: "traps_lower", label: "Lower Traps" },
    ],
  },
  { type: "flat", cells: [
    { key: "obliques",   label: "Obliques",    flex: 1 },
    { key: "forearms",   label: "Forearms",    flex: 1 },
    { key: "lats",       label: "Lats",        flex: 1 },
    { key: "upper_back", label: "Upper Back",  flex: 1 },
  ]},
  { type: "quad",
    subRows: [
      [{ key: "abs", label: "Abs" }, { key: "hands_grip", label: "Hands/Grip" }, { key: "glutes", label: "Glutes" }, { key: "middle_back", label: "Mid Back" }],
      [{ key: "abductors", label: "Abductors" }, { key: "adductors", label: "Adductors" }, { key: "glutes", label: "Glutes" }, { key: "lower_back", label: "Low Back" }],
    ],
    tall: { col: 2, key: "glutes", label: "Glutes" },
  },
  { type: "flat", cells: [
    { key: "quads",      label: "Quads",      flex: 1 },
    { key: "hamstrings", label: "Hamstrings",  flex: 1 },
  ]},
  { type: "flat", cells: [
    { key: "shins",  label: "Shins",  flex: 1 },
    { key: "calves", label: "Calves", flex: 1 },
  ]},
];

export const MUSCLE_MAP_GRID: GridCell[] = [
  { key: "delts",       label: "Deltoids",     row: 0, col: 0, colSpan: 3, lane: "front_upper" },
  { key: "neck",        label: "Neck",          row: 0, col: 3, lane: "rear_upper" },
  { key: "delts_front", label: "Front Delt",    row: 1, col: 0, lane: "front_upper" },
  { key: "delts_side",  label: "Side Delt",     row: 1, col: 1, lane: "front_upper" },
  { key: "delts_rear",  label: "Rear Delt",     row: 1, col: 2, lane: "rear_upper" },
  { key: "traps_upper", label: "Upper Traps",   row: 1, col: 3, lane: "rear_upper" },
  { key: "pecs",        label: "Pectorals",     row: 2, col: 0, rowSpan: 2, lane: "front_upper" },
  { key: "triceps",     label: "Triceps",       row: 2, col: 1, lane: "front_upper" },
  { key: "traps",       label: "Traps",         row: 2, col: 2, rowSpan: 2, lane: "rear_upper" },
  { key: "traps_mid",   label: "Mid Traps",     row: 2, col: 3, lane: "rear_upper" },
  { key: "biceps",      label: "Biceps",        row: 3, col: 1, lane: "front_upper" },
  { key: "traps_lower", label: "Lower Traps",   row: 3, col: 3, lane: "rear_upper" },
  { key: "obliques",    label: "Obliques",      row: 4, col: 0, lane: "front_lower" },
  { key: "forearms",    label: "Forearms",      row: 4, col: 1, lane: "front_upper" },
  { key: "lats",        label: "Lats",          row: 4, col: 2, lane: "rear_upper" },
  { key: "upper_back",  label: "Upper Back",    row: 4, col: 3, lane: "rear_upper" },
  { key: "abs",         label: "Abs",           row: 5, col: 0, lane: "front_lower" },
  { key: "hands_grip",  label: "Hands/Grip",    row: 5, col: 1, lane: "front_upper" },
  { key: "glutes",      label: "Glutes",        row: 5, col: 2, rowSpan: 2, lane: "rear_lower" },
  { key: "middle_back", label: "Mid Back",      row: 5, col: 3, lane: "rear_lower" },
  { key: "abductors",   label: "Abductors",     row: 6, col: 0, lane: "front_lower" },
  { key: "adductors",   label: "Adductors",     row: 6, col: 1, lane: "front_lower" },
  { key: "lower_back",  label: "Low Back",      row: 6, col: 3, lane: "rear_lower" },
  { key: "quads",       label: "Quads",         row: 7, col: 0, colSpan: 2, lane: "front_lower" },
  { key: "hamstrings",  label: "Hamstrings",    row: 7, col: 2, colSpan: 2, lane: "rear_lower" },
  { key: "shins",       label: "Shins",         row: 8, col: 0, colSpan: 2, lane: "front_lower" },
  { key: "calves",      label: "Calves",        row: 8, col: 2, colSpan: 2, lane: "rear_lower" },
];

export const ALL_MUSCLE_KEYS: MuscleKey[] = MUSCLE_MAP_GRID.map(c => c.key);

const INTEL_NAME_TO_KEY: Record<string, MuscleKey> = {
  "Forearms": "forearms",
  "Biceps": "biceps",
  "Triceps": "triceps",
  "Deltoids": "delts",
  "Front/Anterior Delt": "delts_front",
  "Rear/Posterior Delt": "delts_rear",
  "Side/Lateral Delt": "delts_side",
  "Neck": "neck",
  "Traps": "traps",
  "Upper Traps": "traps_upper",
  "Mid Traps": "traps_mid",
  "Lower Traps": "traps_lower",
  "Upper Back": "upper_back",
  "Middle Back": "middle_back",
  "Lower Back": "lower_back",
  "Lats": "lats",
  "Chest": "pecs",
  "Obliques": "obliques",
  "Abs": "abs",
  "Glutes": "glutes",
  "Adductors": "adductors",
  "Abductors": "abductors",
  "Quads": "quads",
  "Hamstrings": "hamstrings",
  "Shins": "shins",
  "Calves": "calves",
};

const INTEL_ID_TO_KEY: Record<number, MuscleKey> = {
  1: "forearms", 2: "biceps", 3: "triceps", 4: "delts",
  5: "delts_front", 6: "delts_rear", 7: "delts_side", 8: "neck",
  9: "traps", 10: "traps_upper", 11: "traps_mid", 12: "traps_lower",
  13: "upper_back", 14: "middle_back", 15: "lower_back", 16: "lats",
  17: "pecs", 18: "obliques", 19: "abs", 20: "glutes",
  21: "adductors", 22: "abductors", 23: "quads", 24: "hamstrings",
  25: "shins", 26: "calves",
};

export interface IntelRegion {
  muscle: string;
  muscle_id: number;
  total_dose: number;
  direct_dose: number;
}

export function transformIntelResponse(
  intelData: { date: string; regions: IntelRegion[] },
  mode: "total" | "direct" = "total"
): MuscleState[] {
  const regions = intelData.regions || [];
  const maxDose = Math.max(...regions.map(r => mode === "total" ? r.total_dose : r.direct_dose), 1);

  return regions
    .map((r) => {
      const key = INTEL_ID_TO_KEY[r.muscle_id] ?? INTEL_NAME_TO_KEY[r.muscle];
      if (!key) return null;
      const dose = mode === "total" ? r.total_dose : r.direct_dose;
      const score = Math.min(100, (dose / maxDose) * 100);
      return {
        key,
        total_dose: r.total_dose,
        direct_dose: r.direct_dose,
        load_7d: 0,
        fatigue: 0,
        readiness: score,
        last_hit: dose > 0 ? intelData.date : undefined,
      } as MuscleState;
    })
    .filter((m): m is MuscleState => m != null);
}
