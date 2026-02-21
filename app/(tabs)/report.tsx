import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  Platform,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { loadEntries } from "@/lib/entry-storage";
import { getApiUrl, authFetch } from "@/lib/query-client";
import {
  DailyEntry,
  weeklyDelta,
  waistDelta,
  suggestCalorieAdjustment,
  proposeMacroSafeAdjustment,
  diagnoseDietVsTraining,
  cardioFuelNote,
  rollingAvg,
  leanGainRatio14d,
  leanGainRatioRolling,
  leanMassRollingAvg,
  ffmRollingAvg,
  ffmVelocity14d,
  ffmLeanGainRatio,
  weightVelocity14d,
  BASELINE,
  ITEM_LABELS,
  ITEM_UNITS,
  distributeDeltasToMeals,
  type AdjustmentItem,
  type MealGuideEntry,
  type Diagnosis,
} from "@/lib/coaching-engine";
import { type StrengthBaselines, strengthVelocity14d } from "@/lib/strength-index";
import { computeSCS, classifyMode, waistVelocity14d, type ModeClassification, type SCSResult } from "@/lib/structural-confidence";

function WeightChart({ data, lineColor }: { data: Array<{ day: string; avg: number }>; lineColor?: string }) {
  const chartColor = lineColor || Colors.primary;
  if (data.length < 2) return null;
  const values = data.map((d) => d.avg);
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const range = max - min || 1;
  const height = 120;
  const width = 300;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * height,
  }));

  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartYAxis}>
        <Text style={styles.chartAxisLabel}>{max.toFixed(1)}</Text>
        <Text style={styles.chartAxisLabel}>{((max + min) / 2).toFixed(1)}</Text>
        <Text style={styles.chartAxisLabel}>{min.toFixed(1)}</Text>
      </View>
      <View style={{ width, height, position: "relative" }}>
        {[0, 0.5, 1].map((pct) => (
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
                backgroundColor: chartColor,
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
              backgroundColor: i === points.length - 1 ? chartColor : Colors.cardBgElevated,
              borderWidth: 1.5,
              borderColor: chartColor,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function RatioChart({ data }: { data: Array<{ day: string; ratio: number }> }) {
  if (data.length < 2) return null;
  const values = data.map((d) => d.ratio);
  const min = Math.min(...values, -0.2);
  const max = Math.max(...values, 1.2);
  const range = max - min || 1;
  const height = 100;
  const width = 300;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * height,
  }));

  const zeroY = height - ((0 - min) / range) * height;

  return (
    <View style={styles.chartContainer}>
      <View style={[styles.chartYAxis, { height }]}>
        <Text style={styles.chartAxisLabel}>{max.toFixed(1)}</Text>
        <Text style={styles.chartAxisLabel}>{((max + min) / 2).toFixed(1)}</Text>
        <Text style={styles.chartAxisLabel}>{min.toFixed(1)}</Text>
      </View>
      <View style={{ width, height, position: "relative" }}>
        {zeroY >= 0 && zeroY <= height ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: zeroY,
              height: 1,
              backgroundColor: Colors.textTertiary + "60",
            }}
          />
        ) : null}
        {[0, 0.5, 1].map((pct) => (
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
          const segColor = values[i] >= 0.6 ? Colors.success : values[i] >= 0.3 ? Colors.warning : Colors.danger;
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: prev.x,
                top: prev.y,
                width: len,
                height: 2.5,
                backgroundColor: segColor,
                borderRadius: 1,
                transform: [{ rotate: `${angle}deg` }],
                transformOrigin: "left center",
              }}
            />
          );
        })}
        {points.map((p, i) => {
          const dotColor = values[i] >= 0.6 ? Colors.success : values[i] >= 0.3 ? Colors.warning : Colors.danger;
          return (
            <View
              key={`dot-${i}`}
              style={{
                position: "absolute",
                left: p.x - 3,
                top: p.y - 3,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === points.length - 1 ? dotColor : Colors.cardBgElevated,
                borderWidth: 1.5,
                borderColor: dotColor,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  const typeConfig: Record<string, { icon: string; color: string; bg: string }> = {
    adherence: { icon: "alert-circle", color: Colors.warning, bg: Colors.warningMuted },
    overshoot: { icon: "trending-up", color: Colors.danger, bg: Colors.dangerMuted },
    undershoot: { icon: "trending-down", color: Colors.secondary, bg: Colors.secondaryMuted },
    training: { icon: "barbell-outline", color: "#60A5FA", bg: "rgba(96, 165, 250, 0.15)" },
    deload: { icon: "pause-circle-outline", color: Colors.secondary, bg: Colors.secondaryMuted },
    ok: { icon: "checkmark-circle", color: Colors.success, bg: Colors.successMuted },
    insufficient: { icon: "time-outline", color: Colors.textSecondary, bg: Colors.surface },
  };

  const config = typeConfig[diagnosis.type] || typeConfig.ok;

  return (
    <View style={[styles.diagCard, { backgroundColor: config.bg, borderColor: config.color + "30" }]}>
      <View style={styles.diagHeader}>
        <Ionicons name={config.icon as any} size={22} color={config.color} />
        <Text style={[styles.diagTitle, { color: config.color }]}>
          {diagnosis.type === "ok" ? "On Track" :
           diagnosis.type === "adherence" ? "Adherence Check" :
           diagnosis.type === "overshoot" ? "Gaining Too Fast" :
           diagnosis.type === "undershoot" ? "Not Gaining" :
           diagnosis.type === "training" ? "Training Focus" :
           diagnosis.type === "deload" ? "Deload Week" : "More Data Needed"}
        </Text>
      </View>
      <Text style={styles.diagMessage}>{diagnosis.message}</Text>
    </View>
  );
}

function AdjustmentCard({ adjustments, kcalChange }: { adjustments: AdjustmentItem[]; kcalChange: number }) {
  if (kcalChange === 0) {
    return (
      <View style={styles.adjustCard}>
        <View style={styles.adjustHeader}>
          <Ionicons name="checkmark-done" size={20} color={Colors.success} />
          <Text style={styles.adjustTitle}>Hold Steady</Text>
        </View>
        <Text style={styles.adjustSubtitle}>
          Your current intake is producing the right rate of gain. Keep running another week and recheck.
        </Text>
      </View>
    );
  }

  const isIncrease = kcalChange > 0;

  return (
    <View style={styles.adjustCard}>
      <View style={styles.adjustHeader}>
        <Ionicons
          name={isIncrease ? "add-circle" : "remove-circle"}
          size={20}
          color={isIncrease ? Colors.success : Colors.danger}
        />
        <Text style={styles.adjustTitle}>
          {isIncrease ? "+" : ""}{kcalChange} kcal/day
        </Text>
      </View>
      <Text style={styles.adjustSubtitle}>
        {isIncrease
          ? "Not gaining fast enough. Increase intake slightly."
          : "Gaining too fast. Pull back slightly to keep it lean."}
      </Text>
      {adjustments.length > 0 ? (
        <View style={styles.tweakList}>
          <Text style={styles.tweakHeader}>Suggested Tweaks</Text>
          {adjustments.map((adj) => {
            const label = ITEM_LABELS[adj.item] || adj.item;
            const unit = ITEM_UNITS[adj.item] || "";
            const sign = adj.deltaAmount > 0 ? "+" : "";
            return (
              <View key={adj.item} style={styles.tweakRow}>
                <View style={styles.tweakLeft}>
                  <MaterialCommunityIcons name="food-apple-outline" size={16} color={Colors.textSecondary} />
                  <Text style={styles.tweakName}>{label}</Text>
                </View>
                <View style={styles.tweakRight}>
                  <Text style={[styles.tweakAmount, { color: adj.deltaAmount > 0 ? Colors.success : Colors.danger }]}>
                    {sign}{adj.deltaAmount}{unit ? ` ${unit}` : ""}
                  </Text>
                  <Text style={styles.tweakKcal}>
                    ({adj.achievedKcal > 0 ? "+" : ""}{adj.achievedKcal} kcal)
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function MealAdjustmentGuide({ adjustments, kcalChange }: { adjustments: AdjustmentItem[]; kcalChange: number }) {
  const allMeals = distributeDeltasToMeals(adjustments);
  const visibleMeals = allMeals.filter((m) => m.ingredients.length > 0);

  const changedCount = visibleMeals.filter((m) => m.changed).length;
  const unchangedCount = visibleMeals.length - changedCount;
  const prepChanged = visibleMeals.filter((m) => m.changed && m.prepZone === "prep").length;

  const summaryParts: string[] = [];
  for (const adj of adjustments) {
    const label = ITEM_LABELS[adj.item] || adj.item;
    const unit = ITEM_UNITS[adj.item] || "";
    const sign = adj.deltaAmount > 0 ? "+" : "";
    summaryParts.push(`${sign}${adj.deltaAmount}${unit ? `${unit}` : ""} ${label}`);
  }

  const formatAmount = (item: string, amount: number) => {
    const unit = ITEM_UNITS[item] || "";
    if (unit === "cup") return `${amount} ${unit}`;
    if (unit) return `${amount}${unit}`;
    return `${amount}`;
  };

  const renderIngredientLine = (ing: { item: string; baseline: number; adjusted: number; delta: number }) => {
    const label = ITEM_LABELS[ing.item] || ing.item;
    const hasDelta = ing.delta !== 0;

    return (
      <View key={ing.item} style={mealGuideStyles.ingredientRow}>
        <View style={mealGuideStyles.ingredientLeft}>
          <View style={[mealGuideStyles.ingredientDot, { backgroundColor: hasDelta ? (ing.delta > 0 ? Colors.success : Colors.danger) : Colors.textTertiary + "40" }]} />
          <Text style={[mealGuideStyles.ingredientName, !hasDelta && { color: Colors.textTertiary }]}>
            {label}
          </Text>
        </View>
        {hasDelta ? (
          <View style={mealGuideStyles.ingredientRight}>
            <Text style={[mealGuideStyles.ingredientBaseline, { textDecorationLine: "line-through" as const }]}>
              {formatAmount(ing.item, ing.baseline)}
            </Text>
            <Feather name="arrow-right" size={10} color={ing.delta > 0 ? Colors.success : Colors.danger} />
            <Text style={[mealGuideStyles.ingredientAdjusted, { color: ing.delta > 0 ? Colors.success : Colors.danger }]}>
              {formatAmount(ing.item, ing.adjusted)}
            </Text>
            <Text style={[mealGuideStyles.ingredientDelta, { color: ing.delta > 0 ? Colors.success : Colors.danger }]}>
              ({ing.delta > 0 ? "+" : ""}{formatAmount(ing.item, ing.delta)})
            </Text>
          </View>
        ) : (
          <Text style={mealGuideStyles.ingredientUnchanged}>
            {formatAmount(ing.item, ing.baseline)}
          </Text>
        )}
      </View>
    );
  };

  const renderMealCard = (meal: MealGuideEntry) => {
    const zoneIcon = meal.prepZone === "prep" ? "briefcase-outline" : "home-outline";
    const zoneColor = meal.prepZone === "prep" ? Colors.secondary : Colors.primary;
    const zoneLabel = meal.prepZone === "prep" ? "PREP" : "HOME";

    return (
      <View key={meal.time} style={[mealGuideStyles.mealCard, meal.changed && { borderColor: Colors.primary + "40" }]}>
        {meal.changed && (
          <View style={mealGuideStyles.adjustedFlag}>
            <Text style={[mealGuideStyles.changedBadgeText, { color: Colors.primary }]}>ADJUSTED</Text>
          </View>
        )}
        <View style={mealGuideStyles.mealHeader}>
          <View style={mealGuideStyles.mealHeaderLeft}>
            <Text style={mealGuideStyles.mealTime}>{meal.time}</Text>
            <Text style={mealGuideStyles.mealLabel}>{meal.label}</Text>
          </View>
          <View style={[mealGuideStyles.zoneBadge, { backgroundColor: zoneColor + "15" }]}>
            <Ionicons name={zoneIcon as any} size={10} color={zoneColor} />
            <Text style={[mealGuideStyles.zoneBadgeText, { color: zoneColor }]}>{zoneLabel}</Text>
          </View>
        </View>
        <View style={mealGuideStyles.ingredientList}>
          {meal.ingredients.map(renderIngredientLine)}
        </View>
      </View>
    );
  };

  return (
    <View style={mealGuideStyles.container}>
      <View style={mealGuideStyles.summaryBar}>
        <Ionicons name="restaurant-outline" size={16} color={Colors.primary} />
        <Text style={mealGuideStyles.summaryText}>
          {kcalChange === 0
            ? "No changes this week. All meals unchanged."
            : changedCount > 0
            ? `${changedCount} meal${changedCount > 1 ? "s" : ""} adjusted${prepChanged > 0 ? ` (${prepChanged} need prep)` : ""}. ${unchangedCount} unchanged.`
            : "All meals unchanged."}
        </Text>
      </View>

      {adjustments.length > 0 && kcalChange !== 0 && (
        <View style={mealGuideStyles.deltaSummary}>
          <Text style={mealGuideStyles.deltaSummaryLabel}>Total Adjustments</Text>
          <Text style={mealGuideStyles.deltaSummaryValue}>{summaryParts.join("  /  ")}</Text>
        </View>
      )}

      <View style={mealGuideStyles.mealsContainer}>
        {visibleMeals.map(renderMealCard)}
      </View>
    </View>
  );
}

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [proxyData, setProxyData] = useState<Array<{ date: string; proxyScore: number | null; proxy7dAvg: number | null }>>([]);
  const [proxyImputed, setProxyImputed] = useState(false);
  const [confidence, setConfidence] = useState<Array<{ window: string; days: number; measured: number; imputed: number; multiNight: number; grade: string }>>([]);
  const [readiness, setReadiness] = useState<{
    readinessScore: number;
    readinessTier: string;
    confidenceGrade: string;
    typeLean: number;
    exerciseBias: number;
    cortisolFlag: boolean;
    hrvDelta: number | null;
    rhrDelta: number | null;
    sleepDelta: number | null;
    proxyDelta: number | null;
    drivers: string[];
    gate?: string;
    daysInWindow?: number;
    analysisStartDate?: string;
    deltas?: {
      sleep_pct: number | null;
      hrv_pct: number | null;
      rhr_bpm: number | null;
      proxy_pct: number | null;
      sleep_str: string;
      hrv_str: string;
      rhr_str: string;
      proxy_str: string;
    };
    confidenceBreakdown?: {
      grade: string;
      measured_7d: number;
      imputed_7d: number;
      combined_7d: number;
    };
    adherence?: {
      alignmentScore: number | null;
      bedDevMin: number | null;
      wakeDevMin: number | null;
      bedtimeDriftLateNights7d: number;
      wakeDriftEarlyNights7d: number;
      measuredNights7d: number;
      bedtimeDriftNote: string | null;
      wakeDriftNote: string | null;
    };
    primaryDriver?: {
      driver: string;
      severity: number;
      recommendation: string;
    } | null;
    placeholders?: {
      mealTimingTracked: boolean;
    };
    sleepBlock?: any;
    sleepTrending?: any;
  } | null>(null);
  const [readinessHistory, setReadinessHistory] = useState<Array<{ date: string; readinessScore: number; readinessTier: string }>>([]);
  const [dataSuff, setDataSuff] = useState<{
    analysisStartDate: string;
    daysWithData: number;
    gate7: boolean;
    gate14: boolean;
    gate30: boolean;
    gateLabel: string | null;
  } | null>(null);
  const [strengthBaselines, setStrengthBaselines] = useState<StrengthBaselines>({
    pushups: null, pullups: null, benchBarReps: null, ohpBarReps: null,
  });

  const fetchEntries = useCallback(async () => {
    const data = await loadEntries();
    setEntries(data);
  }, []);

  const fetchProxy = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const today = new Date().toISOString().slice(0, 10);
      const histFrom = (() => {
        const d = new Date(); d.setDate(d.getDate() - 13);
        return d.toISOString().slice(0, 10);
      })();
      const [proxyRes, confRes, readinessRes, readinessHistRes, dsRes] = await Promise.all([
        authFetch(new URL(`/api/erection/proxy?include_imputed=${proxyImputed}`, baseUrl).toString()),
        authFetch(new URL("/api/erection/confidence", baseUrl).toString()),
        authFetch(new URL(`/api/readiness?date=${today}`, baseUrl).toString()),
        authFetch(new URL(`/api/readiness/range?from=${histFrom}&to=${today}`, baseUrl).toString()),
        authFetch(new URL("/api/data-sufficiency", baseUrl).toString()),
      ]);
      if (proxyRes.ok) {
        const rows = await proxyRes.json();
        setProxyData(rows.map((r: any) => ({
          date: r.date,
          proxyScore: r.proxyScore != null ? Number(r.proxyScore) : null,
          proxy7dAvg: r.proxy7DAvg != null ? Number(r.proxy7DAvg) : null,
        })));
      }
      if (confRes.ok) {
        setConfidence(await confRes.json());
      }
      if (readinessRes.ok) {
        setReadiness(await readinessRes.json());
      }
      if (readinessHistRes.ok) {
        setReadinessHistory(await readinessHistRes.json());
      }
      if (dsRes.ok) setDataSuff(await dsRes.json());
      try {
        const sbRes = await authFetch(new URL("/api/strength/baselines", baseUrl).toString());
        if (sbRes.ok) {
          const sbData = await sbRes.json();
          const bl = sbData.baselines || {};
          setStrengthBaselines({
            pushups: bl.pushups?.value ?? null,
            pullups: bl.pullups?.value ?? null,
            benchBarReps: bl.bench_bar_reps?.value ?? null,
            ohpBarReps: bl.ohp_bar_reps?.value ?? null,
          });
        }
      } catch {}
    } catch {}
  }, [proxyImputed]);

  useFocusEffect(
    useCallback(() => {
      fetchEntries();
      fetchProxy();
    }, [fetchEntries, fetchProxy])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchEntries(), fetchProxy()]);
    setRefreshing(false);
  }, [fetchEntries, fetchProxy]);

  const wkGain = weeklyDelta(entries);
  const wDelta = waistDelta(entries);
  const kcalAdj = wkGain != null ? suggestCalorieAdjustment(wkGain) : null;
  const adjustments = kcalAdj != null ? proposeMacroSafeAdjustment(kcalAdj, BASELINE) : [];
  const diagnosis = diagnoseDietVsTraining(entries);
  const ra = rollingAvg(entries, 7);
  const chartData = ra.slice(-21);
  const lgr = leanGainRatio14d(entries);
  const lgrRolling = leanGainRatioRolling(entries, 14);
  const lmRa = leanMassRollingAvg(entries, 7);
  const lmChartData = lmRa.slice(-21);
  const ffmRa = ffmRollingAvg(entries, 7);
  const ffmChartData = ffmRa.slice(-21);
  const ffmV = ffmVelocity14d(entries);
  const ffmLgr = ffmLeanGainRatio(entries);
  const scs = computeSCS(entries, strengthBaselines);
  const modeClass = classifyMode(entries, strengthBaselines);
  const waistV = waistVelocity14d(entries);
  const sV = strengthVelocity14d(entries, strengthBaselines);

  const hasEnoughData = entries.length >= 7;
  const daysWithWeight = entries.filter(e => e.morningWeightLb != null).length;
  const allVelocitiesNull = modeClass.ffmVelocity == null && modeClass.waistVelocity == null && modeClass.strengthVelocityPct == null;
  const rampUpMessage = daysWithWeight < 7
    ? `Need 7 days for rolling averages (${daysWithWeight} so far)`
    : daysWithWeight < 21 && allVelocitiesNull
      ? `Need ~21 days for 14d velocities (${daysWithWeight} so far)`
      : null;

  const targetMin = 0.25;
  const targetMax = 0.5;
  const isOnTarget = wkGain != null && wkGain >= targetMin && wkGain <= targetMax;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: topInset + 16,
            paddingBottom: Platform.OS === "web" ? 84 + 34 : insets.bottom + 100,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Weekly Report</Text>
          <Text style={styles.subtitle}>
            {hasEnoughData ? "Analysis based on your logged data" : "Log at least 7 days for analysis"}
          </Text>
        </View>

        {!hasEnoughData ? (
          <View style={styles.emptyState}>
            <Ionicons name="hourglass-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>Not enough data yet</Text>
            <Text style={styles.emptyText}>
              You need at least 7 days of logged data to generate your weekly report. You have {entries.length} {entries.length === 1 ? "day" : "days"} so far.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ backgroundColor: modeClass.color + "18", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: modeClass.color + "40" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons
                    name={modeClass.mode === "LEAN_BULK" ? "trending-up" : modeClass.mode === "RECOMP" ? "swap-horizontal" : modeClass.mode === "CUT" ? "trending-down" : "help-circle"}
                    size={20}
                    color={modeClass.color}
                  />
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_600SemiBold", color: modeClass.color }}>
                    Mode: {modeClass.label}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ backgroundColor: modeClass.trainingPhase === "hypertrophy" ? "#A78BFA30" : "#6B728030", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: modeClass.trainingPhase === "hypertrophy" ? "#A78BFA" : "#9CA3AF" }}>
                      {modeClass.trainingPhase === "hypertrophy" ? "Hypertrophy" : "Neural"}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: modeClass.color + "30", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: modeClass.color }}>
                      {scs.total}/100
                    </Text>
                  </View>
                </View>
              </View>
              {modeClass.waistWarning.active && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, backgroundColor: "#FBBF2418", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Ionicons name="warning" size={13} color="#FBBF24" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#FBBF24" }}>
                    {modeClass.waistWarning.label}
                  </Text>
                </View>
              )}
              {modeClass.strengthPlateau.flagged && (
                <View style={{ marginBottom: 6, backgroundColor: "#F8717118", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <Ionicons name="pause-circle" size={13} color="#F87171" />
                    <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: "#F87171" }}>
                      {modeClass.strengthPlateau.label}
                    </Text>
                  </View>
                  {modeClass.strengthPlateau.coachingNotes.map((note, idx) => (
                    <Text key={idx} style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: "#F8717199", marginLeft: 19, marginTop: 1 }}>
                      {idx + 1}. {note}
                    </Text>
                  ))}
                </View>
              )}
              <View style={{ gap: 4 }}>
                {modeClass.ffmVelocity != null && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons
                      name={modeClass.ffmVelocity >= 0.15 ? "arrow-up" : modeClass.ffmVelocity <= -0.15 ? "arrow-down" : "remove"}
                      size={14}
                      color={modeClass.ffmVelocity >= 0.15 ? "#34D399" : modeClass.ffmVelocity <= -0.15 ? "#F87171" : "#FBBF24"}
                    />
                    <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.text }}>
                      FFM: {modeClass.ffmVelocity >= 0 ? "+" : ""}{modeClass.ffmVelocity.toFixed(2)} lb/wk
                      <Text style={{ color: Colors.textTertiary }}> {modeClass.ffmVelocity >= 0.15 ? "(good)" : modeClass.ffmVelocity <= -0.15 ? "(watch)" : "(stable)"}</Text>
                    </Text>
                  </View>
                )}
                {modeClass.waistVelocity != null && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons
                      name={modeClass.waistVelocity <= -0.10 ? "arrow-down" : modeClass.waistVelocity >= 0.10 ? "arrow-up" : "remove"}
                      size={14}
                      color={modeClass.waistVelocity <= -0.10 ? "#34D399" : modeClass.waistVelocity >= 0.10 ? "#F87171" : "#FBBF24"}
                    />
                    <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.text }}>
                      Waist: {modeClass.waistVelocity >= 0 ? "+" : ""}{modeClass.waistVelocity.toFixed(2)} in/wk
                      <Text style={{ color: Colors.textTertiary }}> {modeClass.waistVelocity <= -0.10 ? "(good)" : modeClass.waistVelocity >= 0.10 ? "(watch)" : "(stable)"}</Text>
                    </Text>
                  </View>
                )}
                {modeClass.strengthVelocityPct != null && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons
                      name={modeClass.strengthVelocityPct >= 0.25 ? "arrow-up" : modeClass.strengthVelocityPct <= -0.25 ? "arrow-down" : "remove"}
                      size={14}
                      color={modeClass.strengthVelocityPct >= 0.25 ? "#34D399" : modeClass.strengthVelocityPct <= -0.25 ? "#F87171" : "#FBBF24"}
                    />
                    <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.text }}>
                      Strength: {modeClass.strengthVelocityPct >= 0 ? "+" : ""}{modeClass.strengthVelocityPct.toFixed(2)}%/wk
                      <Text style={{ color: Colors.textTertiary }}> {modeClass.strengthVelocityPct >= 0.25 ? "(good)" : modeClass.strengthVelocityPct <= -0.25 ? "(watch)" : "(stable)"}</Text>
                    </Text>
                  </View>
                )}
              </View>
              {rampUpMessage != null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, backgroundColor: "#6366F118", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
                  <Ionicons name="time-outline" size={13} color="#818CF8" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#818CF8", flex: 1 }}>
                    {rampUpMessage}
                  </Text>
                </View>
              )}
              {modeClass.calorieAction.delta !== 0 && (
                <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: modeClass.color + "20" }}>
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>
                    {modeClass.calorieAction.delta > 0 ? "+" : ""}{modeClass.calorieAction.delta} kcal — {modeClass.calorieAction.reason}
                  </Text>
                </View>
              )}
              {modeClass.mode === "UNCERTAIN" && modeClass.reasons.length > 1 && !rampUpMessage && (
                <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: modeClass.color + "20" }}>
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                    {modeClass.reasons[1]}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.baselineCard}>
              <View style={styles.baselineRow}>
                <View style={styles.baselineStat}>
                  <Text style={styles.baselineLabel}>Baseline</Text>
                  <Text style={styles.baselineValue}>{BASELINE.calories.toFixed(0)}</Text>
                  <Text style={styles.baselineUnit}>kcal/day</Text>
                </View>
                <View style={styles.baselineDivider} />
                <View style={styles.baselineStat}>
                  <Text style={styles.baselineLabel}>Protein</Text>
                  <Text style={styles.baselineValue}>{BASELINE.proteinG}</Text>
                  <Text style={styles.baselineUnit}>g</Text>
                </View>
                <View style={styles.baselineDivider} />
                <View style={styles.baselineStat}>
                  <Text style={styles.baselineLabel}>Carbs</Text>
                  <Text style={styles.baselineValue}>{BASELINE.carbsG}</Text>
                  <Text style={styles.baselineUnit}>g</Text>
                </View>
                <View style={styles.baselineDivider} />
                <View style={styles.baselineStat}>
                  <Text style={styles.baselineLabel}>Fat</Text>
                  <Text style={styles.baselineValue}>{BASELINE.fatG}</Text>
                  <Text style={styles.baselineUnit}>g</Text>
                </View>
              </View>
            </View>

            {chartData.length >= 2 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Weight Trend (7-day Avg)</Text>
                <View style={styles.chartWrapper}>
                  <WeightChart data={chartData} />
                </View>
              </View>
            ) : null}

            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Weekly Change</Text>
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color: isOnTarget
                        ? Colors.success
                        : wkGain != null && wkGain > targetMax
                        ? Colors.danger
                        : Colors.secondary,
                    },
                  ]}
                >
                  {wkGain != null ? `${wkGain > 0 ? "+" : ""}${wkGain.toFixed(2)}` : "--"}
                </Text>
                <Text style={styles.metricUnit}>lb/week</Text>
                <View style={[styles.targetBadge, isOnTarget ? styles.targetBadgeGood : styles.targetBadgeOff]}>
                  <Text style={[styles.targetBadgeText, isOnTarget ? styles.targetBadgeTextGood : styles.targetBadgeTextOff]}>
                    {isOnTarget ? "On Target" : `Target: +${targetMin}-${targetMax}`}
                  </Text>
                </View>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Waist Change</Text>
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color: wDelta != null && wDelta > 0.25 ? Colors.danger : wDelta != null && wDelta <= 0 ? Colors.success : Colors.text,
                    },
                  ]}
                >
                  {wDelta != null ? `${wDelta > 0 ? "+" : ""}${wDelta.toFixed(2)}` : "--"}
                </Text>
                <Text style={styles.metricUnit}>inches (14d)</Text>
              </View>
            </View>

            {lgr != null || lmChartData.length >= 2 || lgrRolling.length >= 2 || ffmV != null || ffmChartData.length >= 2 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Lean Gain Analysis</Text>
                <View style={styles.lgrCard}>
                  {lgr != null ? (
                    <View style={styles.lgrTop}>
                      <View style={styles.lgrGauge}>
                        <Text style={styles.lgrLabel}>Lean Gain Ratio (14d)</Text>
                        <Text
                          style={[
                            styles.lgrValue,
                            {
                              color:
                                lgr >= 0.6
                                  ? Colors.success
                                  : lgr >= 0.3
                                  ? Colors.warning
                                  : Colors.danger,
                            },
                          ]}
                        >
                          {lgr.toFixed(2)}
                        </Text>
                        <Text style={styles.lgrHint}>
                          {lgr >= 0.6
                            ? "Excellent - mostly lean mass"
                            : lgr >= 0.3
                            ? "Moderate - some fat gain"
                            : lgr < 0
                            ? "Losing lean mass - check training/protein"
                            : "Low ratio - gaining mostly fat"}
                        </Text>
                      </View>
                      <View style={styles.lgrBar}>
                        <View style={styles.lgrBarTrack}>
                          <View
                            style={[
                              styles.lgrBarFill,
                              {
                                width: `${Math.max(0, Math.min(100, ((lgr + 1) / 3) * 100))}%`,
                                backgroundColor:
                                  lgr >= 0.6
                                    ? Colors.success
                                    : lgr >= 0.3
                                    ? Colors.warning
                                    : Colors.danger,
                              },
                            ]}
                          />
                        </View>
                        <View style={styles.lgrBarLabels}>
                          <Text style={styles.lgrBarLabel}>Fat</Text>
                          <Text style={styles.lgrBarLabel}>Mixed</Text>
                          <Text style={styles.lgrBarLabel}>Lean</Text>
                        </View>
                      </View>
                    </View>
                  ) : null}
                  {lgrRolling.length >= 2 ? (
                    <View style={{ marginTop: lgr != null ? 16 : 0 }}>
                      <Text style={[styles.lgrLabel, { marginBottom: 8 }]}>Rolling Lean Gain Ratio (14d)</Text>
                      <View style={styles.chartWrapper}>
                        <RatioChart data={lgrRolling} />
                      </View>
                    </View>
                  ) : null}
                  {lmChartData.length >= 2 ? (
                    <View style={{ marginTop: 16 }}>
                      <Text style={[styles.lgrLabel, { marginBottom: 8 }]}>Lean Mass Trend (7d Avg)</Text>
                      <WeightChart data={lmChartData} lineColor="#A78BFA" />
                    </View>
                  ) : null}
                  {ffmV != null ? (
                    <View style={{ marginTop: 16, padding: 12, backgroundColor: "#A78BFA10", borderRadius: 8, borderWidth: 1, borderColor: "#A78BFA30" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <Ionicons name="body-outline" size={14} color="#A78BFA" />
                        <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: "#A78BFA" }}>Fat-Free Mass Velocity (14d)</Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                        <View>
                          <Text style={{ fontSize: 20, fontFamily: "Rubik_600SemiBold", color: ffmV.velocityLbPerWeek > 0.15 ? Colors.success : ffmV.velocityLbPerWeek < -0.15 ? Colors.danger : Colors.warning }}>
                            {ffmV.velocityLbPerWeek > 0 ? "+" : ""}{ffmV.velocityLbPerWeek.toFixed(2)} lb/wk
                          </Text>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, marginTop: 2 }}>{ffmV.label}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>7d avg now: {ffmV.ffm7dToday.toFixed(1)} lb</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>{ffmV.spanDays}d ago: {ffmV.ffm7d14dAgo.toFixed(1)} lb</Text>
                        </View>
                      </View>
                      {ffmLgr.ratio != null ? (
                        <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#A78BFA20" }}>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textSecondary }}>
                            FFM-based LGR: <Text style={{ fontFamily: "Rubik_600SemiBold", color: ffmLgr.ratio >= 0.6 ? Colors.success : ffmLgr.ratio >= 0.3 ? Colors.warning : Colors.danger }}>{ffmLgr.ratio.toFixed(2)}</Text>
                            {" — "}{ffmLgr.label}
                          </Text>
                        </View>
                      ) : ffmLgr.insufficientWeight ? (
                        <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#A78BFA20" }}>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                            FFM-based LGR: {ffmLgr.label}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {ffmChartData.length >= 2 ? (
                    <View style={{ marginTop: 16 }}>
                      <Text style={[styles.lgrLabel, { marginBottom: 8 }]}>Fat-Free Mass Trend (7d Avg)</Text>
                      <WeightChart data={ffmChartData} lineColor="#C084FC" />
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Diagnosis</Text>
              <DiagnosisCard diagnosis={diagnosis} />
            </View>

            {dataSuff && (
              <View style={styles.section}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.cardBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons
                      name={(dataSuff.gate30 ?? false) ? "checkmark-circle" : "time"}
                      size={16}
                      color={(dataSuff.gate30 ?? false) ? "#34D399" : (dataSuff.gate14 ?? false) ? "#FBBF24" : "#60A5FA"}
                    />
                    <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.text }}>
                      Analysis: {dataSuff.daysWithData ?? 0}d since {dataSuff.analysisStartDate ?? "--"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[
                      { label: "7d", ok: dataSuff.gate7 ?? false },
                      { label: "14d", ok: dataSuff.gate14 ?? false },
                      { label: "30d", ok: dataSuff.gate30 ?? false },
                    ].map((g) => (
                      <View key={g.label} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        <Ionicons name={g.ok ? "checkmark-circle" : "ellipse-outline"} size={12} color={g.ok ? "#34D399" : Colors.textTertiary} />
                        <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: g.ok ? "#34D399" : Colors.textTertiary }}>{g.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {dataSuff.gateLabel && (
                  <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: "#FBBF24", marginTop: 6 }}>
                    {dataSuff.gateLabel}
                  </Text>
                )}
              </View>
            )}

            {readiness && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Training Readiness</Text>
                {readiness.gate === "NONE" ? (
                  <View style={[styles.lgrCard, { borderColor: "#60A5FA30" }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#60A5FA20", alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="time" size={20} color="#60A5FA" />
                      </View>
                      <View>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
                          Readiness Score
                        </Text>
                        <Text style={{ fontSize: 20, fontFamily: "Rubik_600SemiBold", color: "#60A5FA" }}>
                          Baseline Building...
                        </Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 14, fontFamily: "Rubik_400Regular", color: Colors.textSecondary }}>
                      Need at least 7 days of data in the analysis window to compute readiness. Currently {readiness.daysInWindow ?? 0} days.
                    </Text>
                  </View>
                ) : (() => {
                  const tier = readiness.readinessTier ?? "BLUE";
                  const tierColor = tier === "GREEN" ? "#34D399" : tier === "BLUE" ? "#60A5FA" : "#FBBF24";
                  const tierIcon = tier === "GREEN" ? "flash" : tier === "BLUE" ? "snow" : "pause-circle";
                  const score = readiness.readinessScore ?? 0;
                  const typeLeanVal = readiness.typeLean ?? 0;
                  const exerciseBiasVal = readiness.exerciseBias ?? 0;
                  return (
                    <View style={[styles.lgrCard, { borderColor: tierColor + "30" }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <View style={{
                            width: 40, height: 40, borderRadius: 20,
                            backgroundColor: tierColor + "20",
                            alignItems: "center", justifyContent: "center",
                          }}>
                            <Ionicons name={tierIcon as any} size={20} color={tierColor} />
                          </View>
                          <View>
                            <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
                              Readiness Score
                            </Text>
                            <Text style={{ fontSize: 28, fontFamily: "Rubik_700Bold", color: tierColor }}>
                              {(readiness.gate === "NONE" || (readiness.daysInWindow ?? 0) < 7) ? "—" : score}
                            </Text>
                            <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 2 }}>
                              {(readiness.gate === "NONE" || (readiness.daysInWindow ?? 0) < 7) ? "Provisional floor — need 7+ days" : (readiness.daysInWindow ?? 0) < 28 ? "Partial baseline — score may shift" : "Estimates recovery permissiveness"}
                            </Text>
                          </View>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 4 }}>
                          <View style={{
                            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                            backgroundColor: tierColor + "20",
                          }}>
                            <Text style={{
                              fontSize: 13, fontFamily: "Rubik_700Bold", letterSpacing: 0.5,
                              color: tierColor,
                            }}>
                              {tier}
                            </Text>
                          </View>
                          {(readiness.confidenceGrade === "Low" || readiness.confidenceGrade === "None") && (
                            <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>
                              LOW CONFIDENCE
                            </Text>
                          )}
                        </View>
                      </View>

                      <View style={{ height: 6, borderRadius: 3, backgroundColor: Colors.surface, marginBottom: 12, overflow: "hidden" as const }}>
                        <View style={{
                          height: 6, borderRadius: 3,
                          width: `${score}%`,
                          backgroundColor: tierColor,
                        }} />
                      </View>

                      {readiness.cortisolFlag && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EF444418", borderRadius: 10, padding: 10, marginBottom: 12 }}>
                          <Ionicons name="warning" size={16} color="#EF4444" />
                          <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: "#EF4444", flex: 1 }}>
                            Cortisol Suppression Active
                          </Text>
                        </View>
                      )}

                      <View style={{ gap: 10, marginBottom: 12, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10 }}>
                        <View>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>Type Lean</Text>
                            <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: tierColor }}>
                              {typeLeanVal > 0 ? "+" : ""}{typeLeanVal.toFixed(2)}
                            </Text>
                          </View>
                          <View style={{ height: 6, borderRadius: 3, backgroundColor: Colors.surface, overflow: "hidden" as const }}>
                            <View style={{
                              position: "absolute",
                              left: `${((typeLeanVal + 1) / 2) * 100}%`,
                              top: 0, width: 3, height: 6, borderRadius: 1.5,
                              backgroundColor: tierColor, marginLeft: -1.5,
                            }} />
                            <View style={{
                              position: "absolute", left: "50%", top: 0, width: 1, height: 6,
                              backgroundColor: Colors.textTertiary + "40",
                            }} />
                          </View>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                            <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Hypertrophy</Text>
                            <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Strength</Text>
                          </View>
                        </View>

                        <View>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>Exercise Bias</Text>
                            <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: tierColor }}>
                              {exerciseBiasVal > 0 ? "+" : ""}{exerciseBiasVal.toFixed(2)}
                            </Text>
                          </View>
                          <View style={{ height: 6, borderRadius: 3, backgroundColor: Colors.surface, overflow: "hidden" as const }}>
                            <View style={{
                              position: "absolute",
                              left: `${((exerciseBiasVal + 1) / 2) * 100}%`,
                              top: 0, width: 3, height: 6, borderRadius: 1.5,
                              backgroundColor: tierColor, marginLeft: -1.5,
                            }} />
                            <View style={{
                              position: "absolute", left: "50%", top: 0, width: 1, height: 6,
                              backgroundColor: Colors.textTertiary + "40",
                            }} />
                          </View>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                            <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Isolation</Text>
                            <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Compound</Text>
                          </View>
                        </View>
                      </View>

                      <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 }}>
                          Signal Drivers
                        </Text>
                        {(readiness.drivers ?? []).map((d, i) => (
                          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
                            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.textSecondary }} />
                            <Text style={{ fontSize: 13, fontFamily: "Rubik_400Regular", color: Colors.textSecondary }}>{d}</Text>
                          </View>
                        ))}
                      </View>

                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10, marginTop: 10 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>
                          Recommended Intensity
                        </Text>
                        <Text style={{
                          fontSize: 13, fontFamily: "Rubik_700Bold",
                          color: tierColor,
                        }}>
                          {tier === "GREEN" ? "HIGH (heavy compounds)" : tier === "BLUE" ? "LOW (deload/pump)" : "MEDIUM (normal hypertrophy)"}
                        </Text>
                      </View>
                    </View>
                  );
                })()}

                {readinessHistory.length >= 2 && (
                  <View style={[styles.lgrCard, { marginTop: 12 }]}>
                    <Text style={[styles.lgrLabel, { marginBottom: 8 }]}>Readiness Trend (14d)</Text>
                    <WeightChart
                      data={readinessHistory.map(h => ({ day: h.date, avg: h.readinessScore ?? 0 }))}
                      lineColor="#34D399"
                    />
                  </View>
                )}

                {(() => {
                  const insufficientData = readiness.gate === "NONE" || (readiness.daysInWindow ?? 0) < 7;
                  const needsMoreFor28d = (readiness.daysInWindow ?? 0) < 28;
                  const sb = readiness.sleepBlock;
                  const sa = sb?.sleepAlignment;
                  const adh = readiness.adherence;
                  const pd = readiness.primaryDriver;
                  const hasAlignment = sa?.alignmentScore != null;
                  const hasAdequacy = sb?.sleepAdequacyScore != null;
                  const shortfallStr = sa?.shortfallMin != null && sa.shortfallMin > 0 ? ` (+${sa.shortfallMin}m)` : "";
                  const confGradeVal = readiness.confidenceBreakdown?.grade ?? readiness.confidenceGrade ?? "None";

                  const sigRow = (label: string, valueEl: React.ReactNode, last = false) => (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: Colors.border }) }}>
                      <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>{label}</Text>
                      {valueEl}
                    </View>
                  );

                  const sigText = (val: string, color: string) => (
                    <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color }}>{val}</Text>
                  );

                  const sectionHeader = (title: string, icon: string, color: string) => (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, marginBottom: 6 }}>
                      <Ionicons name={icon as any} size={14} color={color} />
                      <Text style={{ fontSize: 10, fontFamily: "Rubik_700Bold", color, textTransform: "uppercase" as const, letterSpacing: 1 }}>{title}</Text>
                    </View>
                  );

                  return (
                  <View style={[styles.lgrCard, { marginTop: 12 }]}>
                    <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 }}>
                      Signal Breakdown
                    </Text>

                    {pd && (
                      <View style={{ backgroundColor: "#FBBF2410", borderRadius: 10, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                        <Ionicons name="alert-circle" size={18} color="#FBBF24" style={{ marginTop: 1 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_700Bold", color: "#FBBF24", textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
                            Primary Driver: {pd.driver}
                          </Text>
                          <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, marginTop: 2 }}>
                            {pd.recommendation}
                          </Text>
                        </View>
                      </View>
                    )}

                    {insufficientData && (
                      <View style={{ backgroundColor: "#60A5FA12", borderRadius: 8, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="information-circle" size={16} color="#60A5FA" />
                        <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: "#60A5FA", flex: 1 }}>
                          Not enough data to compute deltas (need 7d rolling + 28d baseline)
                        </Text>
                      </View>
                    )}
                    {!insufficientData && needsMoreFor28d && (
                      <View style={{ backgroundColor: "#FBBF2412", borderRadius: 8, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="information-circle" size={16} color="#FBBF24" />
                        <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: "#FBBF24", flex: 1 }}>
                          Partial baselines ({readiness.daysInWindow ?? 0}d / 28d) - deltas may shift
                        </Text>
                      </View>
                    )}

                    {sectionHeader("Discipline / Adherence", "checkbox-outline", "#818CF8")}

                    {sigRow("Alignment", sigText(
                      hasAlignment ? `${sa!.alignmentScore} / 100` : "\u2014 no observed times",
                      hasAlignment ? (sa!.alignmentScore! >= 80 ? "#34D399" : sa!.alignmentScore! >= 50 ? "#FBBF24" : "#EF4444") : Colors.textTertiary,
                    ))}

                    {hasAlignment && sigRow("Timing", sigText(sa!.deviationLabel, Colors.textSecondary))}

                    {sigRow("Bedtime drift",
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: (adh?.bedtimeDriftLateNights7d ?? 0) >= 3 ? "#EF4444" : Colors.textSecondary }}>
                          {adh?.bedtimeDriftLateNights7d ?? 0} late / 7d
                        </Text>
                        {(adh?.bedtimeDriftLateNights7d ?? 0) >= 3 && (
                          <View style={{ backgroundColor: "#EF444420", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ fontSize: 9, fontFamily: "Rubik_700Bold", color: "#EF4444" }}>DRIFT</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {sigRow("Wake drift",
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: (adh?.wakeDriftEarlyNights7d ?? 0) >= 3 ? "#EF4444" : Colors.textSecondary }}>
                          {adh?.wakeDriftEarlyNights7d ?? 0} early / 7d
                        </Text>
                        {(adh?.wakeDriftEarlyNights7d ?? 0) >= 3 && (
                          <View style={{ backgroundColor: "#EF444420", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ fontSize: 9, fontFamily: "Rubik_700Bold", color: "#EF4444" }}>EARLY</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {sigRow("Cardio adherence", (() => {
                      const actual = adh?.actualCardioMin;
                      const planned = adh?.plannedCardioMin ?? 40;
                      if (actual == null) return sigText("Not logged", Colors.textTertiary);
                      const diff = actual - planned;
                      const diffStr = diff > 0 ? `+${diff}m` : diff < 0 ? `${diff}m` : "0m";
                      const color = Math.abs(diff) <= 5 ? "#34D399" : diff > 0 ? "#EF4444" : "#FBBF24";
                      return (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>{actual}</Text>
                          <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>/ {planned}m</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color }}>({diffStr})</Text>
                        </View>
                      );
                    })())}

                    {sigRow("Lift adherence", (() => {
                      const actual = adh?.actualLiftMin;
                      const planned = adh?.plannedLiftMin ?? 75;
                      if (actual == null) return sigText("Not logged", Colors.textTertiary);
                      const diff = actual - planned;
                      const diffStr = diff > 0 ? `+${diff}m` : diff < 0 ? `${diff}m` : "0m";
                      const color = Math.abs(diff) <= 5 ? "#34D399" : diff > 0 ? "#EF4444" : "#FBBF24";
                      return (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>{actual}</Text>
                          <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>/ {planned}m</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color }}>({diffStr})</Text>
                        </View>
                      );
                    })())}

                    {sigRow("Meal timing",
                      sigText(
                        readiness.placeholders?.mealTimingTracked ? "Tracked" : "Not tracked",
                        Colors.textTertiary,
                      ),
                      true,
                    )}

                    {sectionHeader("Sleep Outcome", "moon-outline", "#60A5FA")}

                    {sigRow("Adequacy", sigText(
                      hasAdequacy ? `${sb!.sleepAdequacyScore} / 100${shortfallStr}` : "\u2014 no sleep data",
                      hasAdequacy ? (sb!.sleepAdequacyScore! >= 90 ? "#34D399" : sb!.sleepAdequacyScore! >= 70 ? "#FBBF24" : "#EF4444") : Colors.textTertiary,
                    ))}

                    {sigRow("Sleep delta", sigText(
                      insufficientData ? "\u2014" : (readiness.deltas?.sleep_str ?? "\u2014"),
                      insufficientData ? "#6B7280" : ((readiness.deltas?.sleep_pct ?? 0) >= 0 ? "#34D399" : "#EF4444"),
                    ))}

                    {(() => {
                      const eff = sb?.sleepEfficiency ?? sb?.sleepEfficiencyEst ?? null;
                      return eff != null ? sigRow("Efficiency", sigText(
                        `${Math.round(eff * 100)}%${sb?.fitbitVsReportedDeltaMin != null ? ` (Fitbit ${sb!.fitbitVsReportedDeltaMin! > 0 ? "+" : ""}${sb!.fitbitVsReportedDeltaMin}m)` : ""}`,
                        eff >= 0.85 ? "#34D399" : eff >= 0.70 ? "#FBBF24" : "#EF4444",
                      ), sb?.awakeInBedMin == null) : null;
                    })()}

                    {sb?.awakeInBedMin != null && sigRow("Awake in bed", sigText(
                      `${sb.awakeInBedMin}m`,
                      sb.awakeInBedMin <= 30 ? "#34D399" : sb.awakeInBedMin <= 60 ? "#FBBF24" : "#EF4444",
                    ))}

                    {sb?.remMin != null && sigRow("REM", sigText(
                      `${sb.remMin}m${sb.remDeltaMin != null ? ` (${sb.remDeltaMin >= 0 ? "+" : ""}${Math.round(sb.remDeltaMin)}m)` : ""}`,
                      sb.remDeltaMin == null ? "#9CA3AF" : sb.remDeltaMin >= -5 ? "#34D399" : sb.remDeltaMin >= -15 ? "#FBBF24" : "#EF4444",
                    ))}

                    {sb?.deepMin != null && sigRow("Deep", sigText(
                      `${sb.deepMin}m${sb.deepDeltaMin != null ? ` (${sb.deepDeltaMin >= 0 ? "+" : ""}${Math.round(sb.deepDeltaMin)}m)` : ""}`,
                      sb.deepDeltaMin == null ? "#9CA3AF" : sb.deepDeltaMin >= -5 ? "#34D399" : sb.deepDeltaMin >= -15 ? "#FBBF24" : "#EF4444",
                    ), true)}

                    {sectionHeader("System State", "pulse-outline", "#34D399")}

                    {sigRow("HRV", sigText(
                      insufficientData ? "\u2014" : `${readiness.deltas?.hrv_str ?? "\u2014"} vs baseline`,
                      insufficientData ? "#6B7280" : ((readiness.deltas?.hrv_pct ?? 0) >= 0 ? "#34D399" : "#EF4444"),
                    ))}

                    {sigRow("RHR", sigText(
                      insufficientData ? "\u2014" : `${readiness.deltas?.rhr_str ?? "\u2014"} vs baseline`,
                      insufficientData ? "#6B7280" : ((readiness.deltas?.rhr_bpm ?? 0) <= 0 ? "#34D399" : "#EF4444"),
                    ))}

                    {sigRow("Proxy", sigText(
                      insufficientData ? "\u2014" : `${readiness.deltas?.proxy_str ?? "\u2014"} vs baseline`,
                      insufficientData ? "#6B7280" : ((readiness.deltas?.proxy_pct ?? 0) >= 0 ? "#34D399" : "#EF4444"),
                    ))}

                    {sigRow("Confidence", sigText(
                      `${confGradeVal} (${readiness.confidenceBreakdown?.measured_7d ?? 0} / 7d)`,
                      confGradeVal === "High" ? "#34D399" : confGradeVal === "Med" ? "#FBBF24" : "#EF4444",
                    ), true)}
                  </View>
                  );
                })()}

                {readiness.gate !== "NONE" && (() => {
                  const score = readiness.readinessScore ?? 0;
                  const confGrade = readiness.confidenceBreakdown?.grade ?? readiness.confidenceGrade ?? "None";
                  const confOk = confGrade === "High" || confGrade === "Med";
                  let ruleTitle = "Pump / Technique";
                  let ruleDesc = "Isolation focus / easy volume / skill work";
                  let ruleColor = "#60A5FA";
                  let ruleIcon: "snow" | "pause-circle" | "flash" = "snow";
                  if (score >= 65 && confOk) {
                    ruleTitle = "High Neural Day";
                    ruleDesc = "Heavy compounds / lower reps / longer rest";
                    ruleColor = "#34D399";
                    ruleIcon = "flash";
                  } else if (score >= 45) {
                    ruleTitle = "Moderate";
                    ruleDesc = "Controlled compounds + machines / moderate reps";
                    ruleColor = "#FBBF24";
                    ruleIcon = "pause-circle";
                  }
                  return (
                    <View style={[styles.lgrCard, { marginTop: 12, borderColor: ruleColor + "30" }]}>
                      <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 10 }}>
                        Today's Training Rule
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: ruleColor + "20", alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name={ruleIcon} size={18} color={ruleColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16, fontFamily: "Rubik_700Bold", color: ruleColor }}>{ruleTitle}</Text>
                          <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, marginTop: 2 }}>{ruleDesc}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })()}
              </View>
            )}

            {kcalAdj != null ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Calorie Recommendation</Text>
                <AdjustmentCard adjustments={adjustments} kcalChange={kcalAdj} />
              </View>
            ) : null}

            {kcalAdj != null ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Meal Adjustment Guide</Text>
                <MealAdjustmentGuide adjustments={adjustments} kcalChange={kcalAdj} />
              </View>
            ) : null}

            {(() => {
              const last7 = entries.slice(-7);
              const fuelNotes = last7
                .filter((e) => e.cardioMin != null)
                .map((e) => ({ day: e.day, note: cardioFuelNote(e.cardioMin, BASELINE) }))
                .filter((n) => n.note != null);
              if (fuelNotes.length === 0) return null;
              return (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Cardio Fuel Guardrail</Text>
                  <View style={styles.fuelCard}>
                    {fuelNotes.map((fn) => (
                      <View key={fn.day} style={styles.fuelRow}>
                        <View style={styles.fuelDot}>
                          <Feather name="zap" size={12} color={Colors.secondary} />
                        </View>
                        <View style={styles.fuelContent}>
                          <Text style={styles.fuelDay}>{fn.day}</Text>
                          <Text style={styles.fuelText}>{fn.note}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })()}

            {proxyData.length >= 2 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Androgen Proxy Trend</Text>
                <View style={styles.lgrCard}>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={[styles.lgrLabel, { marginBottom: 4 }]}>
                      7-day Rolling Average {proxyImputed ? "(incl. imputed)" : "(measured only)"}
                    </Text>
                    <Text style={{ fontSize: 28, fontFamily: "Rubik_700Bold", color: "#8B5CF6" }}>
                      {proxyData[proxyData.length - 1]?.proxy7dAvg?.toFixed(1) ?? proxyData[proxyData.length - 1]?.proxyScore?.toFixed(1) ?? "--"}
                    </Text>
                  </View>
                  <WeightChart
                    data={proxyData.slice(-21).map(d => ({ day: d.date, avg: d.proxy7dAvg ?? d.proxyScore ?? 0 }))}
                    lineColor="#8B5CF6"
                  />
                  <Pressable
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border }}
                    onPress={() => setProxyImputed(!proxyImputed)}
                  >
                    <Ionicons
                      name={proxyImputed ? "checkbox" : "square-outline"}
                      size={20}
                      color={proxyImputed ? "#FBBF24" : Colors.textTertiary}
                    />
                    <Text style={{ fontSize: 14, color: proxyImputed ? "#FBBF24" : Colors.textSecondary, fontFamily: "Rubik_400Regular" }}>
                      Include imputed data
                    </Text>
                  </Pressable>
                </View>

                {confidence.length > 0 && (
                  <View style={[styles.lgrCard, { marginTop: 12 }]}>
                    <Text style={[styles.lgrLabel, { marginBottom: 10 }]}>Data Confidence</Text>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      {confidence.map((c) => {
                        const gradeColor = c.grade === "High" ? "#34D399" : c.grade === "Med" ? "#FBBF24" : c.grade === "Low" ? "#EF4444" : Colors.textTertiary;
                        return (
                          <View key={c.window} style={{ flex: 1, alignItems: "center", gap: 6, paddingVertical: 8, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 6 }}>
                            <Text style={{ fontSize: 14, fontWeight: "700" as const, color: Colors.text, letterSpacing: 0.5 }}>{c.window}</Text>
                            <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, borderWidth: 1, backgroundColor: gradeColor + "20", borderColor: gradeColor + "40" }}>
                              <Text style={{ fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.3, color: gradeColor }}>{c.grade}</Text>
                            </View>
                            <View style={{ flexDirection: "row", gap: 6 }}>
                              <Text style={{ fontSize: 13, fontWeight: "600" as const, color: "#34D399" }}>{c.measured}M</Text>
                              <Text style={{ fontSize: 13, fontWeight: "600" as const, color: "#FBBF24" }}>{c.imputed}I</Text>
                              {c.multiNight > 0 && <Text style={{ fontSize: 13, fontWeight: "600" as const, color: Colors.textTertiary }}>{c.multiNight}C</Text>}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Adjustment Priority</Text>
              <View style={styles.priorityCard}>
                <Text style={styles.prioritySubtitle}>
                  When adjusting calories, ingredients are modified in this order (least disruptive first):
                </Text>
                {BASELINE.adjustPriority.map((item, i) => (
                  <View key={item} style={styles.priorityRow}>
                    <View style={styles.priorityNum}>
                      <Text style={styles.priorityNumText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.priorityName}>{ITEM_LABELS[item] || item}</Text>
                    <Text style={styles.priorityNote}>
                      {item === "mct_g" ? "fat-only" :
                       item === "dextrin_g" ? "fast carb" :
                       item === "oats_g" ? "slow carb" :
                       item === "bananas" ? "carbs + micros" :
                       item === "eggs" ? "protein + fat" :
                       item === "flax_g" ? "fiber + fat" :
                       item === "whey_g" ? "protein anchor" :
                       "protein anchor"}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  baselineCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  baselineRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  baselineStat: {
    alignItems: "center",
  },
  baselineLabel: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  baselineValue: {
    fontSize: 20,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  baselineUnit: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginTop: 1,
  },
  baselineDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.border,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginBottom: 12,
  },
  chartWrapper: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  chartContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chartYAxis: {
    justifyContent: "space-between",
    height: 120,
    width: 40,
  },
  chartAxisLabel: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    textAlign: "right",
  },
  metricsGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricLabel: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 28,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  metricUnit: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginTop: 2,
  },
  targetBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  targetBadgeGood: {
    backgroundColor: Colors.successMuted,
  },
  targetBadgeOff: {
    backgroundColor: Colors.surface,
  },
  targetBadgeText: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
  },
  targetBadgeTextGood: {
    color: Colors.success,
  },
  targetBadgeTextOff: {
    color: Colors.textTertiary,
  },
  diagCard: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  diagHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  diagTitle: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
  },
  diagMessage: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  adjustCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  adjustHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  adjustTitle: {
    fontSize: 18,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  adjustSubtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  tweakList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  tweakHeader: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tweakRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tweakLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tweakRight: {
    alignItems: "flex-end",
  },
  tweakName: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
  },
  tweakAmount: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
  },
  tweakKcal: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginTop: 1,
  },
  priorityCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  prioritySubtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  priorityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  priorityNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  priorityNumText: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textSecondary,
  },
  priorityName: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
    flex: 1,
  },
  priorityNote: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  lgrCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  lgrTop: {
    gap: 12,
  },
  lgrGauge: {
    alignItems: "center",
  },
  lgrLabel: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
  },
  lgrValue: {
    fontSize: 36,
    fontFamily: "Rubik_700Bold",
    marginVertical: 4,
  },
  lgrHint: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
  },
  lgrBar: {
    gap: 4,
  },
  lgrBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.surface,
    overflow: "hidden" as const,
  },
  lgrBarFill: {
    height: 8,
    borderRadius: 4,
  },
  lgrBarLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  lgrBarLabel: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  fuelCard: {
    backgroundColor: Colors.secondaryMuted,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.secondary + "30",
  },
  fuelRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  fuelDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.secondary + "25",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  fuelContent: {
    flex: 1,
  },
  fuelDay: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.secondary,
    marginBottom: 2,
  },
  fuelText: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});

const mealGuideStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden" as const,
  },
  summaryBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.primaryMuted,
  },
  summaryText: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.primary,
    flex: 1,
  },
  deltaSummary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  deltaSummaryLabel: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  deltaSummaryValue: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
  },
  mealsContainer: {
    padding: 10,
    gap: 8,
  },
  mealCard: {
    backgroundColor: Colors.cardBgElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden" as const,
  },
  mealHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  mealHeaderLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    flex: 1,
  },
  mealTime: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textTertiary,
  },
  mealLabel: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  adjustedFlag: {
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  changedBadgeText: {
    fontSize: 11,
    fontFamily: "Rubik_700Bold",
    letterSpacing: 0.5,
  },
  zoneBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  zoneBadgeText: {
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    letterSpacing: 0.3,
  },
  ingredientList: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ingredientRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 3,
  },
  ingredientLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  ingredientDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ingredientName: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  ingredientRight: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  ingredientBaseline: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  ingredientAdjusted: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
  },
  ingredientDelta: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
  },
  ingredientUnchanged: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
});
