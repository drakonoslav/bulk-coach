import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, router } from "expo-router";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch } from "@/lib/query-client";
import { fmtVal, fmtInt, fmtDelta, fmtFracToPctInt, scoreColor } from "@/lib/format";
import { loadIntelRecommendation, saveIntelRecommendation, type IntelRecommendation } from "@/lib/entry-storage";

interface SessionRow {
  date: string;
  nocturnalErections: number | null;
  nocturnalDurationSeconds: number | null;
  isImputed: boolean;
  imputedMethod: string | null;
  multiNightCombined: boolean;
}

interface ProxyRow {
  date: string;
  proxyScore: number | null;
  proxy7dAvg: number | null;
}

interface SnapshotRow {
  id: string;
  sessionDate: string;
  totalNights: number;
  totalNocturnalErections: number;
  totalNocturnalDurationSeconds: number;
}

interface ConfidenceWindow {
  window: string;
  days: number;
  measured: number;
  imputed: number;
  multiNight: number;
  grade: "High" | "Med" | "Low" | "None";
}

const _intelCyclesRefreshedVitals = new Set<string>();

const ACCENT = "#8B5CF6";
const ACCENT_MUTED = "rgba(139, 92, 246, 0.15)";
const MEASURED_COLOR = "#34D399";
const IMPUTED_COLOR = "#FBBF24";

// ─── Androgen Oscillator types (v1 spec) ─────────────────────────────────────
interface BreakdownItem {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  note: string;
}

interface MealTiming {
  preCardioC: number;
  postCardioP: number; postCardioC: number; postCardioF: number;
  meal2P: number; meal2C: number; meal2F: number;
  preLiftP: number; preLiftC: number;
  postLiftP: number; postLiftC: number;
  finalP: number; finalC: string; finalF: string;
}

interface OscillatorData {
  date: string;
  cycleDay28: number;
  cycleWeek: "Prime" | "Overload" | "Peak" | "Resensitize";
  composite: number | null;
  ocs_class: string | null;
  tier: string | null;
  acute: number | null;
  resource: number | null;
  seasonal: number | null;
  acuteComponents: {
    // v1 spec exact weights: HRV 22, RHR 18, sleep qty 15, regularity 8, BW 5, subjective 10, joint/soreness 10, lift strain 7, cardio strain 5
    hrvRatio: number | null; hrvYearRatio: number | null; hrvPts: number;
    rhrDelta: number | null; rhrPts: number;
    sleepMin: number | null; sleepPts: number;
    sleepMidpointShiftMin: number | null; regularityPts: number;
    bwDeltaPct: number | null; bwStabilityPts: number;
    subjectiveDrivePts: number;
    jointSorenessPts: number;
    yesterdayLiftPts: number;
    yesterdayCardioPts: number;
    hasHrv: boolean; hasRhr: boolean; hasSleep: boolean; hasSubjective: boolean;
  };
  resourceComponents: {
    // v1 spec exact weights: cal 10, protein 12, fat floor 12, carb timing 10, BW trend 10, waist 12, FFM 12, strength 12, cardio monotony 10
    caloriePts: number; proteinPts: number; fatFloorPts: number; carbTimingPts: number;
    weightTrendPts: number; waistTrendPts: number; ffmTrendPts: number;
    strengthTrendPts: number; cardioMonotonyPts: number;
    avgCalories7d: number | null;
    avgProtein7d: number | null;
    avgFat7d: number | null;
    bwTrend14dLbPerWk: number | null;
    waistTrend14dInOver14d: number | null;
    ffmTrend14dLbPerWk: number | null;
    strengthTrendPct: number | null;
    zone2Days7d: number; zone3Days7d: number; easyDays7d: number;
  };
  seasonalComponents: {
    // v1 spec exact weights: HRV28 18, RHR28 14, sleep reg 10, waist:weight 12, FFM28 14, deload 10, monotony 8, light 6, motivation 8
    hrv28Pts: number; rhr28Pts: number; sleepReg28Pts: number;
    waistWeightRelPts: number; ffm28Pts: number; deloadPts: number;
    monotonyPts: number; lightPts: number; motivationPts: number;
    hrv28PctChange: number | null; rhr28DeltaBpm: number | null;
    waistChange28d: number | null; weightChange28d: number | null; ffm28dChange: number | null;
  };
  prescription: {
    dayType: "SURGE" | "BUILD" | "RESET" | "RESENSITIZE";
    cardioMode: string;
    liftExpression: string;
    macroProteinG: number;
    macroCarbG: [number, number];
    macroFatG: [number, number];
    macroKcalApprox: number;
    mealTiming: MealTiming;
  };
  hardStopFatigue: boolean;
  hardStopReasons: string[];
  zone2Count7d: number;
  zone3Count7d: number;
  easyCount7d: number;
  explanationText: string;
  dataQuality: "full" | "partial" | "insufficient";
  breakdowns?: {
    acute: BreakdownItem[];
    resource: BreakdownItem[];
    seasonal: BreakdownItem[];
  };
  reasoning?: string[];
}

// ─── Tier config (v1 OCS bands: 85+/70–84/55–69/40–54/<40) ──────────────────
const TIER_CONFIG: Record<string, { color: string; glow: string; label: string; sub: string }> = {
  "Peak":            { color: "#00ffcc", glow: "rgba(0,255,204,0.18)",    label: "PEAK",         sub: "Zone 3 · Neural/Tension · Surge Macros" },
  "Strong Build":    { color: "#00D4AA", glow: "rgba(0,212,170,0.18)",    label: "BUILD",        sub: "Zone 3 or 2 · Hypertrophy · Build Macros" },
  "Controlled Build":{ color: "#FBBF24", glow: "rgba(251,191,36,0.15)",   label: "CONTROLLED",   sub: "Zone 2 · Pump/Moderate · Build or Reset" },
  "Reset":           { color: "#FB923C", glow: "rgba(251,146,60,0.15)",   label: "RESET",        sub: "Zone 2 Short · Recovery Pattern · Reset" },
  "Resensitize":     { color: "#F87171", glow: "rgba(248,113,113,0.15)",  label: "RESENSITIZE",  sub: "Walk Only · No Hard Lift · Resensitize" },
};

function mapIntelToOscillator(intel: IntelRecommendation): OscillatorData {
  const cls = intel.scores?.oscillatorClass ?? "Resensitize";
  const dayTypeMap: Record<string, "SURGE" | "BUILD" | "RESET" | "RESENSITIZE"> = {
    "Peak": "SURGE", "Strong Build": "BUILD",
    "Controlled Build": "RESET", "Reset": "RESET", "Resensitize": "RESENSITIZE",
  };
  const weekMap: Record<string, "Prime" | "Overload" | "Peak" | "Resensitize"> = {
    prime: "Prime", overload: "Overload", peak: "Peak", resensitize: "Resensitize",
  };
  const mt = intel.macroTargets ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

  const abd = intel.scoreBreakdowns?.acute ?? [];
  const rbd = intel.scoreBreakdowns?.resource ?? [];
  const sebd = intel.scoreBreakdowns?.seasonal ?? [];

  const ra = intel.rawInputs?.acute ?? {};
  const rr = intel.rawInputs?.resource ?? {};
  const rs = intel.rawInputs?.seasonal ?? {};

  const acuteComponents: OscillatorData["acuteComponents"] = {
    hrvRatio: ra.hrv_ratio ?? null,
    hrvYearRatio: null,
    hrvPts: abd[0]?.score ?? 0,
    rhrDelta: ra.rhr_delta_bpm ?? null,
    rhrPts: abd[1]?.score ?? 0,
    sleepMin: ra.sleep_duration_min ?? null,
    sleepPts: abd[2]?.score ?? 0,
    sleepMidpointShiftMin: ra.sleep_midpoint_shift_min ?? null,
    regularityPts: abd[3]?.score ?? 0,
    bwDeltaPct: ra.weight_delta_pct ?? null,
    bwStabilityPts: abd[4]?.score ?? 0,
    subjectiveDrivePts: abd[5]?.score ?? 0,
    jointSorenessPts: abd[6]?.score ?? 0,
    yesterdayLiftPts: abd[7]?.score ?? 0,
    yesterdayCardioPts: abd[8]?.score ?? 0,
    hasHrv: ra.hrv_ratio != null,
    hasRhr: ra.rhr_delta_bpm != null,
    hasSleep: ra.sleep_duration_min != null,
    hasSubjective: ra.drive_composite_0_10 != null,
  };

  const z2 = rr.zone2_days_7d ?? 0;
  const z3 = rr.zone3_days_7d ?? 0;
  const ez = rr.easy_days_7d ?? 0;

  const resourceComponents: OscillatorData["resourceComponents"] = {
    caloriePts: rbd[0]?.score ?? 0,
    proteinPts: rbd[1]?.score ?? 0,
    fatFloorPts: rbd[2]?.score ?? 0,
    carbTimingPts: rbd[3]?.score ?? 0,
    weightTrendPts: rbd[4]?.score ?? 0,
    waistTrendPts: rbd[5]?.score ?? 0,
    ffmTrendPts: rbd[6]?.score ?? 0,
    strengthTrendPts: rbd[7]?.score ?? 0,
    cardioMonotonyPts: rbd[8]?.score ?? 0,
    avgCalories7d: rr.avg_calories_7d ?? null,
    avgProtein7d: rr.avg_protein_7d ?? null,
    avgFat7d: rr.avg_fat_7d ?? null,
    bwTrend14dLbPerWk: rr.bw_trend_14d_lb_per_wk ?? null,
    waistTrend14dInOver14d: rr.waist_trend_14d ?? null,
    ffmTrend14dLbPerWk: rr.ffm_trend_14d_lb_per_wk ?? null,
    strengthTrendPct: rr.strength_trend_pct ?? null,
    zone2Days7d: z2,
    zone3Days7d: z3,
    easyDays7d: ez,
  };

  const seasonalComponents: OscillatorData["seasonalComponents"] = {
    hrv28Pts: sebd[0]?.score ?? 0,
    rhr28Pts: sebd[1]?.score ?? 0,
    sleepReg28Pts: sebd[2]?.score ?? 0,
    waistWeightRelPts: sebd[3]?.score ?? 0,
    ffm28Pts: sebd[4]?.score ?? 0,
    deloadPts: sebd[5]?.score ?? 0,
    monotonyPts: sebd[6]?.score ?? 0,
    lightPts: sebd[7]?.score ?? 0,
    motivationPts: sebd[8]?.score ?? 0,
    hrv28PctChange: rs.hrv_28d_pct_change ?? null,
    rhr28DeltaBpm: rs.rhr_28d_delta_bpm ?? null,
    waistChange28d: rs.waist_change_28d ?? null,
    weightChange28d: rs.weight_change_28d ?? null,
    ffm28dChange: rs.ffm_28d_change ?? null,
  };

  return {
    date: intel.date,
    cycleDay28: intel.cycleDay28 ?? 0,
    cycleWeek: weekMap[(intel.cycleWeekType ?? "prime").toLowerCase()] ?? "Prime",
    composite: intel.scores?.compositeScore ?? null,
    ocs_class: cls,
    tier: cls,
    acute: intel.scores?.acuteScore ?? null,
    resource: intel.scores?.resourceScore ?? null,
    seasonal: intel.scores?.seasonalScore ?? null,
    acuteComponents,
    resourceComponents,
    seasonalComponents,
    prescription: {
      dayType: dayTypeMap[cls] ?? "RESENSITIZE",
      cardioMode: intel.recommendedCardioMode ?? "",
      liftExpression: intel.recommendedLiftMode ?? "",
      macroProteinG: mt.proteinG,
      macroCarbG: [Math.round(mt.carbsG * 0.9), Math.round(mt.carbsG * 1.1)],
      macroFatG: [Math.round(mt.fatG * 0.9), Math.round(mt.fatG * 1.1)],
      macroKcalApprox: mt.kcal,
      mealTiming: {} as MealTiming,
    },
    hardStopFatigue: intel.flags?.hardStopFatigue ?? false,
    hardStopReasons: [],
    zone2Count7d: z2,
    zone3Count7d: z3,
    easyCount7d: ez,
    explanationText: (intel.reasoning ?? []).join(" "),
    dataQuality: "full",
    breakdowns: {
      acute: abd as BreakdownItem[],
      resource: rbd as BreakdownItem[],
      seasonal: sebd as BreakdownItem[],
    },
    reasoning: intel.reasoning,
  };
}

function layerColor(score: number | null): string {
  if (score == null) return "#64748B";
  if (score >= 75) return "#00D4AA";
  if (score >= 55) return "#FBBF24";
  return "#F87171";
}

function ScoreBar({ pts, max, color, label, note }: { pts: number; max: number; color: string; label: string; note?: string }) {
  const pct = Math.min(100, Math.round((pts / max) * 100));
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.5)", letterSpacing: 0.3, flex: 1, marginRight: 8 }}>{label}</Text>
        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color }}>{pts}/{max}</Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.08)" }}>
        <View style={{ height: 4, borderRadius: 2, width: `${pct}%` as any, backgroundColor: color, opacity: 0.85 }} />
      </View>
      {!!note && (
        <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.28)", marginTop: 2, lineHeight: 13 }}>{note}</Text>
      )}
    </View>
  );
}

function OscillatorCard({ data }: { data: OscillatorData | null }) {
  const [expanded, setExpanded] = useState<"acute" | "resource" | "seasonal" | "meal" | null>(null);

  if (!data) {
    return (
      <View style={oscStyles.card}>
        <View style={oscStyles.headerRow}>
          <Text style={oscStyles.cardTitle}>ANDROGEN OSCILLATOR</Text>
        </View>
        <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.4)", textAlign: "center", paddingVertical: 20 }}>
          Loading oscillator data…
        </Text>
      </View>
    );
  }

  const comp = data.composite;
  const tierKey = data.ocs_class ?? "Resensitize";
  const tc = TIER_CONFIG[tierKey] ?? TIER_CONFIG["Resensitize"];
  const rx = data.prescription;
  const ac = data.acuteComponents;
  const rc = data.resourceComponents;
  const sc = data.seasonalComponents;
  const mt = rx.mealTiming;
  const abd = data.breakdowns?.acute ?? [];
  const rbd = data.breakdowns?.resource ?? [];
  const sbd = data.breakdowns?.seasonal ?? [];

  const acuteColor = layerColor(data.acute);
  const resourceColor = layerColor(data.resource);
  const seasonalColor = layerColor(data.seasonal);

  const phaseColors: Record<string, string> = {
    Prime: "#60A5FA", Overload: "#A78BFA", Peak: "#00ffcc", Resensitize: "#F87171",
  };
  const cycleColor = phaseColors[data.cycleWeek] ?? "#64748B";

  const cardioColor = rx.cardioMode === "Zone 3" ? "#00ffcc" : rx.cardioMode === "Zone 2" ? "#FBBF24" : "#94A3B8";

  return (
    <View style={[oscStyles.card, { borderColor: tc.color + "30" }]}>
      {/* Glow background */}
      <View style={[oscStyles.glowBg, { backgroundColor: tc.glow }]} />

      {/* Header row */}
      <View style={oscStyles.headerRow}>
        <Text style={oscStyles.cardTitle}>ANDROGEN OSCILLATOR</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {/* 28-day cycle badge */}
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: cycleColor + "1A", borderWidth: 1, borderColor: cycleColor + "40" }}>
            <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: cycleColor }}>
              D{data.cycleDay28} · {data.cycleWeek.toUpperCase()}
            </Text>
          </View>
          {data.dataQuality === "partial" && (
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(251,191,36,0.12)", borderWidth: 1, borderColor: "rgba(251,191,36,0.25)" }}>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: "#FBBF24" }}>PARTIAL</Text>
            </View>
          )}
          {data.dataQuality === "insufficient" && (
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(248,113,113,0.12)", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)" }}>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: "#F87171" }}>NO DATA</Text>
            </View>
          )}
        </View>
      </View>

      {/* Hard-stop alert */}
      {data.hardStopFatigue && data.hardStopReasons.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 10, padding: 10, borderRadius: 8, backgroundColor: "rgba(248,113,113,0.10)", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)" }}>
          <Ionicons name="warning" size={14} color="#F87171" style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10, fontFamily: "Rubik_700Bold", color: "#F87171", letterSpacing: 0.5, marginBottom: 2 }}>HARD STOP — FATIGUE OVERRIDE</Text>
            {data.hardStopReasons.map((r, i) => (
              <Text key={i} style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(248,113,113,0.8)", lineHeight: 14 }}>• {r}</Text>
            ))}
          </View>
        </View>
      )}

      {/* Big composite score + zone distribution */}
      <View style={oscStyles.compositeRow}>
        <View style={{ alignItems: "center" }}>
          <Text style={[oscStyles.compositeScore, { color: tc.color }]}>
            {comp != null ? comp : "—"}
          </Text>
          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.35)", letterSpacing: 1 }}>/ 100</Text>
        </View>
        <View style={{ flex: 1, paddingLeft: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 }}>
            <View style={[oscStyles.tierBadge, { backgroundColor: tc.color + "1A", borderColor: tc.color + "40" }]}>
              <Text style={[oscStyles.tierLabel, { color: tc.color }]}>{tc.label}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.45)", lineHeight: 14, marginBottom: 8 }}>{tc.sub}</Text>
          {/* Weekly Z2/Z3 status pills */}
          <View style={{ flexDirection: "row", gap: 5 }}>
            {[
              { label: `Z2 ×${data.zone2Count7d}`, color: "#FBBF24", max: 3 },
              { label: `Z3 ×${data.zone3Count7d}`, color: "#00ffcc", max: 3 },
              { label: `REC ×${data.easyCount7d}`, color: "#94A3B8", max: 1 },
            ].map((z) => (
              <View key={z.label} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: z.color + "35", backgroundColor: z.color + "12" }}>
                <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: z.color + "CC" }}>{z.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Explanation text */}
      {data.explanationText ? (
        <View style={{ marginBottom: 8, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.38)", lineHeight: 15, fontStyle: "italic" }}>
            {data.explanationText}
          </Text>
        </View>
      ) : null}

      {/* Reasoning bullets from oscillator engine */}
      {data.reasoning && data.reasoning.length > 0 && (
        <View style={{ marginBottom: 12, paddingHorizontal: 4, gap: 2 }}>
          {data.reasoning.map((line, i) => (
            <Text key={i} style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.28)", lineHeight: 14 }}>
              {line}
            </Text>
          ))}
        </View>
      )}

      {/* 3-layer cells */}
      <View style={oscStyles.layerRow}>
        {([
          { key: "acute",    label: "ACUTE",    score: data.acute,    color: acuteColor,    subtitle: "50%" },
          { key: "resource", label: "RESOURCE", score: data.resource, color: resourceColor, subtitle: "30%" },
          { key: "seasonal", label: "SEASONAL", score: data.seasonal, color: seasonalColor, subtitle: "20%" },
        ] as const).map((layer) => {
          const isExp = expanded === layer.key;
          return (
            <Pressable
              key={layer.key}
              style={[oscStyles.layerCell, isExp && { borderColor: layer.color + "60", backgroundColor: layer.color + "0A" }]}
              onPress={() => setExpanded(isExp ? null : layer.key)}
            >
              <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: "rgba(255,255,255,0.45)", letterSpacing: 0.8, marginBottom: 4 }}>
                {layer.label}
              </Text>
              <Text style={{ fontSize: 20, fontFamily: "Rubik_700Bold", color: layer.color, lineHeight: 24 }}>
                {layer.score != null ? layer.score : "—"}
              </Text>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{layer.subtitle}</Text>
              <View style={{ marginTop: 6, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.08)" }}>
                {layer.score != null && (
                  <View style={{ height: 3, borderRadius: 1.5, width: `${layer.score}%` as any, backgroundColor: layer.color, opacity: 0.7 }} />
                )}
              </View>
              <Ionicons name={isExp ? "chevron-up" : "chevron-down"} size={10} color="rgba(255,255,255,0.25)" style={{ alignSelf: "center", marginTop: 4 }} />
            </Pressable>
          );
        })}
      </View>

      {/* ─── Expanded: Acute ─────────────────────────────────────────────────── */}
      {expanded === "acute" && (
        <View style={oscStyles.expandedPanel}>
          <Text style={oscStyles.expandedTitle}>ACUTE READINESS — v1 SPEC (100 pts total)</Text>
          <ScoreBar pts={ac.hrvPts} max={22} color={acuteColor}
            label={`HRV ratio${ac.hrvRatio != null ? " (" + ac.hrvRatio.toFixed(2) + "× 7d" + (ac.hrvYearRatio != null ? ", " + ac.hrvYearRatio.toFixed(2) + "× yr" : "") + ")" : " — no data"}`}
            note={abd[0]?.note} />
          <ScoreBar pts={ac.rhrPts} max={18} color={acuteColor}
            label={`RHR delta${ac.rhrDelta != null ? " (" + (ac.rhrDelta >= 0 ? "+" : "") + ac.rhrDelta.toFixed(1) + " bpm vs 7d)" : " — no data"}`}
            note={abd[1]?.note} />
          <ScoreBar pts={ac.sleepPts} max={15} color={acuteColor}
            label={`Sleep quantity${ac.sleepMin != null ? " (" + Math.floor(ac.sleepMin / 60) + "h " + Math.round(ac.sleepMin % 60) + "m)" : " — no data"}`}
            note={abd[2]?.note} />
          <ScoreBar pts={ac.regularityPts} max={8} color={acuteColor}
            label={`Sleep regularity${ac.sleepMidpointShiftMin != null ? " (midpoint ±" + Math.round(ac.sleepMidpointShiftMin) + "min)" : " — no midpoint"}`}
            note={abd[3]?.note} />
          <ScoreBar pts={ac.bwStabilityPts} max={5} color={acuteColor}
            label={`BW stability${ac.bwDeltaPct != null ? " (±" + ac.bwDeltaPct.toFixed(1) + "% vs 7d)" : " — no data"}`}
            note={abd[4]?.note} />
          <ScoreBar pts={ac.subjectiveDrivePts} max={10} color={acuteColor}
            label={`Drive / Libido${ac.hasSubjective ? "" : " (default neutral — add libido/motivation to log)"}`}
            note={abd[5]?.note} />
          <ScoreBar pts={ac.jointSorenessPts} max={10} color={acuteColor}
            label="Joint / Soreness (pain_0_10 proxy until soreness_score field added)"
            note={abd[6]?.note} />
          <ScoreBar pts={ac.yesterdayLiftPts} max={7} color={acuteColor}
            label="Yesterday lift strain (training_load proxy)"
            note={abd[7]?.note} />
          <ScoreBar pts={ac.yesterdayCardioPts} max={5} color={acuteColor}
            label="Yesterday cardio strain (zone3_min proxy)"
            note={abd[8]?.note} />
          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.25)", marginTop: 8, lineHeight: 14 }}>
            {"Subjective signals (libido, motivation, joint friction, soreness) flow from your daily log into Intel's scoring. Log them daily for full acute resolution."}
          </Text>
        </View>
      )}

      {/* ─── Expanded: Resource ──────────────────────────────────────────────── */}
      {expanded === "resource" && (
        <View style={oscStyles.expandedPanel}>
          <Text style={oscStyles.expandedTitle}>TISSUE-RESOURCE — v1 SPEC (100 pts total)</Text>
          <ScoreBar pts={rc.caloriePts} max={10} color={resourceColor}
            label={`Calorie adherence 7d${rc.avgCalories7d != null ? " (" + Math.round(rc.avgCalories7d) + " kcal avg)" : " — no data"}`}
            note={rbd[0]?.note} />
          <ScoreBar pts={rc.proteinPts} max={12} color={resourceColor}
            label={`Protein adequacy 7d${rc.avgProtein7d != null ? " (" + Math.round(rc.avgProtein7d) + "g avg)" : " — log protein_g_actual to unlock"}`}
            note={rbd[1]?.note} />
          <ScoreBar pts={rc.fatFloorPts} max={12} color={resourceColor}
            label={`Fat floor + oscillation${rc.avgFat7d != null ? " (" + Math.round(rc.avgFat7d) + "g avg)" : " — log fat_g_actual to unlock"}`}
            note={rbd[2]?.note} />
          <ScoreBar pts={rc.carbTimingPts} max={10} color={resourceColor}
            label="Carb timing (proxied from dietary adherence until per-meal logging)"
            note={rbd[3]?.note} />
          <ScoreBar pts={rc.weightTrendPts} max={10} color={resourceColor}
            label={`14d BW trend${rc.bwTrend14dLbPerWk != null ? " (" + (rc.bwTrend14dLbPerWk >= 0 ? "+" : "") + rc.bwTrend14dLbPerWk.toFixed(2) + " lb/wk)" : " — insufficient BW data"}`}
            note={rbd[4]?.note} />
          <ScoreBar pts={rc.waistTrendPts} max={12} color={resourceColor}
            label={`14d Waist trend${rc.waistTrend14dInOver14d != null ? " (" + (rc.waistTrend14dInOver14d >= 0 ? "+" : "") + rc.waistTrend14dInOver14d.toFixed(3) + " in/14d)" : " — no waist data"}`}
            note={rbd[5]?.note} />
          <ScoreBar pts={rc.ffmTrendPts} max={12} color={resourceColor}
            label={`14d FFM trend${rc.ffmTrend14dLbPerWk != null ? " (" + (rc.ffmTrend14dLbPerWk >= 0 ? "+" : "") + rc.ffmTrend14dLbPerWk.toFixed(2) + " lb/wk)" : " — no FFM data"}`}
            note={rbd[6]?.note} />
          <ScoreBar pts={rc.strengthTrendPts} max={12} color={resourceColor}
            label={`Strength trend (bench+OHP)${rc.strengthTrendPct != null ? " (" + (rc.strengthTrendPct >= 0 ? "+" : "") + (rc.strengthTrendPct * 100).toFixed(1) + "%)" : " — no lift data"}`}
            note={rbd[7]?.note} />
          <ScoreBar pts={rc.cardioMonotonyPts} max={10} color={resourceColor}
            label={`Cardio variety 7d (Z2 ${rc.zone2Days7d} / Z3 ${rc.zone3Days7d} / easy ${rc.easyDays7d})`}
            note={rbd[8]?.note} />
          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.25)", marginTop: 8, lineHeight: 14 }}>
            {"Macro actuals (protein, carbs, fat, kcal) flow from your daily log entry. Log them consistently for full resource resolution. Carb timing improves with per-meal tracking."}
          </Text>
        </View>
      )}

      {/* ─── Expanded: Seasonal ──────────────────────────────────────────────── */}
      {expanded === "seasonal" && (
        <View style={oscStyles.expandedPanel}>
          <Text style={oscStyles.expandedTitle}>ENDOCRINE-SEASONAL — v1 SPEC (100 pts total)</Text>
          <ScoreBar pts={sc.hrv28Pts} max={18} color={seasonalColor}
            label={`28d HRV trend${sc.hrv28PctChange != null ? " (" + (sc.hrv28PctChange >= 0 ? "+" : "") + (sc.hrv28PctChange * 100).toFixed(1) + "% vs prior 28d)" : " — insufficient history"}`}
            note={sbd[0]?.note} />
          <ScoreBar pts={sc.rhr28Pts} max={14} color={seasonalColor}
            label={`28d RHR trend${sc.rhr28DeltaBpm != null ? " (" + (sc.rhr28DeltaBpm >= 0 ? "+" : "") + sc.rhr28DeltaBpm.toFixed(1) + " bpm vs prior 28d)" : " — insufficient history"}`}
            note={sbd[1]?.note} />
          <ScoreBar pts={sc.sleepReg28Pts} max={10} color={seasonalColor}
            label="28d Sleep regularity trend (default neutral — needs 56d history)"
            note={sbd[2]?.note} />
          <ScoreBar pts={sc.waistWeightRelPts} max={12} color={seasonalColor}
            label={`Waist:weight relationship${sc.waistChange28d != null ? " (waist " + (sc.waistChange28d >= 0 ? "+" : "") + sc.waistChange28d.toFixed(2) + "in / BW " + (sc.weightChange28d != null && sc.weightChange28d >= 0 ? "+" : "") + (sc.weightChange28d ?? 0).toFixed(1) + "lb)" : " — no data"}`}
            note={sbd[3]?.note} />
          <ScoreBar pts={sc.ffm28Pts} max={14} color={seasonalColor}
            label={`28d FFM trend${sc.ffm28dChange != null ? " (" + (sc.ffm28dChange >= 0 ? "+" : "") + sc.ffm28dChange.toFixed(1) + " lb vs prior 28d)" : " — insufficient FFM history"}`}
            note={sbd[4]?.note} />
          <ScoreBar pts={sc.deloadPts} max={10} color={seasonalColor}
            label="Deload compliance (detects lift-skipped windows in last 28d)"
            note={sbd[5]?.note} />
          <ScoreBar pts={sc.monotonyPts} max={8} color={seasonalColor}
            label="Training monotony index (28d Z2/Z3 variety)"
            note={sbd[6]?.note} />
          <ScoreBar pts={sc.lightPts} max={6} color={seasonalColor}
            label="Light / outdoor (default 3/6 — sunlight_min field not yet tracked)"
            note={sbd[7]?.note} />
          <ScoreBar pts={sc.motivationPts} max={8} color={seasonalColor}
            label="Motivation / virility trend (default 4/8 — subjective fields not yet in log)"
            note={sbd[8]?.note} />
          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.25)", marginTop: 8, lineHeight: 14 }}>
            {"Future inputs (schema ready, not in log form yet):\n• libido/motivation 28d trends · sunlight_min (outdoor exposure)\n• deload week detection improves as history grows"}
          </Text>
        </View>
      )}

      {/* ─── Meal timing expanded ────────────────────────────────────────────── */}
      {expanded === "meal" && (
        <View style={oscStyles.expandedPanel}>
          <Text style={oscStyles.expandedTitle}>MEAL TIMING — {rx.dayType} DAY TEMPLATE</Text>
          {[
            { time: "Pre-Cardio", p: 0, c: mt.preCardioC, f: 0 },
            { time: "Post-Cardio", p: mt.postCardioP, c: mt.postCardioC, f: mt.postCardioF },
            { time: "Meal 2", p: mt.meal2P, c: mt.meal2C, f: mt.meal2F },
            { time: "Pre-Lift", p: mt.preLiftP, c: mt.preLiftC, f: 0 },
            { time: "Post-Lift", p: mt.postLiftP, c: mt.postLiftC, f: 0 },
            { time: "Final Meal", p: mt.finalP, c: mt.finalC, f: mt.finalF },
          ].map((m, i) => (
            <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" }}>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: "rgba(255,255,255,0.6)", width: 90 }}>{m.time}</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                {m.p !== 0 && <Text style={{ fontSize: 10, fontFamily: "Rubik_700Bold", color: "#60A5FA" }}>{m.p}P</Text>}
                <Text style={{ fontSize: 10, fontFamily: "Rubik_700Bold", color: "#A78BFA" }}>{m.c}C</Text>
                {(m.f !== 0 || typeof m.f === "string") && <Text style={{ fontSize: 10, fontFamily: "Rubik_700Bold", color: "#FBBF24" }}>{m.f}F</Text>}
              </View>
            </View>
          ))}
          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.25)", marginTop: 8, lineHeight: 14 }}>
            Peri-workout window targets protein + carb timing. Final meal fills remaining fat/carbs.
          </Text>
        </View>
      )}

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginVertical: 14 }} />

      {/* TODAY'S PRESCRIPTION */}
      <Text style={oscStyles.prescriptionTitle}>TODAY'S PRESCRIPTION</Text>

      {/* Day type + meal timing toggle */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <View style={[oscStyles.dayTypeBadge, { backgroundColor: tc.color + "20", borderColor: tc.color + "50" }]}>
          <Text style={[oscStyles.dayTypeText, { color: tc.color }]}>{rx.dayType}</Text>
        </View>
        <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.45)" }}>day protocol</Text>
        <Pressable
          style={{ marginLeft: "auto", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.05)" }}
          onPress={() => setExpanded(expanded === "meal" ? null : "meal")}
        >
          <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: "rgba(255,255,255,0.45)", letterSpacing: 0.5 }}>MEAL TIMING</Text>
        </Pressable>
      </View>

      {/* Prescription grid */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <View style={oscStyles.rxCell}>
          <Text style={oscStyles.rxCellLabel}>CARDIO</Text>
          <Text style={[oscStyles.rxCellValue, { color: cardioColor }]}>{rx.cardioMode}</Text>
        </View>
        <View style={oscStyles.rxCell}>
          <Text style={oscStyles.rxCellLabel}>LIFTING</Text>
          <Text style={[oscStyles.rxCellValue, { color: tc.color, fontSize: 11 }]}>{rx.liftExpression}</Text>
        </View>
      </View>

      {/* Macro targets */}
      <View style={{ borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(0,0,0,0.15)", padding: 12 }}>
        <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: "rgba(255,255,255,0.35)", letterSpacing: 1, marginBottom: 8 }}>MACRO TARGETS</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {[
            { label: "PRO",   value: `${rx.macroProteinG}g`,                   color: "#60A5FA" },
            { label: "CARBS", value: `${rx.macroCarbG[0]}–${rx.macroCarbG[1]}g`, color: "#A78BFA" },
            { label: "FAT",   value: `${rx.macroFatG[0]}–${rx.macroFatG[1]}g`,   color: "#FBBF24" },
            { label: "~KCAL", value: `${rx.macroKcalApprox}`,                   color: "#34D399" },
          ].map((m) => (
            <View key={m.label} style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: "rgba(255,255,255,0.35)", letterSpacing: 0.5, marginBottom: 3 }}>{m.label}</Text>
              <Text style={{ fontSize: 12, fontFamily: "Rubik_700Bold", color: m.color }}>{m.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Footer note */}
      <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: "rgba(255,255,255,0.18)", marginTop: 10, textAlign: "center" }}>
        OCS = 50% Acute · 30% Resource · 20% Seasonal · Tap layer to expand
      </Text>
    </View>
  );
}

const oscStyles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(15,15,20,0.97)",
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.25)",
    overflow: "hidden",
    position: "relative",
  },
  glowBg: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 140,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 11,
    fontFamily: "Rubik_700Bold",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 2,
  },
  compositeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  compositeScore: {
    fontSize: 56,
    fontFamily: "Rubik_700Bold",
    lineHeight: 60,
    letterSpacing: -2,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  tierLabel: {
    fontSize: 12,
    fontFamily: "Rubik_700Bold",
    letterSpacing: 1.5,
  },
  layerRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  layerCell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 10,
    alignItems: "center",
  },
  expandedPanel: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  expandedTitle: {
    fontSize: 9,
    fontFamily: "Rubik_700Bold",
    color: "rgba(255,255,255,0.3)",
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  prescriptionTitle: {
    fontSize: 9,
    fontFamily: "Rubik_700Bold",
    color: "rgba(255,255,255,0.3)",
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  dayTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  dayTypeText: {
    fontSize: 13,
    fontFamily: "Rubik_700Bold",
    letterSpacing: 2,
  },
  rxCell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 10,
    alignItems: "center",
    gap: 4,
  },
  rxCellLabel: {
    fontSize: 9,
    fontFamily: "Rubik_600SemiBold",
    color: "rgba(255,255,255,0.3)",
    letterSpacing: 1,
  },
  rxCellValue: {
    fontSize: 13,
    fontFamily: "Rubik_700Bold",
    textAlign: "center",
  },
});

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ProxyChart({ data }: { data: ProxyRow[] }) {
  if (data.length < 2) return null;
  const scores = data.map(d => d.proxy7dAvg ?? d.proxyScore ?? 0);
  const min = Math.min(...scores) - 0.3;
  const max = Math.max(...scores) + 0.3;
  const range = max - min || 1;
  const height = 120;
  const width = 300;
  const step = width / (scores.length - 1);

  const points = scores.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * height,
  }));

  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartYAxis}>
        <Text style={styles.chartAxisLabel}>{fmtVal(max, 1)}</Text>
        <Text style={styles.chartAxisLabel}>{fmtVal((max + min) / 2, 1)}</Text>
        <Text style={styles.chartAxisLabel}>{fmtVal(min, 1)}</Text>
      </View>
      <View style={{ width, height, position: "relative" }}>
        {[0, 0.5, 1].map(pct => (
          <View
            key={pct}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: pct * height,
              height: 1,
              backgroundColor: Colors.border,
            }}
          />
        ))}
        {points.map((p, i) => {
          if (i === 0) return null;
          const prev = points[i - 1];
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: prev.x,
                top: prev.y,
                width: len,
                height: 2.5,
                backgroundColor: ACCENT,
                borderRadius: 1,
                transform: [{ rotate: `${angle}deg` }],
                transformOrigin: "left center",
              }}
            />
          );
        })}
        {points.map((p, i) => (
          <View
            key={`dot-${i}`}
            style={{
              position: "absolute",
              left: p.x - 3,
              top: p.y - 3,
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === points.length - 1 ? ACCENT : Colors.cardBgElevated,
              borderWidth: 1.5,
              borderColor: ACCENT,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export default function VitalsScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [proxyData, setProxyData] = useState<ProxyRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [confidence, setConfidence] = useState<ConfidenceWindow[]>([]);
  const [includeImputed, setIncludeImputed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessionDate, setSessionDate] = useState(todayStr());
  const [refreshing, setRefreshing] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupImporting, setBackupImporting] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [dataSources, setDataSources] = useState<Array<{
    id: string; name: string; status: string;
    workouts?: number; vitals?: number; sleep?: number; lastSync?: string | null;
  }>>([]);

  interface LensArchive { id: number; tag: string; startDay: string; endDay: string; label: string | null; summaryJson: any; }
  interface ActiveLensEpisode { id: number; tag: string; startDay: string; intensity: number; label: string | null; }
  const [lensArchives, setLensArchives] = useState<LensArchive[]>([]);
  const [activeLenses, setActiveLenses] = useState<ActiveLensEpisode[]>([]);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [dataSourcesExpanded, setDataSourcesExpanded] = useState(false);
  const [expandedArchiveId, setExpandedArchiveId] = useState<number | null>(null);
  const [archiveTab, setArchiveTab] = useState<"terminal" | "episode">("terminal");
  const [hpaData, setHpaData] = useState<{ hpaScore: number | null; suppressionFlag: boolean; drivers: any; hpaBucket: string | null; stateLabel: string | null; stateTooltipText: string | null } | null>(null);
  const [oscillatorData, setOscillatorData] = useState<OscillatorData | null>(null);
  const CONTEXT_TAG_COLORS: Record<string, string> = {
    travel: "#60A5FA", schedule_shift: "#FBBF24", work_stress: "#F87171",
    social_load: "#A78BFA", illness_symptoms: "#34D399", injury_pain: "#FB923C",
    supplement_change: "#22D3EE", med_change: "#F472B6", early_dating: "#E879F9",
  };

  const loadData = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();

      const [sessRes, proxyRes, snapRes, confRes, srcRes] = await Promise.all([
        authFetch(new URL("/api/erection/sessions", baseUrl).toString()),
        authFetch(new URL(`/api/erection/proxy?include_imputed=${includeImputed}`, baseUrl).toString()),
        authFetch(new URL("/api/erection/snapshots", baseUrl).toString()),
        authFetch(new URL("/api/erection/confidence", baseUrl).toString()),
        authFetch(new URL("/api/data-sources", baseUrl).toString()),
      ]);

      if (sessRes.ok) {
        const rows = await sessRes.json();
        setSessions(rows.map((r: any) => ({
          date: r.date,
          nocturnalErections: r.nocturnalErections != null ? Number(r.nocturnalErections) : null,
          nocturnalDurationSeconds: r.nocturnalDurationSeconds != null ? Number(r.nocturnalDurationSeconds) : null,
          isImputed: !!r.isImputed,
          imputedMethod: r.imputedMethod ?? null,
          multiNightCombined: !!r.multiNightCombined,
        })));
      }

      if (proxyRes.ok) {
        const rows = await proxyRes.json();
        setProxyData(rows.map((r: any) => ({
          date: r.date,
          proxyScore: r.proxyScore != null ? Number(r.proxyScore) : null,
          proxy7dAvg: r.proxy7DAvg != null ? Number(r.proxy7DAvg) : null,
        })));
      }

      if (snapRes.ok) {
        const rows = await snapRes.json();
        setSnapshots(rows.map((r: any) => ({
          id: r.id,
          sessionDate: r.session_date,
          totalNights: Number(r.total_nights),
          totalNocturnalErections: Number(r.total_nocturnal_erections),
          totalNocturnalDurationSeconds: Number(r.total_nocturnal_duration_seconds),
        })));
      }

      if (confRes.ok) {
        const rows = await confRes.json();
        setConfidence(rows);
      }

      if (srcRes.ok) {
        const json = await srcRes.json();
        if (json.sources) setDataSources(json.sources);
      }

      const todayDate = new Date().toISOString().slice(0, 10);
      const [activeRes, archiveRes, hpaRes, oscillatorRes, intelRecCached] = await Promise.all([
        authFetch(new URL("/api/context-lens/episodes/active", baseUrl).toString()),
        authFetch(new URL("/api/context-lens/archives", baseUrl).toString()),
        authFetch(new URL("/api/hpa", baseUrl).toString()),
        authFetch(new URL("/api/oscillator", baseUrl).toString()),
        loadIntelRecommendation("local_default", todayDate),
      ]);
      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveLenses(data.episodes || []);
      }
      if (archiveRes.ok) {
        const data = await archiveRes.json();
        setLensArchives(data.archives || []);
      }
      if (hpaRes.ok) {
        const data = await hpaRes.json();
        setHpaData(data);
      }
      let resolvedIntelRec: IntelRecommendation | null = intelRecCached;
      const needsFreshVitals = (!resolvedIntelRec || !resolvedIntelRec.cycles) && !_intelCyclesRefreshedVitals.has(todayDate);
      if (needsFreshVitals) {
        _intelCyclesRefreshedVitals.add(todayDate);
        try {
          const latestRes = await authFetch(new URL("/api/intel/recommendation/latest", baseUrl).toString());
          if (latestRes.ok) {
            const latestData = await latestRes.json();
            const rec = latestData.recommendation ?? latestData;
            if (rec && rec.scores) {
              resolvedIntelRec = { date: todayDate, ...rec, scoreBreakdowns: latestData.scoreBreakdowns, cycles: latestData.cycles, rawInputs: latestData.rawInputs };
              await saveIntelRecommendation("local_default", todayDate, resolvedIntelRec!);
            }
          }
        } catch {}
      }
      if (resolvedIntelRec) {
        setOscillatorData(mapIntelToOscillator(resolvedIntelRec));
      } else if (oscillatorRes.ok) {
        const data = await oscillatorRes.json();
        setOscillatorData(data);
      }
    } catch (err) {
      console.error("vitals load error:", err);
    }
  }, [includeImputed]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleBackupExport = async () => {
    try {
      setBackupExporting(true);
      setBackupStatus(null);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const baseUrl = getApiUrl();
      const url = new URL("/api/backup/export", baseUrl).toString();
      const resp = await authFetch(url);
      if (!resp.ok) {
        setBackupStatus("Export failed");
        return;
      }

      const json = await resp.json();
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `bulk-coach-backup-${dateStr}.json`;

      if (Platform.OS === "web") {
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        setBackupStatus("Backup downloaded");
      } else {
        const path = LegacyFS.documentDirectory + filename;
        await LegacyFS.writeAsStringAsync(path, JSON.stringify(json, null, 2));
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: "Save Backup" });
          setBackupStatus("Backup exported");
        } else {
          setBackupStatus(`Saved to ${path}`);
        }
      }
    } catch (err) {
      console.error("backup export error:", err);
      setBackupStatus("Export failed");
    } finally {
      setBackupExporting(false);
    }
  };

  const handleBackupImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      setBackupImporting(true);
      setBackupStatus(null);

      const baseUrl = getApiUrl();

      const dryRunForm = new FormData();
      if (Platform.OS === "web") {
        const resp = await globalThis.fetch(asset.uri);
        const blob = await resp.blob();
        dryRunForm.append("file", blob, asset.name || "backup.json");
      } else {
        const file = new File(asset.uri);
        dryRunForm.append("file", file as any);
      }
      dryRunForm.append("mode", "merge");
      dryRunForm.append("dry_run", "true");

      const dryRes = await authFetch(
        new URL("/api/backup/import", baseUrl).toString(),
        { method: "POST", body: dryRunForm },
      );
      const dryJson = await dryRes.json();

      if (!dryRes.ok) {
        setBackupStatus(dryJson.error || "Invalid backup file");
        setBackupImporting(false);
        return;
      }

      const wi = dryJson.would_insert || {};
      const wu = dryJson.would_update || {};
      const summary = Object.entries(wi)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => `${k}: +${v}`)
        .concat(
          Object.entries(wu)
            .filter(([, v]) => (v as number) > 0)
            .map(([k, v]) => `${k}: ~${v}`)
        )
        .join("\n");

      const msg = summary || "No new data to import";

      Alert.alert(
        "Import Preview",
        `Dry run result:\n${msg}\n\nProceed with import?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => setBackupImporting(false) },
          {
            text: "Import",
            style: "default",
            onPress: async () => {
              try {
                const importForm = new FormData();
                if (Platform.OS === "web") {
                  const resp2 = await globalThis.fetch(asset.uri);
                  const blob2 = await resp2.blob();
                  importForm.append("file", blob2, asset.name || "backup.json");
                } else {
                  const file2 = new File(asset.uri);
                  importForm.append("file", file2 as any);
                }
                importForm.append("mode", "merge");
                importForm.append("dry_run", "false");

                const importRes = await authFetch(
                  new URL("/api/backup/import", baseUrl).toString(),
                  { method: "POST", body: importForm },
                );
                const importJson = await importRes.json();

                if (importRes.ok && importJson.status === "ok") {
                  const counts = importJson.imported || {};
                  const total = Object.values(counts).reduce((s: number, v: unknown) => s + (v as number), 0);
                  setBackupStatus(`Restored ${total} rows${importJson.recomputed ? " (recomputed)" : ""}`);
                  loadData();
                } else {
                  setBackupStatus(importJson.error || "Import failed");
                }
              } catch (err2) {
                console.error("backup import error:", err2);
                setBackupStatus("Import failed");
              } finally {
                setBackupImporting(false);
              }
            },
          },
        ],
      );
    } catch (err) {
      console.error("backup import error:", err);
      setBackupStatus("Import failed");
      setBackupImporting(false);
    }
  };

  const handleResetDatabase = async () => {
    Alert.alert(
      "Reset All Data",
      "This will permanently delete ALL daily logs, Fitbit uploads, vitals, sleep data, workout sessions, readiness scores, and cached data.\n\nSettings and meal plan presets will be kept.\n\nThis cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset Everything",
          style: "destructive",
          onPress: async () => {
            try {
              setResetting(true);
              setResetStatus(null);
              const baseUrl = getApiUrl();
              const res = await authFetch(new URL("/api/reset-database", baseUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm: "RESET_ALL_DATA" }),
              });
              const json = await res.json();
              if (res.ok && json.status === "ok") {
                if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setResetStatus(`Cleared ${json.totalDeleted} rows`);
                loadData();
              } else {
                setResetStatus(json.error || "Reset failed");
              }
            } catch (err) {
              console.error("reset error:", err);
              setResetStatus("Reset failed");
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
  };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      setUploading(true);
      setUploadResult(null);

      const baseUrl = getApiUrl();
      const url = new URL("/api/erection/upload", baseUrl).toString();

      const formData = new FormData();

      if (Platform.OS === "web") {
        const resp = await globalThis.fetch(asset.uri);
        const blob = await resp.blob();
        formData.append("file", blob, asset.name || "snapshot.csv");
      } else {
        const file = new File(asset.uri);
        formData.append("file", file as any);
      }
      formData.append("session_date", sessionDate);

      const uploadRes = await authFetch(url, {
        method: "POST",
        body: formData,
      });

      const json = await uploadRes.json();

      if (!uploadRes.ok) {
        setUploadResult(json.error || "Upload failed");
        return;
      }

      if (json.note === "duplicate_snapshot") {
        setUploadResult("Already imported (duplicate file)");
      } else if (json.note === "baseline_stored") {
        setUploadResult("Baseline snapshot stored (first upload, no session yet)");
      } else if (json.derived) {
        const d = json.derived;
        setUploadResult(
          `Imported: ${d.deltaNoctErections} erections, ${formatDur(d.deltaNoctDur)}${d.multiNightCombined ? " (multi-night combined)" : ""}${json.gapsFilled > 0 ? ` | ${json.gapsFilled} gap days filled` : ""}`
        );
      } else {
        setUploadResult(json.note || "Done");
      }

      await loadData();
    } catch (err) {
      console.error("upload error:", err);
      setUploadResult(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const latestProxy = proxyData.length > 0 ? proxyData[proxyData.length - 1] : null;
  const measuredCount = sessions.filter(s => !s.isImputed).length;
  const imputedCount = sessions.filter(s => s.isImputed).length;
  const recentSessions = [...sessions].reverse().slice(0, 14);

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="pulse" size={22} color={ACCENT} />
        <Text style={styles.headerTitle}>Vitals</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 100 + bottomInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={ACCENT} />
        }
      >
        <OscillatorCard data={oscillatorData} />

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="cloud-upload-outline" size={18} color={ACCENT} />
            <Text style={styles.cardTitle}>Upload Snapshot</Text>
          </View>

          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Session Date</Text>
            <TextInput
              style={styles.dateInput}
              value={sessionDate}
              onChangeText={setSessionDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textTertiary}
              keyboardAppearance="dark"
            />
          </View>

          <Pressable
            style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
            onPress={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={Colors.text} />
            ) : (
              <>
                <Feather name="upload" size={18} color={Colors.text} />
                <Text style={styles.uploadBtnText}>Select CSV File</Text>
              </>
            )}
          </Pressable>

          {uploadResult && (
            <View style={[styles.resultBanner, uploadResult.includes("fail") || uploadResult.includes("error") ? styles.resultError : styles.resultSuccess]}>
              <Text style={styles.resultText}>{uploadResult}</Text>
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: ACCENT }]}>
            <Text style={styles.statValue}>
              {fmtVal(latestProxy?.proxy7dAvg ?? latestProxy?.proxyScore, 1)}
            </Text>
            <Text style={styles.statLabel}>7d Proxy Avg</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: MEASURED_COLOR }]}>
            <Text style={styles.statValue}>{measuredCount}</Text>
            <Text style={styles.statLabel}>Measured</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: IMPUTED_COLOR }]}>
            <Text style={styles.statValue}>{imputedCount}</Text>
            <Text style={styles.statLabel}>Imputed</Text>
          </View>
        </View>

        {confidence.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="shield-checkmark-outline" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Data Confidence</Text>
            </View>
            <View style={styles.confGrid}>
              {confidence.map((c) => {
                const gradeColor = c.grade === "High" ? MEASURED_COLOR : c.grade === "Med" ? IMPUTED_COLOR : c.grade === "Low" ? "#EF4444" : Colors.textTertiary;
                return (
                  <View key={c.window} style={styles.confCell}>
                    <Text style={styles.confWindow}>{c.window}</Text>
                    <View style={[styles.confGradeBadge, { backgroundColor: gradeColor + "20", borderColor: gradeColor + "40" }]}>
                      <Text style={[styles.confGradeText, { color: gradeColor }]}>{c.grade}</Text>
                    </View>
                    <View style={styles.confCounts}>
                      <Text style={[styles.confCountText, { color: MEASURED_COLOR }]}>{c.measured}M</Text>
                      <Text style={[styles.confCountText, { color: IMPUTED_COLOR }]}>{c.imputed}I</Text>
                      {c.multiNight > 0 && <Text style={[styles.confCountText, { color: Colors.textTertiary }]}>{c.multiNight}C</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {proxyData.length >= 2 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="chart-line" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Androgen Proxy (7d Avg)</Text>
            </View>
            <ProxyChart data={proxyData} />
            <Pressable
              style={styles.toggleRow}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIncludeImputed(!includeImputed);
              }}
            >
              <Ionicons
                name={includeImputed ? "checkbox" : "square-outline"}
                size={20}
                color={includeImputed ? IMPUTED_COLOR : Colors.textTertiary}
              />
              <Text style={[styles.toggleLabel, includeImputed && { color: IMPUTED_COLOR }]}>
                Include imputed data
              </Text>
            </Pressable>
          </View>
        )}

        {snapshots.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="layers-outline" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Snapshots ({snapshots.length})</Text>
            </View>
            {snapshots.map((snap, idx) => (
              <View key={snap.id} style={[styles.snapRow, idx > 0 && styles.snapRowBorder]}>
                <View style={styles.snapLeft}>
                  <Text style={styles.snapRecCount}>#{snap.totalNights}</Text>
                  <Text style={styles.snapDate}>{snap.sessionDate}</Text>
                </View>
                <View style={styles.snapRight}>
                  <Text style={styles.snapVal}>{isNaN(snap.totalNocturnalErections) ? "--" : snap.totalNocturnalErections} erections</Text>
                  <Text style={styles.snapVal}>{isNaN(snap.totalNocturnalDurationSeconds) ? "--" : formatDur(snap.totalNocturnalDurationSeconds)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Pressable
            style={[styles.cardHeader, !sessionsExpanded && { marginBottom: 0 }, { minHeight: 44 }]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSessionsExpanded(v => !v);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: sessionsExpanded }}
            accessibilityLabel={`Recent Sessions, ${recentSessions.length} items`}
          >
            <Ionicons name="list-outline" size={18} color={ACCENT} />
            <Text style={styles.cardTitle}>Recent Sessions</Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginLeft: "auto", gap: 6 }}>
              {recentSessions.length > 0 && (
                <View style={styles.drawerCountBadge}>
                  <Text style={styles.drawerCountText}>{recentSessions.length}</Text>
                </View>
              )}
              <Ionicons
                name={sessionsExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={Colors.textTertiary}
              />
            </View>
          </Pressable>
          {sessionsExpanded && (
            recentSessions.length === 0 ? (
              <Text style={styles.emptyText}>No session data yet. Upload a snapshot to get started.</Text>
            ) : (
              recentSessions.map((s, idx) => (
                <View key={s.date} style={[styles.sessionRow, idx > 0 && styles.sessionRowBorder]}>
                  <View style={styles.sessionLeft}>
                    <View style={styles.sessionDateRow}>
                      <Text style={styles.sessionDate}>{s.date}</Text>
                      <View style={[styles.badge, s.isImputed ? styles.badgeImputed : styles.badgeMeasured]}>
                        <Text style={[styles.badgeText, s.isImputed ? styles.badgeTextImputed : styles.badgeTextMeasured]}>
                          {s.isImputed ? "Imputed" : "Measured"}
                        </Text>
                      </View>
                      {s.multiNightCombined && (
                        <View style={[styles.badge, styles.badgeWarning]}>
                          <Text style={[styles.badgeText, styles.badgeTextWarning]}>Combined</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.sessionRight}>
                    <Text style={styles.sessionVal}>
                      {s.nocturnalErections ?? 0} erections
                    </Text>
                    <Text style={styles.sessionDur}>
                      {formatDur(s.nocturnalDurationSeconds ?? 0)}
                    </Text>
                  </View>
                </View>
              ))
            )
          )}
        </View>

        {dataSources.length > 0 && (
          <View style={styles.card}>
            <Pressable
              style={[styles.cardHeader, !dataSourcesExpanded && { marginBottom: 0 }, { minHeight: 44 }]}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setDataSourcesExpanded(v => !v);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: dataSourcesExpanded }}
              accessibilityLabel={`Data Sources, ${dataSources.length} items`}
            >
              <Ionicons name="link-outline" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Data Sources</Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginLeft: "auto", gap: 6 }}>
                <View style={styles.drawerCountBadge}>
                  <Text style={styles.drawerCountText}>{dataSources.length}</Text>
                </View>
                <Ionicons
                  name={dataSourcesExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={Colors.textTertiary}
                />
              </View>
            </Pressable>
            {dataSourcesExpanded && dataSources.map((src, idx) => {
              const isConnected = src.status === "connected";
              const needsBuild = src.status === "requires_build";
              const statusColor = isConnected ? MEASURED_COLOR : needsBuild ? Colors.textTertiary : Colors.warning;
              const statusLabel = isConnected ? "Active" : needsBuild ? "Dev Build" : "Setup";
              const totalRecords = (src.workouts ?? 0) + (src.vitals ?? 0) + (src.sleep ?? 0);
              const iconName = src.id === "fitbit" ? "watch-outline" as const
                : src.id === "healthkit" ? "heart-outline" as const
                : src.id === "polar" ? "bluetooth-outline" as const
                : "create-outline" as const;
              const isNavigable = src.id === "healthkit" || src.id === "polar";
              const handleSourcePress = () => {
                if (src.id === "healthkit") router.push("/healthkit");
                else if (src.id === "polar") router.push("/polar");
              };
              return (
                <Pressable
                  key={src.id}
                  style={[srcStyles.sourceRow, idx > 0 && srcStyles.sourceRowBorder]}
                  onPress={isNavigable ? handleSourcePress : undefined}
                  disabled={!isNavigable}
                >
                  <View style={[srcStyles.sourceIcon, { backgroundColor: statusColor + "18" }]}>
                    <Ionicons name={iconName} size={20} color={statusColor} />
                  </View>
                  <View style={srcStyles.sourceInfo}>
                    <Text style={srcStyles.sourceName}>{src.name}</Text>
                    {isConnected && totalRecords > 0 ? (
                      <Text style={srcStyles.sourceDetail}>
                        {[
                          src.workouts ? `${src.workouts} workouts` : null,
                          src.vitals ? `${src.vitals} vitals` : null,
                          src.sleep ? `${src.sleep} sleep` : null,
                        ].filter(Boolean).join(" / ")}
                      </Text>
                    ) : needsBuild ? (
                      <Text style={srcStyles.sourceDetail}>Tap to configure</Text>
                    ) : (
                      <Text style={srcStyles.sourceDetail}>No data yet</Text>
                    )}
                  </View>
                  {isNavigable ? (
                    <Ionicons name="chevron-forward" size={18} color={statusColor} />
                  ) : (
                    <View style={[srcStyles.statusBadge, { backgroundColor: statusColor + "20", borderColor: statusColor + "40" }]}>
                      <Text style={[srcStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable
          style={[styles.card, { borderColor: Colors.primary + "40" }]}
          onPress={() => router.push("/workout")}
        >
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="sword-cross" size={18} color={Colors.primary} />
            <Text style={styles.cardTitle}>Workout Game Guide</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} style={{ marginLeft: "auto" }} />
          </View>
          <Text style={{ fontSize: 13, fontFamily: "Rubik_400Regular", color: Colors.textSecondary }}>
            CBP-driven training with phase transitions and muscle targeting
          </Text>
        </Pressable>

        <View style={[styles.card, { borderColor: "#374151" }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="cloud-download-outline" size={18} color="#60A5FA" />
            <Text style={styles.cardTitle}>Backup & Restore</Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
            <Pressable
              style={[styles.backupBtn, { backgroundColor: "rgba(96, 165, 250, 0.15)", flex: 1 }, backupExporting && styles.uploadBtnDisabled]}
              onPress={handleBackupExport}
              disabled={backupExporting || backupImporting}
            >
              {backupExporting ? (
                <ActivityIndicator size="small" color="#60A5FA" />
              ) : (
                <Feather name="download" size={16} color="#60A5FA" />
              )}
              <Text style={[styles.backupBtnText, { color: "#60A5FA" }]}>Export</Text>
            </Pressable>

            <Pressable
              style={[styles.backupBtn, { backgroundColor: "rgba(251, 191, 36, 0.15)", flex: 1 }, backupImporting && styles.uploadBtnDisabled]}
              onPress={handleBackupImport}
              disabled={backupExporting || backupImporting}
            >
              {backupImporting ? (
                <ActivityIndicator size="small" color={IMPUTED_COLOR} />
              ) : (
                <Feather name="upload" size={16} color={IMPUTED_COLOR} />
              )}
              <Text style={[styles.backupBtnText, { color: IMPUTED_COLOR }]}>Restore</Text>
            </Pressable>
          </View>

          {backupStatus && (
            <Text style={{ fontSize: 13, color: MEASURED_COLOR, textAlign: "center", marginBottom: 4 }}>{backupStatus}</Text>
          )}

          <Text style={styles.backupHint}>
            Export saves all logs, snapshots, sessions, and caches. Restore merges data without duplicating.
          </Text>
        </View>

        <View style={[styles.card, { borderColor: "#7F1D1D" }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
            <Text style={[styles.cardTitle, { color: "#EF4444" }]}>Reset Database</Text>
          </View>

          <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 }}>
            Wipe all daily logs, Fitbit uploads, vitals, sleep data, workout sessions, readiness scores, and caches. Settings and meal presets are preserved.
          </Text>

          <Pressable
            style={[styles.backupBtn, { backgroundColor: "rgba(239, 68, 68, 0.12)", flex: 0 }, resetting && styles.uploadBtnDisabled]}
            onPress={handleResetDatabase}
            disabled={resetting}
          >
            {resetting ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Ionicons name="nuclear-outline" size={16} color="#EF4444" />
            )}
            <Text style={[styles.backupBtnText, { color: "#EF4444" }]}>
              {resetting ? "Resetting..." : "Reset All Data"}
            </Text>
          </Pressable>

          {resetStatus && (
            <Text style={{ fontSize: 13, color: "#EF4444", textAlign: "center", marginTop: 8 }}>{resetStatus}</Text>
          )}
        </View>

        {hpaData && hpaData.hpaScore != null && (
          <View style={styles.section}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Ionicons name="pulse-outline" size={18} color="#F59E0B" />
              <Text style={styles.sectionTitle}>HPA Stress</Text>
              {hpaData.suppressionFlag && (
                <View style={{ backgroundColor: "#F8717125", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="warning" size={11} color="#F87171" />
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_700Bold", color: "#F87171" }}>SUPPRESSION</Text>
                </View>
              )}
            </View>

            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 32, fontFamily: "Rubik_700Bold", color: hpaData.hpaScore >= 80 ? "#DC2626" : hpaData.hpaScore >= 60 ? "#F87171" : hpaData.hpaScore >= 40 ? "#F59E0B" : hpaData.hpaScore >= 20 ? "#34D399" : Colors.textSecondary }}>
                {hpaData.hpaScore}
              </Text>
              <View style={{ paddingBottom: 6 }}>
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>
                  {hpaData.hpaBucket ?? "—"}
                </Text>
                <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                  0–100 scale · today
                </Text>
              </View>
            </View>

            {hpaData.stateLabel && (
              <View style={{ backgroundColor: "#8B5CF610", borderRadius: 8, padding: 10, marginBottom: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <Ionicons name="analytics-outline" size={14} color="#8B5CF6" style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: "#8B5CF6" }}>
                    {hpaData.stateLabel}
                  </Text>
                  {hpaData.stateTooltipText && (
                    <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 2 }}>
                      {hpaData.stateTooltipText}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {hpaData.drivers && (
              <View style={{ gap: 6 }}>
                {[
                  { key: "sleep", label: "Sleep", icon: "moon-outline" as const, color: "#60A5FA" },
                  { key: "hrv", label: "HRV", icon: "heart-outline" as const, color: "#A78BFA" },
                  { key: "rhr", label: "RHR", icon: "fitness-outline" as const, color: "#F87171" },
                  { key: "pain", label: "Pain", icon: "bandage-outline" as const, color: "#F59E0B" },
                ].map((item) => {
                  const d = hpaData.drivers[item.key];
                  if (!d) return null;
                  return (
                    <View key={item.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Ionicons name={item.icon} size={14} color={d.fired ? item.color : Colors.textTertiary} />
                      <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: d.fired ? Colors.text : Colors.textTertiary, flex: 1 }}>
                        {item.label}
                      </Text>
                      <View style={{ backgroundColor: d.fired ? item.color + "20" : Colors.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_600SemiBold", color: d.fired ? item.color : Colors.textTertiary }}>
                          {d.fired ? `+${d.points}` : "—"}
                        </Text>
                      </View>
                      {d.pct != null && (
                        <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, width: 50, textAlign: "right" }}>
                          {fmtFracToPctInt(d.pct)} vs 28d
                        </Text>
                      )}
                      {d.diff != null && (
                        <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, width: 50, textAlign: "right" }}>
                          {fmtDelta(d.diff, 1, " bpm")}
                        </Text>
                      )}
                      {item.key === "pain" && d.current != null && (
                        <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, width: 50, textAlign: "right" }}>
                          {d.current}/10
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {hpaData.suppressionFlag && hpaData.drivers?.suppression && (
              <View style={{ marginTop: 10, padding: 10, backgroundColor: "#F8717110", borderRadius: 8, borderWidth: 1, borderColor: "#F8717130" }}>
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#F87171", marginBottom: 2 }}>
                  Cortisol likely suppressing
                </Text>
                <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                  HPA score {hpaData.hpaScore}+ with androgen proxy dropped {hpaData.drivers.suppression.proxyDelta != null ? fmtFracToPctInt(hpaData.drivers.suppression.proxyDelta) : "≥10%"} below baseline
                </Text>
              </View>
            )}
          </View>
        )}

        {(activeLenses.length > 0 || lensArchives.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Context Lenses</Text>

            {activeLenses.length > 0 && (
              <>
                <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 8 }}>Active</Text>
                {activeLenses.map((ep) => {
                  const tagColor = CONTEXT_TAG_COLORS[ep.tag] || "#8B5CF6";
                  const dayCount = Math.max(1, Math.round((Date.now() - new Date(ep.startDay + "T00:00:00Z").getTime()) / 86400000) + 1);
                  return (
                    <View key={ep.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tagColor, marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: tagColor }}>
                          {ep.tag.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                          Since {ep.startDay} {ep.label ? `\u00B7 ${ep.label}` : ""}
                        </Text>
                      </View>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: tagColor + "20" }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_600SemiBold", color: tagColor }}>Day {dayCount}</Text>
                      </View>
                    </View>
                  );
                })}
                <View style={{ height: 16 }} />
              </>
            )}

            {lensArchives.length > 0 && (
              <>
                <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 8 }}>Archived</Text>
                {lensArchives.map((ar) => {
                  const tagColor = CONTEXT_TAG_COLORS[ar.tag] || "#8B5CF6";
                  const sm = ar.summaryJson || {};
                  const duration = sm.durationDays || "?";
                  const tr = sm.terminalRolling;
                  const ew = sm.episodeWide;
                  const distScore = tr?.disturbanceScore ?? sm.disturbanceScore;
                  const phaseRaw = tr?.phase ?? sm.phase ?? "";
                  const phaseLabel = phaseRaw.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
                  const isExpanded = expandedArchiveId === ar.id;

                  const phaseColors: Record<string, { color: string; bg: string; icon: string }> = {
                    NOVELTY_DISTURBANCE: { color: "#F59E0B", bg: "#F59E0B20", icon: "flash" },
                    ADAPTIVE_STABILIZATION: { color: "#34D399", bg: "#34D39920", icon: "trending-down" },
                    CHRONIC_SUPPRESSION: { color: "#F87171", bg: "#F8717120", icon: "warning" },
                    INSUFFICIENT_DATA: { color: "#94A3B8", bg: "#94A3B820", icon: "time" },
                  };
                  const pc = phaseColors[phaseRaw] || phaseColors.INSUFFICIENT_DATA;

                  const scoreColor = (sc: number) => sc >= 70 ? "#F87171" : sc >= 62 ? "#F59E0B" : sc >= 56 ? "#FCD34D" : "#34D399";
                  const scaleLabel = (sc: number) => sc >= 60 ? "High disturbance" : sc >= 40 ? "Moderate" : sc >= 20 ? "Mild" : "Minimal";
                  const interpColor = (i: string) => i === "improving" ? "#34D399" : i === "worsening" ? "#F87171" : i === "flat" ? "#FBBF24" : Colors.textTertiary;
                  const fmtDeltaLocal = (v: number | null | undefined) => v == null ? "\u2014" : fmtDelta(v, 1);
                  const compBarColor = (v: number) => v > 0.3 ? "#F87171" : v > 0 ? "#F59E0B" : "#34D399";

                  return (
                    <Pressable key={ar.id} onPress={() => { setExpandedArchiveId(isExpanded ? null : ar.id); setArchiveTab("terminal"); }}>
                      <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tagColor + "60", marginRight: 10 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>
                              {ar.tag.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                            </Text>
                            <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                              {ar.startDay} → {ar.endDay} · {duration}d {ar.label ? `· ${ar.label}` : ""}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            {distScore != null && (
                              <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: scoreColor(distScore) }}>
                                {fmtInt(distScore)}
                              </Text>
                            )}
                            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color={Colors.textTertiary} />
                          </View>
                        </View>

                        {isExpanded && (
                          <View style={{ marginTop: 10, backgroundColor: Colors.cardBgElevated || Colors.cardBg, borderRadius: 10, padding: 12, gap: 8 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: pc.bg }}>
                                <Ionicons name={pc.icon as any} size={14} color={pc.color} />
                                <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: pc.color }}>{phaseLabel}</Text>
                              </View>
                              {distScore != null && (
                                <View style={{ alignItems: "center" }}>
                                  <Text style={{ fontSize: 18, fontFamily: "Rubik_700Bold", color: scoreColor(distScore) }}>
                                    {fmtInt(distScore)}
                                  </Text>
                                  <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>{scaleLabel(distScore)}</Text>
                                </View>
                              )}
                            </View>

                            {tr?.components && (
                              <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                                {(["hrv", "rhr", "sleep", "proxy", "drift"] as const).map((k) => {
                                  const compKeys: Record<string, string> = { hrv: "hrv", rhr: "rhr", sleep: "sleep", proxy: "proxy", drift: "drift" };
                                  const compLabels: Record<string, string> = { hrv: "HRV", rhr: "RHR", sleep: "SLP", proxy: "PRX", drift: "DRF" };
                                  const val = tr.components[compKeys[k]] ?? 0;
                                  const pct = Math.min(100, Math.round(Math.abs(val) * 100));
                                  const bColor = compBarColor(val);
                                  return (
                                    <View key={k} style={{ flex: 1, alignItems: "center", gap: 3 }}>
                                      <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: Colors.textTertiary, letterSpacing: 0.5 }}>{compLabels[k]}</Text>
                                      <View style={{ width: "100%", height: 4, borderRadius: 2, backgroundColor: Colors.border, overflow: "hidden", opacity: Math.min(1, Math.abs(val) + 0.15) }}>
                                        <View style={{ height: "100%", borderRadius: 2, width: `${pct}%`, backgroundColor: bColor }} />
                                      </View>
                                      <Text style={{ fontSize: 8, fontFamily: "Rubik_500Medium", color: bColor }}>{pct}%</Text>
                                    </View>
                                  );
                                })}
                              </View>
                            )}

                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                                {duration}d episode
                              </Text>
                              {tr?.cortisolFlagRate21d != null && tr.cortisolFlagRate21d > 0 && (
                                <>
                                  <Text style={{ fontSize: 11, color: Colors.textTertiary }}>·</Text>
                                  <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: tr.cortisolFlagRate21d >= 0.3 ? "#F87171" : Colors.textTertiary }}>
                                    cortisol {fmtFracToPctInt(tr.cortisolFlagRate21d)}
                                  </Text>
                                </>
                              )}
                            </View>

                            <View style={{ flexDirection: "row", marginTop: 4, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8 }}>
                              <Pressable
                                onPress={(e) => { e.stopPropagation(); setArchiveTab("terminal"); }}
                                style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: archiveTab === "terminal" ? tagColor + "30" : "transparent", marginRight: 6 }}
                              >
                                <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: archiveTab === "terminal" ? tagColor : Colors.textTertiary }}>End-of-Episode</Text>
                              </Pressable>
                              <Pressable
                                onPress={(e) => { e.stopPropagation(); setArchiveTab("episode"); }}
                                style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: archiveTab === "episode" ? tagColor + "30" : "transparent" }}
                              >
                                <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: archiveTab === "episode" ? tagColor : Colors.textTertiary }}>Genesis → Terminus</Text>
                              </Pressable>
                            </View>

                            {archiveTab === "terminal" && tr && (
                              <View style={{ gap: 6 }}>
                                <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                                  7d vs 28d rolling deltas at {tr.day}
                                </Text>
                                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                  {[
                                    { label: "HRV", val: tr.deltas?.hrv_pct, suffix: "%" },
                                    { label: "Sleep", val: tr.deltas?.sleep_pct, suffix: "%" },
                                    { label: "RHR", val: tr.deltas?.rhr_bpm, suffix: " bpm" },
                                    { label: "Proxy", val: tr.deltas?.proxy_pct, suffix: "%" },
                                    { label: "Late", val: tr.deltas?.lateRate != null ? Math.round(tr.deltas.lateRate * 100) : null, suffix: "%" },
                                  ].map((item) => (
                                    <View key={item.label} style={{ backgroundColor: Colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                                      <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>{item.label}</Text>
                                      <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.text }}>
                                        {item.val != null ? `${fmtDelta(typeof item.val === "number" ? item.val : null, 0, item.suffix)}` : "\u2014"}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            )}

                            {archiveTab === "episode" && ew && (
                              <View style={{ gap: 6 }}>
                                {ew.interpretation === "insufficient_data" ? (
                                  <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                                    Insufficient tagged days for episode-wide comparison
                                  </Text>
                                ) : (
                                  <>
                                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                      <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                                        Start: {ew.windowStart?.start} → {ew.windowStart?.end}
                                      </Text>
                                      <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                                        End: {ew.windowEnd?.start} → {ew.windowEnd?.end}
                                      </Text>
                                    </View>
                                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                      {[
                                        { label: "ΔHRV", val: ew.deltaChange?.hrv_pct },
                                        { label: "ΔSleep", val: ew.deltaChange?.sleep_pct },
                                        { label: "ΔRHR", val: ew.deltaChange?.rhr_bpm },
                                        { label: "ΔProxy", val: ew.deltaChange?.proxy_pct },
                                        { label: "ΔDrift", val: ew.deltaChange?.lateRate },
                                      ].map((item) => (
                                        <View key={item.label} style={{ backgroundColor: Colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                                          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>{item.label}</Text>
                                          <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.text }}>{fmtDelta(item.val)}</Text>
                                        </View>
                                      ))}
                                    </View>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                      <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: interpColor(ew.interpretation) }}>
                                        {ew.interpretation?.toUpperCase()}
                                      </Text>
                                      {ew.disturbanceChange != null && (
                                        <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                                          Disturbance Δ: {fmtDelta(ew.disturbanceChange)}
                                        </Text>
                                      )}
                                    </View>
                                  </>
                                )}
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: -0.5,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
  },
  drawerCountBadge: {
    backgroundColor: ACCENT_MUTED,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 6,
  },
  drawerCountText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: ACCENT,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  dateLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  dateInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "500",
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 140,
    textAlign: "center",
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 13,
  },
  uploadBtnDisabled: {
    opacity: 0.5,
  },
  uploadBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
  },
  resultBanner: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  resultSuccess: {
    backgroundColor: "rgba(52, 211, 153, 0.12)",
  },
  resultError: {
    backgroundColor: "rgba(255, 107, 107, 0.12)",
  },
  resultText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chartContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 8,
  },
  chartYAxis: {
    justifyContent: "space-between",
    height: 120,
    width: 32,
  },
  chartAxisLabel: {
    fontSize: 9,
    color: Colors.textTertiary,
    textAlign: "right",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  toggleLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  snapRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  snapRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  snapLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  snapRecCount: {
    fontSize: 14,
    fontWeight: "700",
    color: ACCENT,
    minWidth: 28,
  },
  snapDate: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  snapRight: {
    alignItems: "flex-end",
  },
  snapVal: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  sessionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  sessionLeft: {
    flex: 1,
  },
  sessionDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  sessionDate: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.text,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeMeasured: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
  },
  badgeImputed: {
    backgroundColor: "rgba(251, 191, 36, 0.15)",
  },
  badgeWarning: {
    backgroundColor: "rgba(255, 107, 107, 0.15)",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  badgeTextMeasured: {
    color: MEASURED_COLOR,
  },
  badgeTextImputed: {
    color: IMPUTED_COLOR,
  },
  badgeTextWarning: {
    color: Colors.danger,
  },
  sessionRight: {
    alignItems: "flex-end",
  },
  sessionVal: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
  },
  sessionDur: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textTertiary,
    textAlign: "center",
    paddingVertical: 20,
  },
  confGrid: {
    flexDirection: "row",
    gap: 10,
  },
  confCell: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  confWindow: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.text,
    letterSpacing: 0.5,
  },
  confGradeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  confGradeText: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  confCounts: {
    flexDirection: "row",
    gap: 6,
  },
  confCountText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  backupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
  },
  backupBtnText: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  backupHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: "center" as const,
    marginTop: 6,
    lineHeight: 16,
  },
});

const srcStyles = StyleSheet.create({
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  sourceRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceInfo: {
    flex: 1,
    gap: 2,
  },
  sourceName: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.text,
  },
  sourceDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
});
