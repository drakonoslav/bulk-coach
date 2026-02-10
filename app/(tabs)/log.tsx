import React, { useCallback, useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import Colors from "@/constants/colors";
import { saveEntry, loadEntries } from "@/lib/entry-storage";
import { DailyEntry, todayStr } from "@/lib/coaching-engine";

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

  const [morningWeight, setMorningWeight] = useState("");
  const [eveningWeight, setEveningWeight] = useState("");
  const [waist, setWaist] = useState("");
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

  useFocusEffect(
    useCallback(() => {
      const checkToday = async () => {
        const entries = await loadEntries();
        const today = todayStr();
        const existing = entries.find((e) => e.day === today);
        if (existing) {
          setMorningWeight(existing.morningWeightLb.toString());
          setEveningWeight(existing.eveningWeightLb?.toString() || "");
          setWaist(existing.waistIn?.toString() || "");
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
          resetForm();
        }
      };
      checkToday();
    }, [])
  );

  const resetForm = () => {
    setMorningWeight("");
    setEveningWeight("");
    setWaist("");
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
      const entry: DailyEntry = {
        day: todayStr(),
        morningWeightLb: parseFloat(morningWeight),
        eveningWeightLb: eveningWeight ? parseFloat(eveningWeight) : undefined,
        waistIn: waist ? parseFloat(waist) : undefined,
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
          <Text style={styles.subtitle}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</Text>
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
              <Ionicons name="save-outline" size={20} color="#fff" />
              <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save Entry"}</Text>
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
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
