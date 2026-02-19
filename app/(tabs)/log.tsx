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

function parseMinuteInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    return (parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10)).toString();
  }
  return trimmed;
}

function hhmmToMin(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function clockTibMin(bed: string, wake: string): number | null {
  const b = hhmmToMin(bed);
  const w = hhmmToMin(wake);
  if (b == null || w == null) return null;
  let diff = w - b;
  if (diff <= 0) diff += 24 * 60;
  return diff;
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

function AdherenceSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
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
              onChange(opt.value);
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
  const [liftDone, setLiftDone] = useState<boolean | undefined>();
  const [deloadWeek, setDeloadWeek] = useState<boolean | undefined>();
  const [perfNote, setPerfNote] = useState("");
  const [adherence, setAdherence] = useState(1.0);
  const [notes, setNotes] = useState("");
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
  const [dayStateColor, setDayStateColor] = useState<{ color: string; label: string } | null>(null);

  const isToday = selectedDate === todayStr();
  const isFuture = selectedDate > todayStr();

  const stagesComplete = !!(sleepAwakeMin && sleepRemMin && sleepCoreMin && sleepDeepMin);
  const stageSumTIB = stagesComplete
    ? parseInt(sleepAwakeMin, 10) + parseInt(sleepRemMin, 10) + parseInt(sleepCoreMin, 10) + parseInt(sleepDeepMin, 10)
    : null;
  const derivedTST = stagesComplete
    ? parseInt(sleepRemMin, 10) + parseInt(sleepCoreMin, 10) + parseInt(sleepDeepMin, 10)
    : null;

  const clockTIB = (actualBedTime && actualWakeTime)
    ? clockTibMin(actualBedTime, actualWakeTime)
    : null;
  const derivedTIB = clockTIB ?? stageSumTIB;

  const sleepSourceModeVal: "clock" | "stages" | null = stagesComplete
    ? (clockTIB != null ? "clock" : "stages")
    : null;

  const derivedAwakeInBed = (derivedTIB != null && derivedTST != null)
    ? Math.max(0, derivedTIB - derivedTST)
    : null;
  const derivedWASO = stagesComplete ? parseInt(sleepAwakeMin, 10) : null;
  const derivedLatency = (derivedAwakeInBed != null && derivedWASO != null)
    ? Math.max(0, derivedAwakeInBed - derivedWASO)
    : null;

  useEffect(() => {
    if (derivedTST != null && !isNaN(derivedTST)) {
      setSleepMinutesManual(derivedTST.toString());
    }
  }, [derivedTST]);

  useEffect(() => {
    if (derivedWASO != null) {
      setSleepWaso(derivedWASO.toString());
    }
  }, [derivedWASO]);

  useEffect(() => {
    if (derivedLatency != null) {
      setSleepLatency(derivedLatency.toString());
    }
  }, [derivedLatency]);

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
      setLiftDone(existing.liftDone);
      setDeloadWeek(existing.deloadWeek);
      setPerfNote(existing.performanceNote || "");
      setAdherence(existing.adherence ?? 1);
      setNotes(existing.notes || "");
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
      if (!sleepPlan) loadSleepPlan();
      setUploadResult(null);
    }, [selectedDate])
  );

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
    setLiftDone(undefined);
    setDeloadWeek(undefined);
    setPerfNote("");
    setAdherence(1.0);
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
        sleepLatencyMin: sleepLatency ? parseInt(sleepLatency, 10) : undefined,
        sleepWasoMin: sleepWaso ? parseInt(sleepWaso, 10) : undefined,
        napMinutes: napMinutes ? parseInt(napMinutes, 10) : undefined,
        sleepAwakeMin: sleepAwakeMin ? parseInt(sleepAwakeMin, 10) : undefined,
        sleepRemMin: sleepRemMin ? parseInt(sleepRemMin, 10) : undefined,
        sleepCoreMin: sleepCoreMin ? parseInt(sleepCoreMin, 10) : undefined,
        sleepDeepMin: sleepDeepMin ? parseInt(sleepDeepMin, 10) : undefined,
        sleepSourceMode: sleepSourceModeVal ?? undefined,
        waterLiters: water ? parseFloat(water) : undefined,
        steps: steps ? parseInt(steps, 10) : undefined,
        cardioMin: cardio ? parseInt(cardio, 10) : undefined,
        cardioStartTime: cardioStartTime || undefined,
        cardioEndTime: cardioEndTime || undefined,
        liftStartTime: liftStartTime || undefined,
        liftEndTime: liftEndTime || undefined,
        liftMin: liftMin ? parseInt(liftMin, 10) : undefined,
        liftDone,
        deloadWeek,
        performanceNote: perfNote || undefined,
        adherence,
        notes: notes || undefined,
        sleepMinutes: sleepMinutesManual ? parseInt(sleepMinutesManual, 10) : undefined,
        hrv: hrvManual ? parseFloat(hrvManual) : undefined,
        restingHr: restingHrManual ? parseInt(restingHrManual, 10) : undefined,
        caloriesIn: caloriesIn ? parseInt(caloriesIn, 10) : undefined,
        trainingLoad: trainingLoad || undefined,
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
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: topInset + 16,
            paddingBottom: Platform.OS === "web" ? 84 + 34 : insets.bottom + 120,
          },
        ]}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
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
                    {a != null ? `${a.toFixed(1)}%` : "--"}
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
                    {a != null ? `${a.toFixed(1)}%` : "--"}
                  </Text>
                </View>
              );
            })()}
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
                placeholder="22:15"
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
                placeholder="05:45"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
          </View>
          {stagesComplete && derivedTIB != null && derivedTST != null && (
            <View style={{ backgroundColor: Colors.surface, borderRadius: 10, padding: 10, gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>TIB</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_600SemiBold", color: Colors.textPrimary }}>{Math.floor(derivedTIB / 60)}h {derivedTIB % 60}m</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>TST</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_600SemiBold", color: Colors.primary }}>{Math.floor(derivedTST / 60)}h {derivedTST % 60}m</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Eff</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_600SemiBold", color: derivedTST / derivedTIB >= 0.85 ? "#34D399" : derivedTST / derivedTIB >= 0.7 ? "#FBBF24" : "#EF4444" }}>{Math.round((derivedTST / derivedTIB) * 100)}%</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>WASO</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: derivedWASO != null && derivedWASO <= 30 ? "#34D399" : derivedWASO != null && derivedWASO <= 60 ? "#FBBF24" : "#EF4444" }}>{derivedWASO ?? 0}m</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Latency</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: derivedLatency != null && derivedLatency <= 15 ? "#34D399" : derivedLatency != null && derivedLatency <= 30 ? "#FBBF24" : "#EF4444" }}>{derivedLatency ?? 0}m</Text>
                </View>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Awake</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Rubik_600SemiBold", color: derivedAwakeInBed != null && derivedAwakeInBed <= 30 ? "#34D399" : derivedAwakeInBed != null && derivedAwakeInBed <= 60 ? "#FBBF24" : "#EF4444" }}>{derivedAwakeInBed ?? 0}m</Text>
                </View>
              </View>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="eye-off-outline" size={16} color={Colors.secondary} />
                <Text style={styles.inputLabelText}>Awake</Text>
              </View>
              <TextInput
                style={styles.input}
                value={sleepAwakeMin}
                onChangeText={handleMinuteSetter(setSleepAwakeMin)}
                placeholder="30 or 0:30"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="cloudy-night-outline" size={16} color={Colors.secondary} />
                <Text style={styles.inputLabelText}>REM</Text>
              </View>
              <TextInput
                style={styles.input}
                value={sleepRemMin}
                onChangeText={handleMinuteSetter(setSleepRemMin)}
                placeholder="94 or 1:34"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="moon-outline" size={16} color={Colors.secondary} />
                <Text style={styles.inputLabelText}>Core</Text>
              </View>
              <TextInput
                style={styles.input}
                value={sleepCoreMin}
                onChangeText={handleMinuteSetter(setSleepCoreMin)}
                placeholder="210 or 3:30"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="bed-outline" size={16} color={Colors.secondary} />
                <Text style={styles.inputLabelText}>Deep</Text>
              </View>
              <TextInput
                style={styles.input}
                value={sleepDeepMin}
                onChangeText={handleMinuteSetter(setSleepDeepMin)}
                placeholder="60 or 1:00"
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
              latencyMin: sleepLatency ? parseInt(sleepLatency, 10) : undefined,
              wasoMin: sleepWaso ? parseInt(sleepWaso, 10) : undefined,
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
          <View style={[styles.sectionCard, { borderColor: "#EF444420", marginHorizontal: 0, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Ionicons name="heart-outline" size={14} color="#EF4444" />
              <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: "#EF4444" }}>Cardio Session</Text>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginLeft: "auto" }}>Z2 Rebounder 06:00-06:40</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="play-outline" size={14} color="#60A5FA" />
                  <Text style={styles.inputLabelText}>Start</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
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
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="stop-outline" size={14} color="#EF4444" />
                  <Text style={styles.inputLabelText}>End</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
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
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="time-outline" size={14} color={Colors.primary} />
                  <Text style={styles.inputLabelText}>Duration</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={cardio}
                    onChangeText={handleMinuteSetter(setCardio)}
                    placeholder="40 or 0:40"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                  <Text style={styles.inputSuffix}>min</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={[styles.sectionCard, { borderColor: "#FBBF2420", marginHorizontal: 0, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Ionicons name="barbell-outline" size={14} color="#FBBF24" />
              <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: "#FBBF24" }}>Lift Session</Text>
              <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginLeft: "auto" }}>15:45-17:00</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="play-outline" size={14} color="#60A5FA" />
                  <Text style={styles.inputLabelText}>Start</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
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
                    placeholder="15:45"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                </View>
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="stop-outline" size={14} color="#EF4444" />
                  <Text style={styles.inputLabelText}>End</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
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
                    placeholder="17:00"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                </View>
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.inputLabel}>
                  <Ionicons name="time-outline" size={14} color="#FBBF24" />
                  <Text style={styles.inputLabelText}>Duration</Text>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={liftMin}
                    onChangeText={handleMinuteSetter(setLiftMin)}
                    placeholder="75 or 1:15"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardAppearance="dark"
                  />
                  <Text style={styles.inputSuffix}>min</Text>
                </View>
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
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="moon-outline" size={16} color="#60A5FA" />
                <Text style={styles.inputLabelText}>{stagesComplete ? "TST" : "Sleep"}</Text>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, stagesComplete ? { color: Colors.textTertiary } : undefined]}
                  value={sleepMinutesManual}
                  onChangeText={stagesComplete ? undefined : handleMinuteSetter(setSleepMinutesManual)}
                  editable={!stagesComplete}
                  placeholder="420 or 7:00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardAppearance="dark"
                />
                <Text style={styles.inputSuffix}>min</Text>
              </View>
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.inputLabel}>
                <Ionicons name="pulse-outline" size={16} color="#8B5CF6" />
                <Text style={styles.inputLabelText}>HRV</Text>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
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
                <Ionicons name="heart-outline" size={16} color="#EF4444" />
                <Text style={styles.inputLabelText}>RHR</Text>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
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
                  <Text style={[fStyles.value, { color: "#8B5CF6" }]}>{fitbitData.hrv.toFixed(1)} ms</Text>
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
                  <Text style={[fStyles.value, { color: "#60A5FA" }]}>{fitbitData.sleepEfficiency.toFixed(0)}%</Text>
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
            <View style={styles.inputLabel}>
              <Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} />
              <Text style={styles.inputLabelText}>Plan Adherence</Text>
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
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 12,
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputSuffix: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    marginLeft: 8,
    width: 24,
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
