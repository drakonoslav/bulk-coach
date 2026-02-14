import { useState, useCallback, useRef, useEffect } from "react";
import { Platform } from "react-native";
import { apiRequest } from "@/lib/query-client";

export type PolarStatus =
  | "unavailable"
  | "idle"
  | "scanning"
  | "connecting"
  | "connected"
  | "baseline"
  | "streaming"
  | "analyzing"
  | "done"
  | "error";

export interface PolarDevice {
  id: string;
  name: string;
  rssi: number;
}

export interface LiveStats {
  hr: number;
  rrCount: number;
  hrCount: number;
  baselineSecondsLeft: number;
  elapsedSec: number;
}

export interface SessionAnalysis {
  pre_session_rmssd: number | null;
  min_session_rmssd: number | null;
  post_session_rmssd: number | null;
  hrv_suppression_pct: number | null;
  hrv_rebound_pct: number | null;
  hrv_response_flag: string;
  strength_bias: number;
  cardio_bias: number;
  time_to_recovery_sec: number | null;
}

let BleManager: any = null;

const POLAR_HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const POLAR_HR_CHAR = "00002a37-0000-1000-8000-00805f9b34fb";
const BUFFER_SIZE = 100;
const BASELINE_SEC = 120;

function parseHrMeasurement(data: number[]): { hr: number; rrIntervals: number[] } {
  const flags = data[0];
  const is16bit = flags & 0x01;
  const hasRR = flags & 0x10;

  let hr: number;
  let offset: number;
  if (is16bit) {
    hr = data[1] | (data[2] << 8);
    offset = 3;
  } else {
    hr = data[1];
    offset = 2;
  }

  const rrIntervals: number[] = [];
  if (hasRR) {
    while (offset + 1 < data.length) {
      const rr = (data[offset] | (data[offset + 1] << 8)) * 1000 / 1024;
      if (rr >= 300 && rr <= 2000) rrIntervals.push(Math.round(rr * 10) / 10);
      offset += 2;
    }
  }

  return { hr, rrIntervals };
}

async function postJson(path: string, body: any): Promise<any> {
  const res = await apiRequest("POST", path, body);
  return res.json();
}

function decodeBase64ToBytes(b64: string): number[] {
  const bin = atob(b64);
  const bytes = new Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pushRrWithBeatTimes(
  rrIntervals: number[],
  packetTimeMs: number,
  rrBuffer: { ts: string; rr_ms: number }[],
) {
  let t = packetTimeMs;
  for (let i = rrIntervals.length - 1; i >= 0; i--) {
    const rr = rrIntervals[i];
    rrBuffer.push({ ts: new Date(t).toISOString(), rr_ms: rr });
    t -= rr;
  }
}

export function usePolarH10() {
  const [status, setStatus] = useState<PolarStatus>(
    Platform.OS === "web" ? "unavailable" : "idle",
  );
  const statusRef = useRef<PolarStatus>(Platform.OS === "web" ? "unavailable" : "idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const [devices, setDevices] = useState<PolarDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<PolarDevice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [liveStats, setLiveStats] = useState<LiveStats>({
    hr: 0,
    rrCount: 0,
    hrCount: 0,
    baselineSecondsLeft: 0,
    elapsedSec: 0,
  });

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);

  const bleRef = useRef<any>(null);
  const subscriptionRef = useRef<any>(null);
  const hrBufferRef = useRef<{ ts: string; hr_bpm: number }[]>([]);
  const rrBufferRef = useRef<{ ts: string; rr_ms: number }[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimeRef = useRef<number>(0);
  const baselineEndRef = useRef<number>(0);
  const statsRef = useRef({ hrCount: 0, rrCount: 0, lastHr: 0 });

  const cleanup = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      if (bleRef.current) {
        bleRef.current.destroy();
        bleRef.current = null;
      }
    };
  }, [cleanup]);

  const getBle = useCallback(() => {
    if (!bleRef.current && BleManager) {
      bleRef.current = new BleManager();
    }
    return bleRef.current;
  }, []);

  const scan = useCallback(
    async (timeoutMs: number = 8000) => {
      const ble = getBle();
      if (!ble) {
        setStatus("unavailable");
        return;
      }

      setStatus("scanning");
      setDevices([]);
      setError(null);

      const found: PolarDevice[] = [];

      ble.startDeviceScan(null, null, (err: any, device: any) => {
        if (err) return;
        if (!device?.name) return;
        const name = device.name.toLowerCase();
        if (name.includes("polar") || name.includes("h10") || name.includes("h9")) {
          if (!found.find((d) => d.id === device.id)) {
            found.push({ id: device.id, name: device.name, rssi: device.rssi ?? -100 });
            setDevices([...found]);
          }
        }
      });

      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      ble.stopDeviceScan();

      if (found.length === 0) {
        setError("No Polar devices found. Ensure strap is worn and Bluetooth is enabled.");
      }
      setStatus("idle");
    },
    [getBle],
  );

  const connect = useCallback(
    async (deviceId: string) => {
      const ble = getBle();
      if (!ble) return;

      setStatus("connecting");
      setError(null);

      try {
        const device = await ble.connectToDevice(deviceId);
        await device.discoverAllServicesAndCharacteristics();

        const dev = devices.find((d) => d.id === deviceId);
        setConnectedDevice(dev || { id: deviceId, name: "Polar H10", rssi: -50 });
        setStatus("connected");
      } catch (err: any) {
        setError(err.message || "Connection failed");
        setStatus("error");
      }
    },
    [getBle, devices],
  );

  const disconnect = useCallback(async () => {
    cleanup();
    const ble = getBle();
    if (ble && connectedDevice) {
      try {
        await ble.cancelDeviceConnection(connectedDevice.id);
      } catch {}
    }
    setConnectedDevice(null);
    setStatus("idle");
  }, [getBle, connectedDevice, cleanup]);

  const flushHrBuffer = useCallback(async (sid: string) => {
    const buf = hrBufferRef.current;
    if (buf.length === 0) return;
    const samples = buf.splice(0);
    try {
      await postJson("/api/canonical/workouts/hr-samples/upsert-bulk", {
        session_id: sid,
        source: "polar",
        samples,
      });
    } catch (err) {
      console.error("HR flush error:", err);
    }
  }, []);

  const flushRrBuffer = useCallback(async (sid: string) => {
    const buf = rrBufferRef.current;
    if (buf.length === 0) return;
    const intervals = buf.splice(0);
    try {
      await postJson("/api/canonical/workouts/rr-intervals/upsert-bulk", {
        session_id: sid,
        source: "polar",
        intervals,
      });
    } catch (err) {
      console.error("RR flush error:", err);
    }
  }, []);

  const startSession = useCallback(
    async (readinessScore: number) => {
      if (!connectedDevice) return;
      const ble = getBle();
      if (!ble) return;

      const start = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const sid = `polar_${start.toISOString()}`;
      setSessionId(sid);

      setAnalysis(null);
      hrBufferRef.current = [];
      rrBufferRef.current = [];
      statsRef.current = { hrCount: 0, rrCount: 0, lastHr: 0 };

      startTimeRef.current = start.getTime();
      baselineEndRef.current = start.getTime() + BASELINE_SEC * 1000;

      try {
        await postJson("/api/canonical/workouts/upsert-session", {
          session_id: sid,
          date: start.toISOString().slice(0, 10),
          start_ts: start.toISOString(),
          workout_type: "strength",
          source: "polar",
          timezone: tz,
          cbp_start: Math.round(Math.pow(readinessScore / 100, 1.4) * 100),
          cbp_current: Math.round(Math.pow(readinessScore / 100, 1.4) * 100),
          phase: "COMPOUND",
        });
      } catch (err: any) {
        setError("Failed to create session: " + (err.message || String(err)));
        setStatus("error");
        return;
      }

      setStatus("baseline");

      const subscription = ble.monitorCharacteristicForDevice(
        connectedDevice.id,
        POLAR_HR_SERVICE,
        POLAR_HR_CHAR,
        (err: any, char: any) => {
          if (err || !char?.value) return;

          const bytes = decodeBase64ToBytes(char.value);
          const { hr, rrIntervals } = parseHrMeasurement(bytes);

          const packetTimeMs = Date.now();
          const ts = new Date(packetTimeMs).toISOString();

          hrBufferRef.current.push({ ts, hr_bpm: hr });
          statsRef.current.hrCount++;
          statsRef.current.lastHr = hr;

          if (rrIntervals.length) {
            pushRrWithBeatTimes(rrIntervals, packetTimeMs, rrBufferRef.current);
            statsRef.current.rrCount += rrIntervals.length;
          }

          if (hrBufferRef.current.length >= BUFFER_SIZE) void flushHrBuffer(sid);
          if (rrBufferRef.current.length >= BUFFER_SIZE) void flushRrBuffer(sid);
        },
      );

      subscriptionRef.current = subscription;

      timerRef.current = setInterval(() => {
        const nowMs = Date.now();
        const elapsed = Math.round((nowMs - startTimeRef.current) / 1000);
        const baselineLeft = Math.max(
          0,
          Math.round((baselineEndRef.current - nowMs) / 1000),
        );

        setLiveStats({
          hr: statsRef.current.lastHr || 0,
          hrCount: statsRef.current.hrCount,
          rrCount: statsRef.current.rrCount,
          baselineSecondsLeft: baselineLeft,
          elapsedSec: elapsed,
        });

        if (baselineLeft === 0 && statusRef.current === "baseline") {
          setStatus("streaming");
        }
      }, 1000);
    },
    [connectedDevice, getBle, flushHrBuffer, flushRrBuffer],
  );

  const endSession = useCallback(async () => {
    if (!sessionId) return;
    cleanup();
    setStatus("analyzing");

    try {
      await flushHrBuffer(sessionId);
      await flushRrBuffer(sessionId);

      const endTs = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      await postJson("/api/canonical/workouts/upsert-session", {
        session_id: sessionId,
        date: new Date(startTimeRef.current).toISOString().slice(0, 10),
        start_ts: new Date(startTimeRef.current).toISOString(),
        end_ts: endTs.toISOString(),
        workout_type: "strength",
        source: "polar",
        timezone: tz,
      });

      const result = await postJson(
        `/api/canonical/workouts/${encodeURIComponent(sessionId)}/analyze-hrv`,
        {},
      );

      setAnalysis({
        pre_session_rmssd: result.pre_session_rmssd ?? null,
        min_session_rmssd: result.min_session_rmssd ?? null,
        post_session_rmssd: result.post_session_rmssd ?? null,
        hrv_suppression_pct: result.hrv_suppression_pct ?? null,
        hrv_rebound_pct: result.hrv_rebound_pct ?? null,
        hrv_response_flag: result.hrv_response_flag ?? "insufficient",
        strength_bias: result.strength_bias ?? 0.5,
        cardio_bias: result.cardio_bias ?? 0.5,
        time_to_recovery_sec: result.time_to_recovery_sec ?? null,
      });

      setStatus("done");
    } catch (err: any) {
      setError("Analysis failed: " + (err.message || String(err)));
      setStatus("error");
    }
  }, [sessionId, cleanup, flushHrBuffer, flushRrBuffer]);

  const reset = useCallback(() => {
    cleanup();
    setSessionId(null);
    setAnalysis(null);
    setLiveStats({ hr: 0, rrCount: 0, hrCount: 0, baselineSecondsLeft: 0, elapsedSec: 0 });
    setStatus(connectedDevice ? "connected" : "idle");
  }, [connectedDevice, cleanup]);

  return {
    status,
    devices,
    connectedDevice,
    error,
    liveStats,
    sessionId,
    analysis,
    scan,
    connect,
    disconnect,
    startSession,
    endSession,
    reset,
  };
}
