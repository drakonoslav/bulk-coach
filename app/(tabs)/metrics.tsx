import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getProfile, getAge, getDaysSince, formatBirthdayDisplay, type UserProfile } from "@/lib/profile";
import { getApiUrl, authFetch } from "@/lib/query-client";

const BG      = "#0A0A0F";
const CARD    = "#13131A";
const CARD2   = "#1A1A24";
const BORDER  = "rgba(255,255,255,0.08)";
const TEAL    = "#00D4AA";
const PURPLE  = "#8B5CF6";
const TEXT    = "#FFFFFF";
const MUTED   = "rgba(255,255,255,0.45)";
const AMBER   = "#F59E0B";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function avatarLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

interface QuickMetrics {
  weight: string;
  waist: string;
  notes: string;
}

const EMPTY: QuickMetrics = { weight: "", waist: "", notes: "" };

interface TodayLog {
  morning_weight_lb?: number | null;
  waist_in?: number | null;
  notes?: string | null;
}

export default function MetricsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile]   = useState<UserProfile | null>(null);
  const [metrics, setMetrics]   = useState<QuickMetrics>(EMPTY);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [loading, setLoading]   = useState(true);
  const [trend, setTrend]       = useState<{ avgWeight: number | null; avgWaist: number | null }>({ avgWeight: null, avgWaist: null });

  const date = todayStr();

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [])
  );

  async function loadAll() {
    setLoading(true);
    const p = await getProfile();
    setProfile(p);
    if (!p) { setLoading(false); return; }

    try {
      const baseUrl = getApiUrl();
      // Load today's log
      const todayRes = await authFetch(new URL(`/api/logs/${date}`, baseUrl).toString());
      if (todayRes.ok) {
        const log: TodayLog = await todayRes.json();
        setMetrics({
          weight: log.morning_weight_lb != null ? String(log.morning_weight_lb) : "",
          waist:  log.waist_in != null ? String(log.waist_in) : "",
          notes:  log.notes ?? "",
        });
      }

      // Load recent logs for trend
      const logsRes = await authFetch(new URL("/api/logs?limit=7", baseUrl).toString());
      if (logsRes.ok) {
        const logs: Array<{ morning_weight_lb?: number | null; waist_in?: number | null }> = await logsRes.json();
        const weights = logs.map(l => l.morning_weight_lb).filter((v): v is number => v != null);
        const waists  = logs.map(l => l.waist_in).filter((v): v is number => v != null);
        setTrend({
          avgWeight: weights.length ? +(weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(1) : null,
          avgWaist:  waists.length  ? +(waists.reduce((a, b) => a + b, 0)  / waists.length).toFixed(1)  : null,
        });
      }
    } catch {}
    setLoading(false);
  }

  async function save() {
    if (!metrics.weight && !metrics.waist && !metrics.notes) {
      Alert.alert("Nothing to save", "Enter at least one value.");
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const baseUrl = getApiUrl();

      // PATCH only the fields provided — preserves everything else in the row
      const body: Record<string, unknown> = { day: date };
      if (metrics.weight) body.morning_weight_lb = parseFloat(metrics.weight);
      if (metrics.waist)  body.waist_in          = parseFloat(metrics.waist);
      if (metrics.notes !== undefined) body.notes = metrics.notes;

      const res = await authFetch(new URL("/api/logs/quick-patch", baseUrl).toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        loadAll();
      } else {
        Alert.alert("Error", "Save failed. Try again.");
      }
    } catch {
      Alert.alert("Error", "Network error.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={TEAL} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center", padding: 32 }]}>
        <Ionicons name="person-circle-outline" size={56} color={MUTED} />
        <Text style={[styles.muted, { marginTop: 12, textAlign: "center" }]}>No profile found.{"\n"}Restart the app to set one up.</Text>
      </View>
    );
  }

  const age        = getAge(profile.birthday);
  const daysSince  = getDaysSince(profile.createdAt);
  const bdayStr    = formatBirthdayDisplay(profile.birthday);
  const initial    = avatarLetter(profile.username);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const botPad = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: botPad + 24 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Profile Card ── */}
      <View style={styles.profileCard}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{profile.username}</Text>
          <Text style={styles.profileMeta}>Age {age} · Born {bdayStr}</Text>
          <Text style={[styles.profileMeta, { color: TEAL, marginTop: 2 }]}>
            Day {daysSince + 1} in the system
          </Text>
        </View>
      </View>

      {/* ── Workbook shortcut ── */}
      <TouchableOpacity
        style={styles.workbookBtn}
        onPress={() => router.push("/workbook" as any)}
        activeOpacity={0.75}
      >
        <Ionicons name="document-text-outline" size={18} color={TEAL} />
        <Text style={styles.workbookBtnText}>Workbooks</Text>
        <Ionicons name="chevron-forward" size={16} color={MUTED} style={{ marginLeft: "auto" }} />
      </TouchableOpacity>

      {/* ── Today header ── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Today</Text>
        <Text style={styles.sectionDate}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </Text>
      </View>

      {/* ── Quick entry ── */}
      <View style={styles.card}>
        <View style={styles.inputRow}>
          {/* Weight */}
          <View style={styles.inputBlock}>
            <Text style={styles.inputLabel}>Weight</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.numInput}
                placeholder="—"
                placeholderTextColor={MUTED}
                value={metrics.weight}
                onChangeText={v => setMetrics(m => ({ ...m, weight: v }))}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <Text style={styles.unit}>lbs</Text>
            </View>
          </View>

          <View style={styles.inputDivider} />

          {/* Waist */}
          <View style={styles.inputBlock}>
            <Text style={styles.inputLabel}>Waist</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.numInput}
                placeholder="—"
                placeholderTextColor={MUTED}
                value={metrics.waist}
                onChangeText={v => setMetrics(m => ({ ...m, waist: v }))}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <Text style={styles.unit}>in</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        <Text style={[styles.inputLabel, { marginTop: 16, marginBottom: 6 }]}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="How are you feeling today?"
          placeholderTextColor={MUTED}
          value={metrics.notes}
          onChangeText={v => setMetrics(m => ({ ...m, notes: v }))}
          multiline
          numberOfLines={3}
          returnKeyType="default"
        />

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color="#000" size="small" />
          ) : saved ? (
            <>
              <Ionicons name="checkmark" size={18} color="#000" />
              <Text style={styles.saveBtnText}>Saved</Text>
            </>
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color="#000" />
              <Text style={styles.saveBtnText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── 7-day trend ── */}
      {(trend.avgWeight != null || trend.avgWaist != null) && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 24, marginBottom: 12 }]}>7-Day Averages</Text>
          <View style={styles.trendRow}>
            {trend.avgWeight != null && (
              <View style={styles.trendCard}>
                <Text style={styles.trendValue}>{trend.avgWeight}</Text>
                <Text style={styles.trendUnit}>lbs</Text>
                <Text style={styles.trendLabel}>Weight</Text>
              </View>
            )}
            {trend.avgWaist != null && (
              <View style={[styles.trendCard, { borderColor: PURPLE + "40" }]}>
                <Text style={[styles.trendValue, { color: PURPLE }]}>{trend.avgWaist}</Text>
                <Text style={[styles.trendUnit, { color: PURPLE }]}>in</Text>
                <Text style={styles.trendLabel}>Waist</Text>
              </View>
            )}
          </View>
        </>
      )}

      {/* ── Age milestones ── */}
      <View style={styles.card2}>
        <Ionicons name="calendar-outline" size={16} color={AMBER} style={{ marginBottom: 8 }} />
        <Text style={styles.milestoneLine}>
          Next birthday in{" "}
          <Text style={{ color: AMBER }}>{daysToNextBirthday(profile.birthday)} days</Text>
          {" "}— turning {age + 1}
        </Text>
      </View>
    </ScrollView>
  );
}

function daysToNextBirthday(birthday: string): number {
  const today = new Date();
  const [, m, d] = birthday.split("-").map(Number);
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next <= today) next = new Date(today.getFullYear() + 1, m - 1, d);
  return Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 16 },

  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.2)",
    padding: 20,
    marginBottom: 24,
    gap: 16,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(0,212,170,0.15)",
    borderWidth: 2,
    borderColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontFamily: "Rubik_700Bold",
    fontSize: 26,
    color: TEAL,
  },
  profileName: {
    fontFamily: "Rubik_700Bold",
    fontSize: 22,
    color: TEXT,
  },
  profileMeta: {
    fontFamily: "Rubik_400Regular",
    fontSize: 13,
    color: MUTED,
    marginTop: 2,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: "Rubik_600SemiBold",
    fontSize: 16,
    color: TEXT,
  },
  sectionDate: {
    fontFamily: "Rubik_400Regular",
    fontSize: 13,
    color: MUTED,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
  },
  card2: {
    backgroundColor: CARD2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.2)",
    padding: 16,
    marginTop: 16,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  inputBlock: {
    flex: 1,
  },
  inputDivider: {
    width: 1,
    height: 50,
    backgroundColor: BORDER,
    marginHorizontal: 16,
  },
  inputLabel: {
    fontFamily: "Rubik_500Medium",
    fontSize: 11,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  numInput: {
    fontFamily: "Rubik_600SemiBold",
    fontSize: 28,
    color: TEXT,
    minWidth: 80,
  },
  unit: {
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    color: MUTED,
  },
  notesInput: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT,
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    padding: 12,
    minHeight: 70,
    textAlignVertical: "top",
  },
  saveBtn: {
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 16,
  },
  saveBtnText: {
    fontFamily: "Rubik_700Bold",
    fontSize: 15,
    color: "#000",
  },

  trendRow: {
    flexDirection: "row",
    gap: 12,
  },
  trendCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.25)",
    padding: 16,
    alignItems: "center",
  },
  trendValue: {
    fontFamily: "Rubik_700Bold",
    fontSize: 28,
    color: TEAL,
  },
  trendUnit: {
    fontFamily: "Rubik_400Regular",
    fontSize: 13,
    color: TEAL,
    marginBottom: 2,
  },
  trendLabel: {
    fontFamily: "Rubik_400Regular",
    fontSize: 12,
    color: MUTED,
  },

  milestoneLine: {
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    color: MUTED,
    lineHeight: 20,
  },
  muted: {
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    color: MUTED,
  },
  workbookBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: CARD,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.2)",
    marginBottom: 16,
  },
  workbookBtnText: {
    fontFamily: "Rubik_600SemiBold",
    fontSize: 15,
    color: TEXT,
  },
});
