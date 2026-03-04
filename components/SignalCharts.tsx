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

interface SignalPoint {
  date: string;
  hpa: number | null;
  hrvDeltaPct: number | null;
  readiness: number | null;
  strengthVelocity: number | null;
  hrv: number | null;
  rhr: number | null;
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
const C_RECOVERY = "#00E5FF";
const C_RECOVERY_AVG = "#FF00FF";
const C_RECOVERY_REF = "#22C55E";
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
  subtitle,
  children,
  chartWidth,
}: {
  height: number;
  label: string;
  subtitle?: string;
  children: React.ReactNode;
  chartWidth: number;
}) {
  return (
    <View style={[panelStyles.container, { height: height + (subtitle ? 32 : 22) }]}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 4, marginLeft: 2 }}>
        <Text style={panelStyles.label}>{label}</Text>
        {subtitle && <Text style={panelStyles.subtitle}>{subtitle}</Text>}
      </View>
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

  const recoveryIndex = useMemo(() => {
    const ratios: { idx: number; ratio: number }[] = [];
    points.forEach((p, i) => {
      if (p.hrv != null && p.rhr != null && p.rhr > 0) {
        ratios.push({ idx: i, ratio: p.hrv / p.rhr });
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

    const todayRatio = ratios.length > 0 ? ratios[ratios.length - 1].ratio : null;

    const windowAvg = (n: number): number | null => {
      const recent = ratios.filter(r => r.idx >= N - n);
      if (recent.length === 0) return null;
      return recent.reduce((s, r) => s + r.ratio, 0) / recent.length;
    };

    return { data, avgRatio, minR, maxR, todayRatio, avg7: windowAvg(7), avg14: windowAvg(14), avg28: windowAvg(28) };
  }, [points, xForIdx, N]);

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

        <ChartPanel height={CAPACITY_H} label="CAPACITY" subtitle="mitochondrial + recovery state" chartWidth={chartWidth}>
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

        <ChartPanel height={OUTPUT_H} label="OUTPUT" subtitle="neuromuscular performance" chartWidth={chartWidth}>
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
            <View style={[styles.tooltipDot, { backgroundColor: C_SV }]} />
            <Text style={styles.tooltipLabel}>Str.Vel</Text>
            <Text style={styles.tooltipVal}>
              {selectedPoint.strengthVelocity != null
                ? fmtDelta(selectedPoint.strengthVelocity, 1, "%")
                : "--"}
            </Text>
          </View>
          <View style={styles.tooltipRow}>
            <View style={[styles.tooltipDot, { backgroundColor: C_RECOVERY }]} />
            <Text style={styles.tooltipLabel}>RI</Text>
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
