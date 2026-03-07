import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import type {
  InterventionPolicySummary,
  InterventionConfidence,
  InterventionEvidenceLevel,
  InterventionActionKind,
} from "@/lib/intervention-types";

const ACTION_LABELS: Record<InterventionActionKind, string> = {
  DELOAD: "Take a Deload",
  REDUCE_VOLUME: "Reduce Volume",
  REDUCE_INTENSITY: "Reduce Intensity",
  ADD_REST_DAY: "Add a Rest Day",
  INCREASE_CALORIES: "Increase Calories",
  DECREASE_CALORIES: "Decrease Calories",
  INCREASE_CARBS: "Increase Carbs",
  REDUCE_CARDIO: "Reduce Cardio",
  SHIFT_ISOLATION_FOCUS: "Shift Isolation Focus",
  HOLD_STEADY: "Hold Steady",
  CUSTOM: "Custom Action",
};

const CONFIDENCE_COLORS: Record<InterventionConfidence, string> = {
  high: Colors.success,
  medium: Colors.warning,
  low: Colors.textTertiary,
};

const EVIDENCE_COLORS: Record<InterventionEvidenceLevel, string> = {
  strong: Colors.success,
  moderate: Colors.warning,
  weak: Colors.textTertiary,
};

function actionLabel(kind: InterventionActionKind): string {
  return ACTION_LABELS[kind] ?? kind;
}

export default function InterventionAdvisoryCard() {
  const { data, isLoading, error } = useQuery<InterventionPolicySummary>({
    queryKey: ["/api/intervention/policy"],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Intervention Advisory</Text>
        <ActivityIndicator color={Colors.primary} size="small" style={{ marginTop: 12 }} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Intervention Advisory</Text>
        <Text style={styles.emptyText}>Unable to load advisory</Text>
      </View>
    );
  }

  const hasRecommendation = data.topAction !== null;
  const confColor = CONFIDENCE_COLORS[data.confidence] ?? Colors.textTertiary;
  const evidenceColor = EVIDENCE_COLORS[data.evidenceLevel] ?? Colors.textTertiary;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Intervention Advisory</Text>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: confColor + "22" }]}>
            <Text style={[styles.badgeText, { color: confColor }]}>
              {data.confidence.toUpperCase()}
            </Text>
          </View>
          {hasRecommendation && (
            <View style={[styles.badge, { backgroundColor: evidenceColor + "22", marginLeft: 6 }]}>
              <Text style={[styles.badgeText, { color: evidenceColor }]}>
                {data.evidenceLevel.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>

      {hasRecommendation ? (
        <>
          <Text style={styles.actionText}>
            {actionLabel(data.topAction!.kind)}
          </Text>
          {data.drivers.length > 0 && (
            <View style={styles.driversWrap}>
              {data.drivers.map((d, i) => (
                <Text key={i} style={styles.driverText}>
                  • {d}
                </Text>
              ))}
            </View>
          )}
          {(() => {
            const supportingCases = data.similarCases.filter(
              (c) => c.action.kind === data.topAction!.kind,
            );
            if (supportingCases.length === 0) return null;
            return (
              <Text style={styles.caseCount}>
                Based on {supportingCases.length} similar past{" "}
                {supportingCases.length === 1 ? "case" : "cases"}
              </Text>
            );
          })()}
          {data.evidenceLevel === "weak" && (
            <Text style={styles.warningText}>Limited historical evidence</Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyText}>
          Insufficient history for recommendation
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  actionText: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 10,
  },
  driversWrap: {
    marginTop: 8,
  },
  driverText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  caseCount: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 8,
  },
  emptyText: {
    color: Colors.textTertiary,
    fontSize: 13,
    marginTop: 10,
  },
  warningText: {
    color: Colors.warning,
    fontSize: 11,
    fontStyle: "italic" as const,
    marginTop: 6,
  },
});
