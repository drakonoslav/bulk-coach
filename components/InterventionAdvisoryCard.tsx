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
import type { InterventionDecisionSummary } from "@/lib/intervention-decision";

interface PolicyResponse {
  interventionPolicy: InterventionPolicySummary;
  interventionDecision: InterventionDecisionSummary;
}

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
  const { data, isLoading, error } = useQuery<PolicyResponse>({
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

  const policy = data.interventionPolicy;
  const decision = data.interventionDecision;

  const policyConfColor = CONFIDENCE_COLORS[policy.confidence] ?? Colors.textTertiary;
  const policyEvidenceColor = EVIDENCE_COLORS[policy.evidenceLevel] ?? Colors.textTertiary;
  const hasPolicyRec = policy.topAction !== null;

  const decisionConfColor = CONFIDENCE_COLORS[decision.confidence] ?? Colors.textTertiary;
  const hasDecision = decision.recommendedAction !== null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Intervention Advisory</Text>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: policyConfColor + "22" }]}>
            <Text style={[styles.badgeText, { color: policyConfColor }]}>
              {policy.confidence.toUpperCase()}
            </Text>
          </View>
          {hasPolicyRec && (
            <View style={[styles.badge, { backgroundColor: policyEvidenceColor + "22", marginLeft: 6 }]}>
              <Text style={[styles.badgeText, { color: policyEvidenceColor }]}>
                {policy.evidenceLevel.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>

      {hasPolicyRec ? (
        <>
          <Text style={styles.actionText}>
            {actionLabel(policy.topAction!.kind)}
          </Text>
          {policy.drivers.length > 0 && (
            <View style={styles.driversWrap}>
              {policy.drivers.map((d, i) => (
                <Text key={i} style={styles.driverText}>
                  {"\u2022"} {d}
                </Text>
              ))}
            </View>
          )}
          {(() => {
            const supportingCases = policy.similarCases.filter(
              (c) => c.action.kind === policy.topAction!.kind,
            );
            if (supportingCases.length === 0) return null;
            return (
              <Text style={styles.caseCount}>
                Based on {supportingCases.length} similar past{" "}
                {supportingCases.length === 1 ? "case" : "cases"}
              </Text>
            );
          })()}
          {policy.evidenceLevel === "weak" && (
            <Text style={styles.warningText}>Limited historical evidence</Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyText}>
          Insufficient history for policy recommendation
        </Text>
      )}

      <View style={styles.divider} />

      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Decision Layer</Text>
        <View style={[styles.badge, { backgroundColor: decisionConfColor + "22" }]}>
          <Text style={[styles.badgeText, { color: decisionConfColor }]}>
            {decision.confidence.toUpperCase()}
          </Text>
        </View>
      </View>

      {hasDecision ? (
        <>
          <Text style={styles.actionText}>
            {actionLabel(decision.recommendedAction!.action.kind)}
          </Text>
          <Text style={styles.scoreText}>
            Score: {decision.recommendedAction!.score.toFixed(2)}
          </Text>
          {decision.drivers.length > 0 && (
            <View style={styles.driversWrap}>
              {decision.drivers.slice(0, 4).map((d, i) => (
                <Text key={`dd-${i}`} style={styles.driverText}>
                  {"\u2022"} {d}
                </Text>
              ))}
            </View>
          )}
          {decision.runnerUps.length > 0 && (
            <View style={styles.runnerUpsWrap}>
              <Text style={styles.runnerUpsLabel}>Runner-ups:</Text>
              {decision.runnerUps.map((r, i) => (
                <Text key={`ru-${i}`} style={styles.runnerUpText}>
                  {i + 1}. {actionLabel(r.action.kind)} ({r.score.toFixed(2)})
                </Text>
              ))}
            </View>
          )}
        </>
      ) : (
        <Text style={styles.emptyText}>
          No candidate actions available
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
    fontWeight: "600" as const,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "600" as const,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },
  actionText: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: "700" as const,
    marginTop: 10,
  },
  scoreText: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
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
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 14,
  },
  runnerUpsWrap: {
    marginTop: 10,
  },
  runnerUpsLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: "600" as const,
    marginBottom: 4,
  },
  runnerUpText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
});
