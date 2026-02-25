export type MealKey = "preCardio" | "postCardio" | "midday" | "preLift" | "postLift" | "evening";

export const MEAL_PLAN: Record<MealKey, { kcal: number; label: string }> = {
  preCardio: { kcal: 104, label: "Pre-cardio" },
  postCardio: { kcal: 644, label: "Post-cardio" },
  midday: { kcal: 303, label: "Midday" },
  preLift: { kcal: 385, label: "Pre-lift" },
  postLift: { kcal: 268, label: "Post-lift" },
  evening: { kcal: 992, label: "Evening" },
};

export const BASELINE_KCAL = 2696;

export const MEAL_KEYS = Object.keys(MEAL_PLAN) as MealKey[];
