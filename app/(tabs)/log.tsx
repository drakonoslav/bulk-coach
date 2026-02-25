import React, { useCallback, useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import Colors from "@/constants/colors";
import { saveEntry, loadEntry } from "@/lib/entry-storage";
import { DailyEntry, todayStr, avg3 } from "@/lib/coaching-engine";
import { getApiUrl, authFetch } from "@/lib/query-client";
import { computeClientDeviation, deviationHumanLabel, formatSignedMinutes } from "@/lib/sleep-deviation";
import { CLASSIFICATION_LABELS, type SleepClassification } from "@/lib/sleep-timing";
import { deriveSleep } from "@/lib/sleep-derivation";
import { fmtVal, fmtInt, fmtPctVal } from "@/lib/format";

const MEAL_CALORIES: Record<string, number> = {
  preCardio: 104,
  postCardio: 644,
  midday: 303,
  preLift: 385,
  postLift: 268,
  evening: 992,
};

function computeMealCalories(checklist: Record<string, boolean>): number {
  let total = 0;
  for (const [key, checked] of Object.entries(checklist)) {
    if (checked && MEAL_CALORIES[key]) total += MEAL_CALORIES[key];
  }
  return total;
}

function parseMinuteInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    return (parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10)).toString();
  }
  return trimmed;
}

function handleMinuteSetter(setter: (v: string) => void) {
  return (raw: string) => setter(parseMinuteInput(raw));
}

function formatDateLabel(dateStr: string): string {
  const today = todayStr();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function shiftDate(dateStr: string, offset: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  icon,
  iconColor,
  suffix,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  icon: string;
  iconColor: string;
  suffix?: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputLabel}>
        <Ionicons name={icon as any} size={16} color={iconColor} />
        <Text style={styles.inputLabelText}>{label}</Text>
      </View>
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textTertiary}
          keyboardType={keyboardType || "default"}
          keyboardAppearance="dark"
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function ToggleButton({
  label,
  value,
  onToggle,
  icon,
  activeColor,
}: {
  label: string;
  value: boolean | undefined;
  onToggle: () => void;
  icon: string;
  activeColor: string;
}) {
  const isActive = value === true;
  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle();
      }}
      style={[
        styles.toggleBtn,
        isActive && { backgroundColor: activeColor + "25", borderColor: activeColor },
      ]}
    >
      <Ionicons name={icon as any} size={18} color={isActive ? activeColor : Colors.textTertiary} />
      <Text style={[styles.toggleLabel, isActive && { color: activeColor }]}>{label}</Text>
    </Pressable>
  );
}

function AdherenceSelector({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const options = [
    { label: "100%", value: 1.0, color: Colors.success },
    { label: "90%", value: 0.9, color: Colors.primary },
    { label: "80%", value: 0.8, color: Colors.secondary },
    { label: "70%", value: 0.7, color: Colors.warning },
    { label: "<70%", value: 0.6, color: Colors.danger },
  ];

  return (
    <View style={styles.adherenceRow}>
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <Pressable
            key={opt.label}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(isSelected ? null : opt.value);
            }}
            style={[
              styles.adherenceBtn,
              isSelected && { backgroundColor: opt.color + "25", borderColor: opt.color },
            ]}
          >
            <Text style={[styles.adherenceBtnText, isSelected && { color: opt.color }]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SleepQualitySelector({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <View style={styles.sleepRow}>
      {[1, 2, 3, 4, 5].map((n) => {
        const isSelected = value === n;
        const starColor = n <= 2 ? Colors.danger : n <= 3 ? Colors.secondary : Colors.success;
        return (
          <Pressable
            key={n}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(isSelected ? undefined : n);
            }}
          >
            <Ionicons
              name={isSelected ? "star" : "star-outline"}
              size={28}
              color={isSelected ? starColor : Colors.textTertiary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [morningWeight, setMorningWeight] = useState("");
  const [eveningWeight, setEveningWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [bfAmR1, setBfAmR1] = useState("");
  const [bfAmR2, setBfAmR2] = useState("");
  const [bfAmR3, setBfAmR3] = useState("");
  const [bfPmR1, setBfPmR1] = useState("");
  const [bfPmR2, setBfPmR2] = useState("");
  const [bfPmR3, setBfPmR3] = useState("");
  const [fatFreeMass, setFatFreeMass] = useState("");
  const [pushupsReps, setPushupsReps] = useState("");
  const [pullupsReps, setPullupsReps] = useState("");
  const [benchReps, setBenchReps] = useState("");
  const [benchWeight, setBenchWeight] = useState("");
  const [ohpReps, setOhpReps] = useState("");
  const [ohpWeight, setOhpWeight] = useState("");
  const [sleepStart, setSleepStart] = useState("");
  const [sleepEnd, setSleepEnd] = useState("");
  const [sleepQuality, setSleepQuality] = useState<number | undefined>();
  const [tossedMinutes, setTossedMinutes] = useState("");
  const [actualBedTime, setActualBedTime] = useState("");
  const [actualWakeTime, setActualWakeTime] = useState("");
  const [sleepLatency, setSleepLatency] = useState("");
  const [sleepWaso, setSleepWaso] = useState("");
  const [napMinutes, setNapMinutes] = useState("");
  const [sleepAwakeMin, setSleepAwakeMin] = useState("");
  const [sleepRemMin, setSleepRemMin] = useState("");
  const [sleepCoreMin, setSleepCoreMin] = useState("");
  const [sleepDeepMin, setSleepDeepMin] = useState("");
  const [water, setWater] = useState("");
  const [steps, setSteps] = useState("");
  const [cardio, setCardio] = useState("");
  const [cardioStartTime, setCardioStartTime] = useState("");
  const [cardioEndTime, setCardioEndTime] = useState("");
  const [liftStartTime, setLiftStartTime] = useState("");
  const [liftEndTime, setLiftEndTime] = useState("");
  const [liftMin, setLiftMin] = useState("");
  const [liftWorkingMin, setLiftWorkingMin] = useState("");
  const [liftZ1, setLiftZ1] = useState("");
  const [liftZ2, setLiftZ2] = useState("");
  const [liftZ3, setLiftZ3] = useState("");
  const [liftZ4, setLiftZ4] = useState("");
  const [liftZ5, setLiftZ5] = useState("");
  const [zone1, setZone1] = useState("");
  const [zone2, setZone2] = useState("");
  const [zone3, setZone3] = useState("");
  const [zone4, setZone4] = useState("");
  const [zone5, setZone5] = useState("");
  const [liftDone, setLiftDone] = useState<boolean | undefined>();
  const [deloadWeek, setDeloadWeek] = useState<boolean | undefined>();
  const [cardioSkipped, setCardioSkipped] = useState(false);
  const [liftSkipped, setLiftSkipped] = useState(false);
  const [perfNote, setPerfNote] = useState("");
  const [adherence, setAdherence] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [mealChecklist, setMealChecklist] = useState<Record<string, boolean>>({
    preCardio: false, postCardio: false, midday: false,
    preLift: false, postLift: false, evening: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erectionBadges, setErectionBadges] = useState<Record<string, "measured" | "imputed">>({});
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [sessionForDate, setSessionForDate] = useState<{ erections: number; durSec: number; isImputed: boolean } | null>(null);
  const [readinessBadge, setReadinessBadge] = useState<{ score: number; tier: string; confidence: string } | null>(null);
  const [sleepPlan, setSleepPlan] = useState<{ bedtime: string; wake: string } | null>(null);
  const [fitbitData, setFitbitData] = useState<{
    sleepMinutes?: number;
    activeZoneMinutes?: number;
    energyBurnedKcal?: number;
    restingHr?: number;
    hrv?: number;
    zone1Min?: number;
    zone2Min?: number;
    zone3Min?: number;
    belowZone1Min?: number;
    sleepEfficiency?: number;
    sleepStartLocal?: string;
    sleepEndLocal?: string;
  } | null>(null);
  const [picking, setPicking] = useState(false);
  const [sleepMinutesManual, setSleepMinutesManual] = useState("");
  const [hrvManual, setHrvManual] = useState("");
  const [restingHrManual, setRestingHrManual] = useState("");
  const [caloriesIn, setCaloriesIn] = useState("");
  const [trainingLoad, setTrainingLoad] = useState<string | undefined>();
  const [nocturnalCount, setNocturnalCount] = useState("");
  const [nocturnalDuration, setNocturnalDuration] = useState("");
  const [firmnessAvg, setFirmnessAvg] = useState("");
  const [pain010, setPain010] = useState<number | null>(null);
  const [dayStateColor, setDayStateColor] = useState<{ color: string; label: string } | null>(null);

  interface ContextEvent {
    id: number;
    day: string;
    tag: string;
    intensity: number;
    label: string | null;
    notes: string | null;
  }
  const TAG_DEFINITIONS: Record<string, string> = {
    travel: "Any day involving travel, time-zone shifts, disrupted routine, or sleeping outside your normal environment.",
    schedule_shift: "A meaningful change to your normal sleep, wake, work, or training schedule.",
    work_stress: "Elevated cognitive load, deadlines, performance pressure, or prolonged mental strain related to work.",
    social_load: "Extended social activity, gatherings, or emotionally demanding social interaction (positive or negative).",
    illness_symptoms: "Acute sickness signs such as fever, congestion, sore throat, fatigue, or systemic discomfort.",
    injury_pain: "Musculoskeletal pain, inflammation, strain, or physical limitation affecting normal movement or training.",
    supplement_change: "Starting, stopping, or significantly adjusting the dose of a supplement.",
    med_change: "Starting, stopping, or adjusting a prescription or medically supervised treatment.",
    early_dating: "New or evolving romantic involvement that may affect sleep, stress, or emotional load.",
  };
  const CONTEXT_TAG_COLORS: Record<string, string> = {
    travel: "#60A5FA",
    schedule_shift: "#FBBF24",
    work_stress: "#F87171",
    social_load: "#A78BFA",
    illness_symptoms: "#34D399",
    injury_pain: "#FB923C",
    supplement_change: "#22D3EE",
    med_change: "#F472B6",
    early_dating: "#E879F9",
  };
  const PRESET_CONTEXT_TAGS = [
    { key: "travel", label: "Travel", icon: "airplane-outline" as const },
    { key: "schedule_shift", label: "Schedule Shift", icon: "swap-horizontal-outline" as const },
    { key: "work_stress", label: "Work Stress", icon: "briefcase-outline" as const },
    { key: "social_load", label: "Social Load", icon: "people-outline" as const },
    { key: "illness_symptoms", label: "Illness", icon: "medkit-outline" as const },
    { key: "injury_pain", label: "Injury/Pain", icon: "bandage-outline" as const },
    { key: "supplement_change", label: "Supplement", icon: "flask-outline" as const },
    { key: "med_change", label: "Med Change", icon: "medical-outline" as const },
    { key: "early_dating", label: "Early Dating", icon: "heart-outline" as const },
  ];

  interface LensEpisode { id: number; tag: string; startDay: string; endDay: string | null; intensity: number; label: string | null; notes: string | null; }

  const [activeEpisodes, setActiveEpisodes] = useState<LensEpisode[]>([]);
  const [contextEditing, setContextEditing] = useState<{
    tag: string; intensity: number; label: string; notes: string;
    episodeId?: number; startDay?: string; isCarriedOver?: boolean;
  } | null>(null);
  const [contextCustomTag, setContextCustomTag] = useState("");
  const [contextShowCustom, setContextShowCustom] = useState(false);

  const loadEpisodes = useCallback(async (day: string) => {
    try {
      const baseUrl = getApiUrl();
      try { await authFetch(new URL(`/api/context-lens/episodes/apply-today?day=${day}`, baseUrl).toString(), { method: "POST" }); } catch {}
      const res = await authFetch(new URL(`/api/context-lens/episodes/active?day=${day}`, baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setActiveEpisodes(data.episodes || []);
      } else {
        setActiveEpisodes([]);
      }
    } catch {
      setActiveEpisodes([]);
    }
  }, []);

  const startNewEpisode = useCallback(async (tag: string, intensity: number, label: string, notes: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/context-lens/episodes/start", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, startDay: selectedDate, intensity, label: label || null, notes: notes || null }),
      });
      if (res.ok) loadEpisodes(selectedDate);
    } catch {}
  }, [selectedDate, loadEpisodes]);

  const concludeEpisode = useCallback(async (episodeId: number) => {
    try {
      const baseUrl = getApiUrl();
      await authFetch(new URL(`/api/context-lens/episodes/${episodeId}/conclude`, baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDay: selectedDate }),
      });
      loadEpisodes(selectedDate);
    } catch {}
  }, [selectedDate, loadEpisodes]);

  const updateEpisodeDetails = useCallback(async (episodeId: number, intensity: number, label: string, notes: string) => {
    try {
      const baseUrl = getApiUrl();
      await authFetch(new URL(`/api/context-lens/episodes/${episodeId}`, baseUrl).toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intensity, label: label || null, notes: notes || null }),
      });
      loadEpisodes(selectedDate);
    } catch {}
  }, [selectedDate, loadEpisodes]);

  const isToday = selectedDate === todayStr();
  const isFuture = selectedDate > todayStr();

  const stagesComplete = !!(sleepAwakeMin && sleepRemMin && sleepCoreMin && sleepDeepMin);

  const sleepDerived = deriveSleep({
    actualBedTime: actualBedTime || null,
    actualWakeTime: actualWakeTime || null,
    timeAsleepMin: sleepMinutesManual ? parseInt(sleepMinutesManual, 10) : null,
    awakeStageMin: sleepAwakeMin ? parseInt(sleepAwakeMin, 10) : null,
    remMin: sleepRemMin ? parseInt(sleepRemMin, 10) : null,
    coreMin: sleepCoreMin ? parseInt(sleepCoreMin, 10) : null,
    deepMin: sleepDeepMin ? parseInt(sleepDeepMin, 10) : null,
  });

  const hasStagesTST = !!(sleepRemMin && sleepCoreMin && sleepDeepMin);
  useEffect(() => {
    if (hasStagesTST) {
      const stageTST = parseInt(sleepRemMin, 10) + parseInt(sleepCoreMin, 10) + parseInt(sleepDeepMin, 10);
      if (!isNaN(stageTST)) setSleepMinutesManual(stageTST.toString());
    }
  }, [sleepRemMin, sleepCoreMin, sleepDeepMin, hasStagesTST]);

  const populateForm = (existing: DailyEntry | null) => {
    if (existing) {
      setHasExisting(true);
      setMorningWeight(existing.morningWeightLb.toString());
      setEveningWeight(existing.eveningWeightLb?.toString() || "");
      setWaist(existing.waistIn?.toString() || "");
      setBfAmR1(existing.bfMorningR1?.toString() || "");
      setBfAmR2(existing.bfMorningR2?.toString() || "");
      setBfAmR3(existing.bfMorningR3?.toString() || "");
      setBfPmR1(existing.bfEveningR1?.toString() || "");
      setBfPmR2(existing.bfEveningR2?.toString() || "");
      setBfPmR3(existing.bfEveningR3?.toString() || "");
      setFatFreeMass(existing.fatFreeMassLb?.toString() || "");
      setPushupsReps(existing.pushupsReps?.toString() || "");
      setPullupsReps(existing.pullupsReps?.toString() || "");
      setBenchReps(existing.benchReps?.toString() || "");
      setBenchWeight(existing.benchWeightLb?.toString() || "");
      setOhpReps(existing.ohpReps?.toString() || "");
      setOhpWeight(existing.ohpWeightLb?.toString() || "");
      setSleepStart(existing.sleepStart || "");
      setSleepEnd(existing.sleepEnd || "");
      setSleepQuality(existing.sleepQuality);
      setTossedMinutes((existing as any).tossedMinutes?.toString() || "");
      setActualBedTime(existing.actualBedTime || "");
      setActualWakeTime(existing.actualWakeTime || "");
      setSleepLatency(existing.sleepLatencyMin?.toString() || "");
      setSleepWaso(existing.sleepWasoMin?.toString() || "");
      setNapMinutes(existing.napMinutes?.toString() || "");
      setSleepAwakeMin(existing.sleepAwakeMin?.toString() || "");
      setSleepRemMin(existing.sleepRemMin?.toString() || "");
      setSleepCoreMin(existing.sleepCoreMin?.toString() || "");
      setSleepDeepMin(existing.sleepDeepMin?.toString() || "");
      setWater(existing.waterLiters?.toString() || "");
      setSteps(existing.steps?.toString() || "");
      setCardio(existing.cardioMin?.toString() || "");
      setCardioStartTime(existing.cardioStartTime || "");
      setCardioEndTime(existing.cardioEndTime || "");
      setLiftStartTime(existing.liftStartTime || "");
      setLiftEndTime(existing.liftEndTime || "");
      setLiftMin(existing.liftMin?.toString() || "");
      setLiftWorkingMin(existing.liftWorkingMin?.toString() || "");
      setLiftZ1(existing.liftZ1Min?.toString() || "");
      setLiftZ2(existing.liftZ2Min?.toString() || "");
      setLiftZ3(existing.liftZ3Min?.toString() || "");
      setLiftZ4(existing.liftZ4Min?.toString() || "");
      setLiftZ5(existing.liftZ5Min?.toString() || "");
      setZone1(existing.zone1Min?.toString() || "");
      setZone2(existing.zone2Min?.toString() || "");
      setZone3(existing.zone3Min?.toString() || "");
      setZone4(existing.zone4Min?.toString() || "");
      setZone5(existing.zone5Min?.toString() || "");
      setLiftDone(existing.liftDone);
      setDeloadWeek(existing.deloadWeek);
      setCardioSkipped(existing.cardioSkipped ?? false);
      setLiftSkipped(existing.liftSkipped ?? false);
      setPerfNote(existing.performanceNote || "");
      setAdherence(existing.adherence ?? null);
      setNotes(existing.notes || "");
      setPain010(existing.pain010 != null ? Number(existing.pain010) : null);
      setMealChecklist(existing.mealChecklist ?? {
        preCardio: false, postCardio: false, midday: false,
        preLift: false, postLift: false, evening: false,
      });
      setFitbitData({
        sleepMinutes: existing.sleepMinutes,
        activeZoneMinutes: existing.activeZoneMinutes,
        energyBurnedKcal: existing.energyBurnedKcal,
        restingHr: existing.restingHr,
        hrv: existing.hrv,
        zone1Min: existing.zone1Min,
        zone2Min: existing.zone2Min,
        zone3Min: existing.zone3Min,
        belowZone1Min: existing.belowZone1Min,
        sleepEfficiency: existing.sleepEfficiency,
        sleepStartLocal: existing.sleepStartLocal,
        sleepEndLocal: existing.sleepEndLocal,
      });
      setSleepMinutesManual(existing.sleepMinutes?.toString() || "");
      setHrvManual(existing.hrv?.toString() || "");
      setRestingHrManual(existing.restingHr?.toString() || "");
      setCaloriesIn(existing.caloriesIn?.toString() || "");
      setTrainingLoad(existing.trainingLoad || undefined);
    } else {
      setHasExisting(false);
      resetForm();
    }
  };

  const loadDateEntry = useCallback(async (day: string) => {
    setLoading(true);
    setSaved(false);
    try {
      const existing = await loadEntry(day);
      populateForm(existing);
    } catch {
      resetForm();
      setHasExisting(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadErectionBadges = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/erection/badges", baseUrl).toString());
      if (res.ok) setErectionBadges(await res.json());
    } catch {}
  }, []);

  const loadReadinessForDate = useCallback(async (day: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/readiness?date=${day}`, baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setReadinessBadge({ score: data.readinessScore, tier: data.readinessTier, confidence: data.confidenceGrade });
      } else {
        setReadinessBadge(null);
      }
    } catch {
      setReadinessBadge(null);
    }
  }, []);

  const loadSessionForDate = useCallback(async (day: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/erection/sessions", baseUrl).toString());
      if (res.ok) {
        const rows = await res.json();
        const match = rows.find((r: any) => r.date === day);
        if (match) {
          setSessionForDate({
            erections: Number(match.nocturnalErections ?? 0),
            durSec: Number(match.nocturnalDurationSeconds ?? 0),
            isImputed: !!match.isImputed,
          });
        } else {
          setSessionForDate(null);
        }
      }
    } catch {
      setSessionForDate(null);
    }
  }, []);

  const loadSleepPlan = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/sleep-plan", baseUrl).toString());
      if (res.ok) setSleepPlan(await res.json());
    } catch {}
  }, []);

  const loadDayState = useCallback(async (day: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/day-state?start=${day}&end=${day}`, baseUrl).toString());
      if (res.ok) {
        const marks = await res.json();
        if (marks.length > 0 && marks[0].color !== "UNKNOWN") {
          setDayStateColor({ color: marks[0].color, label: marks[0].label });
        } else {
          setDayStateColor(null);
        }
      }
    } catch {
      setDayStateColor(null);
    }
  }, []);

  const loadAndrogenForDate = useCallback(async (day: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/androgen/manual/${day}`, baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        if (data && data.nocturnal_count != null) {
          setNocturnalCount(String(data.nocturnal_count));
          setNocturnalDuration(data.duration_min != null ? String(data.duration_min) : "");
          setFirmnessAvg(data.firmness_avg != null ? String(data.firmness_avg) : "");
        } else {
          setNocturnalCount("");
          setNocturnalDuration("");
          setFirmnessAvg("");
        }
      } else {
        setNocturnalCount("");
        setNocturnalDuration("");
        setFirmnessAvg("");
      }
    } catch {
      setNocturnalCount("");
      setNocturnalDuration("");
      setFirmnessAvg("");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDateEntry(selectedDate);
      loadErectionBadges();
      loadSessionForDate(selectedDate);
      loadReadinessForDate(selectedDate);
      loadDayState(selectedDate);
      loadAndrogenForDate(selectedDate);
      loadEpisodes(selectedDate);
      if (!sleepPlan) loadSleepPlan();
      setUploadResult(null);
    }, [selectedDate])
  );

  useEffect(() => {
    const computed = computeMealCalories(mealChecklist);
    if (computed > 0) {
      setCaloriesIn(String(computed));
    }
  }, [mealChecklist]);

  function formatDur(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  const handleSnapshotUpload = async () => {
    if (picking) return;
    setPicking(true);
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
      formData.append("session_date", selectedDate);

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
        setUploadResult("Already imported (duplicate)");
      } else if (json.note === "baseline_stored") {
        setUploadResult("Baseline stored (first upload)");
      } else if (json.derived) {
        const d = json.derived;
        setUploadResult(
          `${d.deltaNoctErections} erections, ${formatDur(d.deltaNoctDur)}${json.gapsFilled > 0 ? ` | ${json.gapsFilled} gaps filled` : ""}`
        );
      } else {
        setUploadResult(json.note || "Done");
      }

      loadErectionBadges();
      loadSessionForDate(selectedDate);
    } catch (err: any) {
      setUploadResult("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploading(false);
      setPicking(false);
    }
  };

  const goToPrevDay = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prev = shiftDate(selectedDate, -1);
    setSelectedDate(prev);
  };

  const goToNextDay = () => {
    if (isFuture) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = shiftDate(selectedDate, 1);
    if (next <= todayStr()) {
      setSelectedDate(next);
    }
  };

  const goToToday = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDate(todayStr());
  };

  const resetForm = () => {
    setMorningWeight("");
    setEveningWeight("");
    setWaist("");
    setBfAmR1("");
    setBfAmR2("");
    setBfAmR3("");
    setBfPmR1("");
    setBfPmR2("");
    setBfPmR3("");
    setFatFreeMass("");
    setPushupsReps("");
    setPullupsReps("");
    setBenchReps("");
    setBenchWeight("");
    setOhpReps("");
    setOhpWeight("");
    setSleepStart("");
    setSleepEnd("");
    setSleepQuality(undefined);
    setTossedMinutes("");
    setActualBedTime("");
    setActualWakeTime("");
    setSleepLatency("");
    setSleepWaso("");
    setNapMinutes("");
    setSleepAwakeMin("");
    setSleepRemMin("");
    setSleepCoreMin("");
    setSleepDeepMin("");
    setWater("");
    setSteps("");
    setCardio("");
    setCardioStartTime("");
    setCardioEndTime("");
    setLiftStartTime("");
    setLiftEndTime("");
    setLiftMin("");
    setLiftWorkingMin("");
    setLiftZ1("");
    setLiftZ2("");
    setLiftZ3("");
    setLiftZ4("");
    setLiftZ5("");
    setLiftDone(undefined);
    setDeloadWeek(undefined);
    setCardioSkipped(false);
    setLiftSkipped(false);
    setPerfNote("");
    setAdherence(null);
    setNotes("");
    setSaved(false);
    setFitbitData(null);
    setSleepMinutesManual("");
    setHrvManual("");
    setRestingHrManual("");
    setCaloriesIn("");
    setTrainingLoad(undefined);
    setNocturnalCount("");
    setNocturnalDuration("");
    setFirmnessAvg("");
    setPain010(null);
    setMealChecklist({
      preCardio: false, postCardio: false, midday: false,
      preLift: false, postLift: false, evening: false,
    });
    setZone1("");
    setZone2("");
    setZone3("");
    setZone4("");
    setZone5("");
  };

  const handleSave = async () => {
    if (!morningWeight) {
      Alert.alert("Required", "Morning weight is required to log an entry.");
      return;
    }

    setSaving(true);
    try {
      const bfAmVals = [bfAmR1, bfAmR2, bfAmR3].map((v) => (v ? parseFloat(v) : undefined));
      const bfPmVals = [bfPmR1, bfPmR2, bfPmR3].map((v) => (v ? parseFloat(v) : undefined));
      const bfMorningAvg = avg3(bfAmVals[0], bfAmVals[1], bfAmVals[2]);
      const bfEveningAvg = avg3(bfPmVals[0], bfPmVals[1], bfPmVals[2]);

      const scheduleBed = sleepPlan?.bedtime || "21:45";
      const scheduleWake = sleepPlan?.wake || "05:30";

      const entry: DailyEntry = {
        day: selectedDate,
        morningWeightLb: parseFloat(morningWeight),
        eveningWeightLb: eveningWeight ? parseFloat(eveningWeight) : undefined,
        waistIn: waist ? parseFloat(waist) : undefined,
        bfMorningR1: bfAmVals[0],
        bfMorningR2: bfAmVals[1],
        bfMorningR3: bfAmVals[2],
        bfMorningPct: bfMorningAvg,
        bfEveningR1: bfPmVals[0],
        bfEveningR2: bfPmVals[1],
        bfEveningR3: bfPmVals[2],
        bfEveningPct: bfEveningAvg,
        sleepStart: sleepStart || undefined,
        sleepEnd: sleepEnd || undefined,
        sleepQuality,
        tossedMinutes: tossedMinutes ? parseInt(tossedMinutes, 10) : undefined,
        plannedBedTime: scheduleBed,
        plannedWakeTime: scheduleWake,
        actualBedTime: actualBedTime || undefined,
        actualWakeTime: actualWakeTime || undefined,
        sleepLatencyMin: sleepDerived.sleepSourceMode ? (sleepDerived.latencyProxy ?? undefined) : undefined,
        sleepWasoMin: sleepDerived.sleepSourceMode ? (sleepDerived.wasoEst ?? undefined) : undefined,
        napMinutes: napMinutes ? parseInt(napMinutes, 10) : undefined,
        sleepAwakeMin: sleepAwakeMin ? parseInt(sleepAwakeMin, 10) : undefined,
        sleepRemMin: sleepRemMin ? parseInt(sleepRemMin, 10) : undefined,
        sleepCoreMin: sleepCoreMin ? parseInt(sleepCoreMin, 10) : undefined,
        sleepDeepMin: sleepDeepMin ? parseInt(sleepDeepMin, 10) : undefined,
        sleepSourceMode: sleepDerived.sleepSourceMode ?? undefined,
        waterLiters: water ? parseFloat(water) : undefined,
        steps: steps ? parseInt(steps, 10) : undefined,
        cardioMin: cardio ? parseInt(cardio, 10) : undefined,
        cardioStartTime: cardioStartTime || undefined,
        cardioEndTime: cardioEndTime || undefined,
        liftStartTime: liftStartTime || undefined,
        liftEndTime: liftEndTime || undefined,
        liftMin: liftMin ? parseInt(liftMin, 10) : undefined,
        liftWorkingMin: liftWorkingMin ? parseInt(liftWorkingMin, 10) : undefined,
        liftZ1Min: liftZ1 ? parseFloat(liftZ1) : undefined,
        liftZ2Min: liftZ2 ? parseFloat(liftZ2) : undefined,
        liftZ3Min: liftZ3 ? parseFloat(liftZ3) : undefined,
        liftZ4Min: liftZ4 ? parseFloat(liftZ4) : undefined,
        liftZ5Min: liftZ5 ? parseFloat(liftZ5) : undefined,
        zone1Min: zone1 ? parseFloat(zone1) : undefined,
        zone2Min: zone2 ? parseFloat(zone2) : undefined,
        zone3Min: zone3 ? parseFloat(zone3) : undefined,
        zone4Min: zone4 ? parseFloat(zone4) : undefined,
        zone5Min: zone5 ? parseFloat(zone5) : undefined,
        liftDone,
        deloadWeek,
        performanceNote: perfNote || undefined,
        adherence: adherence ?? undefined,
        notes: notes || undefined,
        sleepMinutes: sleepMinutesManual ? parseInt(sleepMinutesManual, 10) : undefined,
        hrv: hrvManual ? parseFloat(hrvManual) : undefined,
        restingHr: restingHrManual ? parseInt(restingHrManual, 10) : undefined,
        caloriesIn: caloriesIn ? parseInt(caloriesIn, 10) : undefined,
        trainingLoad: trainingLoad || undefined,
        fatFreeMassLb: fatFreeMass ? parseFloat(fatFreeMass) : undefined,
        pushupsReps: pushupsReps ? parseInt(pushupsReps, 10) : undefined,
        pullupsReps: pullupsReps ? parseInt(pullupsReps, 10) : undefined,
        benchReps: benchReps ? parseInt(benchReps, 10) : undefined,
        benchWeightLb: benchWeight ? parseFloat(benchWeight) : undefined,
        ohpReps: ohpReps ? parseInt(ohpReps, 10) : undefined,
        ohpWeightLb: ohpWeight ? parseFloat(ohpWeight) : undefined,
        pain010: pain010 ?? undefined,
        mealChecklist: Object.values(mealChecklist).some(v => v) ? mealChecklist : undefined,
        cardioSkipped: cardioSkipped || undefined,
        liftSkipped: liftSkipped || undefined,
      };

      await saveEntry(entry);

      if (nocturnalCount) {
        try {
          const baseUrl = getApiUrl();
          await authFetch(new URL("/api/androgen/manual", baseUrl).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date: selectedDate,
              nocturnalCount: parseInt(nocturnalCount, 10),
              totalDurationMin: nocturnalDuration ? parseFloat(nocturnalDuration) : 0,
              firmnessAvg: firmnessAvg ? parseFloat(firmnessAvg) : null,
            }),
          });
        } catch {}
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHasExisting(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      Alert.alert("Error", "Failed to save entry. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.stickyHeader, { paddingTop: topInset + 16 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Daily Log</Text>
          <View style={styles.dateNav}>
            <Pressable onPress={goToPrevDay} style={styles.dateNavBtn} hitSlop={12}>
              <Ionicons name="chevron-back" size={22} color={Colors.text} />
            </Pressable>
            <Pressable onPress={isToday ? undefined : goToToday} style={styles.dateNavCenter}>
              <Text style={styles.dateNavLabel}>{formatDateLabel(selectedDate)}</Text>
              <Text style={styles.dateNavSub}>
                {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </Text>
              {hasExisting && (
                <View style={styles.dateNavBadge}>
                  <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
                  <Text style={styles.dateNavBadgeText}>Logged</Text>
                </View>
              )}
              {erectionBadges[selectedDate] && (
                <View style={[styles.dateNavBadge, { backgroundColor: erectionBadges[selectedDate] === "measured" ? "rgba(52, 211, 153, 0.12)" : "rgba(251, 191, 36, 0.12)" }]}>
                  <Ionicons name="pulse" size={12} color={erectionBadges[selectedDate] === "measured" ? "#34D399" : "#FBBF24"} />
                  <Text style={[styles.dateNavBadgeText, { color: erectionBadges[selectedDate] === "measured" ? "#34D399" : "#FBBF24" }]}>
                    {erectionBadges[selectedDate] === "measured" ? "Vitals" : "Vitals (est.)"}
                  </Text>
                </View>
              )}
              {readinessBadge && (
                <View style={[styles.dateNavBadge, {
                  backgroundColor: readinessBadge.tier === "GREEN" ? "rgba(52, 211, 153, 0.12)" : readinessBadge.tier === "BLUE" ? "rgba(96, 165, 250, 0.12)" : "rgba(251, 191, 36, 0.12)",
                }]}>
                  <Ionicons
                    name={readinessBadge.tier === "GREEN" ? "flash" : readinessBadge.tier === "BLUE" ? "snow" : "pause-circle"}
                    size={12}
                    color={readinessBadge.tier === "GREEN" ? "#34D399" : readinessBadge.tier === "BLUE" ? "#60A5FA" : "#FBBF24"}
                  />
                  <Text style={[styles.dateNavBadgeText, {
                    color: readinessBadge.tier === "GREEN" ? "#34D399" : readinessBadge.tier === "BLUE" ? "#60A5FA" : "#FBBF24",
                  }]}>
                    {readinessBadge.tier === "GREEN" ? "Ready" : readinessBadge.tier === "BLUE" ? "Deload" : "Normal"} {readinessBadge.score}
                  </Text>
                </View>
              )}
              {dayStateColor && (
                <View style={[styles.dateNavBadge, {
                  backgroundColor: dayStateColor.color === "LEAN_GAIN" ? "rgba(52, 211, 153, 0.12)"
                    : dayStateColor.color === "CUT" ? "rgba(239, 68, 68, 0.12)"
                    : dayStateColor.color === "RECOMP" ? "rgba(96, 165, 250, 0.12)"
                    : dayStateColor.color === "DELOAD" ? "rgba(251, 191, 36, 0.12)"
                    : "rgba(239, 68, 68, 0.12)",
                }]}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: dayStateColor.color === "LEAN_GAIN" ? "#34D399"
                      : dayStateColor.color === "CUT" ? "#EF4444"
                      : dayStateColor.color === "RECOMP" ? "#60A5FA"
                      : dayStateColor.color === "DELOAD" ? "#FBBF24"
                      : "#EF4444",
                  }} />
                  <Text style={[styles.dateNavBadgeText, {
                    color: dayStateColor.color === "LEAN_GAIN" ? "#34D399"
                      : dayStateColor.color === "CUT" ? "#EF4444"
                      : dayStateColor.color === "RECOMP" ? "#60A5FA"
                      : dayStateColor.color === "DELOAD" ? "#FBBF24"
                      : "#EF4444",
                  }]}>
                    {dayStateColor.label}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable onPress={goToNextDay} style={[styles.dateNavBtn, isToday && { opacity: 0.3 }]} hitSlop={12} disabled={isToday}>
              <Ionicons name="chevron-forward" size={22} color={Colors.text} />
            </Pressable>
          </View>
          {!isToday && (
            <Pressable onPress={goToToday} style={styles.todayChip}>
              <Ionicons name="today-outline" size={14} color={Colors.primary} />
              <Text style={styles.todayChipText}>Jump to Today</Text>
            </Pressable>
          )}
        </View>
      </View>
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: 8,
            paddingBottom: Platform.OS === "web" ? 84 + 34 : insets.bottom + 120,
          },
        ]}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Meal Execution</Text>
          {([
            ["preCardio", "Pre-cardio"],
            ["postCardio", "Post-cardio"],
            ["midday", "Midday"],
            ["preLift", "Pre-lift"],
            ["postLift", "Post-lift"],
            ["evening", "Evening"],
          ] as const).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                setMealChecklist(prev => ({ ...prev, [key]: !prev[key] }));
              }}
              style={styles.mealCheckRow}
            >
              <Ionicons
                name={mealChecklist[key] ? "checkbox" : "square-outline"}
                size={22}
                color={mealChecklist[key] ? Colors.primary : Colors.textTertiary}
              />
              <Text style={[styles.mealCheckLabel, mealChecklist[key] && styles.mealCheckLabelDone]}>
                {label}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: mealChecklist[key] ? Colors.primary : Colors.textTertiary, marginLeft: "auto" }}>
                {MEAL_CALORIES[key]} kcal
              </Text>
            </Pressable>
          ))}
          <View style={styles.mealCheckSummary}>
            <Text style={styles.mealCheckSummaryText}>
              Execution: {Object.values(mealChecklist).filter(Boolean).length} / 6 complete  ·  {computeMealCalories(mealChecklist)} kcal
            </Text>
          </View>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            saved && { backgroundColor: Colors.success },
          ]}
        >
          {saved ? (
            <View style={styles.saveBtnContent}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.saveBtnText}>Saved</Text>
            </View>
          ) : (
            <View style={styles.saveBtnContent}>
              <Ionicons name={hasExisting ? "refresh-outline" : "save-outline"} size={20} color="#fff" />
              <Text style={styles.saveBtnText}>{saving ? "Saving..." : hasExisting ? "Update Entry" : "Save Entry"}</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Weight</Text>
          <InputField
            label="Morning Weight"
            value={morningWeight}
            onChangeText={setMorningWeight}
            placeholder="e.g. 175.5"
            keyboardType="decimal-pad"
            icon="scale-outline"
            iconColor={Colors.primary}
            suffix="lb"
          />
          <InputField
            label="Evening Weight"
            value={eveningWeight}
            onChangeText={setEveningWeight}
            placeholder="Optional"
            keyboardType="decimal-pad"
            icon="scale-outline"
            iconColor={Colors.textTertiary}
            suffix="lb"
          />
          <InputField
            label="Waist at Navel"
            value={waist}
            onChangeText={setWaist}
            placeholder="Optional"
            keyboardType="decimal-pad"
            icon="resize-outline"
            iconColor={Colors.secondary}
            suffix="in"
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Body Fat (BIA)</Text>
          <Text style={styles.bfHint}>Enter 3 handheld readings (AM). Script averages them.</Text>
          <View style={styles.bfRow}>
            <View style={styles.bfField}>
              <Text style={styles.bfFieldLabel}>AM 1</Text>
              <TextInput
                style={styles.bfInput}
                value={bfAmR1}
                onChangeText={setBfAmR1}
                placeholder="%"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                keyboardAppearance="dark"
              />
            </View>
            <View style={styles.bfField}>
              <Text style={styles.bfFieldLabel}>AM 2</Text>
              <TextInput
                style={styles.bfInput}
                value={bfAmR2}
                onChangeText={setBfAmR2}
                placeholder="%"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                keyboardAppearance="dark"
              />
            </View>
            <View style={styles.bfField}>
              <Text style={styles.bfFieldLabel}>AM 3</Text>
              <TextInput
                style={styles.bfInput}
                value={bfAmR3}
                onChangeText={setBfAmR3}
                placeholder="%"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                keyboardAppearance="dark"
              />
            </View>
            {(() => {
              const a = avg3(
                bfAmR1 ? parseFloat(bfAmR1) : undefined,
                bfAmR2 ? parseFloat(bfAmR2) : undefined,
                bfAmR3 ? parseFloat(bfAmR3) : undefined,
              );
              return (
                <View style={styles.bfAvg}>
                  <Text style={styles.bfAvgLabel}>Avg</Text>
                  <Text style={[styles.bfAvgValue, a != null && { color: Colors.primary }]}>
                    {a != null ? fmtPctVal(a, 1) : "--"}
                  </Text>
                </View>
              );
            })()}
          </View>
          <Text style={[styles.bfHint, { marginTop: 10 }]}>PM readings (optional)</Text>
          <View style={styles.bfRow}>
            <View style={styles.bfField}>
              <Text style={styles.bfFieldLabel}>PM 1</Text>
              <TextInput
                style={styles.bfInput}
                value={bfPmR1}
                onChangeText={setBfPmR1}
                placeholder="%"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                keyboardAppearance="dark"
              />
            </View>
            <View style={styles.bfField}>
              <Text style={styles.bfFieldLabel}>PM 2</Text>
              <TextInput
                style={styles.bfInput}
                value={bfPmR2}
                onChangeText={setBfPmR2}
                placeholder="%"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                keyboardAppearance="dark"
              />
            </View>
            <View style={styles.bfField}>
              <Text style={styles.bfFieldLabel}>PM 3</Text>
              <TextInput
                style={styles.bfInput}
                value={bfPmR3}
                onChangeText={setBfPmR3}
                placeholder="%"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                keyboardAppearance="dark"
              />
            </View>
            {(() => {
              const a = avg3(
                bfPmR1 ? parseFloat(bfPmR1) : undefined,
                bfPmR2 ? parseFloat(bfPmR2) : undefined,
                bfPmR3 ? parseFloat(bfPmR3) : undefined,
              );
              return (
                <View style={styles.bfAvg}>
                  <Text style={styles.bfAvgLabel}>Avg</Text>
                  <Text style={[styles.bfAvgValue, a != null && { color: Colors.secondary }]}>
                    {a != null ? fmtPctVal(a, 1) : "--"}
                  </Text>
                </View>
              );
            })()}
          </View>
        </View>

        <View style={[styles.sectionCard, { borderColor: "#A78BFA20" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Ionicons name="body-outline" size={14} color="#A78BFA" />
            <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: "#A78BFA" }}>Fat-Free Mass</Text>
            <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginLeft: "auto" }}>measured only</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={fatFreeMass}
                  onChangeText={setFatFreeMass}
                  placeholder="e.g. 145.2"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                  keyboardAppearance="dark"
                />
                <Text style={styles.inputSuffix}>lb</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.sectionCard, { borderColor: "#F5925620" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Ionicons name="barbell-outline" size={14} color="#F59256" />
            <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: "#F59256" }}>Strength Tracking</Text>
            <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginLeft: "auto" }}>reps to failure or top set</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 4 }}>Pushups</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={pushupsReps}
                  onChangeText={setPushupsReps}
                  placeholder="reps"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 4 }}>Pullups</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={pullupsReps}
                  onChangeText={setPullupsReps}
                  placeholder="reps"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                />
              </View>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 4 }}>Bench reps</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={benchReps}
                  onChangeText={setBenchReps}
                  placeholder="reps"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 4 }}>Bench weight</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={benchWeight}
                  onChangeText={setBenchWeight}
                  placeholder="45"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                  keyboardAppearance="dark"
                />
                <Text style={styles.inputSuffix}>lb</Text>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 4 }}>OHP reps</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={ohpReps}
                  onChangeText={setOhpReps}
                  placeholder="reps"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 4 }}>OHP weight</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={ohpWeight}
                  onChangeText={setOhpWeight}
                  placeholder="45"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                  keyboardAppearance="dark"
                />
                <Text style={styles.inputSuffix}>lb</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Sleep — Self-Report</Text>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Actual Bed</Text>
              <TextInput
                style={styles.timeInput}
                value={actualBedTime}
                onChangeText={setActualBedTime}
                placeholder="21:45"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <Ionicons name="arrow-forward" size={16} color={Colors.textTertiary} style={{ marginTop: 24 }} />
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Actual Wake</Text>
              <TextInput
                style={styles.timeInput}
                value={actualWakeTime}
                onChangeText={setActualWakeTime}
                placeholder="05:30"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
          </View>
          {sleepDerived.sleepSourceMode != null && sleepDerived.tib != null && sleepDerived.tst != null && (
            <View style={{ backgroundColor: Colors.surface, borderRadius: 10, padding: 10, gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>TIB</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_600SemiBold", color: Colors.textPrimary }}>{Math.floor(sleepDerived.tib / 60)}h {sleepDerived.tib % 60}m</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>TST</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_600SemiBold", color: Colors.primary }}>{Math.floor(sleepDerived.tst / 60)}h {sleepDerived.tst % 60}m</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Eff</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_600SemiBold", color: (sleepDerived.efficiency ?? 0) >= 85 ? "#34D399" : (sleepDerived.efficiency ?? 0) >= 70 ? "#FBBF24" : "#EF4444" }}>{sleepDerived.efficiency ?? 0}%</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>WASO est</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: sleepDerived.wasoEst != null && sleepDerived.wasoEst <= 30 ? "#34D399" : sleepDerived.wasoEst != null && sleepDerived.wasoEst <= 60 ? "#FBBF24" : "#EF4444" }}>{sleepDerived.wasoEst != null ? `${sleepDerived.wasoEst}m` : "—"}</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Latency est</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: sleepDerived.latencyProxy != null && sleepDerived.latencyProxy <= 15 ? "#34D399" : sleepDerived.latencyProxy != null && sleepDerived.latencyProxy <= 30 ? "#FBBF24" : "#EF4444" }}>{sleepDerived.latencyProxy != null ? `${sleepDerived.latencyProxy}m` : "—"}</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Awake in bed</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: sleepDerived.awakeInBed != null && sleepDerived.awakeInBed <= 30 ? "#34D399" : sleepDerived.awakeInBed != null && sleepDerived.awakeInBed <= 60 ? "#FBBF24" : "#EF4444" }}>{sleepDerived.awakeInBed != null ? `${sleepDerived.awakeInBed}m` : "—"}</Text>
                </View>
              </View>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, textAlign: "center" as const, marginTop: 2 }}>
                source: {sleepDerived.sleepSourceMode}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="eye-off-outline" size={14} color={Colors.secondary} />
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Awake</Text>
              </View>
              <TextInput
                style={styles.inputCompact}
                value={sleepAwakeMin}
                onChangeText={handleMinuteSetter(setSleepAwakeMin)}
                placeholder="30"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="cloudy-night-outline" size={14} color={Colors.secondary} />
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>REM</Text>
              </View>
              <TextInput
                style={styles.inputCompact}
                value={sleepRemMin}
                onChangeText={handleMinuteSetter(setSleepRemMin)}
                placeholder="94"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="moon-outline" size={14} color={Colors.secondary} />
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Core</Text>
              </View>
              <TextInput
                style={styles.inputCompact}
                value={sleepCoreMin}
                onChangeText={handleMinuteSetter(setSleepCoreMin)}
                placeholder="210"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="bed-outline" size={14} color={Colors.secondary} />
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Deep</Text>
              </View>
              <TextInput
                style={styles.inputCompact}
                value={sleepDeepMin}
                onChangeText={handleMinuteSetter(setSleepDeepMin)}
                placeholder="60"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="sunny-outline" size={16} color={Colors.secondary} />
                <Text style={styles.inputLabelText}>Nap (min)</Text>
              </View>
              <TextInput
                style={styles.input}
                value={napMinutes}
                onChangeText={handleMinuteSetter(setNapMinutes)}
                placeholder="0 or 0:20"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="star-outline" size={16} color={Colors.secondary} />
                <Text style={styles.inputLabelText}>Quality</Text>
              </View>
              <SleepQualitySelector value={sleepQuality} onChange={setSleepQuality} />
            </View>
          </View>
          {(() => {
            const planBed = sleepPlan?.bedtime || null;
            const planWake = sleepPlan?.wake || null;
            const dev = computeClientDeviation({
              planBed,
              planWake,
              srBed: actualBedTime || null,
              srWake: actualWakeTime || null,
              fitbitSleepMin: undefined,
              latencyMin: sleepDerived.latencyProxy ?? undefined,
              wasoMin: sleepDerived.wasoEst ?? undefined,
            });
            const humanLabel = deviationHumanLabel(dev.classification);
            if (!humanLabel) return null;
            const shortfallStr = dev.shortfallMin != null && dev.shortfallMin > 0 ? ` \u00B7 shortfall +${dev.shortfallMin}m` : "";
            return (
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingHorizontal: 4, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Sleep Deviation</Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: Colors.textSecondary }}>{humanLabel}</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 1 }}>
                    {dev.deviationLabel}{shortfallStr}
                  </Text>
                </View>
              </View>
            );
          })()}
          <View style={styles.inputGroup}>
            <View style={styles.inputLabel}>
              <Ionicons name="refresh-outline" size={16} color={Colors.secondary} />
              <Text style={styles.inputLabelText}>Toss & Turn (min)</Text>
            </View>
            <TextInput
              style={styles.input}
              value={tossedMinutes}
              onChangeText={handleMinuteSetter(setTossedMinutes)}
              placeholder="0 or 0:15"
              placeholderTextColor={Colors.textTertiary}
              keyboardAppearance="dark"
            />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Activity</Text>
          <InputField
            label="Steps"
            value={steps}
            onChangeText={setSteps}
            placeholder="Optional"
            keyboardType="number-pad"
            icon="footsteps-outline"
            iconColor={Colors.primary}
          />
          <View style={[styles.sectionCard, { borderColor: cardioSkipped ? "#6B728020" : "#EF444420", marginHorizontal: 0, paddingHorizontal: 10, paddingVertical: 10, marginTop: 8 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Ionicons name="heart-outline" size={14} color={cardioSkipped ? "#6B7280" : "#EF4444"} />
              <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: cardioSkipped ? "#6B7280" : "#EF4444" }}>Cardio Session</Text>
              <Pressable
                onPress={() => setCardioSkipped(!cardioSkipped)}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", backgroundColor: cardioSkipped ? "#EF444418" : "#1A1A2E", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: cardioSkipped ? "#EF444440" : "#333" }}
              >
                <Ionicons name={cardioSkipped ? "close-circle" : "checkmark-circle-outline"} size={12} color={cardioSkipped ? "#EF4444" : "#6B7280"} />
                <Text style={{ fontSize: 9, fontFamily: "Rubik_500Medium", color: cardioSkipped ? "#EF4444" : "#6B7280" }}>{cardioSkipped ? "Skipped" : "Skip"}</Text>
              </Pressable>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>06:00–06:40</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="play-outline" size={12} color="#60A5FA" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Start</Text>
                </View>
                <TextInput
                  style={styles.inputCompact}
                  value={cardioStartTime}
                  onChangeText={(t) => {
                    setCardioStartTime(t);
                    if (t && cardioEndTime) {
                      const [sh, sm] = t.split(":").map(Number);
                      const [eh, em] = cardioEndTime.split(":").map(Number);
                      if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
                        let dur = (eh * 60 + em) - (sh * 60 + sm);
                        if (dur < 0) dur += 1440;
                        setCardio(dur.toString());
                      }
                    }
                  }}
                  placeholder="06:00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardAppearance="dark"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="stop-outline" size={12} color="#EF4444" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>End</Text>
                </View>
                <TextInput
                  style={styles.inputCompact}
                  value={cardioEndTime}
                  onChangeText={(t) => {
                    setCardioEndTime(t);
                    if (cardioStartTime && t) {
                      const [sh, sm] = cardioStartTime.split(":").map(Number);
                      const [eh, em] = t.split(":").map(Number);
                      if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
                        let dur = (eh * 60 + em) - (sh * 60 + sm);
                        if (dur < 0) dur += 1440;
                        setCardio(dur.toString());
                      }
                    }
                  }}
                  placeholder="06:40"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardAppearance="dark"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="time-outline" size={12} color={Colors.primary} />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Dur</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.inputCompact}
                    value={cardio}
                    onChangeText={handleMinuteSetter(setCardio)}
                    placeholder="40"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                  <Text style={styles.inputSuffix}>m</Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, marginBottom: 4 }}>
              <Ionicons name="speedometer-outline" size={10} color={Colors.textTertiary} />
              <Text style={{ fontSize: 9, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>HR Zones (min or H:MM)</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {([
                { label: "Z1", color: "#9CA3AF", val: zone1, set: setZone1 },
                { label: "Z2", color: "#34D399", val: zone2, set: setZone2 },
                { label: "Z3", color: "#FBBF24", val: zone3, set: setZone3 },
                { label: "Z4", color: "#F97316", val: zone4, set: setZone4 },
                { label: "Z5", color: "#EF4444", val: zone5, set: setZone5 },
              ] as const).map((z) => (
                <View key={z.label} style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, fontFamily: "Rubik_600SemiBold", color: z.color, textAlign: "center", marginBottom: 3 }}>{z.label}</Text>
                  <TextInput
                    style={{
                      backgroundColor: Colors.inputBg,
                      borderRadius: 8,
                      paddingHorizontal: 4,
                      paddingVertical: 8,
                      fontSize: 13,
                      fontFamily: "Rubik_400Regular",
                      color: Colors.text,
                      borderWidth: 1,
                      borderColor: Colors.border,
                      textAlign: "center",
                    }}
                    value={z.val}
                    onChangeText={handleMinuteSetter(z.set)}
                    placeholder="—"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                    keyboardAppearance="dark"
                  />
                </View>
              ))}</View>
          </View>
          <View style={[styles.sectionCard, { borderColor: liftSkipped ? "#6B728020" : "#FBBF2420", marginHorizontal: 0, paddingHorizontal: 10, paddingVertical: 10, marginTop: 8 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Ionicons name="barbell-outline" size={14} color={liftSkipped ? "#6B7280" : "#FBBF24"} />
              <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: liftSkipped ? "#6B7280" : "#FBBF24" }}>Lift Session</Text>
              <Pressable
                onPress={() => setLiftSkipped(!liftSkipped)}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", backgroundColor: liftSkipped ? "#EF444418" : "#1A1A2E", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: liftSkipped ? "#EF444440" : "#333" }}
              >
                <Ionicons name={liftSkipped ? "close-circle" : "checkmark-circle-outline"} size={12} color={liftSkipped ? "#EF4444" : "#6B7280"} />
                <Text style={{ fontSize: 9, fontFamily: "Rubik_500Medium", color: liftSkipped ? "#EF4444" : "#6B7280" }}>{liftSkipped ? "Skipped" : "Skip"}</Text>
              </Pressable>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>17:00–18:15</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="play-outline" size={12} color="#60A5FA" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Start</Text>
                </View>
                <TextInput
                  style={styles.inputCompact}
                  value={liftStartTime}
                  onChangeText={(t) => {
                    setLiftStartTime(t);
                    if (t && liftEndTime) {
                      const [sh, sm] = t.split(":").map(Number);
                      const [eh, em] = liftEndTime.split(":").map(Number);
                      if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
                        let dur = (eh * 60 + em) - (sh * 60 + sm);
                        if (dur < 0) dur += 1440;
                        setLiftMin(dur.toString());
                      }
                    }
                  }}
                  placeholder="17:00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardAppearance="dark"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="stop-outline" size={12} color="#EF4444" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>End</Text>
                </View>
                <TextInput
                  style={styles.inputCompact}
                  value={liftEndTime}
                  onChangeText={(t) => {
                    setLiftEndTime(t);
                    if (liftStartTime && t) {
                      const [sh, sm] = liftStartTime.split(":").map(Number);
                      const [eh, em] = t.split(":").map(Number);
                      if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
                        let dur = (eh * 60 + em) - (sh * 60 + sm);
                        if (dur < 0) dur += 1440;
                        setLiftMin(dur.toString());
                      }
                    }
                  }}
                  placeholder="18:15"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardAppearance="dark"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="time-outline" size={12} color="#FBBF24" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Dur</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.inputCompact}
                    value={liftMin}
                    onChangeText={handleMinuteSetter(setLiftMin)}
                    placeholder="75"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                  <Text style={styles.inputSuffix}>m</Text>
                </View>
              </View>
              <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="fitness-outline" size={12} color="#FBBF24" />
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>Work</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.inputCompact}
                    value={liftWorkingMin}
                    onChangeText={handleMinuteSetter(setLiftWorkingMin)}
                    placeholder="50"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                  <Text style={styles.inputSuffix}>m</Text>
                </View>
              </View>
            </View>
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 9, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>Lift HR Zones (min)</Text>
              <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
                {[
                  { label: "Z1", color: "#9CA3AF", val: liftZ1, set: setLiftZ1 },
                  { label: "Z2", color: "#34D399", val: liftZ2, set: setLiftZ2 },
                  { label: "Z3", color: "#FBBF24", val: liftZ3, set: setLiftZ3 },
                  { label: "Z4", color: "#F97316", val: liftZ4, set: setLiftZ4 },
                  { label: "Z5", color: "#EF4444", val: liftZ5, set: setLiftZ5 },
                ].map((z) => (
                  <View key={z.label} style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Rubik_500Medium", color: z.color, textAlign: "center", marginBottom: 2 }}>{z.label}</Text>
                    <TextInput
                      style={[styles.inputCompact, { textAlign: "center" }]}
                      value={z.val}
                      onChangeText={handleMinuteSetter(z.set)}
                      placeholder="0"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="numeric"
                      keyboardAppearance="dark"
                    />
                  </View>
                ))}
              </View>
            </View>
          </View>
          <InputField
            label="Performance Note"
            value={perfNote}
            onChangeText={setPerfNote}
            placeholder='e.g. "bench +5lb", "felt flat"'
            icon="trending-up-outline"
            iconColor={Colors.secondary}
          />
        </View>

        <View style={[styles.sectionCard, { borderColor: "#00D4AA20" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Ionicons name="heart-circle-outline" size={16} color={Colors.primary} />
            <Text style={[styles.sectionLabel, { marginBottom: 0, color: Colors.primary }]}>Recovery Vitals</Text>
          </View>
          <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginBottom: 12 }}>
            Enter manually or auto-filled from device sync
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="moon-outline" size={14} color="#60A5FA" />
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>{hasStagesTST ? "TST" : "Sleep"}</Text>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.inputCompact, hasStagesTST ? { color: Colors.textTertiary } : undefined]}
                  value={sleepMinutesManual}
                  onChangeText={hasStagesTST ? undefined : handleMinuteSetter(setSleepMinutesManual)}
                  editable={!hasStagesTST}
                  placeholder="420"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardAppearance="dark"
                />
                <Text style={styles.inputSuffix}>m</Text>
              </View>
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="pulse-outline" size={14} color="#8B5CF6" />
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>HRV</Text>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.inputCompact}
                  value={hrvManual}
                  onChangeText={setHrvManual}
                  placeholder="45"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                  keyboardAppearance="dark"
                />
                <Text style={styles.inputSuffix}>ms</Text>
              </View>
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="heart-outline" size={14} color="#EF4444" />
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>RHR</Text>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.inputCompact}
                  value={restingHrManual}
                  onChangeText={setRestingHrManual}
                  placeholder="62"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                />
                <Text style={styles.inputSuffix}>bpm</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Training Load</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["none", "light", "moderate", "hard"] as const).map((level) => {
              const isSelected = trainingLoad === level;
              const levelColor = level === "none" ? Colors.textTertiary
                : level === "light" ? "#60A5FA"
                : level === "moderate" ? "#FBBF24"
                : "#EF4444";
              return (
                <Pressable
                  key={level}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTrainingLoad(isSelected ? undefined : level);
                  }}
                  style={[
                    styles.adherenceBtn,
                    { flex: 1 },
                    isSelected && { backgroundColor: levelColor + "25", borderColor: levelColor },
                  ]}
                >
                  <Text style={[styles.adherenceBtnText, isSelected && { color: levelColor }]}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ marginTop: 12 }}>
            <View style={styles.toggleRow}>
              <ToggleButton
                label="Lifted"
                value={liftDone}
                onToggle={() => setLiftDone(liftDone === true ? undefined : true)}
                icon="barbell-outline"
                activeColor={Colors.success}
              />
              <ToggleButton
                label="Deload"
                value={deloadWeek}
                onToggle={() => setDeloadWeek(deloadWeek === true ? undefined : true)}
                icon="pause-circle-outline"
                activeColor={Colors.secondary}
              />
            </View>
          </View>
        </View>

        {fitbitData && (fitbitData.sleepMinutes != null || fitbitData.restingHr != null || fitbitData.hrv != null || fitbitData.energyBurnedKcal != null || fitbitData.zone1Min != null) && (
          <View style={styles.sectionCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <MaterialCommunityIcons name="watch" size={16} color={Colors.primary} />
              <Text style={[styles.sectionLabel, { marginBottom: 0, color: Colors.primary }]}>Fitbit Data</Text>
            </View>
            <View style={{ gap: 8 }}>
              {fitbitData.hrv != null && (
                <View style={fStyles.row}>
                  <View style={fStyles.labelWrap}>
                    <Ionicons name="pulse-outline" size={14} color="#8B5CF6" />
                    <Text style={fStyles.label}>HRV (RMSSD)</Text>
                  </View>
                  <Text style={[fStyles.value, { color: "#8B5CF6" }]}>{fmtVal(fitbitData.hrv, 1)} ms</Text>
                </View>
              )}
              {fitbitData.restingHr != null && (
                <View style={fStyles.row}>
                  <View style={fStyles.labelWrap}>
                    <Ionicons name="heart-outline" size={14} color="#EF4444" />
                    <Text style={fStyles.label}>Resting HR</Text>
                  </View>
                  <Text style={[fStyles.value, { color: "#EF4444" }]}>{fitbitData.restingHr} bpm</Text>
                </View>
              )}
              {fitbitData.sleepMinutes != null && (
                <View style={fStyles.row}>
                  <View style={fStyles.labelWrap}>
                    <Ionicons name="moon-outline" size={14} color="#60A5FA" />
                    <Text style={fStyles.label}>Sleep</Text>
                  </View>
                  <Text style={[fStyles.value, { color: "#60A5FA" }]}>{Math.floor(fitbitData.sleepMinutes / 60)}h {fitbitData.sleepMinutes % 60}m</Text>
                </View>
              )}
              {fitbitData.sleepEfficiency != null && (
                <View style={fStyles.row}>
                  <View style={fStyles.labelWrap}>
                    <Ionicons name="analytics-outline" size={14} color="#60A5FA" />
                    <Text style={fStyles.label}>Sleep Efficiency</Text>
                  </View>
                  <Text style={[fStyles.value, { color: "#60A5FA" }]}>{fmtPctVal(fitbitData.sleepEfficiency, 0)}</Text>
                </View>
              )}
              {(fitbitData.sleepStartLocal || fitbitData.sleepEndLocal) && (
                <View style={fStyles.row}>
                  <View style={fStyles.labelWrap}>
                    <Ionicons name="time-outline" size={14} color="#60A5FA" />
                    <Text style={fStyles.label}>Fitbit Sleep Window</Text>
                  </View>
                  <Text style={fStyles.value}>{fitbitData.sleepStartLocal ?? "--"} - {fitbitData.sleepEndLocal ?? "--"}</Text>
                </View>
              )}
              {fitbitData.energyBurnedKcal != null && (
                <View style={fStyles.row}>
                  <View style={fStyles.labelWrap}>
                    <Ionicons name="flame-outline" size={14} color="#F59E0B" />
                    <Text style={fStyles.label}>Energy Burned</Text>
                  </View>
                  <Text style={[fStyles.value, { color: "#F59E0B" }]}>{fitbitData.energyBurnedKcal.toLocaleString()} kcal</Text>
                </View>
              )}
              {fitbitData.activeZoneMinutes != null && (
                <View style={fStyles.row}>
                  <View style={fStyles.labelWrap}>
                    <Ionicons name="fitness-outline" size={14} color={Colors.success} />
                    <Text style={fStyles.label}>Active Zone Min</Text>
                  </View>
                  <Text style={[fStyles.value, { color: Colors.success }]}>{fitbitData.activeZoneMinutes} min</Text>
                </View>
              )}
              {(fitbitData.zone1Min != null || fitbitData.zone2Min != null || fitbitData.zone3Min != null) && (
                <View style={{ flexDirection: "row", gap: 12, paddingVertical: 6, paddingHorizontal: 4 }}>
                  {fitbitData.belowZone1Min != null && (
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: "#9CA3AF" }}>{fitbitData.belowZone1Min}</Text>
                      <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Below</Text>
                    </View>
                  )}
                  {fitbitData.zone1Min != null && (
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: "#FBBF24" }}>{fitbitData.zone1Min}</Text>
                      <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Fat Burn</Text>
                    </View>
                  )}
                  {fitbitData.zone2Min != null && (
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: "#F97316" }}>{fitbitData.zone2Min}</Text>
                      <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Cardio</Text>
                    </View>
                  )}
                  {fitbitData.zone3Min != null && (
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: "#EF4444" }}>{fitbitData.zone3Min}</Text>
                      <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Peak</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Nutrition</Text>
          <InputField
            label="Calories Consumed"
            value={caloriesIn}
            onChangeText={setCaloriesIn}
            placeholder="e.g. 2700"
            keyboardType="number-pad"
            icon="flame-outline"
            iconColor="#F59E0B"
            suffix="kcal"
          />
          <InputField
            label="Water (extra)"
            value={water}
            onChangeText={setWater}
            placeholder="Outside shakes"
            keyboardType="decimal-pad"
            icon="water-outline"
            iconColor="#60A5FA"
            suffix="L"
          />
          <View style={styles.inputGroup}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={styles.inputLabel}>
                <Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} />
                <Text style={styles.inputLabelText}>Plan Adherence</Text>
              </View>
              <Pressable
                onPress={() => {
                  Alert.alert(
                    "Reset All Adherence",
                    "Clear adherence values from ALL daily log entries? This cannot be undone.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Reset All",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            const baseUrl = getApiUrl();
                            const res = await authFetch(new URL("/api/logs/reset-adherence", baseUrl).toString(), { method: "POST" });
                            const data = await res.json();
                            Alert.alert("Done", `Cleared adherence from ${data.rowsCleared} entries.`);
                            setAdherence(null);
                          } catch {
                            Alert.alert("Error", "Failed to reset adherence.");
                          }
                        },
                      },
                    ],
                  );
                }}
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.danger }}>Reset All</Text>
              </Pressable>
            </View>
            <AdherenceSelector value={adherence} onChange={setAdherence} />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else worth noting..."
            placeholderTextColor={Colors.textTertiary}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            keyboardAppearance="dark"
          />
        </View>

        <View style={styles.sectionCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Ionicons name="bandage-outline" size={16} color="#F59E0B" />
            <Text style={[styles.sectionLabel, { marginBottom: 0, color: "#F59E0B" }]}>Pain / Injury</Text>
            {pain010 != null && pain010 > 0 && (
              <View style={{ marginLeft: "auto", backgroundColor: pain010 >= 7 ? "#F8717120" : pain010 >= 4 ? "#F59E0B20" : "#34D39920", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: pain010 >= 7 ? "#F87171" : pain010 >= 4 ? "#F59E0B" : "#34D399" }}>
                  {pain010}/10
                </Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, width: 16 }}>{pain010 ?? 0}</Text>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setPain010(v === 0 && pain010 === 0 ? null : v);
                    }}
                    style={{
                      width: 26, height: 26, borderRadius: 13,
                      alignItems: "center", justifyContent: "center",
                      backgroundColor: pain010 != null && v <= pain010
                        ? (v >= 7 ? "#F87171" : v >= 4 ? "#F59E0B" : "#34D399") + (v === pain010 ? "40" : "15")
                        : Colors.border,
                    }}
                  >
                    <Text style={{
                      fontSize: 9, fontFamily: v === pain010 ? "Rubik_700Bold" : "Rubik_400Regular",
                      color: pain010 != null && v <= pain010
                        ? (v >= 7 ? "#F87171" : v >= 4 ? "#F59E0B" : "#34D399")
                        : Colors.textTertiary
                    }}>
                      {v}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 8, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>None</Text>
                <Text style={{ fontSize: 8, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Severe</Text>
              </View>
            </View>
          </View>
          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 4 }}>
            {pain010 == null ? "Tap a level to log pain/injury" : pain010 >= 4 ? "Contributes +20 to HPA stress score" : "Below HPA threshold (4+)"}
          </Text>
        </View>

        <View style={[styles.sectionCard, { borderColor: "#8B5CF620" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Ionicons name="prism-outline" size={16} color="#8B5CF6" />
            <Text style={[styles.sectionLabel, { marginBottom: 0, color: "#8B5CF6" }]}>Context Lenses</Text>
            <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginLeft: "auto" }}>
              {activeEpisodes.filter(ep => ep.endDay === null).length > 0 ? `${activeEpisodes.filter(ep => ep.endDay === null).length} active` : "tap to start"}
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: contextShowCustom ? 8 : 0 }}>
            {PRESET_CONTEXT_TAGS.map((preset) => {
              const episode = activeEpisodes.find((ep) => ep.tag === preset.key && ep.endDay === null);
              const isActive = !!episode;
              const tagColor = CONTEXT_TAG_COLORS[preset.key] || "#8B5CF6";
              const isCarriedOver = isActive && episode.startDay < selectedDate;
              const dayCount = isActive ? Math.max(1, Math.round((new Date(selectedDate + "T00:00:00Z").getTime() - new Date(episode.startDay + "T00:00:00Z").getTime()) / 86400000) + 1) : 0;
              return (
                <Pressable
                  key={preset.key}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (isActive) {
                      setContextEditing({
                        tag: preset.key,
                        intensity: episode.intensity,
                        label: episode.label || "",
                        notes: episode.notes || "",
                        episodeId: episode.id,
                        startDay: episode.startDay,
                        isCarriedOver,
                      });
                    } else {
                      setContextEditing({ tag: preset.key, intensity: 1, label: "", notes: "" });
                    }
                  }}
                  style={[
                    ctxStyles.chip,
                    isActive && { backgroundColor: tagColor + "18", borderColor: tagColor + "50" },
                  ]}
                >
                  <Ionicons name={preset.icon as any} size={13} color={isActive ? tagColor : Colors.textTertiary} />
                  <Text style={[ctxStyles.chipText, isActive && { color: tagColor, fontFamily: "Rubik_600SemiBold" }]}>
                    {preset.label}
                  </Text>
                  {isActive && (
                    <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: tagColor + "AA", marginLeft: 2 }}>
                      {isCarriedOver ? `d${dayCount}` : "new"}
                    </Text>
                  )}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setContextShowCustom(!contextShowCustom);
              }}
              style={ctxStyles.addBtn}
            >
              <Ionicons name={contextShowCustom ? "close" : "add"} size={15} color={Colors.primary} />
            </Pressable>
          </View>
          {contextShowCustom && (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                style={[styles.input, { flex: 1, paddingVertical: 8, fontSize: 13 }]}
                value={contextCustomTag}
                onChangeText={setContextCustomTag}
                placeholder="custom tag..."
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
                autoFocus
                onSubmitEditing={() => {
                  const tag = contextCustomTag.trim().toLowerCase().replace(/\s+/g, "_");
                  if (tag) {
                    setContextShowCustom(false);
                    setContextCustomTag("");
                    setContextEditing({ tag, intensity: 1, label: "", notes: "" });
                  }
                }}
              />
              <Pressable
                onPress={() => {
                  const tag = contextCustomTag.trim().toLowerCase().replace(/\s+/g, "_");
                  if (tag) {
                    setContextShowCustom(false);
                    setContextCustomTag("");
                    setContextEditing({ tag, intensity: 1, label: "", notes: "" });
                  }
                }}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "#8B5CF6" }}
              >
                <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: "#fff" }}>Add</Text>
              </Pressable>
            </View>
          )}
        </View>

        <Modal
          visible={contextEditing !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setContextEditing(null)}
        >
          <Pressable style={ctxStyles.modalOverlay} onPress={() => setContextEditing(null)}>
            <Pressable style={ctxStyles.modalCard} onPress={() => {}}>
              {contextEditing && (() => {
                const tagColor = CONTEXT_TAG_COLORS[contextEditing.tag] || "#8B5CF6";
                const isExisting = contextEditing.episodeId != null;
                return (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tagColor }} />
                        <Text style={{ fontSize: 16, fontFamily: "Rubik_700Bold", color: Colors.text }}>
                          {contextEditing.tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Text>
                      </View>
                      <Pressable onPress={() => setContextEditing(null)} hitSlop={12}>
                        <Ionicons name="close" size={22} color={Colors.textTertiary} />
                      </Pressable>
                    </View>

                    {isExisting && contextEditing.startDay && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: tagColor + "10", borderRadius: 8 }}>
                        <Ionicons name="calendar-outline" size={13} color={tagColor} />
                        <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: tagColor }}>
                          Started {contextEditing.startDay}
                          {contextEditing.isCarriedOver ? ` \u00B7 Day ${Math.max(1, Math.round((new Date(selectedDate + "T00:00:00Z").getTime() - new Date(contextEditing.startDay + "T00:00:00Z").getTime()) / 86400000) + 1)}` : ""}
                        </Text>
                      </View>
                    )}

                    {TAG_DEFINITIONS[contextEditing.tag] && (
                      <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginBottom: 14, lineHeight: 17 }}>
                        {TAG_DEFINITIONS[contextEditing.tag]}
                      </Text>
                    )}

                    <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 8 }}>Intensity</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                      {[0, 1, 2, 3].map((level) => {
                        const isSelected = contextEditing.intensity === level;
                        const levelLabels = ["Minimal", "Mild", "Moderate", "High"];
                        const levelColors = [Colors.textTertiary, tagColor, "#FBBF24", "#F87171"];
                        return (
                          <Pressable
                            key={level}
                            onPress={() => {
                              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setContextEditing({ ...contextEditing, intensity: level });
                            }}
                            style={[
                              ctxStyles.intensityBtn,
                              isSelected && { backgroundColor: levelColors[level] + "20", borderColor: levelColors[level] },
                            ]}
                          >
                            <Text style={[ctxStyles.intensityText, isSelected && { color: levelColors[level] }]}>
                              {levelLabels[level]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: -8, marginBottom: 14, lineHeight: 14 }}>
                      {["Negligible impact", "Noticeable shift", "Clear disruption", "Significant impact"][contextEditing.intensity]}
                    </Text>

                    <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 6 }}>Label (optional)</Text>
                    <TextInput
                      style={[styles.input, { marginBottom: 12, fontSize: 14, paddingVertical: 10 }]}
                      value={contextEditing.label}
                      onChangeText={(t) => setContextEditing({ ...contextEditing, label: t })}
                      placeholder='e.g. "magnesium glycinate"'
                      placeholderTextColor={Colors.textTertiary}
                      keyboardAppearance="dark"
                      editable={!isExisting}
                    />

                    <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 6 }}>Notes (optional)</Text>
                    <TextInput
                      style={[styles.input, { marginBottom: 16, fontSize: 14, paddingVertical: 10, minHeight: 60 }]}
                      value={contextEditing.notes}
                      onChangeText={(t) => setContextEditing({ ...contextEditing, notes: t })}
                      placeholder="Any additional details..."
                      placeholderTextColor={Colors.textTertiary}
                      multiline
                      textAlignVertical="top"
                      keyboardAppearance="dark"
                    />

                    <View style={{ flexDirection: "row", gap: 10 }}>
                      {isExisting && (
                        <Pressable
                          testID="conclude-episode-btn"
                          accessibilityLabel="Conclude episode"
                          onPress={() => {
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            concludeEpisode(contextEditing.episodeId!);
                            setContextEditing(null);
                          }}
                          style={ctxStyles.deleteBtn}
                        >
                          <Ionicons name="stop-circle-outline" size={16} color="#F87171" />
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          if (isExisting) {
                            updateEpisodeDetails(contextEditing.episodeId!, contextEditing.intensity, contextEditing.label, contextEditing.notes);
                          } else {
                            startNewEpisode(contextEditing.tag, contextEditing.intensity, contextEditing.label, contextEditing.notes);
                          }
                          setContextEditing(null);
                        }}
                        style={[ctxStyles.saveBtn, { backgroundColor: tagColor }]}
                      >
                        <Ionicons name="checkmark" size={18} color="#fff" />
                        <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: "#fff" }}>
                          {isExisting ? "Update" : "Start Lens"}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                );
              })()}
            </Pressable>
          </Pressable>
        </Modal>

        <View style={[styles.sectionCard, { borderColor: "#8B5CF620" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <MaterialCommunityIcons name="pulse" size={16} color="#8B5CF6" />
            <Text style={[styles.sectionLabel, { marginBottom: 0, color: "#8B5CF6" }]}>Nocturnal Vitals</Text>
          </View>

          {sessionForDate ? (
            <View style={{ backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sessionForDate.isImputed ? "#FBBF24" : "#34D399" }} />
                  <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: sessionForDate.isImputed ? "#FBBF24" : "#34D399" }}>
                    {sessionForDate.isImputed ? "Estimated" : "Measured"}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                  {formatDateLabel(selectedDate)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 20, marginTop: 10 }}>
                <View>
                  <Text style={{ fontSize: 22, fontFamily: "Rubik_700Bold", color: "#8B5CF6" }}>{sessionForDate.erections}</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>erections</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 22, fontFamily: "Rubik_700Bold", color: "#8B5CF6" }}>{formatDur(sessionForDate.durSec)}</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>duration</Text>
                </View>
              </View>
            </View>
          ) : (
            <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginBottom: 10 }}>
              No session data for this date. Upload a cumulative snapshot CSV to add.
            </Text>
          )}

          <Pressable
            onPress={handleSnapshotUpload}
            disabled={uploading}
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "rgba(139,92,246,0.12)",
                borderWidth: 1,
                borderColor: "#8B5CF630",
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#8B5CF6" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color="#8B5CF6" />
                <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: "#8B5CF6" }}>
                  Upload Snapshot for {formatDateLabel(selectedDate)}
                </Text>
              </>
            )}
          </Pressable>

          {uploadResult && (
            <View style={{ marginTop: 8, backgroundColor: "rgba(139,92,246,0.06)", borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textSecondary }}>{uploadResult}</Text>
            </View>
          )}

          <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: "rgba(139,92,246,0.15)", paddingTop: 14 }}>
            <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: "#8B5CF6", marginBottom: 10 }}>
              Manual Entry (Androgen Proxy)
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="trending-up-outline" size={14} color="#8B5CF6" />
                  <Text style={styles.inputLabelText}>Count</Text>
                </View>
                <TextInput
                  style={styles.input}
                  value={nocturnalCount}
                  onChangeText={setNocturnalCount}
                  placeholder="0"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="time-outline" size={14} color="#8B5CF6" />
                  <Text style={styles.inputLabelText}>Duration</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={nocturnalDuration}
                    onChangeText={handleMinuteSetter(setNocturnalDuration)}
                    placeholder="0 or 0:15"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                  <Text style={styles.inputSuffix}>min</Text>
                </View>
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="speedometer-outline" size={14} color="#8B5CF6" />
                  <Text style={styles.inputLabelText}>Firmness</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={firmnessAvg}
                    onChangeText={setFirmnessAvg}
                    placeholder="0-10"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="decimal-pad"
                    keyboardAppearance="dark"
                  />
                </View>
              </View>
            </View>
          </View>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            saved && { backgroundColor: Colors.success },
          ]}
        >
          {saved ? (
            <View style={styles.saveBtnContent}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.saveBtnText}>Saved</Text>
            </View>
          ) : (
            <View style={styles.saveBtnContent}>
              <Ionicons name={hasExisting ? "refresh-outline" : "save-outline"} size={20} color="#fff" />
              <Text style={styles.saveBtnText}>{saving ? "Saving..." : hasExisting ? "Update Entry" : "Save Entry"}</Text>
            </View>
          )}
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  stickyHeader: {
    backgroundColor: Colors.background,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    zIndex: 10,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
    marginBottom: 12,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  dateNavBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  dateNavCenter: {
    flex: 1,
    alignItems: "center",
  },
  dateNavLabel: {
    fontSize: 18,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  dateNavSub: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dateNavBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  dateNavBadgeText: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: Colors.success,
  },
  todayChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.primary + "15",
    borderWidth: 1,
    borderColor: Colors.primary + "40",
  },
  todayChipText: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.primary,
  },
  sectionCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden" as const,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  mealCheckRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  mealCheckLabel: {
    fontSize: 15,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
  },
  mealCheckLabelDone: {
    color: Colors.primary,
    fontFamily: "Rubik_500Medium",
  },
  mealCheckSummary: {
    marginTop: 10,
    paddingTop: 4,
  },
  mealCheckSummaryText: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textSecondary,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  inputLabelText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputCompact: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputSuffix: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    marginLeft: 6,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  timeField: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  timeInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    textAlign: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
  },
  adherenceRow: {
    flexDirection: "row",
    gap: 6,
  },
  adherenceBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  adherenceBtnText: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textTertiary,
  },
  sleepRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    paddingVertical: 4,
  },
  bfHint: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginBottom: 8,
  },
  bfRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-end",
  },
  bfField: {
    flex: 1,
  },
  bfFieldLabel: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    marginBottom: 4,
    textAlign: "center",
  },
  bfInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    textAlign: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bfAvg: {
    width: 56,
    alignItems: "center",
    paddingBottom: 2,
  },
  bfAvgLabel: {
    fontSize: 10,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  bfAvgValue: {
    fontSize: 15,
    fontFamily: "Rubik_700Bold",
    color: Colors.textTertiary,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: "#fff",
  },
});

const fStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 8,
  },
  labelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: "#9CA3AF",
  },
  value: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: "#E5E7EB",
  },
});

const ctxStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.cardBgElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.cardBgElevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.cardBg,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  intensityBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  intensityText: {
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textTertiary,
  },
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(248,113,113,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.3)",
  },
  saveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#8B5CF6",
  },
});
