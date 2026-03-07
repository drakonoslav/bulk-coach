import type { MuscleGroup } from "@/hooks/useWorkoutEngine";

export interface IntelMuscleEntry {
  muscle_id: number;
  muscle: string;
  freshness: number;
  fatigue: number;
  load_7d: number;
  last_hit: string | null;
  days_since_hit: number | null;
  underfed_score: number;
  status: "balanced" | "underfed" | "overtaxed";
  tau_days: number;
  heatmap_intensity: number;
  queue_priority: number;
  compound_suitability: number;
  isolation_suitability: number;
  data_blend: "canonical_only" | "bridge_only" | "blended" | "no_data";
}

export interface IntelMuscleStateResponse {
  date: string;
  muscle_schema_version: number;
  muscles: IntelMuscleEntry[];
  balances: {
    push_pull_ratio: number;
    upper_lower_ratio: number;
    anterior_posterior_ratio: number;
  };
  meta: {
    freshness_model: string;
    freshness_k: number;
    priority_model: string;
    freshness_interpretation: string;
    field_sources: Record<string, string>;
  };
}

export interface IntelPriorityBreakdown {
  deficit_component: number;
  freshness_component: number;
  recency_component: number;
  readiness_gate: number;
  mode_suitability: number;
}

export interface IntelPriorityEntry {
  muscle_id: number;
  muscle: string;
  priority_score: number;
  priority_breakdown: IntelPriorityBreakdown;
  status: "balanced" | "underfed" | "overtaxed";
  freshness: number;
  days_since_hit: number | null;
  recommended_slots: string[];
  rank: number;
}

export interface IntelGatedEntry {
  muscle_id: number;
  muscle: string;
  reason: string;
  freshness: number;
}

export interface IntelPriorityResponse {
  date: string;
  mode: "compound" | "isolation";
  queue: IntelPriorityEntry[];
  gated_out: IntelGatedEntry[];
  meta: {
    scoring_model: string;
    readiness_threshold: number;
    weights: {
      deficit: number;
      freshness: number;
      recency: number;
      mode_suitability: number;
    };
  };
}

const INTEL_TO_GAME: Map<number, MuscleGroup[]> = new Map([
  [1,  []],                                                 // Forearms — dropped
  [2,  ["biceps"]],
  [3,  ["triceps"]],
  [4,  ["delts_front", "delts_side", "delts_rear"]],        // Deltoids — grouped
  [5,  ["delts_front"]],                                    // Front/Anterior Delt
  [6,  ["delts_rear"]],                                     // Rear/Posterior Delt
  [7,  ["delts_side"]],                                     // Side/Lateral Delt
  [8,  ["neck"]],
  [9,  []],                                                 // Traps — dropped
  [10, []],                                                 // Upper Traps — dropped
  [11, []],                                                 // Mid Traps — dropped
  [12, []],                                                 // Lower Traps — dropped
  [13, ["back_upper"]],                                     // Upper Back
  [14, ["back_mid"]],                                       // Middle Back
  [15, []],                                                 // Lower Back — dropped
  [16, ["back_lats"]],                                      // Lats
  [17, ["chest_upper", "chest_mid", "chest_lower"]],        // Pectorals — grouped
  [18, []],                                                 // Obliques — dropped
  [19, ["abs"]],
  [20, ["glutes"]],
  [21, []],                                                 // Adductors — dropped
  [22, []],                                                 // Abductors — dropped
  [23, ["quads"]],
  [24, ["hamstrings"]],
  [25, []],                                                 // Shins — dropped
  [26, ["calves"]],
  [27, []],                                                 // Hands/Grip — dropped
]);

const DROPPED_MUSCLE_IDS = [1, 9, 10, 11, 12, 15, 18, 21, 22, 25, 27];

export interface BridgeResult {
  muscles: MuscleGroup[];
  mapped: number;
  dropped: number;
  droppedNames: string[];
  usedFallback: boolean;
}

export function collapseIntelPriority(queue: IntelPriorityEntry[]): BridgeResult {
  const seen = new Set<MuscleGroup>();
  const result: MuscleGroup[] = [];
  let mapped = 0;
  let dropped = 0;
  const droppedNames: string[] = [];

  for (const entry of queue) {
    const gameKeys = INTEL_TO_GAME.get(entry.muscle_id);
    if (!gameKeys || gameKeys.length === 0) {
      dropped++;
      droppedNames.push(entry.muscle);
      continue;
    }
    mapped++;
    for (const key of gameKeys) {
      if (!seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
  }

  return { muscles: result, mapped, dropped, droppedNames, usedFallback: false };
}

export function isDroppingTooMany(bridgeResult: BridgeResult, minRequired: number = 3): boolean {
  const uniqueMuscleSlots = new Set(bridgeResult.muscles).size;
  return uniqueMuscleSlots < minRequired;
}

export { DROPPED_MUSCLE_IDS };
