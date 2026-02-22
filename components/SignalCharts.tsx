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
import Svg, { Path, Rect, Line, Text as SvgText } from "react-native-svg";
import Colors from "@/constants/colors";

interface SignalPoint {
  date: string;
  hpa: number | null;
  hrvDeltaPct: number | null;
  readiness: number | null;
  strengthVelocity: number | null;
}

interface SignalChartsProps {
  points: SignalPoint[];
  rangeDays: number;
  onRangeChange: (days: number) => void;
}

const RANGES = [30, 60, 90];
const PAD_L = 0;
const PAD_R = 4;
const PAD_T = 6;
const PAD_B = 18;

const C_HPA = "#D97706";
const C_HPA_HIGH = "#DC2626";
const C_HRV = "#67E8F9";
const C_READINESS = "#6B8ACD";
const C_SV = "#6EBF8B";
const C_GRID = "rgba(255,255,255,0.08)";
const C_THRESHOLD = "rgba(255,255,255,0.15)";
const C_CROSSHAIR = "rgba(255,255,255,0.35)";
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

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function ChartPanel({
  height,
  label,
  children,
  chartWidth,
}: {
  height: number;
  label: string;
  children: React.ReactNode;
  chartWidth: number;
}) {
  return (
    <View style={[panelStyles.container, { height: height + 22 }]}>
      <Text style={panelStyles.label}>{label}</Text>
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
    color: "rgba(255,255,255,0.3)",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 4,
    marginLeft: 2,
  },
});

export default function SignalCharts({ points, rangeDays, onRangeChange }: SignalChartsProps) {
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const containerRef = useRef<View>(null);

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
          const x = e.nativeEvent.locationX;
          setSelectedIdx(idxFromX(x));
        },
        onPanResponderMove: (e) => {
          const x = e.nativeEvent.locationX;
          setSelectedIdx(idxFromX(x));
        },
        onPanResponderRelease: () => {
          setTimeout(() => setSelectedIdx(null), 2500);
        },
      }),
    [idxFromX],
  );

  const STRESS_H = 90;
  const CAPACITY_H = 110;
  const OUTPUT_H = 110;

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

  const svData = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    const vals = points.filter(p => p.strengthVelocity != null).map(p => p.strengthVelocity!);
    const absMax = vals.length > 0 ? Math.max(Math.max(...vals.map(Math.abs)), 5) : 5;
    points.forEach((p, i) => {
      if (p.strengthVelocity != null) {
        const y = PAD_T + ((absMax - p.strengthVelocity) / (2 * absMax)) * (OUTPUT_H - PAD_T - PAD_B);
        out.push({ x: xForIdx(i), y });
      }
    });
    return { data: out, absMax };
  }, [points, xForIdx]);

  const svZeroY = useMemo(() => {
    return PAD_T + (svData.absMax / (2 * svData.absMax)) * (OUTPUT_H - PAD_T - PAD_B);
  }, [svData.absMax]);

  const crosshairX = selectedIdx != null ? xForIdx(selectedIdx) : null;
  const selectedPoint = selectedIdx != null ? points[selectedIdx] : null;

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
        <ChartPanel height={STRESS_H} label="STRESS AXIS" chartWidth={chartWidth}>
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

        <ChartPanel height={CAPACITY_H} label="CAPACITY AXIS" chartWidth={chartWidth}>
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
            {readinessData.length > 1 && (
              <Path d={buildPath(readinessData)} stroke={C_READINESS} strokeWidth={2} fill="none" />
            )}
            {crosshairX != null && (
              <Line x1={crosshairX} y1={0} x2={crosshairX} y2={CAPACITY_H} stroke={C_CROSSHAIR} strokeWidth={1} strokeDasharray="3,3" />
            )}
          </Svg>
        </ChartPanel>

        <View style={styles.separator} />

        <ChartPanel height={OUTPUT_H} label="OUTPUT AXIS" chartWidth={chartWidth}>
          <Svg width={chartWidth} height={OUTPUT_H}>
            {[-5, 0, 5].map((v) => {
              const y = PAD_T + ((svData.absMax - v) / (2 * svData.absMax)) * (OUTPUT_H - PAD_T - PAD_B);
              return (
                <Line key={v} x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y} stroke={v === 0 ? C_THRESHOLD : C_GRID} strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? "4,4" : undefined} />
              );
            })}
            {svData.data.length > 1 && (
              <Path d={buildPath(svData.data)} stroke={C_SV} strokeWidth={2} fill="none" />
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
      </View>

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
                ? `${selectedPoint.hrvDeltaPct > 0 ? "+" : ""}${selectedPoint.hrvDeltaPct.toFixed(0)}%`
                : "--"}
            </Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_READINESS }]} />
            <Text style={styles.tooltipLabel}>Readiness</Text>
            <Text style={styles.tooltipVal}>{selectedPoint.readiness != null ? Math.round(selectedPoint.readiness) : "--"}</Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_SV }]} />
            <Text style={styles.tooltipLabel}>Str.Vel</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.strengthVelocity != null
                ? `${selectedPoint.strengthVelocity > 0 ? "+" : ""}${selectedPoint.strengthVelocity.toFixed(1)}%`
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
    backgroundColor: "rgba(10,10,18,0.92)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 10,
    minWidth: 130,
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
});
