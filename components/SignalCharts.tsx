import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  LayoutChangeEvent,
  PanResponder,
  Platform,
} from "react-native";
import { fmtDelta, fmtPctVal } from "@/lib/format";
import Svg, { Path, Rect, Line, Text as SvgText } from "react-native-svg";
import Colors from "@/constants/colors";
import type { ForecastSummary, ForecastResult } from "@/lib/forecast-types";
import { computeRecoveryIndexPairs } from "@/lib/recovery-index";

interface SignalPoint {
  date: string;
  hpa: number | null;
  hrvDeltaPct: number | null;
  readiness: number | null;
  strengthVelocity: number | null;
  hrv: number | null;
  rhr: number | null;
  latencyPct: number | null;
  wasoPct: number | null;
  awakeInBedPct: number | null;
  latencyMin: number | null;
  wasoMin: number | null;
  awakeInBedMin: number | null;
}

interface SignalChartsProps {
  points: SignalPoint[];
  rangeDays: number;
  onRangeChange: (days: number) => void;
  forecast?: ForecastSummary | null;
  svSource?: "intel" | "legacy";
}

const RANGES = [30, 60, 90];
const PAD_L = 0;
const PAD_R = 4;
const PAD_T = 6;
const PAD_B = 18;

const C_HPA = "#D97706";
const C_HPA_HIGH = "#DC2626";
const C_HRV = "#FBBF24";
const C_READINESS = "#5CF2FF";
const C_SV = "#FF2D8A";
const C_RECOVERY = "#5CF2FF";
const C_RECOVERY_AVG = "#FF00FF";
const C_RECOVERY_REF = "#22C55E";
const C_LATENCY = "#2D8CFF";
const C_WASO = "#FFC928";
const C_AWAKE_IN_BED = "#FF4D5A";
const C_BLEND_LW = "#00E639";
const C_BLEND_WA = "#FF6600";
const C_BLEND_LA = "#8B5CF6";
const C_BLEND_RYB = "#FF4FCF";
const C_BLEND_WHITE = "#FFFFFF";
const C_GRID = "rgba(255,255,255,0.08)";

type PlanetCode = "LWA" | "LAW" | "WLA" | "WAL" | "ALW" | "AWL";
interface SleepPlanet { code: PlanetCode; name: string; subtitle: string; accent: string }
const PLANET_MAP: Record<PlanetCode, { name: string; subtitle: string; accent: string }> = {
  LWA: { name: "Stable Crustal World", subtitle: "Mostly stable sleep terrain; onset disturbance leads", accent: C_LATENCY },
  LAW: { name: "Tectonic Crust World", subtitle: "Crust-led terrain with occasional deep wake pressure", accent: C_LATENCY },
  WLA: { name: "Convective Mantle World", subtitle: "Maintenance instability dominates the terrain", accent: C_WASO },
  WAL: { name: "Fragmented Mantle World", subtitle: "Fragmented mantle terrain with wake bursts", accent: C_BLEND_WA },
  ALW: { name: "Core-Driven Volcanic World", subtitle: "Wake pressure drives the terrain; latency shapes the structure", accent: C_AWAKE_IN_BED },
  AWL: { name: "Exposed Core World", subtitle: "Wake-dominant terrain with strong fragmentation beneath", accent: C_BLEND_LA },
};
function getSleepPlanet(latencyRatio: number | null, wasoRatio: number | null, awakeRatio: number | null): SleepPlanet | null {
  if (latencyRatio == null || wasoRatio == null || awakeRatio == null) return null;
  const eps = 1e-6;
  const items = [
    { key: "L", value: latencyRatio },
    { key: "W", value: wasoRatio },
    { key: "A", value: awakeRatio },
  ];
  const tieBreak: Record<string, number> = { A: 0, W: 1, L: 2 };
  items.sort((a, b) => {
    const diff = b.value - a.value;
    if (Math.abs(diff) > eps) return diff;
    return tieBreak[a.key] - tieBreak[b.key];
  });
  const code = (items[0].key + items[1].key + items[2].key) as PlanetCode;
  const info = PLANET_MAP[code];
  return { code, ...info };
}
const C_THRESHOLD = "rgba(255,255,255,0.15)";
const C_CROSSHAIR = "rgba(255,255,255,0.22)";
const C_ZONE_CALM = "rgba(255,255,255,0.015)";
const C_ZONE_MOD = "rgba(251,191,36,0.03)";
const C_ZONE_HIGH = "rgba(220,38,38,0.04)";

function buildPath(
  data: { x: number; y: number }[],
): string {
  if (data.length === 0) return "";
  let d = `M${data[0].x},${data[0].y}`;
  for (let i = 1; i < data.length; i++) {
    d += ` L${data[i].x},${data[i].y}`;
  }
  return d;
}

interface FillLayer {
  d: string;
  color: string;
  opacity: number;
  strokeColor: string;
  strokeWidth: number;
  glowRadius: number;
  glowOpacity: number;
  isComposite: boolean;
  isExtreme?: boolean;
  priority: number;
}

function interpolateGaps(raw: (number | null)[]): (number | null)[] {
  const result = [...raw];
  const N = raw.length;
  let prev = -1;
  for (let i = 0; i < N; i++) {
    if (raw[i] != null) {
      if (prev >= 0 && prev < i - 1) {
        for (let j = prev + 1; j < i; j++) {
          const t = (j - prev) / (i - prev);
          result[j] = raw[prev]! + t * (raw[i]! - raw[prev]!);
        }
      }
      prev = i;
    }
  }
  return result;
}

function buildDisruptionFillLayers(
  points: { latencyPct: number | null; wasoPct: number | null; awakeInBedPct: number | null }[],
  xForIdx: (i: number) => number,
  pctToY: (pct: number) => number,
  latAvgY: number | null,
  wasoAvgY: number | null,
  awakeAvgY: number | null,
): FillLayer[] {
  const N = points.length;
  if (N < 2) return [];

  const latY = interpolateGaps(points.map(p => p.latencyPct != null ? pctToY(p.latencyPct) : null));
  const wasoY = interpolateGaps(points.map(p => p.wasoPct != null ? pctToY(p.wasoPct) : null));
  const awakeY = interpolateGaps(points.map(p => p.awakeInBedPct != null ? pctToY(p.awakeInBedPct) : null));

  const pathAcc: Record<string, string> = {};
  function addTrap(key: string, x1: number, t1: number, x2: number, t2: number, b1: number, b2: number) {
    if (t1 >= b1 - 0.3 && t2 >= b2 - 0.3) return;
    if (!pathAcc[key]) pathAcc[key] = "";
    pathAcc[key] += `M${x1.toFixed(1)},${t1.toFixed(1)} L${x2.toFixed(1)},${t2.toFixed(1)} L${x2.toFixed(1)},${b2.toFixed(1)} L${x1.toFixed(1)},${b1.toFixed(1)} Z `;
  }

  interface MLine { key: string; y1: number; y2: number; avgY: number }

  function blendKey(a: string, b: string): string { return [a, b].sort().join("_"); }

  function lerp(v1: number, v2: number, t: number): number { return v1 + t * (v2 - v1); }

  function fillSubSeg(active: { key: string; yL: number; yR: number; avgY: number }[], xL: number, xR: number) {
    if (active.length === 0 || xR - xL < 0.1) return;
    if (active.length === 1) {
      const m = active[0];
      addTrap(m.key + "_solo", xL, m.yL, xR, m.yR, m.avgY, m.avgY);
      return;
    }
    const sortedL = [...active].sort((a, b) => a.yL - b.yL);
    const sortedR = [...active].sort((a, b) => a.yR - b.yR);
    const ctrls = active.map(m => m.avgY).sort((a, b) => a - b);
    const highCtrl = ctrls[0];

    if (active.length === 2) {
      const [a, b] = active;
      const bk = blendKey(a.key, b.key);
      const lowerCtrl = Math.max(a.avgY, b.avgY);
      const lowerCtrlM = a.avgY > b.avgY ? a : b;
      const aTopL = a.yL <= b.yL, aTopR = a.yR <= b.yR;
      if (aTopL === aTopR) {
        const top = aTopL ? a : b;
        const bot = aTopL ? b : a;
        addTrap(top.key + "_solo", xL, top.yL, xR, top.yR, bot.yL, bot.yR);
        addTrap(bk, xL, bot.yL, xR, bot.yR, highCtrl, highCtrl);
      } else {
        const dA = a.yR - a.yL, dB = b.yR - b.yL;
        const den = dA - dB;
        if (Math.abs(den) > 0.01) {
          const t = (b.yL - a.yL) / den;
          const cx = lerp(xL, xR, t);
          const cy = lerp(a.yL, a.yR, t);
          const topH1 = aTopL ? a : b, botH1 = aTopL ? b : a;
          addTrap(topH1.key + "_solo", xL, topH1.yL, cx, cy, botH1.yL, cy);
          addTrap(bk, xL, botH1.yL, cx, cy, highCtrl, highCtrl);
          const topH2 = aTopR ? a : b, botH2 = aTopR ? b : a;
          addTrap(topH2.key + "_solo", cx, cy, xR, topH2.yR, cy, botH2.yR);
          addTrap(bk, cx, cy, xR, botH2.yR, highCtrl, highCtrl);
        }
      }
      if (lowerCtrl > highCtrl + 0.5) {
        addTrap(lowerCtrlM.key + "_solo", xL, highCtrl, xR, highCtrl, lowerCtrl, lowerCtrl);
      }
    } else if (active.length === 3) {
      const midCtrl = ctrls[1];
      const lowCtrl = ctrls[2];
      const sameOrder = sortedL[0].key === sortedR[0].key && sortedL[1].key === sortedR[1].key;
      if (sameOrder) {
        const top = { key: sortedL[0].key, yL: sortedL[0].yL, yR: sortedR[0].yR };
        const mid = { key: sortedL[1].key, yL: sortedL[1].yL, yR: sortedR[1].yR };
        const bot = { key: sortedL[2].key, yL: sortedL[2].yL, yR: sortedR[2].yR };
        addTrap(top.key + "_solo", xL, top.yL, xR, top.yR, mid.yL, mid.yR);
        addTrap(blendKey(top.key, mid.key), xL, mid.yL, xR, mid.yR, bot.yL, bot.yR);
        addTrap("all3", xL, bot.yL, xR, bot.yR, highCtrl, highCtrl);
      } else {
        const diffs: { key1: string; key2: string; t: number }[] = [];
        for (let a = 0; a < active.length; a++) {
          for (let b = a + 1; b < active.length; b++) {
            const mA = active[a], mB = active[b];
            const dA = mA.yR - mA.yL, dB = mB.yR - mB.yL;
            const den = dA - dB;
            if (Math.abs(den) > 0.01) {
              const t = (mB.yL - mA.yL) / den;
              if (t > 0.01 && t < 0.99) diffs.push({ key1: mA.key, key2: mB.key, t });
            }
          }
        }
        if (diffs.length === 0) {
          const top = sortedL[0], bot = sortedL[2];
          addTrap(top.key + "_solo", xL, top.yL, xR, top.yR, sortedL[1].yL, sortedL[1].yR);
          addTrap(blendKey(top.key, sortedL[1].key), xL, sortedL[1].yL, xR, sortedL[1].yR, bot.yL, bot.yR);
          addTrap("all3", xL, bot.yL, xR, bot.yR, highCtrl, highCtrl);
        } else {
          diffs.sort((a, b) => a.t - b.t);
          const breaks = [0, ...diffs.map(d => d.t), 1];
          for (let s = 0; s < breaks.length - 1; s++) {
            const tL = breaks[s], tR = breaks[s + 1];
            if (tR - tL < 0.005) continue;
            const subXL = lerp(xL, xR, tL), subXR = lerp(xL, xR, tR);
            const subActive = active.map(m => ({
              key: m.key, yL: lerp(m.yL, m.yR, tL), yR: lerp(m.yL, m.yR, tR), avgY: m.avgY,
            }));
            const subSorted = [...subActive].sort((a, b) => a.yL - b.yL);
            addTrap(subSorted[0].key + "_solo", subXL, subSorted[0].yL, subXR, subSorted[0].yR, subSorted[1].yL, subSorted[1].yR);
            addTrap(blendKey(subSorted[0].key, subSorted[1].key), subXL, subSorted[1].yL, subXR, subSorted[1].yR, subSorted[2].yL, subSorted[2].yR);
            addTrap("all3", subXL, subSorted[2].yL, subXR, subSorted[2].yR, highCtrl, highCtrl);
          }
        }
      }
      if (midCtrl > highCtrl + 0.5) {
        const belowHigh = active.filter(m => m.avgY > highCtrl + 0.5);
        if (belowHigh.length >= 1) {
          const widest = belowHigh.reduce((a, b) => a.avgY > b.avgY ? a : b);
          addTrap(widest.key + "_solo", xL, highCtrl, xR, highCtrl, midCtrl, midCtrl);
        }
      }
      if (lowCtrl > midCtrl + 0.5) {
        const belowMid = active.filter(m => m.avgY > midCtrl + 0.5);
        if (belowMid.length >= 1) {
          addTrap(belowMid[0].key + "_solo", xL, midCtrl, xR, midCtrl, lowCtrl, lowCtrl);
        }
      }
    }
  }

  for (let i = 0; i < N - 1; i++) {
    const x1 = xForIdx(i), x2 = xForIdx(i + 1);
    const metrics: MLine[] = [];
    const tryAdd = (key: string, yArr: (number | null)[], avgY: number | null) => {
      const v1 = yArr[i], v2 = yArr[i + 1];
      if (v1 == null || v2 == null || avgY == null) return;
      if (v1 >= avgY && v2 >= avgY) return;
      metrics.push({ key, y1: v1, y2: v2, avgY });
    };
    tryAdd("lat", latY, latAvgY);
    tryAdd("waso", wasoY, wasoAvgY);
    tryAdd("awake", awakeY, awakeAvgY);
    if (metrics.length === 0) continue;

    const breakpoints: number[] = [0, 1];
    for (const m of metrics) {
      if ((m.y1 < m.avgY) !== (m.y2 < m.avgY)) {
        const dy = m.y2 - m.y1;
        if (Math.abs(dy) > 0.01) {
          const t = (m.avgY - m.y1) / dy;
          if (t > 0.001 && t < 0.999) breakpoints.push(t);
        }
      }
    }
    for (let a = 0; a < metrics.length; a++) {
      for (let b = a + 1; b < metrics.length; b++) {
        const mA = metrics[a], mB = metrics[b];
        const dA = mA.y2 - mA.y1, dB = mB.y2 - mB.y1;
        const den = dA - dB;
        if (Math.abs(den) > 0.01) {
          const t = (mB.y1 - mA.y1) / den;
          if (t > 0.001 && t < 0.999) breakpoints.push(t);
        }
      }
    }
    breakpoints.sort((a, b) => a - b);
    const unique: number[] = [breakpoints[0]];
    for (let k = 1; k < breakpoints.length; k++) {
      if (breakpoints[k] - unique[unique.length - 1] > 0.001) unique.push(breakpoints[k]);
    }

    for (let s = 0; s < unique.length - 1; s++) {
      const tL = unique[s], tR = unique[s + 1];
      const xL = lerp(x1, x2, tL), xR = lerp(x1, x2, tR);
      const active: { key: string; yL: number; yR: number; avgY: number }[] = [];
      for (const m of metrics) {
        const yL = lerp(m.y1, m.y2, tL);
        const yR = lerp(m.y1, m.y2, tR);
        if (yL < m.avgY || yR < m.avgY) {
          active.push({ key: m.key, yL: Math.min(yL, m.avgY), yR: Math.min(yR, m.avgY), avgY: m.avgY });
        }
      }
      fillSubSeg(active, xL, xR);
    }
  }

  const layers: FillLayer[] = [];
  const soloSpec: Record<string, { color: string; pri: number }> = {
    lat_solo: { color: C_LATENCY, pri: 0 },
    waso_solo: { color: C_WASO, pri: 1 },
    awake_solo: { color: C_AWAKE_IN_BED, pri: 2 },
  };
  const compSpec: Record<string, { color: string; pri: number }> = {
    lat_waso: { color: C_BLEND_LW, pri: 10 },
    awake_waso: { color: C_BLEND_WA, pri: 11 },
    awake_lat: { color: C_BLEND_LA, pri: 12 },
    all3: { color: C_BLEND_RYB, pri: 20 },
  };
  const extremeSpec: Record<string, { color: string; pri: number }> = {
    joint_cap: { color: C_BLEND_WHITE, pri: 30 },
  };

  for (const [k, cfg] of Object.entries(soloSpec)) {
    if (!pathAcc[k]) continue;
    layers.push({
      d: pathAcc[k], color: cfg.color, opacity: 0.85,
      strokeColor: cfg.color, strokeWidth: 0.8, glowRadius: 2.5, glowOpacity: 0.08,
      isComposite: false, priority: cfg.pri,
    });
  }
  for (const [k, cfg] of Object.entries(compSpec)) {
    if (!pathAcc[k]) continue;
    layers.push({
      d: pathAcc[k], color: cfg.color, opacity: 0.95,
      strokeColor: cfg.color, strokeWidth: 1.4, glowRadius: 4, glowOpacity: 0.18,
      isComposite: true, priority: cfg.pri,
    });
  }
  for (const [k, cfg] of Object.entries(extremeSpec)) {
    if (!pathAcc[k]) continue;
    layers.push({
      d: pathAcc[k], color: cfg.color, opacity: 0.98,
      strokeColor: cfg.color, strokeWidth: 1.1, glowRadius: 3.5, glowOpacity: 0.18,
      isComposite: true, isExtreme: true, priority: cfg.pri,
    });
  }
  layers.sort((a, b) => a.priority - b.priority);
  return layers;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function ChartPanel({
  height,
  label,
  subtitle,
  children,
  chartWidth,
  legendRows,
}: {
  height: number;
  label: string;
  subtitle?: string;
  children: React.ReactNode;
  chartWidth: number;
  legendRows?: { text: string; color: string }[][];
}) {
  const legendH = legendRows ? legendRows.length * 14 : 0;
  return (
    <View style={[panelStyles.container, { height: height + (subtitle ? 32 : 22) + legendH }]}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: legendRows ? 2 : 4, marginLeft: 2 }}>
        <Text style={panelStyles.label}>{label}</Text>
        {subtitle && <Text style={panelStyles.subtitle}>{subtitle}</Text>}
      </View>
      {legendRows && legendRows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", gap: 8, marginLeft: 2, marginBottom: ri < legendRows.length - 1 ? 1 : 3 }}>
          {row.map((il, ci) => (
            <Text key={ci} style={{ fontSize: 6.5, fontWeight: "800" as const, color: il.color, letterSpacing: 0.6 }}>{il.text}</Text>
          ))}
        </View>
      ))}
      <View style={{ height, overflow: "hidden" }}>
        {chartWidth > 0 && children}
      </View>
    </View>
  );
}

const panelStyles = StyleSheet.create({
  container: {
    marginBottom: 2,
  },
  label: {
    fontSize: 9,
    fontFamily: "Rubik_500Medium",
    color: "rgba(255,255,255,0.75)",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 0,
  },
  subtitle: {
    fontSize: 8,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 0.3,
  },
});

export default function SignalCharts({ points, rangeDays, onRangeChange, forecast, svSource = "legacy" }: SignalChartsProps) {
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const containerRef = useRef<View>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setChartWidth(e.nativeEvent.layout.width);
  }, []);

  const plotW = chartWidth - PAD_L - PAD_R;
  const N = points.length;

  const xForIdx = useCallback(
    (i: number) => {
      if (N <= 1) return PAD_L + plotW / 2;
      return PAD_L + (i / (N - 1)) * plotW;
    },
    [N, plotW],
  );

  const idxFromX = useCallback(
    (px: number) => {
      if (N <= 1) return 0;
      const ratio = (px - PAD_L) / plotW;
      return Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))));
    },
    [N, plotW],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
          const x = e.nativeEvent.locationX;
          setSelectedIdx(idxFromX(x));
        },
        onPanResponderMove: (e) => {
          const x = e.nativeEvent.locationX;
          setSelectedIdx(idxFromX(x));
        },
        onPanResponderRelease: () => {
          if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
          tooltipTimerRef.current = setTimeout(() => setSelectedIdx(null), 6000);
        },
      }),
    [idxFromX],
  );

  const STRESS_H = 90;
  const CAPACITY_H = 110;
  const OUTPUT_H = 110;
  const RECOVERY_H = 110;

  const hpaData = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    points.forEach((p, i) => {
      if (p.hpa != null) {
        const y = PAD_T + ((100 - p.hpa) / 100) * (STRESS_H - PAD_T - PAD_B);
        out.push({ x: xForIdx(i), y });
      }
    });
    return out;
  }, [points, xForIdx]);

  const hrvData = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    const vals = points.filter(p => p.hrvDeltaPct != null).map(p => p.hrvDeltaPct!);
    const minV = vals.length > 0 ? Math.min(...vals, -15) : -15;
    const maxV = vals.length > 0 ? Math.max(...vals, 15) : 15;
    const range = maxV - minV || 1;
    points.forEach((p, i) => {
      if (p.hrvDeltaPct != null) {
        const y = PAD_T + ((maxV - p.hrvDeltaPct) / range) * (STRESS_H - PAD_T - PAD_B);
        out.push({ x: xForIdx(i), y });
      }
    });
    return out;
  }, [points, xForIdx]);

  const readinessData = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    points.forEach((p, i) => {
      if (p.readiness != null) {
        const y = PAD_T + ((100 - p.readiness) / 100) * (CAPACITY_H - PAD_T - PAD_B);
        out.push({ x: xForIdx(i), y });
      }
    });
    return out;
  }, [points, xForIdx]);

  const disruptionSeries = useMemo(() => {
    const pctToY = (pct: number) => PAD_T + ((100 - pct) / 100) * (CAPACITY_H - PAD_T - PAD_B);
    const buildSeries = (getter: (p: SignalPoint) => number | null) => {
      const raw: { x: number; y: number }[] = [];
      const vals: number[] = [];
      points.forEach((p, i) => {
        const v = getter(p);
        if (v != null) {
          raw.push({ x: xForIdx(i), y: pctToY(v) });
          vals.push(v);
        }
      });
      const avgPct = vals.length > 0 ? vals.reduce((s, n) => s + n, 0) / vals.length : null;
      const avgY = avgPct != null ? pctToY(avgPct) : null;
      return { raw, avgY };
    };
    const latency = buildSeries(p => p.latencyPct);
    const waso = buildSeries(p => p.wasoPct);
    const awakeInBed = buildSeries(p => p.awakeInBedPct);
    const fillLayers = buildDisruptionFillLayers(
      points, xForIdx, pctToY,
      latency.avgY, waso.avgY, awakeInBed.avgY,
    );
    return { latency, waso, awakeInBed, fillLayers };
  }, [points, xForIdx]);

  const svData = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    const vals = points.filter(p => p.strengthVelocity != null).map(p => p.strengthVelocity!);
    const rawAbsMax = vals.length > 0 ? Math.max(...vals.map(Math.abs)) : 0;
    const minFloor = svSource === "intel" ? 0.1 : 5;
    const absMax = Math.max(rawAbsMax * 1.2, minFloor);
    points.forEach((p, i) => {
      if (p.strengthVelocity != null) {
        const y = PAD_T + ((absMax - p.strengthVelocity) / (2 * absMax)) * (OUTPUT_H - PAD_T - PAD_B);
        out.push({ x: xForIdx(i), y });
      }
    });
    const gridStep = svSource === "intel"
      ? (absMax > 0.5 ? Math.round(absMax * 10) / 20 : Math.round(absMax * 100) / 200)
      : Math.round(absMax / 2);
    const gridLines = gridStep > 0 ? [-gridStep, 0, gridStep] : [0];
    return { data: out, absMax, gridLines };
  }, [points, xForIdx, svSource]);

  const svZeroY = useMemo(() => {
    return PAD_T + (svData.absMax / (2 * svData.absMax)) * (OUTPUT_H - PAD_T - PAD_B);
  }, [svData.absMax]);

  const recoveryIndex = useMemo(() => {
    const riResult = computeRecoveryIndexPairs(
      points.map(p => ({ hrv: p.hrv ?? undefined, rhr: p.rhr ?? undefined }))
    );

    const ratios: { idx: number; ratio: number }[] = [];
    let pairIdx = 0;
    points.forEach((p, i) => {
      if (p.hrv != null && p.rhr != null && p.rhr > 0) {
        ratios.push({ idx: i, ratio: riResult.pairs[pairIdx].ratio });
        pairIdx++;
      }
    });

    if (ratios.length === 0) return { data: [], avgRatio: 0, minR: 0, maxR: 2, todayRatio: null as number | null, avg7: null as number | null, avg14: null as number | null, avg28: null as number | null };

    const allR = ratios.map(r => r.ratio);
    const avgRatio = allR.reduce((s, v) => s + v, 0) / allR.length;
    const minR = Math.min(...allR, 0.5, 1.0);
    const maxR = Math.max(...allR, 1.5, avgRatio + 0.3);
    const range = maxR - minR || 1;

    const data = ratios.map(r => ({
      x: xForIdx(r.idx),
      y: PAD_T + ((maxR - r.ratio) / range) * (RECOVERY_H - PAD_T - PAD_B),
    }));

    const todayRatio = riResult.now;

    const windowAvg = (n: number): number | null => {
      const recent = ratios.filter(r => r.idx >= N - n);
      if (recent.length === 0) return null;
      return recent.reduce((s, r) => s + r.ratio, 0) / recent.length;
    };

    return { data, avgRatio, minR, maxR, todayRatio, avg7: windowAvg(7), avg14: windowAvg(14), avg28: windowAvg(28) };
  }, [points, xForIdx, N]);

  const crosshairX = selectedIdx != null ? xForIdx(selectedIdx) : null;
  const selectedPoint = selectedIdx != null ? points[selectedIdx] : null;

  const sleepPlanet = useMemo(() => {
    const pt = selectedPoint ?? (N > 0 ? points[N - 1] : null);
    if (!pt) return null;
    return getSleepPlanet(pt.latencyPct, pt.wasoPct, pt.awakeInBedPct);
  }, [selectedPoint, points, N]);

  const dateLabels = useMemo(() => {
    if (N < 2 || chartWidth <= 0) return [];
    const maxLabels = Math.min(Math.floor(chartWidth / 42), 6);
    const step = Math.max(1, Math.floor(N / maxLabels));
    const labels: { x: number; text: string }[] = [];
    for (let i = 0; i < N; i += step) {
      labels.push({ x: xForIdx(i), text: formatDateShort(points[i].date) });
    }
    return labels;
  }, [N, chartWidth, xForIdx, points]);

  const stressZoneBands = useMemo(() => {
    const h = STRESS_H - PAD_T - PAD_B;
    const y0 = (v: number) => PAD_T + ((100 - v) / 100) * h;
    return [
      { y: y0(100), height: y0(60) - y0(100), fill: C_ZONE_HIGH },
      { y: y0(60), height: y0(40) - y0(60), fill: C_ZONE_MOD },
      { y: y0(40), height: y0(0) - y0(40), fill: C_ZONE_CALM },
    ];
  }, []);

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>SIGNAL INTERACTION</Text>
        <View style={styles.rangeRow}>
          {RANGES.map((d) => (
            <Pressable
              key={d}
              onPress={() => onRangeChange(d)}
              style={[styles.rangeBtn, rangeDays === d && styles.rangeBtnActive]}
            >
              <Text style={[styles.rangeTxt, rangeDays === d && styles.rangeTxtActive]}>
                {d}d
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View onLayout={onLayout} style={styles.chartArea} {...panResponder.panHandlers}>
        <ChartPanel height={STRESS_H} label="STRESS" subtitle="HPA axis / autonomic load" chartWidth={chartWidth}>
          <Svg width={chartWidth} height={STRESS_H}>
            {stressZoneBands.map((z, i) => (
              <Rect key={i} x={PAD_L} y={z.y} width={plotW} height={z.height} fill={z.fill} />
            ))}
            {[0, 25, 50, 75, 100].map((v) => {
              const y = PAD_T + ((100 - v) / 100) * (STRESS_H - PAD_T - PAD_B);
              return (
                <Line key={v} x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={C_GRID} strokeWidth={0.5} />
              );
            })}
            {hrvData.length > 1 && (
              <Path d={buildPath(hrvData)} stroke={C_HRV} strokeWidth={1} fill="none" opacity={0.5} />
            )}
            {hpaData.length > 1 && (
              <Path d={buildPath(hpaData)} stroke={C_HPA} strokeWidth={2} fill="none" />
            )}
            {crosshairX != null && (
              <Line x1={crosshairX} y1={0} x2={crosshairX} y2={STRESS_H} stroke={C_CROSSHAIR} strokeWidth={1} strokeDasharray="3,3" />
            )}
          </Svg>
        </ChartPanel>

        <View style={styles.separator} />

        <ChartPanel height={CAPACITY_H} label="CAPACITY" subtitle="mitochondrial + recovery state" chartWidth={chartWidth} legendRows={[
          [
            { text: "AWAKE", color: C_AWAKE_IN_BED },
            { text: "FRAGMENTATION", color: C_BLEND_WA },
            { text: "WASO", color: C_WASO },
            { text: "INSTABILITY", color: C_BLEND_LW },
            { text: "LATENCY", color: C_LATENCY },
            { text: "DYSREGULATION", color: C_BLEND_LA },
          ],
        ]}>
          <Svg width={chartWidth} height={CAPACITY_H}>
            {[0, 25, 50, 75, 100].map((v) => {
              const y = PAD_T + ((100 - v) / 100) * (CAPACITY_H - PAD_T - PAD_B);
              return (
                <Line key={v} x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={C_GRID} strokeWidth={0.5} />
              );
            })}
            {[75, 50].map((v) => {
              const y = PAD_T + ((100 - v) / 100) * (CAPACITY_H - PAD_T - PAD_B);
              return (
                <Line key={`th-${v}`} x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={C_THRESHOLD} strokeWidth={1} strokeDasharray="4,4" />
              );
            })}

            {disruptionSeries.fillLayers.filter(l => !l.isComposite).map((layer, li) => (
              <Path key={`base-glow-${li}`} d={layer.d} fill="none" stroke={layer.strokeColor} strokeWidth={layer.glowRadius} opacity={layer.glowOpacity} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {disruptionSeries.fillLayers.filter(l => !l.isComposite).map((layer, li) => (
              <Path key={`base-fill-${li}`} d={layer.d} fill={layer.color} stroke="none" opacity={layer.opacity} />
            ))}
            {disruptionSeries.fillLayers.filter(l => !l.isComposite).map((layer, li) => (
              <Path key={`base-edge-${li}`} d={layer.d} fill="none" stroke={layer.strokeColor} strokeWidth={layer.strokeWidth} opacity={0.82} strokeLinejoin="miter" strokeLinecap="round" />
            ))}

            {disruptionSeries.fillLayers.filter(l => l.isComposite && !l.isExtreme).map((layer, li) => (
              <Path key={`comp-glow-${li}`} d={layer.d} fill="none" stroke={layer.strokeColor} strokeWidth={layer.glowRadius} opacity={layer.glowOpacity} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {disruptionSeries.fillLayers.filter(l => l.isComposite && !l.isExtreme).map((layer, li) => (
              <Path key={`comp-fill-${li}`} d={layer.d} fill={layer.color} stroke="none" opacity={layer.opacity} />
            ))}
            {disruptionSeries.fillLayers.filter(l => l.isComposite && !l.isExtreme).map((layer, li) => (
              <Path key={`comp-edge-${li}`} d={layer.d} fill="none" stroke={C_BLEND_WHITE} strokeWidth={0.9} opacity={0.30} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {disruptionSeries.fillLayers.filter(l => l.isComposite && !l.isExtreme).map((layer, li) => (
              <Path key={`comp-cap-${li}`} d={layer.d} fill="none" stroke={layer.strokeColor} strokeWidth={layer.strokeWidth} opacity={0.96} strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {disruptionSeries.fillLayers.filter(l => l.isExtreme).map((layer, li) => (
              <React.Fragment key={`extreme-${li}`}>
                <Path d={layer.d} fill="none" stroke={layer.strokeColor} strokeWidth={layer.glowRadius} opacity={layer.glowOpacity} strokeLinejoin="round" strokeLinecap="round" />
                <Path d={layer.d} fill={layer.color} stroke="none" opacity={layer.opacity} />
                <Path d={layer.d} fill="none" stroke={layer.strokeColor} strokeWidth={layer.strokeWidth} opacity={0.95} strokeLinejoin="round" strokeLinecap="round" />
              </React.Fragment>
            ))}

            {disruptionSeries.latency.raw.length > 1 && (
              <Path d={buildPath(disruptionSeries.latency.raw)} stroke={C_LATENCY} strokeWidth={1.3} fill="none" opacity={0.92} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {disruptionSeries.waso.raw.length > 1 && (
              <Path d={buildPath(disruptionSeries.waso.raw)} stroke={C_WASO} strokeWidth={1.3} fill="none" opacity={0.92} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {disruptionSeries.awakeInBed.raw.length > 1 && (
              <Path d={buildPath(disruptionSeries.awakeInBed.raw)} stroke={C_AWAKE_IN_BED} strokeWidth={1.3} fill="none" opacity={0.92} strokeLinejoin="round" strokeLinecap="round" />
            )}

            {disruptionSeries.latency.avgY != null && (
              <Line x1={PAD_L} y1={disruptionSeries.latency.avgY} x2={chartWidth - PAD_R} y2={disruptionSeries.latency.avgY} stroke={C_LATENCY} strokeWidth={1.0} opacity={0.85} strokeDasharray="5,4" />
            )}
            {disruptionSeries.waso.avgY != null && (
              <Line x1={PAD_L} y1={disruptionSeries.waso.avgY} x2={chartWidth - PAD_R} y2={disruptionSeries.waso.avgY} stroke={C_WASO} strokeWidth={1.0} opacity={0.85} strokeDasharray="5,4" />
            )}
            {disruptionSeries.awakeInBed.avgY != null && (
              <Line x1={PAD_L} y1={disruptionSeries.awakeInBed.avgY} x2={chartWidth - PAD_R} y2={disruptionSeries.awakeInBed.avgY} stroke={C_AWAKE_IN_BED} strokeWidth={1.0} opacity={0.85} strokeDasharray="5,4" />
            )}

            {readinessData.length > 1 && (
              <Path d={buildPath(readinessData)} stroke={C_READINESS} strokeWidth={4.0} fill="none" opacity={0.12} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {readinessData.length > 1 && (
              <Path d={buildPath(readinessData)} stroke={C_READINESS} strokeWidth={2.4} fill="none" opacity={1} strokeLinejoin="round" strokeLinecap="round" />
            )}

            {crosshairX != null && (
              <Line x1={crosshairX} y1={0} x2={crosshairX} y2={CAPACITY_H} stroke={C_CROSSHAIR} strokeWidth={1} strokeDasharray="3,3" />
            )}
          </Svg>
        </ChartPanel>

        {sleepPlanet && (
          <View style={{ paddingHorizontal: 8, paddingTop: 1, paddingBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text style={{ fontSize: 7, fontWeight: "700" as const, color: "rgba(255,255,255,0.35)", letterSpacing: 1.2 }}>SOMNIOFORMING:</Text>
              <Text style={{ fontSize: 8, fontWeight: "800" as const, color: sleepPlanet.accent, letterSpacing: 0.8 }}>{sleepPlanet.code}</Text>
              <Text style={{ fontSize: 7.5, fontWeight: "600" as const, color: sleepPlanet.accent, opacity: 0.85 }}>{sleepPlanet.name}</Text>
            </View>
            <Text style={{ fontSize: 6.5, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{sleepPlanet.subtitle}</Text>
          </View>
        )}

        <View style={styles.separator} />

        <ChartPanel height={OUTPUT_H} label="OUTPUT" subtitle="neuromuscular performance" chartWidth={chartWidth}>
          <Svg width={chartWidth} height={OUTPUT_H}>
            {svData.gridLines.map((v) => {
              const y = PAD_T + ((svData.absMax - v) / (2 * svData.absMax)) * (OUTPUT_H - PAD_T - PAD_B);
              return (
                <Line key={v} x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={v === 0 ? C_THRESHOLD : C_GRID} strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? "4,4" : undefined} />
              );
            })}
            {svData.data.length > 1 && (
              <Path d={buildPath(svData.data)} stroke={C_SV} strokeWidth={2.4} fill="none" />
            )}
            {crosshairX != null && (
              <Line x1={crosshairX} y1={0} x2={crosshairX} y2={OUTPUT_H} stroke={C_CROSSHAIR} strokeWidth={1} strokeDasharray="3,3" />
            )}
            {dateLabels.map((lbl, i) => (
              <SvgText
                key={i}
                x={lbl.x}
                y={OUTPUT_H - 2}
                fontSize={8}
                fill="rgba(255,255,255,0.25)"
                textAnchor="middle"
                fontFamily="Rubik_400Regular"
              >
                {lbl.text}
              </SvgText>
            ))}
          </Svg>
        </ChartPanel>

        <View style={styles.separator} />

        <ChartPanel height={RECOVERY_H} label="RECOVERY INDEX" subtitle="HRV / RHR" chartWidth={chartWidth}>
          <Svg width={chartWidth} height={RECOVERY_H}>
            {(() => {
              const { avgRatio, minR, maxR } = recoveryIndex;
              const range = maxR - minR || 1;
              const yFor = (v: number) => PAD_T + ((maxR - v) / range) * (RECOVERY_H - PAD_T - PAD_B);
              const plotH = RECOVERY_H - PAD_T - PAD_B;

              const greenY = (1.0 >= minR && 1.0 <= maxR) ? yFor(1.0) : null;
              const magentaY = (avgRatio > 0 && avgRatio >= minR && avgRatio <= maxR) ? yFor(avgRatio) : null;

              const topY = PAD_T;
              const botY = PAD_T + plotH;

              const upperLine = greenY != null && magentaY != null ? Math.min(greenY, magentaY) : (greenY ?? magentaY ?? topY);
              const lowerLine = greenY != null && magentaY != null ? Math.max(greenY, magentaY) : (greenY ?? magentaY ?? botY);

              const zones: { y: number; h: number; fill: string; label: string; labelY: number }[] = [];

              if (avgRatio >= 1.0) {
                zones.push({ y: topY, h: Math.max(0, (magentaY ?? topY) - topY), fill: "rgba(34,197,94,0.05)", label: "Recovery Surge", labelY: topY + ((magentaY ?? topY) - topY) / 2 });
                zones.push({ y: magentaY ?? topY, h: Math.max(0, (greenY ?? botY) - (magentaY ?? topY)), fill: "rgba(251,191,36,0.04)", label: "Hypertrophy Window", labelY: (magentaY ?? topY) + ((greenY ?? botY) - (magentaY ?? topY)) / 2 });
                zones.push({ y: greenY ?? botY, h: Math.max(0, botY - (greenY ?? botY)), fill: "rgba(220,38,38,0.04)", label: "Stimulus Phase", labelY: (greenY ?? botY) + (botY - (greenY ?? botY)) / 2 });
              } else {
                zones.push({ y: topY, h: Math.max(0, (greenY ?? topY) - topY), fill: "rgba(34,197,94,0.05)", label: "Recovery Surge", labelY: topY + ((greenY ?? topY) - topY) / 2 });
                zones.push({ y: greenY ?? topY, h: Math.max(0, (magentaY ?? botY) - (greenY ?? topY)), fill: "rgba(251,191,36,0.04)", label: "Hypertrophy Window", labelY: (greenY ?? topY) + ((magentaY ?? botY) - (greenY ?? topY)) / 2 });
                zones.push({ y: magentaY ?? botY, h: Math.max(0, botY - (magentaY ?? botY)), fill: "rgba(220,38,38,0.04)", label: "Stimulus Phase", labelY: (magentaY ?? botY) + (botY - (magentaY ?? botY)) / 2 });
              }

              return (
                <>
                  {zones.map((z, i) => (
                    <React.Fragment key={`rz-${i}`}>
                      <Rect x={PAD_L} y={z.y} width={plotW} height={z.h} fill={z.fill} />
                      {z.h > 14 && (
                        <SvgText
                          x={chartWidth - PAD_R - 4}
                          y={z.labelY + 3}
                          fontSize={7}
                          fill="rgba(255,255,255,0.2)"
                          textAnchor="end"
                          fontFamily="Rubik_400Regular"
                        >
                          {z.label}
                        </SvgText>
                      )}
                    </React.Fragment>
                  ))}
                </>
              );
            })()}
            {(() => {
              const { minR, maxR } = recoveryIndex;
              const range = maxR - minR || 1;
              const gridVals = [minR, (minR + maxR) / 2, maxR].map(v => Math.round(v * 10) / 10);
              return gridVals.map((v) => {
                const y = PAD_T + ((maxR - v) / range) * (RECOVERY_H - PAD_T - PAD_B);
                return (
                  <Line key={`rg-${v}`} x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={C_GRID} strokeWidth={0.5} />
                );
              });
            })()}
            {(() => {
              const { minR, maxR } = recoveryIndex;
              const range = maxR - minR || 1;
              if (1.0 >= minR && 1.0 <= maxR) {
                const y = PAD_T + ((maxR - 1.0) / range) * (RECOVERY_H - PAD_T - PAD_B);
                return <Line x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={C_RECOVERY_REF} strokeWidth={1} strokeDasharray="6,4" opacity={0.7} />;
              }
              return null;
            })()}
            {(() => {
              const { avgRatio, minR, maxR } = recoveryIndex;
              const range = maxR - minR || 1;
              if (avgRatio > 0 && avgRatio >= minR && avgRatio <= maxR) {
                const y = PAD_T + ((maxR - avgRatio) / range) * (RECOVERY_H - PAD_T - PAD_B);
                return <Line x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={C_RECOVERY_AVG} strokeWidth={1} strokeDasharray="6,4" opacity={0.7} />;
              }
              return null;
            })()}
            {recoveryIndex.data.length > 1 && (
              <Path d={buildPath(recoveryIndex.data)} stroke={C_RECOVERY} strokeWidth={2} fill="none" />
            )}
            {crosshairX != null && (
              <Line x1={crosshairX} y1={0} x2={crosshairX} y2={RECOVERY_H} stroke={C_CROSSHAIR} strokeWidth={1} strokeDasharray="3,3" />
            )}
            {dateLabels.map((lbl, i) => (
              <SvgText
                key={i}
                x={lbl.x}
                y={RECOVERY_H - 2}
                fontSize={8}
                fill="rgba(255,255,255,0.25)"
                textAnchor="middle"
                fontFamily="Rubik_400Regular"
              >
                {lbl.text}
              </SvgText>
            ))}
          </Svg>
        </ChartPanel>
      </View>

      {recoveryIndex.data.length > 0 && (() => {
        const avg = recoveryIndex.avgRatio;
        const classifyZone = (v: number, isSystemState: boolean): { zone: string; zoneColor: string } => {
          if (isSystemState) {
            if (v > 1.0) return { zone: "Recovery Surge", zoneColor: C_RECOVERY_REF };
            if (v >= 1.0) return { zone: "Hypertrophy Window", zoneColor: "#FBBF24" };
            return { zone: "Stimulus Phase", zoneColor: "#EF4444" };
          }
          if (v > 1.0) return { zone: "Recovery Surge", zoneColor: C_RECOVERY_REF };
          if (avg >= 1.0) {
            if (v >= avg) return { zone: "Recovery Surge", zoneColor: C_RECOVERY_REF };
            return { zone: "Hypertrophy Window", zoneColor: "#FBBF24" };
          } else {
            if (v >= 1.0) return { zone: "Recovery Surge", zoneColor: C_RECOVERY_REF };
            if (v >= avg) return { zone: "Hypertrophy Window", zoneColor: "#FBBF24" };
            return { zone: "Stimulus Phase", zoneColor: "#EF4444" };
          }
        };

        return (
          <View style={styles.recoveryStats}>
            {[
              { label: "System state", value: avg, isSystem: true },
              { label: "Today", value: recoveryIndex.todayRatio, isSystem: false },
              { label: "7-day avg", value: recoveryIndex.avg7, isSystem: false },
              { label: "14-day avg", value: recoveryIndex.avg14, isSystem: false },
              { label: "28-day avg", value: recoveryIndex.avg28, isSystem: false },
            ].map((row) => {
              if (row.value == null) return null;
              const dom = row.value >= 1.0 ? "para" : "symp";
              const domColor = row.value >= 1.0 ? C_RECOVERY_REF : "#EF4444";
              const { zone, zoneColor } = classifyZone(row.value, row.isSystem);
              return (
                <View key={row.label} style={styles.recoveryRow}>
                  <Text style={styles.recoveryLabel}>{row.label}</Text>
                  <Text style={[styles.recoveryVal, { color: domColor }]}>{row.value.toFixed(4)}</Text>
                  <Text style={[styles.recoveryDom, { color: domColor }]}>{dom}</Text>
                  <Text style={[styles.recoveryZone, { color: zoneColor }]}>{zone}</Text>
                </View>
              );
            })}
          </View>
        );
      })()}

      {selectedPoint && (
        <View style={[styles.tooltip, crosshairX != null && crosshairX > chartWidth * 0.6 ? { right: 12 } : { left: 12 }]}>
          <Text style={styles.tooltipDate}>{selectedPoint.date}</Text>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_HPA }]} />
            <Text style={styles.tooltipLabel}>HPA</Text>
            <Text style={styles.tooltipVal}>{selectedPoint.hpa != null ? selectedPoint.hpa : "--"}</Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_HRV }]} />
            <Text style={styles.tooltipLabel}>HRV</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.hrvDeltaPct != null
                ? fmtDelta(selectedPoint.hrvDeltaPct, 0, "%")
                : "--"}
            </Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_READINESS }]} />
            <Text style={styles.tooltipLabel}>Readiness</Text>
            <Text style={styles.tooltipVal}>{selectedPoint.readiness != null ? Math.round(selectedPoint.readiness) : "--"}</Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_LATENCY }]} />
            <Text style={styles.tooltipLabel}>Sleep Latency</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.latencyMin != null ? `${selectedPoint.latencyMin} min (${Math.round(selectedPoint.latencyPct!)}%)` : "--"}
            </Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_WASO }]} />
            <Text style={styles.tooltipLabel}>Wake After Sleep Onset</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.wasoMin != null ? `${selectedPoint.wasoMin} min (${Math.round(selectedPoint.wasoPct!)}%)` : "--"}
            </Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_AWAKE_IN_BED }]} />
            <Text style={styles.tooltipLabel}>Awake-in-Bed</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.awakeInBedMin != null ? `${selectedPoint.awakeInBedMin} min (${Math.round(selectedPoint.awakeInBedPct!)}%)` : "--"}
            </Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_SV }]} />
            <Text style={styles.tooltipLabel}>Strength Velocity</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.strengthVelocity != null
                ? svSource === "intel"
                  ? fmtDelta(selectedPoint.strengthVelocity, 2, "")
                  : fmtDelta(selectedPoint.strengthVelocity, 1, "%")
                : "--"}
            </Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_RECOVERY }]} />
            <Text style={styles.tooltipLabel}>Recovery Index</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.hrv != null && selectedPoint.rhr != null && selectedPoint.rhr > 0
                ? (selectedPoint.hrv / selectedPoint.rhr).toFixed(2)
                : "--"}
            </Text>
          </View>
        </View>
      )}

      {N === 0 && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>No signal data yet</Text>
        </View>
      )}

      {forecast && <ForecastCards forecast={forecast} />}
    </View>
  );
}

const FORECAST_STATUS_LABELS: Record<string, string> = {
  rising: "Rising",
  near_peak: "Near peak",
  past_peak: "Past peak",
  stable: "Stable",
  rising_risk: "Rising risk",
  high_risk: "High risk",
  progressing: "Progressing",
  slowing: "Slowing",
  plateau_likely: "Plateau likely",
  insufficient_data: "Insufficient data",
};

const FORECAST_STATUS_COLORS: Record<string, string> = {
  rising: "#00D4AA",
  near_peak: "#FBBF24",
  past_peak: "#EF4444",
  stable: "#00D4AA",
  rising_risk: "#FBBF24",
  high_risk: "#EF4444",
  progressing: "#00D4AA",
  slowing: "#FBBF24",
  plateau_likely: "#EF4444",
  insufficient_data: "rgba(255,255,255,0.25)",
};

const CONF_COLORS: Record<string, string> = {
  high: "#00D4AA",
  medium: "#FBBF24",
  low: "rgba(255,255,255,0.3)",
};

function ForecastRow({ label, result }: { label: string; result: ForecastResult }) {
  const statusLabel = FORECAST_STATUS_LABELS[result.status] ?? result.status;
  const statusColor = FORECAST_STATUS_COLORS[result.status] ?? "rgba(255,255,255,0.5)";
  const confColor = CONF_COLORS[result.confidence] ?? "rgba(255,255,255,0.3)";
  const windowText = result.window.daysMin != null && result.window.daysMax != null
    ? `${result.window.daysMin}–${result.window.daysMax}d`
    : null;

  return (
    <View style={fcStyles.row}>
      <View style={fcStyles.rowHeader}>
        <Text style={fcStyles.rowLabel}>{label}</Text>
        <View style={[fcStyles.confBadge, { borderColor: confColor }]}>
          <Text style={[fcStyles.confText, { color: confColor }]}>{result.confidence}</Text>
        </View>
      </View>
      <View style={fcStyles.statusRow}>
        <View style={[fcStyles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[fcStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        {windowText && (
          <Text style={fcStyles.windowText}>{windowText}</Text>
        )}
      </View>
      {result.drivers.length > 0 && (
        <View style={fcStyles.driversWrap}>
          {result.drivers.slice(0, 3).map((d, i) => (
            <Text key={i} style={fcStyles.driverText}>• {d}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function ForecastCards({ forecast }: { forecast: ForecastSummary }) {
  return (
    <View style={fcStyles.container}>
      <View style={fcStyles.headerRow}>
        <Text style={fcStyles.sectionTitle}>FORECAST</Text>
        <Text style={fcStyles.sectionSubtitle}>deterministic projection</Text>
      </View>
      <ForecastRow label="Peak Strength" result={forecast.peakStrength} />
      <View style={styles.separator} />
      <ForecastRow label="Fatigue Risk" result={forecast.fatigueRisk} />
      <View style={styles.separator} />
      <ForecastRow label="Hypertrophy Plateau" result={forecast.hypertrophyPlateau} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 16,
    position: "relative",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 10,
    fontFamily: "Rubik_500Medium",
    color: "rgba(255,255,255,0.35)",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rangeRow: {
    flexDirection: "row",
    gap: 4,
  },
  rangeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  rangeBtnActive: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  rangeTxt: {
    fontSize: 10,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.3)",
  },
  rangeTxtActive: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: "Rubik_500Medium",
  },
  chartArea: {
    width: "100%",
  },
  separator: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginVertical: 2,
  },
  tooltip: {
    position: "absolute",
    top: 40,
    backgroundColor: "rgba(10,10,18,0.95)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 12,
    minWidth: 210,
    zIndex: 10,
  },
  tooltipDate: {
    fontSize: 10,
    fontFamily: "Rubik_500Medium",
    color: "rgba(255,255,255,0.5)",
    marginBottom: 6,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
  },
  tooltipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tooltipLabel: {
    fontSize: 10,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.45)",
    flex: 1,
  },
  tooltipVal: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: "rgba(255,255,255,0.8)",
  },
  emptyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.2)",
  },
  recoveryStats: {
    marginTop: 8,
    paddingHorizontal: 4,
    gap: 4,
  },
  recoveryRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  recoveryLabel: {
    fontSize: 10,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.7)",
    width: 80,
  },
  recoveryVal: {
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    width: 52,
    textAlign: "right" as const,
  },
  recoveryDom: {
    fontSize: 9,
    fontFamily: "Rubik_400Regular",
    marginLeft: 4,
    width: 32,
  },
  recoveryZone: {
    fontSize: 8,
    fontFamily: "Rubik_500Medium",
    marginLeft: 2,
  },
});

const fcStyles = StyleSheet.create({
  container: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Rubik_500Medium",
    color: "rgba(255,255,255,0.35)",
    letterSpacing: 2,
    textTransform: "uppercase" as const,
  },
  sectionSubtitle: {
    fontSize: 9,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.2)",
  },
  row: {
    paddingVertical: 8,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  rowLabel: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: "rgba(255,255,255,0.75)",
  },
  confBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  confText: {
    fontSize: 8,
    fontFamily: "Rubik_500Medium",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
  },
  windowText: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.5)",
    marginLeft: 4,
  },
  driversWrap: {
    marginTop: 2,
    paddingLeft: 12,
  },
  driverText: {
    fontSize: 9,
    fontFamily: "Rubik_400Regular",
    color: "rgba(255,255,255,0.35)",
    lineHeight: 14,
  },
});
