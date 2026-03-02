import { getApiUrl, authFetch } from "@/lib/query-client";

export const USE_INTEL_STRENGTH = true;

export interface IntelStrengthDay {
  date: string;
  day_strength_index: number;
  rolling_avg_7d: number;
  velocity_14d: number;
  trend_score: number;
  phase: string;
  phase_transition: string | null;
  tonnage: number;
  sets: number;
  avg_weight: number;
  avg_reps: number;
}

export interface IntelStrengthTrend {
  source: string;
  lane: string;
  schema_version: number;
  from: string;
  to: string;
  baseline_tonnage: number;
  training_days_in_baseline: number;
  sessions_in_14d: number;
  swap_penalty_14d: number;
  velocity_14d_unit: string;
  days: IntelStrengthDay[];
  latest: IntelStrengthDay;
}

export interface IntelStrengthSummary {
  sessions_in_14d: number;
  velocity_pct_per_week: number;
  velocity_index_per_week: number;
  swap_penalty_14d: number;
  day_strength_index: number;
  rolling_avg_7d: number;
  phase: string;
  phase_transition: string | null;
}

export async function fetchIntelStrengthTrend(
  from: string,
  to: string
): Promise<IntelStrengthTrend | null> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL("/api/intel/strength/trend", baseUrl);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    const res = await authFetch(url.toString());
    if (!res.ok) return null;
    const raw = await res.json();
    const data = raw?.upstream_json ?? raw;
    if (!data?.days || !Array.isArray(data.days)) return null;
    return data as IntelStrengthTrend;
  } catch {
    return null;
  }
}

export function deriveStrengthSummary(
  trend: IntelStrengthTrend
): IntelStrengthSummary {
  const sessions_in_14d = trend.sessions_in_14d ?? trend.days.slice(-14).filter((d) => d.sets > 0).length;
  const swap_penalty_14d = trend.swap_penalty_14d ?? 0;

  const latest = trend.latest ?? trend.days[trend.days.length - 1];
  const rawVelocity = latest?.velocity_14d ?? 0;

  const velocityPerWeek = rawVelocity * 7;

  const avg7d = latest?.rolling_avg_7d ?? 0;
  const velocityPctPerWeek = avg7d > 0 ? (velocityPerWeek / avg7d) * 100 : 0;

  return {
    sessions_in_14d,
    velocity_pct_per_week: velocityPctPerWeek,
    velocity_index_per_week: velocityPerWeek,
    swap_penalty_14d,
    day_strength_index: latest?.day_strength_index ?? 0,
    rolling_avg_7d: avg7d,
    phase: latest?.phase ?? "rest",
    phase_transition: latest?.phase_transition ?? null,
  };
}

export function trendToChartData(
  trend: IntelStrengthTrend
): { indexData: { day: string; value: number }[]; velocityData: { day: string; value: number }[] } {
  const indexData = trend.days.map((d) => ({
    day: d.date,
    value: d.rolling_avg_7d,
  }));
  const velocityData = trend.days.map((d) => ({
    day: d.date,
    value: d.velocity_14d * 7,
  }));
  return { indexData, velocityData };
}

export function trendPhaseMarkers(
  trend: IntelStrengthTrend
): { day: string; label: string; color: string }[] {
  return trend.days
    .filter((d) => d.phase_transition != null)
    .map((d) => ({
      day: d.date,
      label: d.phase_transition!,
      color: d.phase === "strength" ? "#22C55E" : d.phase === "deload" ? "#FBBF24" : "#60A5FA",
    }));
}
