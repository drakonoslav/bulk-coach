import { useState, useCallback, useRef, useMemo } from "react";
import { Platform, NativeModules } from "react-native";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Constants from "expo-constants";

export type HealthKitStatus = "unavailable" | "idle" | "requesting_permissions" | "syncing" | "done" | "error";

export interface SyncCounts {
  sleep_upserts: number;
  vitals_upserts: number;
  sessions_upserts: number;
  hr_samples_points: number;
}

const EMPTY_COUNTS: SyncCounts = { sleep_upserts: 0, vitals_upserts: 0, sessions_upserts: 0, hr_samples_points: 0 };

function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

function hasNativeHealthKitModule(): boolean {
  if (Platform.OS !== "ios") return false;
  try {
    const mod = NativeModules.AppleHealthKit;
    return !!mod;
  } catch {
    return false;
  }
}

let AppleHealthKit: any = null;

if (Platform.OS === "ios" && !isExpoGo()) {
  try {
    AppleHealthKit = require("react-native-health").default;
  } catch {
    AppleHealthKit = null;
  }
}

export interface HealthKitDebugInfo {
  runtime: "Expo Go" | "Dev Client" | "Non-iOS";
  moduleLoaded: boolean;
}

const HK_PERMISSIONS = {
  permissions: {
    read: [
      "SleepAnalysis",
      "HeartRate",
      "RestingHeartRate",
      "HeartRateVariabilitySDNN",
      "RespiratoryRate",
      "OxygenSaturation",
      "StepCount",
      "ActiveEnergyBurned",
      "Workout",
    ],
    write: [] as string[],
  },
};

function dateNDaysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function groupByDate<T>(items: T[], dateFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = dateFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

async function postJson(path: string, body: any): Promise<any> {
  const res = await apiRequest("POST", path, body);
  return res.json();
}

export function useHealthKit() {
  const debugInfo = useMemo<HealthKitDebugInfo>(() => {
    if (Platform.OS !== "ios") {
      return { runtime: "Non-iOS", moduleLoaded: false };
    }
    const expoGo = isExpoGo();
    const modLoaded = AppleHealthKit !== null;
    return {
      runtime: expoGo ? "Expo Go" : "Dev Client",
      moduleLoaded: modLoaded,
    };
  }, []);

  const available = Platform.OS === "ios" && !isExpoGo() && AppleHealthKit !== null;

  const [status, setStatus] = useState<HealthKitStatus>(
    available ? "idle" : "unavailable"
  );
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<SyncCounts>(EMPTY_COUNTS);
  const [progress, setProgress] = useState("");
  const abortRef = useRef(false);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (!AppleHealthKit) return false;
    setStatus("requesting_permissions");
    setError(null);
    return new Promise((resolve) => {
      AppleHealthKit.initHealthKit(HK_PERMISSIONS, (err: any) => {
        if (err) {
          setError("HealthKit permission denied");
          setStatus("error");
          resolve(false);
        } else {
          setStatus("idle");
          resolve(true);
        }
      });
    });
  }, []);

  const syncDays = useCallback(async (daysBack: number) => {
    if (!AppleHealthKit) return;
    abortRef.current = false;
    setStatus("syncing");
    setError(null);
    setCounts(EMPTY_COUNTS);

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const startDate = dateNDaysAgo(daysBack);
    const opts = { startDate: startDate.toISOString() };
    const running: SyncCounts = { sleep_upserts: 0, vitals_upserts: 0, sessions_upserts: 0, hr_samples_points: 0 };

    try {
      setProgress("Fetching sleep data...");
      const sleepSamples: any[] = await new Promise((resolve, reject) => {
        AppleHealthKit.getSleepSamples(opts, (err: any, results: any[]) => {
          if (err) reject(err); else resolve(results || []);
        });
      });

      const sleepByDate = groupByDate(sleepSamples, (s: any) => s.startDate?.slice(0, 10) || "");
      for (const [date, samples] of Object.entries(sleepByDate)) {
        if (abortRef.current) break;
        if (!date || date.length !== 10) continue;

        let totalMin = 0;
        let remMin = 0;
        let deepMin = 0;
        let coreMin = 0;
        let awakeMin = 0;
        let earliest = samples[0]?.startDate;
        let latest = samples[0]?.endDate;

        for (const s of samples) {
          const dur = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
          if (s.startDate < earliest) earliest = s.startDate;
          if (s.endDate > latest) latest = s.endDate;

          if (s.value === "ASLEEP" || s.value === "CORE" || s.value === "INBED") {
            totalMin += dur;
            if (s.value === "CORE") coreMin += dur;
          }
          if (s.value === "REM") { remMin += dur; totalMin += dur; }
          if (s.value === "DEEP") { deepMin += dur; totalMin += dur; }
          if (s.value === "AWAKE") awakeMin += dur;
        }

        if (totalMin > 0) {
          await postJson("/api/canonical/sleep/upsert", {
            date,
            sleep_start: earliest,
            sleep_end: latest,
            total_sleep_minutes: Math.round(totalMin),
            rem_minutes: remMin > 0 ? Math.round(remMin) : undefined,
            deep_minutes: deepMin > 0 ? Math.round(deepMin) : undefined,
            light_or_core_minutes: coreMin > 0 ? Math.round(coreMin) : undefined,
            awake_minutes: awakeMin > 0 ? Math.round(awakeMin) : undefined,
            source: "apple_health",
            timezone: tz,
          });
          running.sleep_upserts++;
          setCounts({ ...running });
        }
      }

      setProgress("Fetching vitals...");
      const dayDates: string[] = [];
      for (let i = 0; i < daysBack; i++) {
        const d = dateNDaysAgo(i);
        dayDates.push(d.toISOString().slice(0, 10));
      }

      for (const date of dayDates) {
        if (abortRef.current) break;
        const dayStart = new Date(date + "T00:00:00").toISOString();
        const dayEnd = new Date(date + "T23:59:59").toISOString();
        const dayOpts = { startDate: dayStart, endDate: dayEnd };

        let restingHr: number | undefined;
        let hrvSdnn: number | undefined;
        let steps: number | undefined;
        let activeEnergy: number | undefined;

        try {
          const hrSamples: any[] = await new Promise((resolve, reject) => {
            AppleHealthKit.getRestingHeartRate(dayOpts, (err: any, results: any[]) => {
              if (err) resolve([]); else resolve(results || []);
            });
          });
          if (hrSamples.length > 0) restingHr = hrSamples[0].value;
        } catch {}

        try {
          const hrvSamples: any[] = await new Promise((resolve, reject) => {
            AppleHealthKit.getHeartRateVariabilitySamples(dayOpts, (err: any, results: any[]) => {
              if (err) resolve([]); else resolve(results || []);
            });
          });
          if (hrvSamples.length > 0) hrvSdnn = hrvSamples[0].value;
        } catch {}

        try {
          const stepResult: any = await new Promise((resolve, reject) => {
            AppleHealthKit.getStepCount(dayOpts, (err: any, result: any) => {
              if (err) resolve(null); else resolve(result);
            });
          });
          if (stepResult?.value) steps = Math.round(stepResult.value);
        } catch {}

        try {
          const energyResult: any = await new Promise((resolve, reject) => {
            AppleHealthKit.getActiveEnergyBurned(dayOpts, (err: any, results: any[]) => {
              if (err) resolve([]); else resolve(results || []);
            });
          });
          if (energyResult.length > 0) {
            activeEnergy = Math.round(energyResult.reduce((sum: number, e: any) => sum + (e.value || 0), 0));
          }
        } catch {}

        if (restingHr || hrvSdnn || steps || activeEnergy) {
          await postJson("/api/canonical/vitals/upsert", {
            date,
            resting_hr: restingHr,
            hrv_sdnn_ms: hrvSdnn,
            steps,
            active_energy_kcal: activeEnergy,
            source: "apple_health",
            timezone: tz,
          });
          running.vitals_upserts++;
          setCounts({ ...running });
        }
      }

      setProgress("Fetching workouts...");
      const workoutSamples: any[] = await new Promise((resolve, reject) => {
        AppleHealthKit.getSamples({
          ...opts,
          type: "Workout",
        }, (err: any, results: any[]) => {
          if (err) reject(err); else resolve(results || []);
        });
      });

      const typeMap: Record<string, string> = {
        TraditionalStrengthTraining: "strength",
        FunctionalStrengthTraining: "strength",
        Running: "cardio",
        Cycling: "cardio",
        Swimming: "cardio",
        HighIntensityIntervalTraining: "hiit",
        Yoga: "flexibility",
        Pilates: "flexibility",
      };

      for (const w of workoutSamples) {
        if (abortRef.current) break;
        const sessionId = `hk_${w.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8)}`;
        const workoutType = typeMap[w.activityName] || "other";

        await postJson("/api/canonical/workouts/upsert-session", {
          session_id: sessionId,
          date: w.start?.slice(0, 10) || w.startDate?.slice(0, 10),
          start_ts: w.start || w.startDate,
          end_ts: w.end || w.endDate,
          workout_type: workoutType,
          calories_burned: w.calories ? Math.round(w.calories) : undefined,
          source: "apple_health",
          timezone: tz,
        });
        running.sessions_upserts++;
        setCounts({ ...running });

        try {
          const hrDuring: any[] = await new Promise((resolve, reject) => {
            AppleHealthKit.getHeartRateSamples({
              startDate: w.start || w.startDate,
              endDate: w.end || w.endDate,
            }, (err: any, results: any[]) => {
              if (err) resolve([]); else resolve(results || []);
            });
          });

          if (hrDuring.length > 0) {
            await postJson("/api/canonical/workouts/hr-samples/upsert-bulk", {
              session_id: sessionId,
              source: "apple_health",
              samples: hrDuring.map((s: any) => ({
                ts: s.startDate || s.start,
                hr_bpm: Math.round(s.value),
              })),
            });
            running.hr_samples_points += hrDuring.length;
            setCounts({ ...running });
          }
        } catch {}
      }

      setStatus("done");
      setProgress("");
    } catch (err: any) {
      setError(err.message || "Sync failed");
      setStatus("error");
      setProgress("");
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    status,
    error,
    counts,
    progress,
    requestPermissions,
    syncDays,
    abort,
    debugInfo,
  };
}
