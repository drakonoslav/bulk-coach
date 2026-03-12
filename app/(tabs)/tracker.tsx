import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Platform,
  KeyboardAvoidingView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getApiUrl, authFetch } from "@/lib/query-client";

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_ID_KEY = "tracker_user_id";
const HISTORY_KEY_PREFIX = "tracker_history_";
const MAX_HISTORY = 90;

const TEAL = "#00D4AA";
const BG = "#0A0A0F";
const CARD = "#13131A";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.45)";
const RED = "#FF4D4D";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  date: string;
  userId: string;
  savedAt: string;
  weight?: number;
  sleepHours?: number;
  hrv?: number;
  rhr?: number;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  cardioMin?: number;
  cardioZone?: "recovery_walk" | "zone_2" | "zone_3";
  liftDone?: boolean;
  libido?: number;
  motivation?: number;
  jointFriction?: number;
  notes?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

async function getOrCreateUserId(): Promise<string> {
  const stored = await AsyncStorage.getItem(USER_ID_KEY);
  if (stored) return stored;
  const id = "usr_" + (await Crypto.randomUUID()).replace(/-/g, "").slice(0, 16);
  await AsyncStorage.setItem(USER_ID_KEY, id);
  return id;
}

function historyKey(userId: string): string {
  return `${HISTORY_KEY_PREFIX}${userId}`;
}

async function loadHistory(userId: string): Promise<LogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(historyKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveToHistory(userId: string, entry: LogEntry): Promise<LogEntry[]> {
  const existing = await loadHistory(userId);
  const filtered = existing.filter(e => e.date !== entry.date);
  const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(historyKey(userId), JSON.stringify(updated));
  return updated;
}

function buildIntelPayload(entry: LogEntry): Record<string, unknown> {
  const p: Record<string, unknown> = {
    expo_user_id: entry.userId,
    date: entry.date,
  };
  if (entry.weight != null) p.body_weight_lb = entry.weight;
  if (entry.sleepHours != null) p.sleep_duration_min = Math.round(entry.sleepHours * 60);
  if (entry.hrv != null) p.hrv_ms = entry.hrv;
  if (entry.rhr != null) p.resting_hr_bpm = entry.rhr;
  if (entry.calories != null) p.kcal_actual = entry.calories;
  if (entry.proteinG != null) p.protein_g_actual = entry.proteinG;
  if (entry.carbsG != null) p.carbs_g_actual = entry.carbsG;
  if (entry.fatG != null) p.fat_g_actual = entry.fatG;
  if (entry.cardioMin != null && entry.cardioMin > 0) {
    p.actual_cardio_mode = entry.cardioZone ?? "recovery_walk";
    if (entry.cardioZone === "zone_2") p.cardio_zone2_min = entry.cardioMin;
    else if (entry.cardioZone === "zone_3") p.cardio_zone3_min = entry.cardioMin;
  }
  if (entry.liftDone != null) {
    p.completed_lift_mode = entry.liftDone ? "hypertrophy_build" : undefined;
  }
  if (entry.libido != null) p.libido_score = entry.libido;
  if (entry.motivation != null) p.motivation_score = entry.motivation;
  if (entry.jointFriction != null) p.joint_friction_score = entry.jointFriction;
  return p;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FieldRow({
  label, value, onChangeText, placeholder = "—", keyboardType = "decimal-pad", unit,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "decimal-pad" | "number-pad" | "default";
  unit?: string;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          keyboardType={keyboardType}
        />
        {unit ? <Text style={styles.fieldUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function TapStrip({
  label, value, onChange, max = 5,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {Array.from({ length: max }, (_, i) => i + 1).map(n => (
          <TouchableOpacity
            key={n}
            onPress={() => onChange(n)}
            style={[
              styles.tapDot,
              value === n && { backgroundColor: TEAL },
            ]}
          >
            <Text style={[styles.tapDotText, value === n && { color: BG }]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function Toggle({
  label, value, onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["Yes", "No"] as const).map(opt => {
          const active = value === (opt === "Yes");
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange(opt === "Yes")}
              style={[styles.toggleBtn, active && { backgroundColor: TEAL, borderColor: TEAL }]}
            >
              <Text style={[styles.toggleText, active && { color: BG }]}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function ZoneSelector({
  value, onChange,
}: {
  value: LogEntry["cardioZone"] | undefined;
  onChange: (v: LogEntry["cardioZone"]) => void;
}) {
  const opts: { key: LogEntry["cardioZone"]; label: string }[] = [
    { key: "recovery_walk", label: "Walk" },
    { key: "zone_2", label: "Zone 2" },
    { key: "zone_3", label: "Zone 3" },
  ];
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>Zone</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {opts.map(o => {
          const active = value === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              onPress={() => onChange(o.key)}
              style={[styles.toggleBtn, active && { backgroundColor: TEAL, borderColor: TEAL }]}
            >
              <Text style={[styles.toggleText, active && { color: BG }]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function HistoryCard({ entry }: { entry: LogEntry }) {
  const parts: string[] = [];
  if (entry.weight) parts.push(`${entry.weight} lbs`);
  if (entry.sleepHours) parts.push(`${entry.sleepHours}h sleep`);
  if (entry.calories) parts.push(`${entry.calories} kcal`);
  if (entry.cardioMin) parts.push(`${entry.cardioMin}min cardio`);
  if (entry.liftDone) parts.push("lifted");
  return (
    <View style={styles.historyCard}>
      <Text style={styles.historyDate}>{formatDate(entry.date)}</Text>
      <Text style={styles.historyMeta} numberOfLines={2}>
        {parts.length ? parts.join(" · ") : "Entry saved"}
      </Text>
      {entry.notes ? (
        <Text style={styles.historyNotes} numberOfLines={2}>{entry.notes}</Text>
      ) : null}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function TrackerScreen() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string>("");
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState(todayStr());

  // Form state
  const [weight, setWeight] = useState("");
  const [sleepHours, setSleepHours] = useState("");
  const [hrv, setHrv] = useState("");
  const [rhr, setRhr] = useState("");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const [cardioMin, setCardioMin] = useState("");
  const [cardioZone, setCardioZone] = useState<LogEntry["cardioZone"]>(undefined);
  const [liftDone, setLiftDone] = useState<boolean | undefined>(undefined);
  const [libido, setLibido] = useState<number | undefined>(undefined);
  const [motivation, setMotivation] = useState<number | undefined>(undefined);
  const [jointFriction, setJointFriction] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState("");

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    (async () => {
      const id = await getOrCreateUserId();
      setUserId(id);
      const hist = await loadHistory(id);
      setHistory(hist);

      // Pre-fill from today's cached entry if it exists
      const todayEntry = hist.find(e => e.date === todayStr());
      if (todayEntry) populateForm(todayEntry);
    })();
  }, []);

  function populateForm(entry: LogEntry) {
    if (entry.weight) setWeight(String(entry.weight));
    if (entry.sleepHours) setSleepHours(String(entry.sleepHours));
    if (entry.hrv) setHrv(String(entry.hrv));
    if (entry.rhr) setRhr(String(entry.rhr));
    if (entry.calories) setCalories(String(entry.calories));
    if (entry.proteinG) setProteinG(String(entry.proteinG));
    if (entry.carbsG) setCarbsG(String(entry.carbsG));
    if (entry.fatG) setFatG(String(entry.fatG));
    if (entry.cardioMin) setCardioMin(String(entry.cardioMin));
    if (entry.cardioZone) setCardioZone(entry.cardioZone);
    if (entry.liftDone != null) setLiftDone(entry.liftDone);
    if (entry.libido) setLibido(entry.libido);
    if (entry.motivation) setMotivation(entry.motivation);
    if (entry.jointFriction) setJointFriction(entry.jointFriction);
    if (entry.notes) setNotes(entry.notes);
  }

  function buildEntry(): LogEntry {
    return {
      date,
      userId,
      savedAt: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : undefined,
      sleepHours: sleepHours ? parseFloat(sleepHours) : undefined,
      hrv: hrv ? parseFloat(hrv) : undefined,
      rhr: rhr ? parseFloat(rhr) : undefined,
      calories: calories ? parseInt(calories, 10) : undefined,
      proteinG: proteinG ? parseInt(proteinG, 10) : undefined,
      carbsG: carbsG ? parseInt(carbsG, 10) : undefined,
      fatG: fatG ? parseInt(fatG, 10) : undefined,
      cardioMin: cardioMin ? parseInt(cardioMin, 10) : undefined,
      cardioZone,
      liftDone,
      libido,
      motivation,
      jointFriction,
      notes: notes.trim() || undefined,
    };
  }

  const handleSave = useCallback(async () => {
    if (!userId) return;
    setSaving(true);
    setSaved(false);
    const entry = buildEntry();

    // 1. Save to AsyncStorage immediately (device cache — survives anything)
    const updated = await saveToHistory(userId, entry);
    setHistory(updated);

    // 2. POST to Intel (primary long-term store) — fire and don't block UX
    try {
      const payload = buildIntelPayload(entry);
      const baseUrl = getApiUrl();
      const res = await authFetch(
        new URL("/api/intel/vitals/daily-log", baseUrl).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.text();
        console.warn("[tracker] Intel POST non-2xx:", res.status, body);
      }
    } catch (err) {
      console.warn("[tracker] Intel POST failed (device saved locally):", err);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }, [userId, date, weight, sleepHours, hrv, rhr, calories, proteinG, carbsG, fatG,
      cardioMin, cardioZone, liftDone, libido, motivation, jointFriction, notes]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingTop: topPad + 12, paddingBottom: botPad + 120 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Daily Track</Text>
          <View style={styles.userBadge}>
            <Ionicons name="person-circle-outline" size={13} color={TEAL} />
            <Text style={styles.userId} numberOfLines={1}>
              {userId ? userId : "…"}
            </Text>
          </View>
        </View>

        {/* Date */}
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={15} color={MUTED} />
          <Text style={styles.dateText}>{formatDate(date)}</Text>
          {date !== todayStr() && (
            <TouchableOpacity onPress={() => setDate(todayStr())} style={styles.todayBtn}>
              <Text style={styles.todayBtnText}>Today</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Body */}
        <Section title="Body">
          <FieldRow label="Weight" value={weight} onChangeText={setWeight} unit="lbs" />
          <FieldRow label="Sleep" value={sleepHours} onChangeText={setSleepHours} unit="hrs" />
          <FieldRow label="HRV" value={hrv} onChangeText={setHrv} unit="ms" />
          <FieldRow label="Resting HR" value={rhr} onChangeText={setRhr} unit="bpm" />
        </Section>

        {/* Training */}
        <Section title="Training">
          <Toggle label="Lift done?" value={liftDone} onChange={setLiftDone} />
          <FieldRow label="Cardio" value={cardioMin} onChangeText={setCardioMin} unit="min" />
          {(cardioMin && parseInt(cardioMin, 10) > 0) ? (
            <ZoneSelector value={cardioZone} onChange={setCardioZone} />
          ) : null}
        </Section>

        {/* Nutrition */}
        <Section title="Nutrition">
          <FieldRow label="Calories" value={calories} onChangeText={setCalories} unit="kcal" />
          <FieldRow label="Protein" value={proteinG} onChangeText={setProteinG} unit="g" />
          <FieldRow label="Carbs" value={carbsG} onChangeText={setCarbsG} unit="g" />
          <FieldRow label="Fat" value={fatG} onChangeText={setFatG} unit="g" />
        </Section>

        {/* Wellbeing */}
        <Section title="Wellbeing">
          <TapStrip label="Libido" value={libido} onChange={setLibido} />
          <TapStrip label="Motivation" value={motivation} onChange={setMotivation} />
          <TapStrip label="Joint friction" value={jointFriction} onChange={setJointFriction} />
        </Section>

        {/* Notes */}
        <Section title="Notes">
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything notable today…"
            placeholderTextColor={MUTED}
            multiline
            numberOfLines={3}
            keyboardType="default"
          />
        </Section>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={BG} size="small" />
          ) : saved ? (
            <>
              <Ionicons name="checkmark-circle" size={18} color={BG} />
              <Text style={styles.saveBtnText}>Saved to Intel</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color={BG} />
              <Text style={styles.saveBtnText}>Save Entry</Text>
            </>
          )}
        </TouchableOpacity>

        {/* History */}
        {history.length > 0 && (
          <View style={{ marginTop: 32 }}>
            <Text style={styles.historyHeading}>Your History</Text>
            {history.map(entry => (
              <TouchableOpacity
                key={`${entry.userId}_${entry.date}`}
                onPress={() => {
                  setDate(entry.date);
                  populateForm(entry);
                  scrollRef.current?.scrollTo({ y: 0, animated: true });
                }}
              >
                <HistoryCard entry={entry} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: TEXT,
    fontFamily: "Rubik_700Bold",
    letterSpacing: -0.5,
  },
  userBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  userId: {
    fontSize: 11,
    color: TEAL,
    fontFamily: "Rubik_400Regular",
    letterSpacing: 0.3,
    maxWidth: 240,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
    backgroundColor: CARD,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  dateText: {
    fontSize: 14,
    color: TEXT,
    fontFamily: "Rubik_500Medium",
    flex: 1,
  },
  todayBtn: {
    backgroundColor: TEAL + "22",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  todayBtnText: {
    fontSize: 12,
    color: TEAL,
    fontFamily: "Rubik_500Medium",
  },
  section: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    color: TEAL,
    fontFamily: "Rubik_600SemiBold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  fieldLabel: {
    fontSize: 14,
    color: TEXT,
    fontFamily: "Rubik_400Regular",
    flex: 1,
  },
  fieldInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  fieldInput: {
    fontSize: 15,
    color: TEXT,
    fontFamily: "Rubik_500Medium",
    textAlign: "right",
    minWidth: 60,
    padding: 2,
  },
  fieldUnit: {
    fontSize: 12,
    color: MUTED,
    fontFamily: "Rubik_400Regular",
    width: 30,
  },
  tapDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },
  tapDotText: {
    fontSize: 13,
    color: TEXT,
    fontFamily: "Rubik_500Medium",
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  toggleText: {
    fontSize: 13,
    color: TEXT,
    fontFamily: "Rubik_500Medium",
  },
  notesInput: {
    fontSize: 14,
    color: TEXT,
    fontFamily: "Rubik_400Regular",
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: 4,
  },
  saveBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: BG,
    fontFamily: "Rubik_700Bold",
  },
  historyHeading: {
    fontSize: 13,
    color: MUTED,
    fontFamily: "Rubik_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  historyCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 8,
  },
  historyDate: {
    fontSize: 13,
    color: TEAL,
    fontFamily: "Rubik_600SemiBold",
    marginBottom: 3,
  },
  historyMeta: {
    fontSize: 13,
    color: TEXT,
    fontFamily: "Rubik_400Regular",
  },
  historyNotes: {
    fontSize: 12,
    color: MUTED,
    fontFamily: "Rubik_400Regular",
    marginTop: 4,
    fontStyle: "italic",
  },
});
