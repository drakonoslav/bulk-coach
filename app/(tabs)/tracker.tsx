import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform, KeyboardAvoidingView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getApiUrl, authFetch } from "@/lib/query-client";

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_ID_KEY  = "tracker_user_id";
const HISTORY_PRE  = "tracker_history_";
const MAX_HISTORY  = 90;

const TEAL  = "#00D4AA";
const BG    = "#0A0A0F";
const CARD  = "#13131A";
const CARD2 = "#1A1A24";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT  = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.45)";
const AMBER = "#F59E0B";

// ─── Enums ────────────────────────────────────────────────────────────────────

const CARDIO_MODES = [
  { key: "zone_2",              label: "Zone 2" },
  { key: "zone_3",              label: "Zone 3" },
  { key: "zone_1",              label: "Zone 1" },
  { key: "recovery_walk",       label: "Walk" },
  { key: "recovery_patterning", label: "Patterning" },
  { key: "off",                 label: "Off" },
] as const;

const LIFT_MODES = [
  { key: "hypertrophy_build",   label: "Hypertrophy" },
  { key: "neural_tension",      label: "Neural" },
  { key: "recovery_patterning", label: "Recovery" },
  { key: "deload",              label: "Deload" },
  { key: "off",                 label: "Off" },
] as const;

type CardioMode = typeof CARDIO_MODES[number]["key"];
type LiftMode   = typeof LIFT_MODES[number]["key"];

// ─── Form State (flat object for easy serialisation) ──────────────────────────

interface Form {
  // Sleep
  bedtimeHhmm: string;    waketime_hhmm: string;
  sleepDurationMin: string; timeInBedMin: string;
  // Cardiac
  hrv: string; rhr: string; overnightHr: string; walkingHr: string; vo2: string;
  // Activity
  steps: string; activeKcal: string; exerciseMin: string;
  // Cardio
  cardioDurationMin: string; cardioAvgHr: string;
  cardioZone2Min: string; cardioZone3Min: string;
  cardioMode: CardioMode | "";
  // Body
  weight: string; bodyFatPct: string; fatFreeMassLb: string;
  // Waist
  waistIn: string; waistConfidence: string;
  // Subjective (integers stored as numbers | undefined)
  libido: number | undefined; morningErection: number | undefined;
  motivation: number | undefined; moodStability: number | undefined;
  mentalDrive: number | undefined; soreness: number | undefined;
  jointFriction: number | undefined; stressLoad: number | undefined;
  // Lift
  plannedLiftMode: LiftMode | ""; completedLiftMode: LiftMode | "";
  liftReadiness: number | undefined;
  topSetLoad: string; topSetRpe: string;
  pumpQuality: number | undefined; repSpeed: number | undefined;
  liftStrain: string;
  // Nutrition actuals
  kcalActual: string; proteinActual: string; carbsActual: string; fatActual: string;
  // Light
  sunlightMin: string;
  // Notes
  notes: string;
}

const EMPTY_FORM: Form = {
  bedtimeHhmm: "", waketime_hhmm: "", sleepDurationMin: "", timeInBedMin: "",
  hrv: "", rhr: "", overnightHr: "", walkingHr: "", vo2: "",
  steps: "", activeKcal: "", exerciseMin: "",
  cardioDurationMin: "", cardioAvgHr: "", cardioZone2Min: "", cardioZone3Min: "", cardioMode: "",
  weight: "", bodyFatPct: "", fatFreeMassLb: "",
  waistIn: "", waistConfidence: "",
  libido: undefined, morningErection: undefined,
  motivation: undefined, moodStability: undefined,
  mentalDrive: undefined, soreness: undefined,
  jointFriction: undefined, stressLoad: undefined,
  plannedLiftMode: "", completedLiftMode: "",
  liftReadiness: undefined, topSetLoad: "", topSetRpe: "",
  pumpQuality: undefined, repSpeed: undefined, liftStrain: "",
  kcalActual: "", proteinActual: "", carbsActual: "", fatActual: "",
  sunlightMin: "",
  notes: "",
};

// ─── Intel Payload Builder ────────────────────────────────────────────────────

function hhmm(t: string): { h: number; m: number } | null {
  const parts = t.trim().split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!isFinite(h) || !isFinite(m)) return null;
  return { h, m };
}

function toIsoLocal(date: string, h: number, m: number, prevDay: boolean): string {
  const d = new Date(date + "T12:00:00");
  if (prevDay) d.setDate(d.getDate() - 1);
  const mm = String(m).padStart(2, "0");
  const hh = String(h).padStart(2, "0");
  return `${d.toISOString().slice(0, 10)}T${hh}:${mm}:00`;
}

function computeSleep(date: string, bedHhmm: string, wakeHhmm: string) {
  const bed  = hhmm(bedHhmm);
  const wake = hhmm(wakeHhmm);
  if (!bed || !wake) return {};

  const bedMin  = bed.h * 60 + bed.m;   // minutes from midnight, may need offset
  const wakeMin = wake.h * 60 + wake.m;

  // If bed hour >= 12 (noon), assume previous calendar day
  const prevDay = bed.h >= 12;
  const bedMinAdj = prevDay ? bedMin - 1440 : bedMin; // negative if before midnight

  let midRaw = (bedMinAdj + wakeMin) / 2;
  if (midRaw < 0) midRaw += 1440;

  const durationMin = wakeMin - bedMinAdj;
  const bedIso  = toIsoLocal(date, bed.h,  bed.m,  prevDay);
  const wakeIso = toIsoLocal(date, wake.h, wake.m, false);

  return {
    bedtime_local:   bedIso,
    waketime_local:  wakeIso,
    sleep_midpoint_min: Math.round(midRaw),
    sleep_duration_min_computed: Math.round(durationMin),
  };
}

function buildPayload(userId: string, date: string, f: Form): Record<string, unknown> {
  const p: Record<string, unknown> = { expo_user_id: userId, date };

  const sleepCalc = computeSleep(date, f.bedtimeHhmm, f.waketime_hhmm);
  if (sleepCalc.bedtime_local)  p.bedtime_local  = sleepCalc.bedtime_local;
  if (sleepCalc.waketime_local) p.waketime_local = sleepCalc.waketime_local;
  if (sleepCalc.sleep_midpoint_min != null)
    p.sleep_midpoint_min = sleepCalc.sleep_midpoint_min;

  // Sleep duration: prefer explicit input, fall back to computed
  const dur = f.sleepDurationMin ? parseInt(f.sleepDurationMin, 10)
    : sleepCalc.sleep_duration_min_computed;
  if (dur) p.sleep_duration_min = dur;

  const tib = f.timeInBedMin ? parseInt(f.timeInBedMin, 10) : undefined;
  if (tib) p.time_in_bed_min = tib;

  // Efficiency: computed if we have both values
  if (dur && tib && tib > 0) {
    p.sleep_efficiency_pct = parseFloat(((dur / tib) * 100).toFixed(2));
  }

  // Cardiac
  if (f.hrv)         p.hrv_ms              = parseFloat(f.hrv);
  if (f.rhr)         p.resting_hr_bpm      = parseFloat(f.rhr);
  if (f.overnightHr) p.overnight_hr_avg_bpm = parseFloat(f.overnightHr);
  if (f.walkingHr)   p.walking_hr_avg_bpm  = parseFloat(f.walkingHr);
  if (f.vo2)         p.vo2_estimate        = parseFloat(f.vo2);

  // Activity
  if (f.steps)       p.step_count          = parseInt(f.steps, 10);
  if (f.activeKcal)  p.active_energy_kcal  = parseInt(f.activeKcal, 10);
  if (f.exerciseMin) p.exercise_min        = parseInt(f.exerciseMin, 10);

  // Cardio
  if (f.cardioDurationMin) p.cardio_duration_min = parseInt(f.cardioDurationMin, 10);
  if (f.cardioAvgHr)       p.cardio_avg_hr_bpm   = parseFloat(f.cardioAvgHr);
  if (f.cardioZone2Min)    p.cardio_zone2_min     = parseInt(f.cardioZone2Min, 10);
  if (f.cardioZone3Min)    p.cardio_zone3_min     = parseInt(f.cardioZone3Min, 10);
  if (f.cardioMode)        p.actual_cardio_mode   = f.cardioMode;

  // Body comp (only when explicitly entered)
  if (f.weight)         p.body_weight_lb = parseFloat(f.weight);
  if (f.bodyFatPct)     { p.body_fat_pct = parseFloat(f.bodyFatPct); p.body_comp_confidence = 0.3; }
  if (f.fatFreeMassLb)  p.fat_free_mass_lb = parseFloat(f.fatFreeMassLb);

  // Waist
  if (f.waistIn) {
    p.waist_at_navel_in = parseFloat(f.waistIn);
    p.waist_measure_confidence = f.waistConfidence ? parseFloat(f.waistConfidence) : 1.0;
  }

  // Subjective — integers, exact scales
  if (f.libido         != null) p.libido_score          = f.libido;
  if (f.morningErection!= null) p.morning_erection_score = f.morningErection; // 0-3
  if (f.motivation     != null) p.motivation_score       = f.motivation;
  if (f.moodStability  != null) p.mood_stability_score   = f.moodStability;
  if (f.mentalDrive    != null) p.mental_drive_score     = f.mentalDrive;
  if (f.soreness       != null) p.soreness_score         = f.soreness;
  if (f.jointFriction  != null) p.joint_friction_score   = f.jointFriction;
  if (f.stressLoad     != null) p.stress_load_score      = f.stressLoad;

  // Lift
  if (f.plannedLiftMode)   p.planned_lift_mode          = f.plannedLiftMode;
  if (f.completedLiftMode) p.completed_lift_mode        = f.completedLiftMode;
  if (f.liftReadiness != null) p.lift_readiness_self_score = f.liftReadiness;
  if (f.topSetLoad)        p.top_set_load_index         = parseFloat(f.topSetLoad);
  if (f.topSetRpe)         p.top_set_rpe                = parseFloat(f.topSetRpe);
  if (f.pumpQuality  != null) p.pump_quality_score      = f.pumpQuality;
  if (f.repSpeed     != null) p.rep_speed_subjective_score = f.repSpeed;
  if (f.liftStrain)        p.lift_strain_score          = parseFloat(f.liftStrain);

  // Nutrition actuals
  if (f.kcalActual)   p.kcal_actual     = parseInt(f.kcalActual, 10);
  if (f.proteinActual)p.protein_g_actual = parseFloat(f.proteinActual);
  if (f.carbsActual)  p.carbs_g_actual  = parseFloat(f.carbsActual);
  if (f.fatActual)    p.fat_g_actual    = parseFloat(f.fatActual);

  // Light
  if (f.sunlightMin) p.sunlight_min = parseInt(f.sunlightMin, 10);

  return p;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

interface HistoryEntry { date: string; savedAt: string; form: Form; }

async function getOrCreateUserId(): Promise<string> {
  const stored = await AsyncStorage.getItem(USER_ID_KEY);
  if (stored) return stored;
  const id = "usr_" + (await Crypto.randomUUID()).replace(/-/g, "").slice(0, 16);
  await AsyncStorage.setItem(USER_ID_KEY, id);
  return id;
}

async function loadHistory(uid: string): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_PRE + uid);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function persistHistory(uid: string, date: string, form: Form): Promise<HistoryEntry[]> {
  const existing = await loadHistory(uid);
  const filtered = existing.filter(e => e.date !== date);
  const entry: HistoryEntry = { date, savedAt: new Date().toISOString(), form };
  const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(HISTORY_PRE + uid, JSON.stringify(updated));
  return updated;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US",
    { weekday: "short", month: "short", day: "numeric" });
}

function Sec({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <View style={[s.sec, accent ? { borderLeftWidth: 3, borderLeftColor: accent } : {}]}>
      <Text style={[s.secTitle, accent ? { color: accent } : {}]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.rowRight}>{children}</View>
    </View>
  );
}

function Num({
  value, onChange, unit, placeholder = "—",
}: { value: string; onChange: (v: string) => void; unit?: string; placeholder?: string }) {
  return (
    <View style={s.numWrap}>
      <TextInput
        style={s.numInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        keyboardType="decimal-pad"
      />
      {unit ? <Text style={s.unit}>{unit}</Text> : null}
    </View>
  );
}

function Dots({
  value, onChange, min = 1, max = 5,
}: { value: number | undefined; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 5 }}>
      {Array.from({ length: max - min + 1 }, (_, i) => i + min).map(n => {
        const active = value === n;
        return (
          <TouchableOpacity key={n} onPress={() => onChange(n)}
            style={[s.dot, active && { backgroundColor: TEAL, borderColor: TEAL }]}>
            <Text style={[s.dotTxt, active && { color: BG }]}>{n}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function TenDots({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
        const active = value === n;
        return (
          <TouchableOpacity key={n} onPress={() => onChange(n)}
            style={[s.dot, active && { backgroundColor: AMBER, borderColor: AMBER }]}>
            <Text style={[s.dotTxt, active && { color: BG }]}>{n}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ModeSelect<T extends string>({
  options, value, onChange,
}: { options: readonly { key: T; label: string }[]; value: T | ""; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
      {options.map(o => {
        const active = value === o.key;
        return (
          <TouchableOpacity key={o.key} onPress={() => onChange(o.key)}
            style={[s.modeBtn, active && { backgroundColor: TEAL, borderColor: TEAL }]}>
            <Text style={[s.modeTxt, active && { color: BG }]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TrackerScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [userId, setUserId]   = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [date, setDate]       = useState(todayStr());
  const [form, setForm]       = useState<Form>({ ...EMPTY_FORM });
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [intelStatus, setIntelStatus] = useState<"idle"|"ok"|"warn">("idle");

  const set = useCallback(<K extends keyof Form>(key: K, val: Form[K]) =>
    setForm(f => ({ ...f, [key]: val })), []);

  useEffect(() => {
    (async () => {
      const uid = await getOrCreateUserId();
      setUserId(uid);
      const hist = await loadHistory(uid);
      setHistory(hist);
      // Pre-fill from today's cache
      const todayCache = hist.find(e => e.date === todayStr());
      if (todayCache) setForm({ ...EMPTY_FORM, ...todayCache.form });
    })();
  }, []);

  const handleSave = useCallback(async () => {
    if (!userId) return;
    setSaving(true);
    setSaved(false);
    setIntelStatus("idle");

    // 1. Save locally first — device cache, always succeeds
    const updated = await persistHistory(userId, date, form);
    setHistory(updated);

    // 2. POST to Intel — primary long-term store
    try {
      const payload = buildPayload(userId, date, form);
      const baseUrl = getApiUrl();
      const res = await authFetch(
        new URL("/api/intel/vitals/daily-log", baseUrl).toString(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      setIntelStatus(res.ok ? "ok" : "warn");
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn("[tracker] Intel non-2xx:", res.status, body);
      }
    } catch (err) {
      setIntelStatus("warn");
      console.warn("[tracker] Intel POST failed (saved locally):", err);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => { setSaved(false); setIntelStatus("idle"); }, 4000);
  }, [userId, date, form]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }}
        contentContainerStyle={[s.container, { paddingTop: topPad + 12, paddingBottom: botPad + 120 }]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* ── Header ─────────────────────────────── */}
        <View style={s.header}>
          <Text style={s.title}>Logbook</Text>
          <View style={s.uidRow}>
            <Ionicons name="person-circle-outline" size={12} color={TEAL} />
            <Text style={s.uid}>{userId || "…"}</Text>
          </View>
        </View>

        {/* ── Date ──────────────────────────────── */}
        <View style={s.dateCard}>
          <Ionicons name="calendar-outline" size={14} color={MUTED} />
          <Text style={s.dateTxt}>{fmtDate(date)}</Text>
          {date !== todayStr() && (
            <TouchableOpacity onPress={() => setDate(todayStr())} style={s.todayBtn}>
              <Text style={s.todayTxt}>Today</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── SLEEP ─────────────────────────────── */}
        <Sec title="SLEEP">
          <Row label="Bedtime">
            <Num value={form.bedtimeHhmm} onChange={v => set("bedtimeHhmm", v)} placeholder="23:15" unit="HH:MM" />
          </Row>
          <Row label="Wake time">
            <Num value={form.waketime_hhmm} onChange={v => set("waketime_hhmm", v)} placeholder="06:30" unit="HH:MM" />
          </Row>
          <Row label="Sleep actual">
            <Num value={form.sleepDurationMin} onChange={v => set("sleepDurationMin", v)} unit="min" />
          </Row>
          <Row label="Time in bed">
            <Num value={form.timeInBedMin} onChange={v => set("timeInBedMin", v)} unit="min" />
          </Row>
          {/* Show computed values as confirmation */}
          {form.bedtimeHhmm && form.waketime_hhmm ? (() => {
            const calc = computeSleep(date, form.bedtimeHhmm, form.waketime_hhmm);
            if (!calc.sleep_midpoint_min) return null;
            const effStr = form.sleepDurationMin && form.timeInBedMin
              ? ((parseInt(form.sleepDurationMin,10) / parseInt(form.timeInBedMin,10)) * 100).toFixed(1) + "%"
              : "—";
            return (
              <View style={s.computed}>
                <Text style={s.computedTxt}>Midpoint: {calc.sleep_midpoint_min} min · Efficiency: {effStr}</Text>
              </View>
            );
          })() : null}
        </Sec>

        {/* ── CARDIAC ───────────────────────────── */}
        <Sec title="CARDIAC / HRV">
          <Row label="HRV"><Num value={form.hrv} onChange={v => set("hrv", v)} unit="ms" /></Row>
          <Row label="Resting HR"><Num value={form.rhr} onChange={v => set("rhr", v)} unit="bpm" /></Row>
          <Row label="Overnight HR avg"><Num value={form.overnightHr} onChange={v => set("overnightHr", v)} unit="bpm" /></Row>
          <Row label="Walking HR avg"><Num value={form.walkingHr} onChange={v => set("walkingHr", v)} unit="bpm" /></Row>
          <Row label="VO₂ estimate"><Num value={form.vo2} onChange={v => set("vo2", v)} unit="mL/kg/min" /></Row>
        </Sec>

        {/* ── ACTIVITY ──────────────────────────── */}
        <Sec title="ACTIVITY">
          <Row label="Steps"><Num value={form.steps} onChange={v => set("steps", v)} unit="steps" /></Row>
          <Row label="Active energy"><Num value={form.activeKcal} onChange={v => set("activeKcal", v)} unit="kcal" /></Row>
          <Row label="Exercise time"><Num value={form.exerciseMin} onChange={v => set("exerciseMin", v)} unit="min" /></Row>
        </Sec>

        {/* ── CARDIO SESSION ────────────────────── */}
        <Sec title="CARDIO SESSION">
          <Row label="Mode">
            <ModeSelect options={CARDIO_MODES} value={form.cardioMode}
              onChange={v => set("cardioMode", v)} />
          </Row>
          <Row label="Duration"><Num value={form.cardioDurationMin} onChange={v => set("cardioDurationMin", v)} unit="min" /></Row>
          <Row label="Avg HR"><Num value={form.cardioAvgHr} onChange={v => set("cardioAvgHr", v)} unit="bpm" /></Row>
          <Row label="Zone 2 time"><Num value={form.cardioZone2Min} onChange={v => set("cardioZone2Min", v)} unit="min" /></Row>
          <Row label="Zone 3 time"><Num value={form.cardioZone3Min} onChange={v => set("cardioZone3Min", v)} unit="min" /></Row>
        </Sec>

        {/* ── BODY COMPOSITION ──────────────────── */}
        <Sec title="BODY COMPOSITION">
          <Row label="Weight"><Num value={form.weight} onChange={v => set("weight", v)} unit="lbs" /></Row>
          <Row label="Body fat %"><Num value={form.bodyFatPct} onChange={v => set("bodyFatPct", v)} unit="%" /></Row>
          <Row label="Fat-free mass"><Num value={form.fatFreeMassLb} onChange={v => set("fatFreeMassLb", v)} unit="lbs" /></Row>
          <Row label="Waist (navel)"><Num value={form.waistIn} onChange={v => set("waistIn", v)} unit="in" /></Row>
        </Sec>

        {/* ── SUBJECTIVE ────────────────────────── */}
        <Sec title="WELLBEING" accent={TEAL}>
          <Text style={s.scaleNote}>All 1–5 except Morning Erection (0–3)</Text>
          <Row label="Libido"><Dots value={form.libido} onChange={v => set("libido", v)} /></Row>
          <Row label="Morning erection">
            <Dots value={form.morningErection} onChange={v => set("morningErection", v)} min={0} max={3} />
          </Row>
          <Row label="Motivation"><Dots value={form.motivation} onChange={v => set("motivation", v)} /></Row>
          <Row label="Mood stability"><Dots value={form.moodStability} onChange={v => set("moodStability", v)} /></Row>
          <Row label="Mental drive"><Dots value={form.mentalDrive} onChange={v => set("mentalDrive", v)} /></Row>
          <Row label="Soreness"><Dots value={form.soreness} onChange={v => set("soreness", v)} /></Row>
          <Row label="Joint friction"><Dots value={form.jointFriction} onChange={v => set("jointFriction", v)} /></Row>
          <Row label="Stress load"><Dots value={form.stressLoad} onChange={v => set("stressLoad", v)} /></Row>
        </Sec>

        {/* ── LIFT SESSION ──────────────────────── */}
        <Sec title="LIFT SESSION">
          <Row label="Planned mode">
            <ModeSelect options={LIFT_MODES} value={form.plannedLiftMode}
              onChange={v => set("plannedLiftMode", v)} />
          </Row>
          <Row label="Completed mode">
            <ModeSelect options={LIFT_MODES} value={form.completedLiftMode}
              onChange={v => set("completedLiftMode", v)} />
          </Row>
          <Row label="Readiness (1–10)">
            <TenDots value={form.liftReadiness} onChange={v => set("liftReadiness", v)} />
          </Row>
          <Row label="Top set load"><Num value={form.topSetLoad} onChange={v => set("topSetLoad", v)} unit="lbs" /></Row>
          <Row label="Top set RPE"><Num value={form.topSetRpe} onChange={v => set("topSetRpe", v)} /></Row>
          <Row label="Pump quality"><Dots value={form.pumpQuality} onChange={v => set("pumpQuality", v)} /></Row>
          <Row label="Rep speed"><Dots value={form.repSpeed} onChange={v => set("repSpeed", v)} /></Row>
          <Row label="Lift strain"><Num value={form.liftStrain} onChange={v => set("liftStrain", v)} unit="0–100" /></Row>
        </Sec>

        {/* ── NUTRITION ─────────────────────────── */}
        <Sec title="NUTRITION ACTUALS">
          <Row label="Calories"><Num value={form.kcalActual} onChange={v => set("kcalActual", v)} unit="kcal" /></Row>
          <Row label="Protein"><Num value={form.proteinActual} onChange={v => set("proteinActual", v)} unit="g" /></Row>
          <Row label="Carbs"><Num value={form.carbsActual} onChange={v => set("carbsActual", v)} unit="g" /></Row>
          <Row label="Fat"><Num value={form.fatActual} onChange={v => set("fatActual", v)} unit="g" /></Row>
        </Sec>

        {/* ── LIGHT ─────────────────────────────── */}
        <Sec title="LIGHT EXPOSURE">
          <Row label="Sunlight">
            <Num value={form.sunlightMin} onChange={v => set("sunlightMin", v)} unit="min" />
          </Row>
        </Sec>

        {/* ── NOTES ─────────────────────────────── */}
        <Sec title="NOTES">
          <TextInput style={s.notesInput} value={form.notes}
            onChangeText={v => set("notes", v)}
            placeholder="Anything notable today…"
            placeholderTextColor={MUTED}
            multiline numberOfLines={3} keyboardType="default" />
        </Sec>

        {/* ── SAVE ──────────────────────────────── */}
        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={BG} size="small" />
          ) : saved ? (
            <>
              <Ionicons name={intelStatus === "warn" ? "cloud-offline-outline" : "checkmark-circle"}
                size={18} color={BG} />
              <Text style={s.saveTxt}>
                {intelStatus === "warn" ? "Saved locally · Intel unreachable" : "Saved to Intel"}
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color={BG} />
              <Text style={s.saveTxt}>Save Entry</Text>
            </>
          )}
        </TouchableOpacity>

        {/* ── HISTORY ───────────────────────────── */}
        {history.length > 0 && (
          <View style={{ marginTop: 32 }}>
            <Text style={s.histHead}>History</Text>
            {history.map(e => {
              const parts = [
                e.form.weight ? `${e.form.weight} lbs` : "",
                e.form.hrv ? `HRV ${e.form.hrv}` : "",
                e.form.kcalActual ? `${e.form.kcalActual} kcal` : "",
                e.form.completedLiftMode ? e.form.completedLiftMode.replace(/_/g, " ") : "",
              ].filter(Boolean);
              return (
                <TouchableOpacity key={e.date + e.savedAt}
                  onPress={() => {
                    setDate(e.date);
                    setForm({ ...EMPTY_FORM, ...e.form });
                    scrollRef.current?.scrollTo({ y: 0, animated: true });
                  }}>
                  <View style={s.histCard}>
                    <Text style={s.histDate}>{fmtDate(e.date)}</Text>
                    <Text style={s.histMeta} numberOfLines={2}>
                      {parts.length ? parts.join(" · ") : "Entry saved"}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:  { paddingHorizontal: 16 },
  header:     { marginBottom: 14 },
  title:      { fontSize: 26, fontWeight: "700", color: TEXT, fontFamily: "Rubik_700Bold", letterSpacing: -0.4 },
  uidRow:     { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  uid:        { fontSize: 11, color: TEAL, fontFamily: "Rubik_400Regular", letterSpacing: 0.3, maxWidth: 280 },
  dateCard:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: CARD, borderRadius: 10,
                padding: 10, borderWidth: 1, borderColor: BORDER, marginBottom: 14 },
  dateTxt:    { fontSize: 14, color: TEXT, fontFamily: "Rubik_500Medium", flex: 1 },
  todayBtn:   { backgroundColor: TEAL + "22", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  todayTxt:   { fontSize: 12, color: TEAL, fontFamily: "Rubik_500Medium" },
  sec:        { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
                paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, marginBottom: 10 },
  secTitle:   { fontSize: 10, color: MUTED, fontFamily: "Rubik_600SemiBold", letterSpacing: 1.2,
                textTransform: "uppercase", marginBottom: 8 },
  row:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  rowLabel:   { fontSize: 13, color: TEXT, fontFamily: "Rubik_400Regular", flex: 1 },
  rowRight:   { alignItems: "flex-end" },
  numWrap:    { flexDirection: "row", alignItems: "center", gap: 4 },
  numInput:   { fontSize: 15, color: TEXT, fontFamily: "Rubik_500Medium", textAlign: "right",
                minWidth: 56, padding: 2 },
  unit:       { fontSize: 11, color: MUTED, fontFamily: "Rubik_400Regular", minWidth: 34 },
  dot:        { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.05)",
                alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER },
  dotTxt:     { fontSize: 13, color: TEXT, fontFamily: "Rubik_500Medium" },
  modeBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.03)" },
  modeTxt:    { fontSize: 12, color: TEXT, fontFamily: "Rubik_500Medium" },
  scaleNote:  { fontSize: 10, color: MUTED, fontFamily: "Rubik_400Regular", marginBottom: 6, fontStyle: "italic" },
  computed:   { backgroundColor: TEAL + "12", borderRadius: 6, padding: 6, marginVertical: 4 },
  computedTxt:{ fontSize: 11, color: TEAL, fontFamily: "Rubik_400Regular" },
  notesInput: { fontSize: 14, color: TEXT, fontFamily: "Rubik_400Regular",
                minHeight: 72, textAlignVertical: "top", paddingTop: 4 },
  saveBtn:    { backgroundColor: TEAL, borderRadius: 14, height: 52, flexDirection: "row",
                alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 },
  saveTxt:    { fontSize: 16, fontWeight: "700", color: BG, fontFamily: "Rubik_700Bold" },
  histHead:   { fontSize: 11, color: MUTED, fontFamily: "Rubik_600SemiBold",
                letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  histCard:   { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
                padding: 14, marginBottom: 8 },
  histDate:   { fontSize: 13, color: TEAL, fontFamily: "Rubik_600SemiBold", marginBottom: 3 },
  histMeta:   { fontSize: 12, color: TEXT, fontFamily: "Rubik_400Regular" },
});
