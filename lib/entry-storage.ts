import { apiRequest, getApiUrl, authFetch } from "@/lib/query-client";
import { DailyEntry, BASELINE, type Baseline } from "./coaching-engine";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BASELINE_KEY = "@bulk_coach_baseline";

export async function loadEntries(): Promise<DailyEntry[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL("/api/logs", baseUrl);
    const res = await authFetch(url.toString());
    if (!res.ok) throw new Error(`${res.status}`);
    const rows: any[] = await res.json();
    return rows.map(rowToEntry).sort((a, b) => a.day.localeCompare(b.day));
  } catch (err) {
    console.error("loadEntries API error:", err);
    return [];
  }
}

export interface DashboardResponse {
  entries: DailyEntry[];
  appliedCalorieDelta: number | null;
  policySource: string | null;
  modeInsightReason: string | null;
  decisions14d: any[];
}

export async function loadDashboard(start?: string, end?: string): Promise<DashboardResponse> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL("/api/dashboard", baseUrl);
    if (start) url.searchParams.set("start", start);
    if (end) url.searchParams.set("end", end);
    const res = await authFetch(url.toString());
    if (!res.ok) throw new Error(`${res.status}`);
    const raw = await res.json();
    const rows: any[] = Array.isArray(raw?.entries) ? raw.entries : [];
    const entries = rows.map(rowToEntry).sort((a, b) => a.day.localeCompare(b.day));
    return {
      entries,
      appliedCalorieDelta: raw?.appliedCalorieDelta ?? null,
      policySource: raw?.policySource ?? null,
      modeInsightReason: raw?.modeInsightReason ?? null,
      decisions14d: raw?.decisions14d ?? [],
    };
  } catch (err) {
    console.error("loadDashboard API error:", err);
    return {
      entries: [],
      appliedCalorieDelta: null,
      policySource: null,
      modeInsightReason: null,
      decisions14d: [],
    };
  }
}

export interface DashboardRow {
  day: string;
  morningWeightLb: number;
  eveningWeightLb?: number;
  waistIn?: number;
  bfMorningR1?: number;
  bfMorningR2?: number;
  bfMorningR3?: number;
  bfMorningPct?: number;
  bfEveningR1?: number;
  bfEveningR2?: number;
  bfEveningR3?: number;
  bfEveningPct?: number;
  sleepStart?: string;
  sleepEnd?: string;
  sleepQuality?: number;
  waterLiters?: number;
  steps?: number;
  cardioMin?: number;
  liftDone?: boolean;
  deloadWeek?: boolean;
  adherence?: number;
  performanceNote?: string;
  notes?: string;
  leanMassLb?: number;
  fatMassLb?: number;
  weight7dAvg?: number;
  waist7dAvg?: number;
  leanMass7dAvg?: number;
  leanGainRatio14dRoll?: number;
  cardioFuelNote?: string;
}

export interface StrengthExercise {
  id: string;
  name: string;
  category: string;
  isBodyweight?: boolean;
  active?: boolean;
}

export interface StrengthSet {
  id: string;
  day: string;
  exerciseId: string;
  weightLb?: number;
  reps?: number;
  rir?: number;
  seconds?: number;
  setType?: string;
  isMeasured?: boolean;
  createdAt?: string;
}

function rowToStrengthExercise(row: any): StrengthExercise {
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    isBodyweight: row.is_bodyweight != null ? Boolean(row.is_bodyweight) : undefined,
    active: row.active != null ? Boolean(row.active) : undefined,
  };
}

function rowToStrengthSet(row: any): StrengthSet {
  return {
    id: String(row.id),
    day: String(row.day),
    exerciseId: String(row.exercise_id),
    weightLb: row.weight_lb != null ? Number(row.weight_lb) : undefined,
    reps: row.reps != null ? Number(row.reps) : undefined,
    rir: row.rir != null ? Number(row.rir) : undefined,
    seconds: row.seconds != null ? Number(row.seconds) : undefined,
    setType: row.set_type ?? undefined,
    isMeasured: row.is_measured != null ? Boolean(row.is_measured) : undefined,
    createdAt: row.created_at ?? undefined,
  };
}

export async function loadEntry(day: string): Promise<DailyEntry | null> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL(`/api/logs/${day}`, baseUrl);
    const res = await authFetch(url.toString());
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status}`);
    const row = await res.json();
    return rowToEntry(row);
  } catch (err) {
    console.error("loadEntry API error:", err);
    return null;
  }
}

export async function saveEntry(entry: DailyEntry): Promise<void> {
  await apiRequest("POST", "/api/logs/upsert", entry);
}

export async function deleteEntry(day: string): Promise<void> {
  await apiRequest("DELETE", `/api/logs/${day}`);
}

export async function loadBaseline(): Promise<Baseline> {
  const raw = await AsyncStorage.getItem(BASELINE_KEY);
  if (!raw) return BASELINE;
  return JSON.parse(raw);
}

export async function saveBaseline(baseline: Baseline): Promise<void> {
  await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
}

export async function loadStrengthExercises(): Promise<StrengthExercise[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL("/api/strength-exercises", baseUrl);
    const res = await authFetch(url.toString());
    if (!res.ok) throw new Error(`${res.status}`);
    const raw = await res.json();
    const rows: any[] = Array.isArray(raw?.exercises) ? raw.exercises : [];
    return rows.map(rowToStrengthExercise);
  } catch (err) {
    console.error("loadStrengthExercises API error:", err);
    return [];
  }
}

export async function loadStrengthSets(start: string, end: string): Promise<StrengthSet[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL("/api/strength-sets", baseUrl);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    const res = await authFetch(url.toString());
    if (!res.ok) throw new Error(`${res.status}`);
    const raw = await res.json();
    const rows: any[] = Array.isArray(raw?.sets) ? raw.sets : [];
    return rows.map(rowToStrengthSet);
  } catch (err) {
    console.error("loadStrengthSets API error:", err);
    return [];
  }
}

export async function getStrengthSource(): Promise<"legacy" | "intel"> {
  try {
    const res = await apiRequest("GET", "/api/settings/strength-source");
    const data = await res.json();
    return data?.strengthSource === "intel" ? "intel" : "legacy";
  } catch {
    return "legacy";
  }
}

export async function setStrengthSource(value: "legacy" | "intel"): Promise<void> {
  await apiRequest("PUT", "/api/settings/strength-source", { value });
}

export async function saveStrengthSets(
  day: string,
  sets: Array<{
    id?: string;
    exerciseId: string;
    weightLb?: number;
    reps?: number;
    rir?: number;
    seconds?: number;
  }>
): Promise<StrengthSet[]> {
  const src = await getStrengthSource();
  if (src === "intel") {
    console.log("[strength] strength_source=intel — skipping local strength_sets write");
    return [];
  }
  const payload = { day, sets };
  const res = await apiRequest("POST", "/api/strength-sets/upsert", payload);
  const raw = await res.json();
  const rows: any[] = Array.isArray(raw?.sets) ? raw.sets : [];
  return rows.map(rowToStrengthSet);
}

export async function loadStrengthMapping(): Promise<{
  muscles: Array<{ id: string; name: string; parent_id?: string | null }>;
  weights: Array<{
    exercise_id: string;
    muscle_id: string;
    weight_pct: number;
    role?: string;
    version: number;
    active: boolean;
  }>;
}> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL("/api/strength-mapping", baseUrl);
    const res = await authFetch(url.toString());
    if (!res.ok) throw new Error(`${res.status}`);
    const raw = await res.json();
    return {
      muscles: Array.isArray(raw?.muscles) ? raw.muscles : [],
      weights: Array.isArray(raw?.weights) ? raw.weights : [],
    };
  } catch (err) {
    console.error("loadStrengthMapping API error:", err);
    return { muscles: [], weights: [] };
  }
}

function rowToEntry(row: any): DailyEntry {
  return {
    day: row.day,
    morningWeightLb: Number(row.morningWeightLb),
    eveningWeightLb: row.eveningWeightLb != null ? Number(row.eveningWeightLb) : undefined,
    waistIn: row.waistIn != null ? Number(row.waistIn) : undefined,
    bfMorningR1: row.bfMorningR1 != null ? Number(row.bfMorningR1) : undefined,
    bfMorningR2: row.bfMorningR2 != null ? Number(row.bfMorningR2) : undefined,
    bfMorningR3: row.bfMorningR3 != null ? Number(row.bfMorningR3) : undefined,
    bfMorningPct: row.bfMorningPct != null ? Number(row.bfMorningPct) : undefined,
    bfEveningR1: row.bfEveningR1 != null ? Number(row.bfEveningR1) : undefined,
    bfEveningR2: row.bfEveningR2 != null ? Number(row.bfEveningR2) : undefined,
    bfEveningR3: row.bfEveningR3 != null ? Number(row.bfEveningR3) : undefined,
    bfEveningPct: row.bfEveningPct != null ? Number(row.bfEveningPct) : undefined,
    sleepStart: row.sleepStart ?? undefined,
    sleepEnd: row.sleepEnd ?? undefined,
    sleepQuality: row.sleepQuality != null ? Number(row.sleepQuality) : undefined,
    tossedMinutes: row.tossedMinutes != null ? Number(row.tossedMinutes) : undefined,
    sleepPlanBedtime: row.sleepPlanBedtime ?? undefined,
    sleepPlanWake: row.sleepPlanWake ?? undefined,
    plannedBedTime: row.plannedBedTime ?? undefined,
    plannedWakeTime: row.plannedWakeTime ?? undefined,
    actualBedTime: row.actualBedTime ?? undefined,
    actualWakeTime: row.actualWakeTime ?? undefined,
    sleepLatencyMin: row.sleepLatencyMin != null ? Number(row.sleepLatencyMin) : undefined,
    sleepWasoMin: row.sleepWasoMin != null ? Number(row.sleepWasoMin) : undefined,
    napMinutes: row.napMinutes != null ? Number(row.napMinutes) : undefined,
    sleepAwakeMin: row.sleepAwakeMin != null ? Number(row.sleepAwakeMin) : undefined,
    sleepRemMin: row.sleepRemMin != null ? Number(row.sleepRemMin) : undefined,
    sleepCoreMin: row.sleepCoreMin != null ? Number(row.sleepCoreMin) : undefined,
    sleepDeepMin: row.sleepDeepMin != null ? Number(row.sleepDeepMin) : undefined,
    sleepSourceMode: row.sleepSourceMode ?? undefined,
    waterLiters: row.waterLiters != null ? Number(row.waterLiters) : undefined,
    steps: row.steps != null ? Number(row.steps) : undefined,
    cardioMin: row.cardioMin != null ? Number(row.cardioMin) : undefined,
    liftDone: row.liftDone ?? undefined,
    deloadWeek: row.deloadWeek ?? undefined,
    performanceNote: row.performanceNote ?? undefined,
    adherence: row.adherence != null ? Number(row.adherence) : undefined,
    notes: row.notes ?? undefined,
    sleepMinutes: row.sleepMinutes != null ? Number(row.sleepMinutes) : undefined,
    activeZoneMinutes: row.activeZoneMinutes != null ? Number(row.activeZoneMinutes) : undefined,
    energyBurnedKcal: row.energyBurnedKcal != null ? Number(row.energyBurnedKcal) : undefined,
    restingHr: row.restingHr != null ? Number(row.restingHr) : undefined,
    hrv: row.hrv != null ? Number(row.hrv) : undefined,
    zone1Min: row.zone1Min != null ? Number(row.zone1Min) : undefined,
    zone2Min: row.zone2Min != null ? Number(row.zone2Min) : undefined,
    zone3Min: row.zone3Min != null ? Number(row.zone3Min) : undefined,
    belowZone1Min: row.belowZone1Min != null ? Number(row.belowZone1Min) : undefined,
    sleepEfficiency: row.sleepEfficiency != null ? Number(row.sleepEfficiency) : undefined,
    sleepStartLocal: row.sleepStartLocal ?? undefined,
    sleepEndLocal: row.sleepEndLocal ?? undefined,
    caloriesIn: row.caloriesIn != null ? Number(row.caloriesIn) : undefined,
    trainingLoad: row.trainingLoad ?? undefined,
    cardioStartTime: row.cardioStartTime ?? undefined,
    cardioEndTime: row.cardioEndTime ?? undefined,
    liftStartTime: row.liftStartTime ?? undefined,
    liftEndTime: row.liftEndTime ?? undefined,
    liftMin: row.liftMin != null ? Number(row.liftMin) : undefined,
    liftWorkingMin: row.liftWorkingMin != null ? Number(row.liftWorkingMin) : undefined,
    zone4Min: row.zone4Min != null ? Number(row.zone4Min) : undefined,
    zone5Min: row.zone5Min != null ? Number(row.zone5Min) : undefined,
    liftZ1Min: row.liftZ1Min != null ? Number(row.liftZ1Min) : undefined,
    liftZ2Min: row.liftZ2Min != null ? Number(row.liftZ2Min) : undefined,
    liftZ3Min: row.liftZ3Min != null ? Number(row.liftZ3Min) : undefined,
    liftZ4Min: row.liftZ4Min != null ? Number(row.liftZ4Min) : undefined,
    liftZ5Min: row.liftZ5Min != null ? Number(row.liftZ5Min) : undefined,
    fatFreeMassLb: row.fatFreeMassLb != null ? Number(row.fatFreeMassLb) : undefined,
    pushupsReps: row.pushupsReps != null ? Number(row.pushupsReps) : undefined,
    pullupsReps: row.pullupsReps != null ? Number(row.pullupsReps) : undefined,
    benchReps: row.benchReps != null ? Number(row.benchReps) : undefined,
    benchWeightLb: row.benchWeightLb != null ? Number(row.benchWeightLb) : undefined,
    ohpReps: row.ohpReps != null ? Number(row.ohpReps) : undefined,
    ohpWeightLb: row.ohpWeightLb != null ? Number(row.ohpWeightLb) : undefined,
    pain010: row.pain010 != null ? Number(row.pain010) : undefined,
    mealChecklist: row.mealChecklist ?? undefined,
    cardioSkipped: row.cardioSkipped ?? undefined,
    liftSkipped: row.liftSkipped ?? undefined,
  };
}

export interface IntelReceipt {
  performed_at: string;
  source: string;
  exercise_names: string[];
  set_count: number;
  total_tonnage: number;
  intel_set_ids: number[];
  plan_id: number | null;
}

export async function saveIntelReceipt(receipt: IntelReceipt): Promise<void> {
  await apiRequest("POST", "/api/intel-receipts", receipt);
}

export async function loadIntelReceipt(date: string): Promise<IntelReceipt | null> {
  const res = await apiRequest("GET", `/api/intel-receipts/${date}?_=${Date.now()}`);
  const data = await res.json();
  return data?.receipt ?? null;
}
