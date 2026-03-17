import { getApiUrl } from "./query-client";
import { makeApiHeaders } from "./api-headers";
import type {
  NutritionMealLinesResponse,
  NutritionSummaryAllPhasesResponse,
  NutritionSummaryForPhaseResponse,
} from "./nutrition-types";
import type { ApiErrorResponse } from "./workbook-types";

function base(): string {
  return getApiUrl().replace(/\/$/, "");
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T | ApiErrorResponse;
  if (!res.ok) {
    const err = data as ApiErrorResponse;
    throw new Error(err.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export async function fetchNutritionMealLines(params?: {
  phase?: string | null;
  mealTemplateId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<NutritionMealLinesResponse> {
  const headers = await makeApiHeaders();
  const url = new URL(`${base()}/api/nutrition`);
  if (params?.phase) url.searchParams.set("phase", params.phase);
  if (params?.mealTemplateId) url.searchParams.set("mealTemplateId", params.mealTemplateId);
  if (typeof params?.limit === "number") url.searchParams.set("limit", String(params.limit));
  if (typeof params?.offset === "number") url.searchParams.set("offset", String(params.offset));

  const res = await fetch(url.toString(), { method: "GET", headers });
  return parseJsonOrThrow<NutritionMealLinesResponse>(res);
}

export async function fetchNutritionSummaryForPhase(
  phase: string
): Promise<NutritionSummaryForPhaseResponse> {
  const headers = await makeApiHeaders();
  const url = new URL(`${base()}/api/nutrition/summary`);
  url.searchParams.set("phase", phase);

  const res = await fetch(url.toString(), { method: "GET", headers });
  return parseJsonOrThrow<NutritionSummaryForPhaseResponse>(res);
}

export async function fetchNutritionSummaryAllPhases(): Promise<NutritionSummaryAllPhasesResponse> {
  const headers = await makeApiHeaders();
  const res = await fetch(`${base()}/api/nutrition/summary`, { method: "GET", headers });
  return parseJsonOrThrow<NutritionSummaryAllPhasesResponse>(res);
}
