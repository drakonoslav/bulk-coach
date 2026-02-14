import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useWorkoutEngine, MUSCLE_LABELS, type MuscleGroup, type WorkoutPhase } from "@/hooks/useWorkoutEngine";
import { apiRequest } from "@/lib/query-client";

interface CoachPrompt {
  phase: "COMPOUND" | "ISOLATION";
  prompt_title: string;
  prompt_body: string;
  recommended_muscles: MuscleGroup[];
  stop_rule?: string;
}

async function getNextPrompt(sessionId: string): Promise<CoachPrompt> {
  const res = await apiRequest("GET", `/api/workout/${encodeURIComponent(sessionId)}/next-prompt`);
  return res.json();
}

const COMPOUND_MUSCLES: MuscleGroup[] = [
  "chest_upper", "chest_mid", "chest_lower",
  "back_lats", "back_upper", "back_mid",
  "quads", "hamstrings", "glutes",
];

const ISOLATION_MUSCLES: MuscleGroup[] = [
  "delts_front", "delts_side", "delts_rear",
  "biceps", "triceps",
  "calves", "abs", "neck",
];

function CbpBar({ current, start, phase }: { current: number; start: number; phase: WorkoutPhase }) {
  const pct = start > 0 ? Math.max(0, Math.min(100, (current / start) * 100)) : 0;
  const isLow = pct <= 25;
  const barColor = isLow ? Colors.danger : phase === "COMPOUND" ? Colors.primary : "#8B5CF6";

  return (
    <View style={styles.cbpContainer}>
      <View style={styles.cbpHeader}>
        <Text style={styles.cbpLabel}>CBP</Text>
        <Text style={[styles.cbpValue, isLow && { color: Colors.danger }]}>
          {Math.round(current)} / {start}
        </Text>
      </View>
      <View style={styles.cbpTrack}>
        <View style={[styles.cbpFill, { width: `${pct}%`, backgroundColor: barColor }]} />
        <View style={[styles.cbpThreshold, { left: "25%" }]} />
        <View style={[styles.cbpThreshold, { left: "40%" }]} />
      </View>
      <View style={styles.cbpLabels}>
        <Text style={styles.cbpThresholdLabel}>ISOLATION</Text>
        <Text style={styles.cbpThresholdLabel}>COMPOUND</Text>
      </View>
    </View>
  );
}

function PhaseIndicator({ phase }: { phase: WorkoutPhase }) {
  const isCompound = phase === "COMPOUND";
  return (
    <View style={[styles.phaseCard, { borderColor: isCompound ? Colors.primary : "#8B5CF6" }]}>
      <MaterialCommunityIcons
        name={isCompound ? "weight-lifter" : "arm-flex"}
        size={28}
        color={isCompound ? Colors.primary : "#8B5CF6"}
      />
      <View>
        <Text style={styles.phaseLabel}>Current Phase</Text>
        <Text style={[styles.phaseValue, { color: isCompound ? Colors.primary : "#8B5CF6" }]}>
          {phase}
        </Text>
      </View>
    </View>
  );
}

function MuscleButton({
  muscle,
  onPress,
  isTarget,
  disabled,
}: {
  muscle: MuscleGroup;
  onPress: () => void;
  isTarget: boolean;
  disabled: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.muscleButton,
        isTarget && styles.muscleButtonTarget,
        disabled && styles.muscleButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.muscleButtonText, isTarget && styles.muscleButtonTextTarget]}>
        {MUSCLE_LABELS[muscle]}
      </Text>
      {isTarget && (
        <Ionicons name="star" size={12} color="#8B5CF6" style={{ marginLeft: 4 }} />
      )}
    </Pressable>
  );
}

function RpeSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.rpeContainer}>
      <Text style={styles.rpeLabel}>RPE</Text>
      <View style={styles.rpeRow}>
        {[6, 7, 8, 9, 10].map(v => (
          <Pressable
            key={v}
            style={[styles.rpeChip, value === v && styles.rpeChipActive]}
            onPress={() => onChange(v)}
          >
            <Text style={[styles.rpeText, value === v && styles.rpeTextActive]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function WorkoutScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    sessionId?: string;
    readiness?: string;
    polarConnected?: string;
    polarBaselineDone?: string;
  }>();

  const engine = useWorkoutEngine();
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | null>(null);
  const [rpe, setRpe] = useState(7);
  const [readinessInput, setReadinessInput] = useState(
    params.readiness ? parseInt(params.readiness, 10) : 75
  );
  const [nextPrompt, setNextPrompt] = useState<CoachPrompt | null>(null);

  const isActive = engine.status === "active" || engine.status === "logging";
  const currentPhase = engine.state?.phase || "COMPOUND";

  const displayMuscles = currentPhase === "COMPOUND" ? COMPOUND_MUSCLES : ISOLATION_MUSCLES;

  const polarSessionId = params.sessionId || undefined;
  const isPolarAttached = params.polarConnected === "true" && !!polarSessionId;
  const polarBaselineDone = params.polarBaselineDone === "true";
  const canLogSets = !isPolarAttached || polarBaselineDone;

  const fetchPrompt = useCallback(async (sid: string) => {
    try {
      const prompt = await getNextPrompt(sid);
      setNextPrompt(prompt);
    } catch {}
  }, []);

  const handleStartWorkout = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await engine.startWorkout(readinessInput, "strength", polarSessionId);
    engine.fetchIsolationTargets(readinessInput);
    const sid = polarSessionId || engine.state?.session_id;
    if (sid) fetchPrompt(sid);
  };

  const handleLogSet = async () => {
    if (!selectedMuscle) return;
    if (!canLogSets) {
      Alert.alert("Baseline still running", "Wait for the 2-minute baseline to finish before logging sets.");
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const isCompound = currentPhase === "COMPOUND";
    const result = await engine.logSet(selectedMuscle, rpe, isCompound);
    if (result?.session_id) {
      fetchPrompt(result.session_id);
    }
    setSelectedMuscle(null);
  };

  const handleEndWorkout = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const doEnd = async () => {
      if (isPolarAttached && polarSessionId) {
        await engine.endWorkout({ polarOwned: true });
        router.push({
          pathname: "/polar",
          params: { action: "endAndAnalyze", sessionId: polarSessionId },
        });
        return;
      }
      await engine.endWorkout();
    };
    if (Platform.OS === "web") {
      doEnd();
    } else {
      Alert.alert(
        "End Workout",
        `${engine.state?.compoundSets || 0} compound + ${engine.state?.isolationSets || 0} isolation sets logged. End now?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "End", style: "destructive", onPress: doEnd },
        ]
      );
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Game Guide",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {engine.status === "idle" && (
          <View style={styles.startSection}>
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="sword-cross" size={48} color={Colors.primary} />
            </View>
            <Text style={styles.heroTitle}>Workout Game Guide</Text>
            <Text style={styles.heroSubtitle}>
              CBP-driven workout with automatic phase transitions and muscle targeting
            </Text>

            <View style={styles.readinessSection}>
              <Text style={styles.inputLabel}>Readiness Score</Text>
              <View style={styles.readinessChips}>
                {[50, 60, 70, 75, 80, 90, 100].map(v => (
                  <Pressable
                    key={v}
                    style={[styles.chip, readinessInput === v && styles.chipActive]}
                    onPress={() => setReadinessInput(v)}
                  >
                    <Text style={[styles.chipText, readinessInput === v && styles.chipTextActive]}>{v}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.cbpPreview}>
                CBP: {Math.round(Math.pow(readinessInput / 100, 1.4) * 100)} points
              </Text>
            </View>

            <Pressable style={styles.startButton} onPress={handleStartWorkout}>
              <Ionicons name="play" size={22} color="#fff" />
              <Text style={styles.startButtonText}>Begin Workout</Text>
            </Pressable>

            {isPolarAttached && (
              <View style={styles.polarNote}>
                <MaterialCommunityIcons name="heart-flash" size={16} color="#D32027" />
                <Text style={styles.polarNoteText}>Attaching to Polar H10 session</Text>
              </View>
            )}
          </View>
        )}

        {isActive && engine.state && (
          <>
            <CbpBar
              current={engine.state.cbpCurrent}
              start={engine.state.cbpStart}
              phase={currentPhase}
            />

            <PhaseIndicator phase={currentPhase} />

            <View style={styles.setCountsRow}>
              <View style={styles.setCountCard}>
                <Text style={styles.setCountValue}>{engine.state.compoundSets}</Text>
                <Text style={styles.setCountLabel}>Compound</Text>
              </View>
              <View style={styles.setCountCard}>
                <Text style={styles.setCountValue}>{engine.state.isolationSets}</Text>
                <Text style={styles.setCountLabel}>Isolation</Text>
              </View>
              <View style={styles.setCountCard}>
                <Text style={styles.setCountValue}>{Math.round(engine.state.strainPoints)}</Text>
                <Text style={styles.setCountLabel}>Strain</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {currentPhase === "COMPOUND" ? "Lift — Compound" : "Lift — Isolation"}
              </Text>
              <Text style={styles.sectionHint}>
                {currentPhase === "COMPOUND"
                  ? "Select a compound movement muscle group"
                  : "Focus on isolation targets below"}
              </Text>

              {nextPrompt && (
                <View style={styles.coachCard}>
                  <View style={styles.coachHeaderRow}>
                    <View style={styles.coachBadge}>
                      <MaterialCommunityIcons name="controller-classic" size={14} color={Colors.primary} />
                      <Text style={styles.coachBadgeText}>COACH</Text>
                    </View>
                    {nextPrompt.stop_rule ? (
                      <View style={styles.coachStopPill}>
                        <Ionicons name="alert-circle" size={14} color={Colors.warning} />
                        <Text style={styles.coachStopText}>Rule</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.coachTitle}>{nextPrompt.prompt_title}</Text>
                  <Text style={styles.coachBody}>{nextPrompt.prompt_body}</Text>
                  {nextPrompt.recommended_muscles?.length ? (
                    <View style={styles.coachChipsRow}>
                      {nextPrompt.recommended_muscles.map((m) => (
                        <Pressable
                          key={m}
                          style={[
                            styles.coachChip,
                            selectedMuscle === m && styles.coachChipActive,
                          ]}
                          onPress={() => setSelectedMuscle(m)}
                          disabled={engine.status === "logging"}
                        >
                          <Ionicons
                            name="flash"
                            size={12}
                            color={selectedMuscle === m ? "#fff" : Colors.primary}
                          />
                          <Text
                            style={[
                              styles.coachChipText,
                              selectedMuscle === m && styles.coachChipTextActive,
                            ]}
                          >
                            {MUSCLE_LABELS[m]}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {nextPrompt.stop_rule ? (
                    <View style={styles.coachRuleBox}>
                      <Text style={styles.coachRuleLabel}>Stop / Switch Rule</Text>
                      <Text style={styles.coachRuleText}>{nextPrompt.stop_rule}</Text>
                    </View>
                  ) : null}
                </View>
              )}

              {currentPhase === "ISOLATION" && engine.isolationTargets.length > 0 && (
                <View style={styles.targetsBox}>
                  <Text style={styles.targetsTitle}>Recommended Targets</Text>
                  <View style={styles.targetsRow}>
                    {engine.isolationTargets.map(m => (
                      <Pressable
                        key={m}
                        style={styles.targetChip}
                        onPress={() => setSelectedMuscle(m)}
                      >
                        <Ionicons name="star" size={12} color="#8B5CF6" />
                        <Text style={styles.targetChipText}>{MUSCLE_LABELS[m]}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.muscleGrid}>
                {displayMuscles.map(m => (
                  <MuscleButton
                    key={m}
                    muscle={m}
                    onPress={() => setSelectedMuscle(selectedMuscle === m ? null : m)}
                    isTarget={engine.isolationTargets.includes(m)}
                    disabled={engine.status === "logging"}
                  />
                ))}
              </View>
            </View>

            {selectedMuscle && (
              <View style={styles.logSection}>
                <View style={styles.selectedDisplay}>
                  <MaterialCommunityIcons name="arm-flex" size={20} color={Colors.primary} />
                  <Text style={styles.selectedText}>
                    {MUSCLE_LABELS[selectedMuscle]}
                  </Text>
                </View>
                <RpeSelector value={rpe} onChange={setRpe} />
                <Pressable
                  style={[styles.logButton, engine.status === "logging" && { opacity: 0.6 }]}
                  onPress={handleLogSet}
                  disabled={engine.status === "logging"}
                >
                  <Ionicons name="checkmark-circle" size={22} color="#fff" />
                  <Text style={styles.logButtonText}>Log Set</Text>
                </Pressable>
              </View>
            )}

            <Pressable style={styles.endWorkoutButton} onPress={handleEndWorkout}>
              <Ionicons name="stop-circle" size={20} color={Colors.danger} />
              <Text style={styles.endWorkoutText}>End Workout</Text>
            </Pressable>
          </>
        )}

        {engine.status === "finished" && (
          <View style={styles.finishedSection}>
            <View style={styles.finishedIcon}>
              <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
            </View>
            <Text style={styles.finishedTitle}>Workout Complete</Text>
            {engine.state && (
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Compound Sets</Text>
                  <Text style={styles.summaryValue}>{engine.state.compoundSets}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Isolation Sets</Text>
                  <Text style={styles.summaryValue}>{engine.state.isolationSets}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total Strain</Text>
                  <Text style={styles.summaryValue}>{Math.round(engine.state.strainPoints)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>CBP Remaining</Text>
                  <Text style={styles.summaryValue}>{Math.round(engine.state.cbpCurrent)}</Text>
                </View>
              </View>
            )}
            <Pressable style={styles.doneButton} onPress={() => {
              engine.reset();
              router.back();
            }}>
              <Text style={styles.doneButtonText}>Done</Text>
            </Pressable>
          </View>
        )}

        {engine.error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={Colors.danger} />
            <Text style={styles.errorText}>{engine.error}</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  startSection: { paddingHorizontal: 24, paddingTop: 24, alignItems: "center" },
  heroIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.primaryMuted,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  heroTitle: { fontSize: 26, fontFamily: "Rubik_700Bold", color: Colors.text, marginBottom: 8 },
  heroSubtitle: {
    fontSize: 14, fontFamily: "Rubik_400Regular", color: Colors.textSecondary,
    textAlign: "center", marginBottom: 24, lineHeight: 20,
  },
  readinessSection: { width: "100%", marginBottom: 24 },
  inputLabel: { fontSize: 14, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 10 },
  readinessChips: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primaryMuted, borderColor: Colors.primary },
  chipText: { fontSize: 15, fontFamily: "Rubik_600SemiBold", color: Colors.textSecondary },
  chipTextActive: { color: Colors.primary },
  cbpPreview: { fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.primary },
  startButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 14,
    width: "100%", marginBottom: 12,
  },
  startButtonText: { fontSize: 18, fontFamily: "Rubik_700Bold", color: "#fff" },
  polarNote: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: "rgba(211, 32, 39, 0.08)",
  },
  polarNoteText: { fontSize: 12, fontFamily: "Rubik_500Medium", color: "#D32027" },

  cbpContainer: { marginHorizontal: 20, marginTop: 16, marginBottom: 16 },
  cbpHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  cbpLabel: { fontSize: 14, fontFamily: "Rubik_700Bold", color: Colors.textSecondary, letterSpacing: 1 },
  cbpValue: { fontSize: 16, fontFamily: "Rubik_700Bold", color: Colors.text },
  cbpTrack: {
    height: 14, backgroundColor: Colors.surface, borderRadius: 7,
    position: "relative", overflow: "hidden",
  },
  cbpFill: { height: 14, borderRadius: 7 },
  cbpThreshold: {
    position: "absolute", top: 0, bottom: 0, width: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  cbpLabels: {
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 4, marginTop: 4,
  },
  cbpThresholdLabel: {
    fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary,
    letterSpacing: 0.5,
  },

  phaseCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    marginHorizontal: 20, marginBottom: 16, padding: 16,
    backgroundColor: Colors.cardBg, borderRadius: 14, borderWidth: 1.5,
  },
  phaseLabel: { fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textTertiary },
  phaseValue: { fontSize: 20, fontFamily: "Rubik_700Bold" },

  setCountsRow: { flexDirection: "row", gap: 10, marginHorizontal: 20, marginBottom: 20 },
  setCountCard: {
    flex: 1, backgroundColor: Colors.cardBg, borderRadius: 12,
    padding: 14, alignItems: "center",
  },
  setCountValue: { fontSize: 22, fontFamily: "Rubik_700Bold", color: Colors.text },
  setCountLabel: { fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 2 },

  section: { marginHorizontal: 20, marginBottom: 20 },
  sectionTitle: {
    fontSize: 16, fontFamily: "Rubik_700Bold", color: Colors.text, marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginBottom: 14,
  },

  targetsBox: {
    backgroundColor: "rgba(139, 92, 246, 0.06)",
    borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: "rgba(139, 92, 246, 0.2)",
  },
  targetsTitle: { fontSize: 13, fontFamily: "Rubik_600SemiBold", color: "#8B5CF6", marginBottom: 8 },
  targetsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  targetChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "rgba(139, 92, 246, 0.12)",
  },
  targetChipText: { fontSize: 13, fontFamily: "Rubik_500Medium", color: "#8B5CF6" },

  muscleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muscleButton: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border,
    flexDirection: "row", alignItems: "center",
  },
  muscleButtonTarget: {
    borderColor: "rgba(139, 92, 246, 0.4)",
    backgroundColor: "rgba(139, 92, 246, 0.06)",
  },
  muscleButtonDisabled: { opacity: 0.5 },
  muscleButtonText: { fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.text },
  muscleButtonTextTarget: { color: "#8B5CF6" },

  logSection: {
    marginHorizontal: 20, marginBottom: 20,
    backgroundColor: Colors.cardBg, borderRadius: 14, padding: 18,
  },
  selectedDisplay: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14,
  },
  selectedText: { fontSize: 18, fontFamily: "Rubik_700Bold", color: Colors.text },
  rpeContainer: { marginBottom: 14 },
  rpeLabel: { fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 8 },
  rpeRow: { flexDirection: "row", gap: 8 },
  rpeChip: {
    flex: 1, paddingVertical: 10, alignItems: "center",
    borderRadius: 10, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  rpeChipActive: { backgroundColor: Colors.primaryMuted, borderColor: Colors.primary },
  rpeText: { fontSize: 16, fontFamily: "Rubik_700Bold", color: Colors.textSecondary },
  rpeTextActive: { color: Colors.primary },
  logButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12,
  },
  logButtonText: { fontSize: 16, fontFamily: "Rubik_600SemiBold", color: "#fff" },

  endWorkoutButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginHorizontal: 20, marginBottom: 20, paddingVertical: 14,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.danger,
  },
  endWorkoutText: { fontSize: 15, fontFamily: "Rubik_600SemiBold", color: Colors.danger },

  finishedSection: { paddingHorizontal: 24, paddingTop: 40, alignItems: "center" },
  finishedIcon: { marginBottom: 16 },
  finishedTitle: { fontSize: 24, fontFamily: "Rubik_700Bold", color: Colors.text, marginBottom: 24 },
  summaryCard: {
    width: "100%", backgroundColor: Colors.cardBg, borderRadius: 14, padding: 20, marginBottom: 24,
  },
  summaryRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  summaryLabel: { fontSize: 15, fontFamily: "Rubik_400Regular", color: Colors.textSecondary },
  summaryValue: { fontSize: 15, fontFamily: "Rubik_700Bold", color: Colors.text },
  doneButton: {
    paddingVertical: 14, paddingHorizontal: 48,
    backgroundColor: Colors.primary, borderRadius: 12,
  },
  doneButtonText: { fontSize: 16, fontFamily: "Rubik_600SemiBold", color: "#fff" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 20, marginBottom: 20, padding: 14,
    backgroundColor: Colors.dangerMuted, borderRadius: 12,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Rubik_400Regular", color: Colors.danger },

  coachCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  coachHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  coachBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  coachBadgeText: {
    fontSize: 12,
    fontFamily: "Rubik_700Bold",
    color: Colors.primary,
    letterSpacing: 1,
  },
  coachStopPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255, 171, 64, 0.12)",
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  coachStopText: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.warning,
  },
  coachTitle: {
    fontSize: 16,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
    marginBottom: 6,
  },
  coachBody: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  coachChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  coachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.cardBgElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  coachChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  coachChipText: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.primary,
  },
  coachChipTextActive: {
    color: "#fff",
  },
  coachRuleBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  coachRuleLabel: {
    fontSize: 12,
    fontFamily: "Rubik_700Bold",
    color: Colors.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  coachRuleText: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
