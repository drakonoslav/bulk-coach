import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { loadEntries } from "@/lib/entry-storage";
import {
  DailyEntry,
  weeklyDelta,
  waistDelta,
  suggestCalorieAdjustment,
  proposeMacroSafeAdjustment,
  diagnoseDietVsTraining,
  cardioFuelNote,
  rollingAvg,
  BASELINE,
  ITEM_LABELS,
  ITEM_UNITS,
  type AdjustmentItem,
  type Diagnosis,
} from "@/lib/coaching-engine";

function WeightChart({ data }: { data: Array<{ day: string; avg: number }> }) {
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
                backgroundColor: Colors.primary,
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
              backgroundColor: i === points.length - 1 ? Colors.primary : Colors.cardBgElevated,
              borderWidth: 1.5,
              borderColor: Colors.primary,
            }}
          />
        ))}
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

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEntries = useCallback(async () => {
    const data = await loadEntries();
    setEntries(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchEntries();
    }, [fetchEntries])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEntries();
    setRefreshing(false);
  }, [fetchEntries]);

  const wkGain = weeklyDelta(entries);
  const wDelta = waistDelta(entries);
  const kcalAdj = wkGain != null ? suggestCalorieAdjustment(wkGain) : null;
  const adjustments = kcalAdj != null ? proposeMacroSafeAdjustment(kcalAdj, BASELINE) : [];
  const diagnosis = diagnoseDietVsTraining(entries);
  const ra = rollingAvg(entries, 7);
  const chartData = ra.slice(-21);

  const hasEnoughData = entries.length >= 7;

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

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Diagnosis</Text>
              <DiagnosisCard diagnosis={diagnosis} />
            </View>

            {kcalAdj != null ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Calorie Recommendation</Text>
                <AdjustmentCard adjustments={adjustments} kcalChange={kcalAdj} />
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
    fontSize: 10,
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
    fontSize: 10,
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
    fontSize: 10,
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
    fontSize: 11,
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
    fontSize: 11,
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
    fontSize: 10,
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
    fontSize: 13,
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
    fontSize: 12,
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
    fontSize: 11,
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
    fontSize: 13,
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
    fontSize: 12,
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
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.secondary,
    marginBottom: 2,
  },
  fuelText: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
