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

export async function loadDashboard(start?: string, end?: string): Promise<DashboardRow[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL("/api/dashboard", baseUrl);
    if (start) url.searchParams.set("start", start);
    if (end) url.searchParams.set("end", end);
    const res = await authFetch(url.toString());
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("loadDashboard API error:", err);
    return [];
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
    adherence: row.adherence != null ? Number(row.adherence) : 1,
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
    fatFreeMassLb: row.fatFreeMassLb != null ? Number(row.fatFreeMassLb) : undefined,
    pushupsReps: row.pushupsReps != null ? Number(row.pushupsReps) : undefined,
    pullupsReps: row.pullupsReps != null ? Number(row.pullupsReps) : undefined,
    benchReps: row.benchReps != null ? Number(row.benchReps) : undefined,
    benchWeightLb: row.benchWeightLb != null ? Number(row.benchWeightLb) : undefined,
    ohpReps: row.ohpReps != null ? Number(row.ohpReps) : undefined,
    ohpWeightLb: row.ohpWeightLb != null ? Number(row.ohpWeightLb) : undefined,
  };
}
