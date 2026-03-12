import React, { useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Animated,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { createProfile } from "@/lib/profile";
import { clearUserIdCache } from "@/lib/user-identity";

const BG     = "#0A0A0F";
const CARD   = "#13131A";
const BORDER = "rgba(255,255,255,0.10)";
const TEAL   = "#00D4AA";
const TEXT   = "#FFFFFF";
const MUTED  = "rgba(255,255,255,0.45)";
const RED    = "#EF4444";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function isValidDate(y: string, m: string, d: string): boolean {
  const yi = parseInt(y, 10);
  const mi = parseInt(m, 10);
  const di = parseInt(d, 10);
  if (!yi || !mi || !di) return false;
  if (mi < 1 || mi > 12) return false;
  if (di < 1 || di > 31) return false;
  if (yi < 1920 || yi > new Date().getFullYear() - 10) return false;
  const date = new Date(yi, mi - 1, di);
  return date.getFullYear() === yi && date.getMonth() === mi - 1 && date.getDate() === di;
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [step, setStep]         = useState<"name" | "birthday">("name");
  const [username, setUsername] = useState("");
  const [month, setMonth]       = useState("");
  const [day, setDay]           = useState("");
  const [year, setYear]         = useState("");
  const [error, setError]       = useState("");
  const [saving, setSaving]     = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;

  const nameRef  = useRef<TextInput>(null);
  const dayRef   = useRef<TextInput>(null);
  const yearRef  = useRef<TextInput>(null);

  function goToBirthday() {
    const name = username.trim();
    if (name.length < 2) { setError("Please enter at least 2 characters."); return; }
    setError("");
    Animated.timing(slideAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start(() => {
      setStep("birthday");
    });
  }

  async function finish() {
    const m = month.padStart(2, "0");
    const d = day.padStart(2, "0");
    const y = year;
    if (!isValidDate(y, m, d)) {
      setError("Please enter a valid birthday.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const birthday = `${y}-${m}-${d}`;
      await createProfile(username.trim(), birthday);
      clearUserIdCache();
      router.replace("/(tabs)");
    } catch {
      setError("Something went wrong. Try again.");
      setSaving(false);
    }
  }

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -400],
  });

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Ionicons name="barbell-outline" size={36} color={TEAL} />
          </View>
          <Text style={styles.appName}>BULK COACH</Text>
          <Text style={styles.tagline}>Your personal physique tracker</Text>
        </View>

        {/* Step: Name */}
        {step === "name" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What's your name?</Text>
            <Text style={styles.cardSub}>This is how the app will address you.</Text>
            <TextInput
              ref={nameRef}
              style={styles.input}
              placeholder="e.g. Alex"
              placeholderTextColor={MUTED}
              value={username}
              onChangeText={t => { setUsername(t); setError(""); }}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={goToBirthday}
              maxLength={32}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity
              style={[styles.btn, username.trim().length < 2 && styles.btnDim]}
              onPress={goToBirthday}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          </View>
        )}

        {/* Step: Birthday */}
        {step === "birthday" && (
          <View style={styles.card}>
            <TouchableOpacity onPress={() => { setStep("name"); setError(""); }} style={styles.back}>
              <Ionicons name="chevron-back" size={18} color={MUTED} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.cardTitle}>Hey {username.trim()} 👋</Text>
            <Text style={styles.cardSub}>When's your birthday? Used to track your age.</Text>

            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Text style={styles.dateLabel}>Month</Text>
                <TextInput
                  style={styles.dateInput}
                  placeholder="MM"
                  placeholderTextColor={MUTED}
                  value={month}
                  onChangeText={t => {
                    const v = t.replace(/[^0-9]/g, "").slice(0, 2);
                    setMonth(v);
                    setError("");
                    if (v.length === 2) dayRef.current?.focus();
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  returnKeyType="next"
                  onSubmitEditing={() => dayRef.current?.focus()}
                />
              </View>
              <Text style={styles.dateSep}>/</Text>
              <View style={styles.dateField}>
                <Text style={styles.dateLabel}>Day</Text>
                <TextInput
                  ref={dayRef}
                  style={styles.dateInput}
                  placeholder="DD"
                  placeholderTextColor={MUTED}
                  value={day}
                  onChangeText={t => {
                    const v = t.replace(/[^0-9]/g, "").slice(0, 2);
                    setDay(v);
                    setError("");
                    if (v.length === 2) yearRef.current?.focus();
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  returnKeyType="next"
                  onSubmitEditing={() => yearRef.current?.focus()}
                />
              </View>
              <Text style={styles.dateSep}>/</Text>
              <View style={[styles.dateField, { flex: 1.6 }]}>
                <Text style={styles.dateLabel}>Year</Text>
                <TextInput
                  ref={yearRef}
                  style={styles.dateInput}
                  placeholder="YYYY"
                  placeholderTextColor={MUTED}
                  value={year}
                  onChangeText={t => {
                    const v = t.replace(/[^0-9]/g, "").slice(0, 4);
                    setYear(v);
                    setError("");
                  }}
                  keyboardType="number-pad"
                  maxLength={4}
                  returnKeyType="done"
                  onSubmitEditing={finish}
                />
              </View>
            </View>

            {month.length === 2 && (
              <Text style={styles.monthHint}>
                {MONTHS[parseInt(month, 10) - 1] ?? ""}
              </Text>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.btn, saving && styles.btnDim]}
              onPress={finish}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <>
                  <Text style={styles.btnText}>Begin</Text>
                  <Ionicons name="checkmark" size={18} color="#000" style={{ marginLeft: 6 }} />
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.privacy}>
              Your data stays on your device. Nothing is shared.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: 40,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(0,212,170,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(0,212,170,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  appName: {
    fontFamily: "Rubik_700Bold",
    fontSize: 24,
    color: TEXT,
    letterSpacing: 4,
  },
  tagline: {
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    color: MUTED,
    marginTop: 6,
  },
  card: {
    width: "100%",
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
  },
  cardTitle: {
    fontFamily: "Rubik_600SemiBold",
    fontSize: 22,
    color: TEXT,
    marginBottom: 6,
  },
  cardSub: {
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    color: MUTED,
    marginBottom: 24,
    lineHeight: 20,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT,
    fontFamily: "Rubik_400Regular",
    fontSize: 20,
    padding: 16,
    marginBottom: 8,
  },
  error: {
    fontFamily: "Rubik_400Regular",
    fontSize: 13,
    color: RED,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginTop: 12,
  },
  btnDim: {
    opacity: 0.5,
  },
  btnText: {
    fontFamily: "Rubik_700Bold",
    fontSize: 16,
    color: "#000",
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  backText: {
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    color: MUTED,
    marginLeft: 2,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 8,
  },
  dateField: {
    flex: 1,
  },
  dateLabel: {
    fontFamily: "Rubik_500Medium",
    fontSize: 11,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  dateInput: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT,
    fontFamily: "Rubik_400Regular",
    fontSize: 22,
    padding: 14,
    textAlign: "center",
  },
  dateSep: {
    fontFamily: "Rubik_400Regular",
    fontSize: 24,
    color: MUTED,
    paddingBottom: 12,
  },
  monthHint: {
    fontFamily: "Rubik_400Regular",
    fontSize: 13,
    color: TEAL,
    marginBottom: 8,
    marginLeft: 2,
  },
  privacy: {
    fontFamily: "Rubik_400Regular",
    fontSize: 12,
    color: MUTED,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 18,
  },
});
