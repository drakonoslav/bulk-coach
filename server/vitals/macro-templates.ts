// ═══════════════════════════════════════════════════════════════════════════════
// BulkCoach Vitals — Macro Templates (v1 Build Packet — exact spec values)
// ═══════════════════════════════════════════════════════════════════════════════

import { MacroDayType } from "./enums.js";
import type { MacroTargets, MealTimingTargets } from "./interfaces.js";

export const MACRO_TEMPLATES: Record<MacroDayType, MacroTargets> = {
  [MacroDayType.SURGE]: {
    kcal: 2700,
    proteinG: 175,
    carbsG: 390,
    fatG: 40,
  },
  [MacroDayType.BUILD]: {
    kcal: 2695,
    proteinG: 175,
    carbsG: 350,
    fatG: 60,
  },
  [MacroDayType.RESET]: {
    kcal: 2695,
    proteinG: 175,
    carbsG: 290,
    fatG: 80,
  },
  [MacroDayType.RESENSITIZE]: {
    kcal: 2610,
    proteinG: 175,
    carbsG: 250,
    fatG: 90,
  },
};

export const MEAL_TIMING_TEMPLATES: Record<MacroDayType, MealTimingTargets> = {
  [MacroDayType.SURGE]: {
    preCardioCarbsG: 30,
    postCardioProteinG: 40,
    postCardioCarbsG: 90,
    postCardioFatG: 10,
    meal2ProteinG: 30,
    meal2CarbsG: 60,
    meal2FatG: 10,
    preLiftProteinG: 25,
    preLiftCarbsG: 80,
    preLiftFatG: 5,
    postLiftProteinG: 45,
    postLiftCarbsG: 110,
    postLiftFatG: 5,
    finalMealProteinG: 35,
    finalMealCarbsG: 20,
    finalMealFatG: 10,
  },
  [MacroDayType.BUILD]: {
    preCardioCarbsG: 30,
    postCardioProteinG: 40,
    postCardioCarbsG: 75,
    postCardioFatG: 10,
    meal2ProteinG: 30,
    meal2CarbsG: 55,
    meal2FatG: 10,
    preLiftProteinG: 25,
    preLiftCarbsG: 65,
    preLiftFatG: 5,
    postLiftProteinG: 45,
    postLiftCarbsG: 85,
    postLiftFatG: 5,
    finalMealProteinG: 35,
    finalMealCarbsG: 40,
    finalMealFatG: 30,
  },
  [MacroDayType.RESET]: {
    preCardioCarbsG: 25,
    postCardioProteinG: 40,
    postCardioCarbsG: 60,
    postCardioFatG: 15,
    meal2ProteinG: 30,
    meal2CarbsG: 45,
    meal2FatG: 15,
    preLiftProteinG: 25,
    preLiftCarbsG: 45,
    preLiftFatG: 10,
    postLiftProteinG: 45,
    postLiftCarbsG: 55,
    postLiftFatG: 10,
    finalMealProteinG: 35,
    finalMealCarbsG: 35,
    finalMealFatG: 30,
  },
  [MacroDayType.RESENSITIZE]: {
    preCardioCarbsG: 20,
    postCardioProteinG: 40,
    postCardioCarbsG: 45,
    postCardioFatG: 15,
    meal2ProteinG: 30,
    meal2CarbsG: 35,
    meal2FatG: 20,
    preLiftProteinG: 25,
    preLiftCarbsG: 30,
    preLiftFatG: 10,
    postLiftProteinG: 40,
    postLiftCarbsG: 40,
    postLiftFatG: 10,
    finalMealProteinG: 40,
    finalMealCarbsG: 40,
    finalMealFatG: 35,
  },
};

// Human-readable labels for UI display
export const CARDIO_MODE_LABELS: Record<string, string> = {
  recovery_walk: "Walk / Easy",
  zone_2: "Zone 2",
  zone_3: "Zone 3",
};

export const LIFT_MODE_LABELS: Record<string, string> = {
  off: "Off",
  mobility: "Mobility",
  recovery_patterning: "Recovery / Patterning",
  pump: "Pump / Moderate",
  hypertrophy_build: "Hypertrophy / Build",
  neural_tension: "Neural / Tension",
};

export const MACRO_DAY_LABELS: Record<string, string> = {
  surge: "SURGE",
  build: "BUILD",
  reset: "RESET",
  resensitize: "RESENSITIZE",
};
