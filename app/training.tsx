import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { saveIntelReceipt } from "@/lib/entry-storage";

type Mode = "compound" | "isolation";
type Source = "archive" | "plan";
type Context = "gym" | "home";

interface IntelExercise {
  id: string;
  name: string;
  category?: string;
  compound?: boolean;
}

interface PlanExercise {
  exercise_id: string;
  exercise_name: string;
  sets_prescribed?: number;
  reps_prescribed?: string;
  notes?: string;
}

interface SetEntry {
  localId: string;
  exerciseId: string;
  exerciseName: string;
  weightLb: string;
  reps: string;
  rir: string;
}

interface SessionState {
  planId: number | null;
  sessionId: number | null;
  exercises: PlanExercise[];
  active: boolean;
}

const MUSCLES_26 = [
  "Upper Chest", "Mid Chest", "Lower Chest",
  "Front Delt", "Side Delt", "Rear Delt",
  "Long Head Tricep", "Lateral Head Tricep", "Medial Head Tricep",
  "Bicep Short Head", "Bicep Long Head", "Brachialis",
  "Upper Traps", "Mid Traps", "Lower Traps",
  "Lats", "Rhomboids", "Teres Major",
  "Rectus Abdominis", "Obliques",
  "Quads", "Hamstrings", "Glutes",
  "Calves", "Forearms", "Erectors",
];

export default function TrainingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("compound");
  const [source, setSource] = useState<Source>("archive");
  const [context, setContext] = useState<Context>("gym");

  const [allExercises, setAllExercises] = useState<IntelExercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(false);

  const [session, setSession] = useState<SessionState>({
    planId: null,
    sessionId: null,
    exercises: [],
    active: false,
  });
  const [startingSession, setStartingSession] = useState(false);

  const [sets, setSets] = useState<SetEntry[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<{ id: string; name: string } | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const [weightInput, setWeightInput] = useState("");
  const [repsInput, setRepsInput] = useState("");
  const [rirInput, setRirInput] = useState("");

  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [batchResult, setBatchResult] = useState<any>(null);
  const [complianceResult, setComplianceResult] = useState<any>(null);

  useEffect(() => {
    if (mode === "compound") {
      loadExercises();
    }
  }, [mode]);

  const loadExercises = useCallback(async () => {
    setLoadingExercises(true);
    try {
      const res = await apiRequest("GET", "/api/intel/exercises");
      const data = await res.json();
      const raw: any[] = Array.isArray(data?.exercises) ? data.exercises : [];
      const mapped: IntelExercise[] = raw.map((e) =>
        typeof e === "string" ? { id: e, name: e } : { id: e.id || e.name, name: e.name || e.id, category: e.category, compound: e.compound }
      );
      setAllExercises(mapped);
    } catch (err: any) {
      console.error("Failed to load intel exercises:", err);
      Alert.alert("Error", "Could not load exercises from intel service");
    } finally {
      setLoadingExercises(false);
    }
  }, []);

  const compoundExercises = useMemo(() => {
    return allExercises;
  }, [allExercises]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const [selectedDate, setSelectedDate] = useState(todayStr);

  const shiftDate = useCallback((dir: -1 | 1) => {
    setSelectedDate((prev) => {
      const d = new Date(prev + "T12:00:00");
      d.setDate(d.getDate() + dir);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
  }, []);

  const dateLabel = useMemo(() => {
    if (selectedDate === todayStr) return "Today";
    const d = new Date(selectedDate + "T12:00:00");
    const yesterday = new Date(todayStr + "T12:00:00");
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }, [selectedDate, todayStr]);

  const [sessionFallback, setSessionFallback] = useState(false);

  const startSession = useCallback(async () => {
    setStartingSession(true);
    setSessionFallback(false);
    try {
      const body: any = {
        planned_for: selectedDate,
        mode: "compound",
        preset: "hypertrophy",
        context,
      };
      if (context === "home") {
        body.available = "rack,barbell,plates,bench,landmine,dumbbell,kettlebell,pullup_bar";
      }
      const res = await apiRequest("POST", "/api/intel/session/start", body);
      const raw = await res.json();
      const data = raw?.upstream_json ?? raw;
      const rawPlanId = data?.plan_id ?? data?.planId ?? null;
      const rawSessionId = data?.session_id ?? data?.sessionId ?? null;
      const planId = rawPlanId != null && Number.isFinite(Number(rawPlanId)) ? Number(rawPlanId) : null;
      const sessionId = rawSessionId != null && Number.isFinite(Number(rawSessionId)) ? Number(rawSessionId) : null;
      const exercises: PlanExercise[] = Array.isArray(data?.exercises) ? data.exercises : [];
      setSession({ planId, sessionId, exercises, active: true });
      setSets([]);
      setBatchResult(null);
      setComplianceResult(null);
      if (exercises.length > 0) {
        setSelectedExercise({
          id: exercises[0].exercise_id,
          name: exercises[0].exercise_name,
        });
      }
    } catch (err: any) {
      console.error("session/start error:", err);
      setSessionFallback(true);
      setSource("archive");
      Alert.alert(
        "Plan Unavailable",
        "Intel session/start failed. Falling back to Archive mode — sets will still batch to Intel, but session/complete will be skipped."
      );
    } finally {
      setStartingSession(false);
    }
  }, [context, selectedDate]);

  useEffect(() => {
    setSelectedExercise(null);
  }, [mode, source]);

  const addSet = useCallback(() => {
    if (!selectedExercise) {
      Alert.alert("Select Exercise", "Pick an exercise before adding a set");
      return;
    }
    const w = parseFloat(weightInput.trim());
    const r = parseInt(repsInput.trim(), 10);
    const ri = parseInt(rirInput.trim() || "0", 10);
    if (isNaN(w) || w <= 0) {
      Alert.alert("Invalid Weight", "Enter a positive number for weight");
      return;
    }
    if (isNaN(r) || r <= 0) {
      Alert.alert("Invalid Reps", "Enter a positive number for reps");
      return;
    }
    const newSet: SetEntry = {
      localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      exerciseId: selectedExercise.id,
      exerciseName: selectedExercise.name,
      weightLb: String(w),
      reps: String(r),
      rir: String(isNaN(ri) ? 0 : ri),
    };
    setSets((prev) => [...prev, newSet]);
    setWeightInput("");
    setRepsInput("");
    setRirInput("");
  }, [selectedExercise, weightInput, repsInput, rirInput]);

  const removeSet = useCallback((localId: string) => {
    setSets((prev) => prev.filter((s) => s.localId !== localId));
  }, []);

  const submitBatch = useCallback(async () => {
    if (sets.length === 0) {
      Alert.alert("No Sets", "Add at least one set before saving");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        sets: sets.map((s) => ({
          exercise: s.exerciseId,
          weight: parseFloat(s.weightLb),
          reps: parseInt(s.reps, 10),
          rir: parseInt(s.rir, 10) || 0,
          performed_at: selectedDate,
        })),
      };
      const res = await apiRequest("POST", "/api/intel/sets/batch", payload);
      const raw = await res.json();
      const data = raw?.upstream_json ?? raw;
      setBatchResult(data);

      if (data?.inserted && Array.isArray(data?.rows)) {
        const exerciseNames = [...new Set(sets.map((s) => s.exerciseId))];
        const totalTonnage = data.rows.reduce((sum: number, r: any) => sum + (r.tonnage ?? 0), 0);
        const intelSetIds = data.rows.map((r: any) => Number(r.id)).filter(Number.isFinite);
        try {
          await saveIntelReceipt({
            performed_at: selectedDate,
            source: "intel",
            exercise_names: exerciseNames,
            set_count: data.inserted,
            total_tonnage: totalTonnage,
            intel_set_ids: intelSetIds,
            plan_id: session.planId,
          });
        } catch (e) {
          console.warn("Failed to save intel receipt:", e);
        }
      }

      return data;
    } catch (err: any) {
      console.error("sets/batch error:", err);
      Alert.alert("Error", `Batch save failed: ${err.message}`);
      return null;
    } finally {
      setSaving(false);
    }
  }, [sets, selectedDate]);

  const completeSession = useCallback(async () => {
    if (!session.active || session.planId == null || !Number.isFinite(session.planId)) {
      Alert.alert("No Active Plan", "Start a plan session first (requires numeric plan_id)");
      return;
    }

    setCompleting(true);
    try {
      const batchData = await submitBatch();
      if (!batchData) {
        setCompleting(false);
        return;
      }

      const setIds: number[] = (
        Array.isArray(batchData?.set_ids)
          ? batchData.set_ids
          : Array.isArray(batchData?.rows)
            ? batchData.rows.map((r: any) => r.id)
            : Array.isArray(batchData?.sets)
              ? batchData.sets.map((s: any) => s.id || s.set_id)
              : []
      ).map(Number).filter(Number.isFinite);

      const completePayload: any = {
        plan_id: session.planId,
      };
      if (session.sessionId != null) completePayload.session_id = session.sessionId;
      if (setIds.length > 0) completePayload.set_ids = setIds;

      const res = await apiRequest("POST", "/api/intel/session/complete", completePayload);
      const raw = await res.json();
      const data = raw?.upstream_json ?? raw;
      setComplianceResult(data);
      setSession((prev) => ({ ...prev, active: false }));
    } catch (err: any) {
      console.error("session/complete error:", err);
      Alert.alert("Error", `Complete failed: ${err.message}`);
    } finally {
      setCompleting(false);
    }
  }, [session, submitBatch]);

  const exerciseListForPicker = useMemo(() => {
    if (mode === "isolation") {
      return MUSCLES_26.map((m) => ({ id: m, name: m }));
    }
    if (source === "plan" && session.active) {
      return session.exercises.map((e) => ({
        id: e.exercise_id,
        name: e.exercise_name,
      }));
    }
    return compoundExercises.map((e) => ({ id: e.id, name: e.name }));
  }, [mode, source, session, compoundExercises]);

  const isWeb = Platform.OS === "web";

  return (
    <View style={[styles.container, { paddingTop: isWeb ? 67 : insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.title}>Training Log</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.datePicker}>
        <Pressable onPress={() => shiftDate(-1)} hitSlop={12} style={styles.dateArrow}>
          <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => setSelectedDate(todayStr)} style={styles.dateLabelWrap}>
          <Text style={styles.dateLabel}>{dateLabel}</Text>
          <Text style={styles.dateSubLabel}>{selectedDate}</Text>
        </Pressable>
        <Pressable onPress={() => shiftDate(1)} hitSlop={12} style={styles.dateArrow}>
          <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 34 : insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Mode</Text>
          <View style={styles.toggleGroup}>
            <Pressable
              style={[styles.toggleBtn, mode === "compound" && styles.toggleActive]}
              onPress={() => setMode("compound")}
            >
              <Text style={[styles.toggleText, mode === "compound" && styles.toggleTextActive]}>Compound</Text>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, mode === "isolation" && styles.toggleActive]}
              onPress={() => setMode("isolation")}
            >
              <Text style={[styles.toggleText, mode === "isolation" && styles.toggleTextActive]}>Isolation</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Source</Text>
          <View style={styles.toggleGroup}>
            <Pressable
              style={[styles.toggleBtn, source === "plan" && styles.toggleActive]}
              onPress={() => setSource("plan")}
            >
              <Text style={[styles.toggleText, source === "plan" && styles.toggleTextActive]}>Intel Plan</Text>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, source === "archive" && styles.toggleActive]}
              onPress={() => setSource("archive")}
            >
              <Text style={[styles.toggleText, source === "archive" && styles.toggleTextActive]}>Archive</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Context</Text>
          <View style={styles.toggleGroup}>
            <Pressable
              style={[styles.toggleBtn, context === "gym" && styles.toggleActive]}
              onPress={() => setContext("gym")}
            >
              <Text style={[styles.toggleText, context === "gym" && styles.toggleTextActive]}>Gym</Text>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, context === "home" && styles.toggleActive]}
              onPress={() => setContext("home")}
            >
              <Text style={[styles.toggleText, context === "home" && styles.toggleTextActive]}>Home</Text>
            </Pressable>
          </View>
        </View>

        {mode === "compound" && source === "plan" && !session.active && (
          <Pressable
            style={[styles.actionBtn, startingSession && styles.actionBtnDisabled]}
            onPress={startSession}
            disabled={startingSession}
          >
            {startingSession ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.actionBtnText}>Start Intel Session</Text>
            )}
          </Pressable>
        )}

        {session.active && (
          <View style={styles.sessionBanner}>
            <Ionicons name="flash" size={16} color={Colors.primary} />
            <Text style={styles.sessionText}>
              Plan active — {session.exercises.length} exercises
              {session.planId != null ? ` (plan: ${session.planId})` : ""}
            </Text>
          </View>
        )}

        {sessionFallback && (
          <View style={[styles.sessionBanner, { borderColor: "rgba(251, 191, 36, 0.3)", backgroundColor: "rgba(251, 191, 36, 0.1)" }]}>
            <Ionicons name="warning" size={16} color="#FBBF24" />
            <Text style={[styles.sessionText, { color: "#FBBF24" }]}>
              Plan unavailable — logging in Archive mode. Sets batch to Intel; session/complete skipped.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {mode === "compound" ? "Add Compound Set" : "Add Isolation Set"}
          </Text>

          <Pressable
            style={styles.exercisePicker}
            onPress={() => setPickerVisible(true)}
            testID="exercise-picker"
          >
            <Text style={[styles.exercisePickerText, !selectedExercise && { color: Colors.textSecondary }]}>
              {selectedExercise?.name || "Select exercise…"}
            </Text>
            <Ionicons name="chevron-down" size={18} color={Colors.textSecondary} />
          </Pressable>

          {loadingExercises && mode === "compound" && (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: 8 }} />
          )}

          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Weight (lb)</Text>
              <TextInput
                style={styles.input}
                value={weightInput}
                onChangeText={setWeightInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.textSecondary}
                testID="weight-input"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Reps</Text>
              <TextInput
                style={styles.input}
                value={repsInput}
                onChangeText={setRepsInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.textSecondary}
                testID="reps-input"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>RIR</Text>
              <TextInput
                style={styles.input}
                value={rirInput}
                onChangeText={setRirInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.textSecondary}
                testID="rir-input"
              />
            </View>
          </View>

          <Pressable style={styles.addBtn} onPress={addSet} testID="add-set-btn">
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={styles.addBtnText}>Add Set</Text>
          </Pressable>
        </View>

        {sets.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sets ({sets.length})</Text>
            {sets.map((s, i) => (
              <View key={s.localId} style={styles.setRow}>
                <Text style={styles.setIndex}>{i + 1}.</Text>
                <View style={styles.setInfo}>
                  <Text style={styles.setExercise} numberOfLines={1}>{s.exerciseName}</Text>
                  <Text style={styles.setDetail}>{s.weightLb} lb × {s.reps}{s.rir !== "0" ? ` @RIR ${s.rir}` : ""}</Text>
                </View>
                <Pressable onPress={() => removeSet(s.localId)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {sets.length > 0 && mode === "compound" && (
          <View style={styles.card}>
            {source === "plan" && session.active ? (
              <Pressable
                style={[styles.actionBtn, { backgroundColor: Colors.primary }, (saving || completing) && styles.actionBtnDisabled]}
                onPress={completeSession}
                disabled={saving || completing}
                testID="complete-session-btn"
              >
                {saving || completing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.actionBtnText}>Save & Complete Session</Text>
                )}
              </Pressable>
            ) : (
              <Pressable
                style={[styles.actionBtn, saving && styles.actionBtnDisabled]}
                onPress={submitBatch}
                disabled={saving}
                testID="save-batch-btn"
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.actionBtnText}>Save Sets to Intel</Text>
                )}
              </Pressable>
            )}
          </View>
        )}

        {batchResult && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Batch Result</Text>
            <Text style={styles.debugText}>{JSON.stringify(batchResult, null, 2)}</Text>
          </View>
        )}

        {complianceResult && (
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { color: Colors.primary }]}>Compliance Result</Text>
            <Text style={styles.debugText}>{JSON.stringify(complianceResult, null, 2)}</Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={pickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {mode === "isolation" ? "Select Muscle" : "Select Exercise"}
              </Text>
              <Pressable onPress={() => setPickerVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </Pressable>
            </View>
            <FlatList
              data={exerciseListForPicker}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.pickerItem,
                    selectedExercise?.id === item.id && styles.pickerItemActive,
                  ]}
                  onPress={() => {
                    setSelectedExercise(item);
                    setPickerVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.pickerItemText,
                      selectedExercise?.id === item.id && styles.pickerItemTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              )}
              style={{ maxHeight: 400 }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 18,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  datePicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dateArrow: { padding: 4 },
  dateLabelWrap: { alignItems: "center", minWidth: 120 },
  dateLabel: { fontSize: 15, fontFamily: "Rubik_600SemiBold", color: Colors.text },
  dateSubLabel: { fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    width: 60,
  },
  toggleGroup: {
    flexDirection: "row",
    flex: 1,
    gap: 8,
    marginLeft: 8,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  toggleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  toggleText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  toggleTextActive: {
    color: "#fff",
  },
  actionBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
  },
  sessionBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 212, 170, 0.1)",
    borderRadius: 8,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 212, 170, 0.3)",
  },
  sessionText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.primary,
    flex: 1,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  exercisePicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  exercisePickerText: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    flex: 1,
  },
  inputRow: {
    flexDirection: "row",
    gap: 10,
  },
  inputGroup: { flex: 1 },
  inputLabel: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  setIndex: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    width: 20,
  },
  setInfo: { flex: 1 },
  setExercise: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
  },
  setDetail: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  debugText: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: "70%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  pickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerItemActive: {
    backgroundColor: "rgba(0, 212, 170, 0.1)",
  },
  pickerItemText: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
  },
  pickerItemTextActive: {
    color: Colors.primary,
    fontFamily: "Rubik_600SemiBold",
  },
});
