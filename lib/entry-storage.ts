import AsyncStorage from "@react-native-async-storage/async-storage";
import { DailyEntry, BASELINE, type Baseline } from "./coaching-engine";

const ENTRIES_KEY = "@bulk_coach_entries";
const BASELINE_KEY = "@bulk_coach_baseline";

export async function loadEntries(): Promise<DailyEntry[]> {
  const raw = await AsyncStorage.getItem(ENTRIES_KEY);
  if (!raw) return [];
  const entries: DailyEntry[] = JSON.parse(raw);
  return entries.sort((a, b) => a.day.localeCompare(b.day));
}

export async function saveEntries(entries: DailyEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  await AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(sorted));
}

export async function saveEntry(entry: DailyEntry): Promise<void> {
  const entries = await loadEntries();
  const filtered = entries.filter((e) => e.day !== entry.day);
  filtered.push(entry);
  await saveEntries(filtered);
}

export async function deleteEntry(day: string): Promise<void> {
  const entries = await loadEntries();
  const filtered = entries.filter((e) => e.day !== day);
  await saveEntries(filtered);
}

export async function loadBaseline(): Promise<Baseline> {
  const raw = await AsyncStorage.getItem(BASELINE_KEY);
  if (!raw) return BASELINE;
  return JSON.parse(raw);
}

export async function saveBaseline(baseline: Baseline): Promise<void> {
  await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
}
