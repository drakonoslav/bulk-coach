import React, { useCallback, useState, useRef } from "react";
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
import { getApiUrl } from "@/lib/query-client";
import { fetch as expoFetch } from "expo/fetch";

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
  const [water, setWater] = useState("");
  const [steps, setSteps] = useState("");
  const [cardio, setCardio] = useState("");
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

  const isToday = selectedDate === todayStr();
  const isFuture = selectedDate > todayStr();

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
      setWater(existing.waterLiters?.toString() || "");
      setSteps(existing.steps?.toString() || "");
      setCardio(existing.cardioMin?.toString() || "");
      setLiftDone(existing.liftDone);
      setDeloadWeek(existing.deloadWeek);
      setPerfNote(existing.performanceNote || "");
      setAdherence(existing.adherence ?? 1);
      setNotes(existing.notes || "");
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
      const res = await expoFetch(new URL("/api/erection/badges", baseUrl).toString(), { credentials: "include" });
      if (res.ok) setErectionBadges(await res.json());
    } catch {}
  }, []);

  const loadReadinessForDate = useCallback(async (day: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await expoFetch(new URL(`/api/readiness?date=${day}`, baseUrl).toString(), { credentials: "include" });
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
      const res = await expoFetch(new URL("/api/erection/sessions", baseUrl).toString(), { credentials: "include" });
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

  useFocusEffect(
    useCallback(() => {
      loadDateEntry(selectedDate);
      loadErectionBadges();
      loadSessionForDate(selectedDate);
      loadReadinessForDate(selectedDate);
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

      const uploadRes = await expoFetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
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
    setWater("");
    setSteps("");
    setCardio("");
    setLiftDone(undefined);
    setDeloadWeek(undefined);
    setPerfNote("");
    setAdherence(1.0);
    setNotes("");
    setSaved(false);
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
        waterLiters: water ? parseFloat(water) : undefined,
        steps: steps ? parseInt(steps, 10) : undefined,
        cardioMin: cardio ? parseInt(cardio, 10) : undefined,
        liftDone,
        deloadWeek,
        performanceNote: perfNote || undefined,
        adherence,
        notes: notes || undefined,
      };

      await saveEntry(entry);
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
                  backgroundColor: readinessBadge.tier === "GREEN" ? "rgba(52, 211, 153, 0.12)" : readinessBadge.tier === "RED" ? "rgba(239, 68, 68, 0.12)" : "rgba(251, 191, 36, 0.12)",
                }]}>
                  <Ionicons
                    name={readinessBadge.tier === "GREEN" ? "flash" : readinessBadge.tier === "RED" ? "bed" : "pause-circle"}
                    size={12}
                    color={readinessBadge.tier === "GREEN" ? "#34D399" : readinessBadge.tier === "RED" ? "#EF4444" : "#FBBF24"}
                  />
                  <Text style={[styles.dateNavBadgeText, {
                    color: readinessBadge.tier === "GREEN" ? "#34D399" : readinessBadge.tier === "RED" ? "#EF4444" : "#FBBF24",
                  }]}>
                    {readinessBadge.tier === "GREEN" ? "Ready" : readinessBadge.tier === "RED" ? "Low" : "Normal"} {readinessBadge.score}
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
          <Text style={styles.sectionLabel}>Sleep</Text>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Bedtime</Text>
              <TextInput
                style={styles.timeInput}
                value={sleepStart}
                onChangeText={setSleepStart}
                placeholder="22:30"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
            <Ionicons name="arrow-forward" size={16} color={Colors.textTertiary} style={{ marginTop: 24 }} />
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Wake Up</Text>
              <TextInput
                style={styles.timeInput}
                value={sleepEnd}
                onChangeText={setSleepEnd}
                placeholder="06:30"
                placeholderTextColor={Colors.textTertiary}
                keyboardAppearance="dark"
              />
            </View>
          </View>
          <View style={styles.inputGroup}>
            <View style={styles.inputLabel}>
              <Ionicons name="star-outline" size={16} color={Colors.secondary} />
              <Text style={styles.inputLabelText}>Sleep Quality</Text>
            </View>
            <SleepQualitySelector value={sleepQuality} onChange={setSleepQuality} />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Activity</Text>
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
          <InputField
            label="Steps"
            value={steps}
            onChangeText={setSteps}
            placeholder="Optional"
            keyboardType="number-pad"
            icon="footsteps-outline"
            iconColor={Colors.primary}
          />
          <InputField
            label="Cardio"
            value={cardio}
            onChangeText={setCardio}
            placeholder="Optional"
            keyboardType="number-pad"
            icon="heart-outline"
            iconColor={Colors.danger}
            suffix="min"
          />
          <InputField
            label="Performance Note"
            value={perfNote}
            onChangeText={setPerfNote}
            placeholder='e.g. "bench +5lb", "felt flat"'
            icon="trending-up-outline"
            iconColor={Colors.secondary}
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Nutrition</Text>
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
