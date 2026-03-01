export type MuscleKey =
  | "neck" | "delts_front" | "delts_side" | "delts_rear" | "delts"
  | "pecs" | "traps" | "traps_upper" | "traps_mid" | "traps_lower"
  | "upper_back" | "middle_back" | "lower_back" | "lats"
  | "biceps" | "triceps" | "forearms"
  | "abs" | "obliques"
  | "glutes" | "quads" | "hamstrings" | "calves" | "shins"
  | "adductors" | "abductors";

export type MuscleState = {
  key: MuscleKey;
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

export const MUSCLE_MAP_GRID: GridCell[] = [
  { key: "neck",        label: "Neck",        row: 0, col: 0, lane: "front_upper" },
  { key: "traps_upper", label: "Upper Traps", row: 0, col: 1, lane: "rear_upper" },
  { key: "delts_front", label: "Front Delts", row: 1, col: 0, lane: "front_upper" },
  { key: "delts_side",  label: "Side Delts",  row: 1, col: 1, lane: "front_upper" },
  { key: "delts_rear",  label: "Rear Delts",  row: 1, col: 2, lane: "rear_upper" },
  { key: "pecs",        label: "Pecs",        row: 2, col: 0, colSpan: 2, lane: "front_upper" },
  { key: "traps_mid",   label: "Mid Traps",   row: 2, col: 2, lane: "rear_upper" },
  { key: "biceps",      label: "Biceps",      row: 3, col: 0, lane: "front_upper" },
  { key: "triceps",     label: "Triceps",     row: 3, col: 1, lane: "rear_upper" },
  { key: "forearms",    label: "Forearms",    row: 3, col: 2, lane: "front_upper" },
  { key: "lats",        label: "Lats",        row: 4, col: 0, lane: "rear_upper" },
  { key: "upper_back",  label: "Upper Back",  row: 4, col: 1, lane: "rear_upper" },
  { key: "traps_lower", label: "Lower Traps", row: 4, col: 2, lane: "rear_upper" },
  { key: "abs",         label: "Abs",         row: 5, col: 0, colSpan: 2, lane: "front_lower" },
  { key: "obliques",    label: "Obliques",    row: 5, col: 2, lane: "front_lower" },
  { key: "middle_back", label: "Mid Back",    row: 6, col: 0, lane: "rear_lower" },
  { key: "lower_back",  label: "Low Back",    row: 6, col: 1, lane: "rear_lower" },
  { key: "glutes",      label: "Glutes",      row: 6, col: 2, lane: "rear_lower" },
  { key: "quads",       label: "Quads",       row: 7, col: 0, lane: "front_lower" },
  { key: "hamstrings",  label: "Hamstrings",  row: 7, col: 1, lane: "rear_lower" },
  { key: "adductors",   label: "Adductors",   row: 7, col: 2, lane: "front_lower" },
  { key: "abductors",   label: "Abductors",   row: 8, col: 0, lane: "front_lower" },
  { key: "calves",      label: "Calves",      row: 8, col: 1, lane: "rear_lower" },
  { key: "shins",       label: "Shins",       row: 8, col: 2, lane: "front_lower" },
  { key: "delts",       label: "Delts (all)", row: 9, col: 0, colSpan: 2, lane: "front_upper" },
  { key: "traps",       label: "Traps (all)", row: 9, col: 2, lane: "rear_upper" },
];

export const ALL_MUSCLE_KEYS: MuscleKey[] = MUSCLE_MAP_GRID.map(c => c.key);
