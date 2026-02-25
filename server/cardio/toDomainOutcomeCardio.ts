import { DomainOutcome, Confidence } from "../types/domainOutcome";

export function toDomainOutcomeCardio(args: {
  dateISO: string;
  scheduleStability: any;
  outcome: any;
}): DomainOutcome {
  const ss = args.scheduleStability;
  const co = args.outcome;

  const recoveryReason = ss?.recoveryReason ?? "no_event";
  const recoveryApplicable = ss?.recoveryApplicable ?? (recoveryReason !== "no_event");

  const confidence: Confidence =
    ss?.recoveryConfidence === "high" ? "high" :
    ss?.recoveryConfidence === "medium" ? "medium" : "low";

  return {
    domain: "cardio",
    dateISO: args.dateISO,

    scheduledToday: ss?.scheduledToday ?? null,
    scheduledTodayReason: ss?.scheduledTodayReason ?? "schedule_unknown",
    scheduledTodayConfidence: ss?.scheduledTodayConfidence ?? "low",

    schedule: {
      alignment: ss?.alignmentScore ?? null,
      consistency: ss?.consistencyScore ?? null,
      recovery: ss?.recoveryScore ?? null,
      recoveryApplicable,
      confidence,
      reason: recoveryReason,
    },

    outcome: {
      adequacy: co?.adequacyScore ?? null,
      efficiency: co?.efficiencyScore ?? null,
      continuity: co?.continuityScore ?? null,

      adequacyDenominator: co?.adequacyScore != null ? (co?.adequacySource ?? "productive") : null,
      efficiencyDenominator: co?.efficiencyScore != null ? "productive/total" : null,
      continuityDenominator: co?.continuityDenominator ?? null,
    },

    debug: {
      productiveMin: co?.productiveMin ?? null,
      cardioTotalMin: co?.cardioTotalMin ?? null,
      cardioTotalSource: co?.cardioTotalSource ?? null,
      plannedDurationMin: co?.plannedDurationMin ?? null,
      offBandMin: co?.offBandMin ?? null,
      offBandWeighted: co?.offBandWeighted ?? null,
      z1Min: co?.z1Min ?? null,
      z2Min: co?.z2Min ?? null,
      z3Min: co?.z3Min ?? null,
      z4Min: co?.z4Min ?? null,
      z5Min: co?.z5Min ?? null,
      recoveryRaw: ss?.recoveryRaw ?? null,
      recoverySuppressed: ss?.recoverySuppressed ?? null,
      recoveryFinal: ss?.recoveryFinal ?? null,
      missStreak: ss?.missStreak ?? 0,
      suppressionFactor: ss?.suppressionFactor ?? null,
      driftPenalty: ss?.driftPenalty ?? null,
      driftFactor: ss?.driftFactor ?? null,
    },
  };
}
