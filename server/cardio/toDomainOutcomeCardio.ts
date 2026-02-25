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
      consistencySamples: ss?.consistencyNSessions ?? null,
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
      scheduleDetail: ss,
      outcomeDetail: co,
    },
  };
}
