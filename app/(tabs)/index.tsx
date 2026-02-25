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
import { Ionicons, Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { loadEntries } from "@/lib/entry-storage";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { fmtVal, fmtInt, fmtDelta, fmtPctVal } from "@/lib/format";
import SignalCharts from "@/components/SignalCharts";
import {
  DailyEntry,
  rollingAvg,
  weeklyDelta,
  waistDelta,
  getCurrentAvgWeight,
  getWeightTrend,
  getSleepHours,
  getLeanMassLb,
  leanMassRollingAvg,
  formatDate,
  BASELINE,
} from "@/lib/coaching-engine";

function MiniChart({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const height = 40;
  const width = 120;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * height,
  }));

  return (
    <View style={{ width, height, marginTop: 4 }}>
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
              height: 2,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: "left center",
            }}
          />
        );
      })}
      <View
        style={{
          position: "absolute",
          left: points[points.length - 1].x - 3,
          top: points[points.length - 1].y - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function StatCard({
  icon,
  iconColor,
  label,
  value,
  subtitle,
  chart,
}: {
  icon: string;
  iconColor: string;
  label: string;
  value: string;
  subtitle?: string;
  chart?: React.ReactNode;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <View style={[styles.statIconWrap, { backgroundColor: iconColor + "20" }]}>
          <Ionicons name={icon as any} size={16} color={iconColor} />
        </View>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
      {subtitle ? <Text style={styles.statSubtitle}>{subtitle}</Text> : null}
      {chart}
    </View>
  );
}

function EntryRow({ entry }: { entry: DailyEntry }) {
  const sleep = getSleepHours(entry);
  return (
    <View style={styles.entryRow}>
      <View style={styles.entryDate}>
        <Text style={styles.entryDateText}>{formatDate(entry.day)}</Text>
      </View>
      <View style={styles.entryDetails}>
        <View style={styles.entryPill}>
          <Feather name="activity" size={12} color={Colors.primary} />
          <Text style={styles.entryPillText}>{entry.morningWeightLb} lb</Text>
        </View>
        {entry.liftDone ? (
          <View style={[styles.entryPill, { backgroundColor: Colors.successMuted }]}>
            <Ionicons name="barbell-outline" size={12} color={Colors.success} />
            <Text style={[styles.entryPillText, { color: Colors.success }]}>Lift</Text>
          </View>
        ) : null}
        {sleep != null ? (
          <View style={[styles.entryPill, { backgroundColor: Colors.secondaryMuted }]}>
            <Ionicons name="moon-outline" size={12} color={Colors.secondary} />
            <Text style={[styles.entryPillText, { color: Colors.secondary }]}>{sleep}h</Text>
          </View>
        ) : null}
        {entry.bfMorningPct != null ? (
          <View style={[styles.entryPill, { backgroundColor: "rgba(167, 139, 250, 0.15)" }]}>
            <Ionicons name="body-outline" size={12} color="#A78BFA" />
            <Text style={[styles.entryPillText, { color: "#A78BFA" }]}>{fmtPctVal(entry.bfMorningPct, 1)}</Text>
          </View>
        ) : null}
        {entry.adherence != null && entry.adherence < 1 ? (
          <View style={[styles.entryPill, { backgroundColor: Colors.dangerMuted }]}>
            <Ionicons name="alert-circle-outline" size={12} color={Colors.danger} />
            <Text style={[styles.entryPillText, { color: Colors.danger }]}>{Math.round(entry.adherence * 100)}%</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface SignalPoint {
  date: string;
  hpa: number | null;
  hrvDeltaPct: number | null;
  readiness: number | null;
  strengthVelocity: number | null;
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [signalPoints, setSignalPoints] = useState<SignalPoint[]>([]);
  const [signalDays, setSignalDays] = useState(30);

  const fetchSignals = useCallback(async (days: number) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/signals/chart", baseUrl);
      url.searchParams.set("days", String(days));
      const res = await authFetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setSignalPoints(data.points || []);
      }
    } catch {}
  }, []);

  const fetchEntries = useCallback(async () => {
    const data = await loadEntries();
    setEntries(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchEntries();
      fetchSignals(signalDays);
    }, [fetchEntries, fetchSignals, signalDays])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchEntries(), fetchSignals(signalDays)]);
    setRefreshing(false);
  }, [fetchEntries, fetchSignals, signalDays]);

  const handleRangeChange = useCallback((days: number) => {
    setSignalDays(days);
    fetchSignals(days);
  }, [fetchSignals]);

  const avgWeight = getCurrentAvgWeight(entries);
  const wkDelta = weeklyDelta(entries);
  const trend = getWeightTrend(entries);
  const wDelta = waistDelta(entries);
  const ra = rollingAvg(entries, 7);
  const chartData = ra.slice(-14).map((r) => r.avg);

  const lmRa = leanMassRollingAvg(entries, 7);
  const lmChartData = lmRa.slice(-14).map((r) => r.avg);
  const latestLm = lmRa.length > 0 ? lmRa[lmRa.length - 1].avg : null;
  const latestBf = [...entries].reverse().find((e) => e.bfMorningPct != null)?.bfMorningPct ?? null;

  const recentEntries = [...entries].reverse().slice(0, 7);

  const trendIcon = trend === "up" ? "arrow-up" : trend === "down" ? "arrow-down" : "remove";
  const trendColor = trend === "up" ? Colors.success : trend === "down" ? Colors.danger : Colors.textSecondary;

  const recentWithAdh = entries.slice(-7).filter(e => e.adherence != null);
  const avgAdherence = recentWithAdh.length > 0
    ? recentWithAdh.reduce((s, e) => s + e.adherence!, 0) / recentWithAdh.length
    : null;

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: topInset + 16, paddingBottom: Platform.OS === "web" ? 84 + 34 : insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>Bulk Coach</Text>
          <Text style={styles.subGreeting}>
            {entries.length > 0 ? `${entries.length} days tracked` : "Start logging to see insights"}
          </Text>
        </View>

        <SignalCharts
          points={signalPoints}
          rangeDays={signalDays}
          onRangeChange={handleRangeChange}
        />

        <View style={styles.heroCard}>
          <View style={styles.heroLeft}>
            <Text style={styles.heroLabel}>7-Day Average</Text>
            <Text style={styles.heroWeight}>
              {fmtVal(avgWeight, 1)}
              <Text style={styles.heroUnit}> lb</Text>
            </Text>
            {wkDelta != null ? (
              <View style={styles.heroTrend}>
                <Ionicons name={trendIcon as any} size={14} color={trendColor} />
                <Text style={[styles.heroTrendText, { color: trendColor }]}>
                  {fmtDelta(wkDelta, 2, " lb/wk")}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.heroRight}>
            <MiniChart data={chartData} color={Colors.primary} />
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatCard
            icon="fitness-outline"
            iconColor={Colors.primary}
            label="Baseline"
            value={fmtInt(BASELINE.calories, "--")}
            subtitle="kcal/day"
          />
          <StatCard
            icon="resize-outline"
            iconColor={Colors.secondary}
            label="Waist"
            value={wDelta != null ? `${fmtDelta(wDelta, 2, '"')}` : "--"}
            subtitle="14-day change"
          />
          <StatCard
            icon="checkmark-circle-outline"
            iconColor={Colors.success}
            label="Adherence"
            value={avgAdherence != null ? `${Math.round(avgAdherence * 100)}%` : "--"}
            subtitle="7-day avg"
          />
          <StatCard
            icon="body-outline"
            iconColor="#A78BFA"
            label="Lean Mass"
            value={fmtVal(latestLm, 1)}
            subtitle="lb (7d avg)"
            chart={<MiniChart data={lmChartData} color="#A78BFA" />}
          />
          <StatCard
            icon="analytics-outline"
            iconColor="#F472B6"
            label="Body Fat"
            value={latestBf != null ? fmtPctVal(latestBf, 1) : "--"}
            subtitle="latest AM avg"
          />
        </View>

        {entries.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Entries</Text>
            {recentEntries.map((entry) => (
              <EntryRow key={entry.day} entry={entry} />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="analytics-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No entries yet</Text>
            <Text style={styles.emptyText}>
              Log your first day to start tracking your progress
            </Text>
          </View>
        )}

        <View style={styles.macroRow}>
          <Text style={styles.sectionTitle}>Macro Targets</Text>
          <View style={styles.macroCards}>
            <View style={[styles.macroCard, { borderLeftColor: Colors.primary }]}>
              <Text style={styles.macroValue}>{BASELINE.proteinG}g</Text>
              <Text style={styles.macroLabel}>Protein</Text>
            </View>
            <View style={[styles.macroCard, { borderLeftColor: Colors.secondary }]}>
              <Text style={styles.macroValue}>{BASELINE.carbsG}g</Text>
              <Text style={styles.macroLabel}>Carbs</Text>
            </View>
            <View style={[styles.macroCard, { borderLeftColor: Colors.danger }]}>
              <Text style={styles.macroValue}>{BASELINE.fatG}g</Text>
              <Text style={styles.macroLabel}>Fat</Text>
            </View>
          </View>
        </View>
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
  greeting: {
    fontSize: 28,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
    marginBottom: 4,
  },
  subGreeting: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  heroCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroLeft: {
    flex: 1,
  },
  heroRight: {
    alignItems: "flex-end",
  },
  heroLabel: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  heroWeight: {
    fontSize: 36,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  heroUnit: {
    fontSize: 18,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  heroTrend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  heroTrendText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 14,
    width: "48%" as any,
    flexGrow: 1,
    flexBasis: "45%" as any,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  statSubtitle: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginTop: 2,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginBottom: 12,
  },
  entryRow: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  entryDate: {
    marginBottom: 6,
  },
  entryDateText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  entryDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  entryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  entryPillText: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.primary,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
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
  },
  macroRow: {
    marginBottom: 24,
  },
  macroCards: {
    flexDirection: "row",
    gap: 10,
  },
  macroCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  macroValue: {
    fontSize: 18,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  macroLabel: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
