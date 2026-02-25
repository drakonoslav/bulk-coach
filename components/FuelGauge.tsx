import React from "react";
import { View, Text } from "react-native";

interface FuelGaugeProps {
  label: string;
  value: number | null | undefined;
  max?: number;
  suffix?: string;
  confidence?: "high" | "low" | "full" | null;
  nullLabel?: string;
  thresholds?: { good?: number; warn?: number };
}

function gaugeColor(v: number | null | undefined, max: number, thresholds?: { good?: number; warn?: number }): string {
  if (v == null) return "#6B7280";
  const pct = (v / max) * 100;
  const good = thresholds?.good ?? 80;
  const warn = thresholds?.warn ?? 60;
  return pct >= good ? "#34D399" : pct >= warn ? "#FBBF24" : "#EF4444";
}

function formatValue(v: number | null | undefined, max: number, suffix?: string): string {
  if (v == null) return "";
  if (suffix === "%") return `${v.toFixed(1)}%`;
  return `${v.toFixed(1)}`;
}

export default function FuelGauge({
  label,
  value,
  max = 100,
  suffix,
  confidence,
  nullLabel,
  thresholds,
}: FuelGaugeProps) {
  const isNull = value == null;
  const fillPct = isNull ? 0 : Math.min(Math.max((value / max) * 100, 0), 100);
  const color = gaugeColor(value, max, thresholds);
  const isLowConf = confidence === "low";

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: "#9CA3AF" }}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {isNull ? (
            <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: "#6B7280" }}>{nullLabel || "\u2014"}</Text>
          ) : (
            <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color }}>
              {formatValue(value, max, suffix)}
            </Text>
          )}
          {isLowConf && (
            <View style={{ backgroundColor: "#FBBF2418", borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 }}>
              <Text style={{ fontSize: 8, fontFamily: "Rubik_600SemiBold", color: "#FBBF24" }}>LOW CONF</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: "#1F2937", overflow: "hidden" }}>
        {isNull ? (
          <View style={{ flex: 1, flexDirection: "row" }}>
            {[...Array(8)].map((_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  backgroundColor: i % 2 === 0 ? "#374151" : "#1F2937",
                }}
              />
            ))}
          </View>
        ) : (
          <View
            style={{
              width: `${fillPct}%`,
              height: "100%",
              borderRadius: 3,
              backgroundColor: color,
              opacity: 0.85,
            }}
          />
        )}
      </View>
    </View>
  );
}

interface FuelGaugeGroupProps {
  items: FuelGaugeProps[];
}

export function FuelGaugeGroup({ items }: FuelGaugeGroupProps) {
  return (
    <View style={{ marginTop: 2, marginBottom: 2 }}>
      {items.map((item, i) => (
        <FuelGauge key={i} {...item} />
      ))}
    </View>
  );
}
