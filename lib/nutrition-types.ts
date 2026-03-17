import type { ApiProvenance } from "./workbook-types";

export type NutritionMealLineRow = {
  rowIndex: number;
  phase: string | null;
  mealTemplateId: string | null;
  lineNo: number | null;
  ingredientId: string | null;
  amountUnit: number | null;
  kcalLine: number | null;
  proteinLine: number | null;
  carbsLine: number | null;
  fatLine: number | null;
  raw: Record<string, unknown>;
};

export type NutritionMealLinesResponse = {
  rows: NutritionMealLineRow[];
  total: number;
  provenance: ApiProvenance;
};

export type NutritionTemplateRow = {
  rowIndex: number;
  phase: string | null;
  mealTemplateId: string | null;
  kcalSum: number | null;
  proteinSum: number | null;
  carbsSum: number | null;
  fatSum: number | null;
  raw: Record<string, unknown>;
};

export type NutritionPhaseTotals = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type NutritionSummaryForPhaseResponse = {
  phase: string;
  templateRows: NutritionTemplateRow[];
  totals: NutritionPhaseTotals;
  provenance: ApiProvenance;
};

export type NutritionSummaryAllPhasesResponse = {
  phases: Array<{
    phase: string | null;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
  }>;
  provenance: ApiProvenance;
};
