import { getApiUrl, authFetch } from "@/lib/query-client";

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
  days: IntelStrengthDay[];
  latest: IntelStrengthDay;
}

export interface IntelStrengthSummary {
  sessions_in_14d: number;
  velocity_14d_pct: number;
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
  const last14 = trend.days.slice(-14);
  const sessions_in_14d = last14.filter((d) => d.sets > 0).length;

  const latest = trend.latest ?? trend.days[trend.days.length - 1];
  const rawVelocity = latest?.velocity_14d ?? 0;
  const velocity_14d_pct = rawVelocity * 100;

  return {
    sessions_in_14d,
    velocity_14d_pct,
    swap_penalty_14d: 0,
    day_strength_index: latest?.day_strength_index ?? 0,
    rolling_avg_7d: latest?.rolling_avg_7d ?? 0,
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
    value: d.velocity_14d * 100,
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
