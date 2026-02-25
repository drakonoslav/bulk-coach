import { DomainOutcome, Confidence, RecoveryStatus } from "../types/domainOutcome";

export function toDomainOutcomeLift(args: {
  dateISO: string;
  scheduleStability: any;
  outcome: any;
}): DomainOutcome {
  const ss = args.scheduleStability;
  const lo = args.outcome;

  const recoveryReason = ss?.recoveryReason ?? "no_event";
  const recoveryScore = ss?.recoveryScore ?? null;
  const recoveryApplicable = ss?.recoveryApplicable ?? (recoveryReason !== "no_event");

  const recoveryStatus: RecoveryStatus =
    recoveryReason === "no_event" ? "not_applicable" :
    recoveryScore == null ? "insufficient_data" :
    "computed";

  const confidence: Confidence =
    ss?.recoveryConfidence === "high" ? "high" :
    ss?.recoveryConfidence === "medium" ? "medium" : "low";

  return {
    domain: "lift",
    dateISO: args.dateISO,

    scheduledToday: ss?.scheduledToday ?? null,
    scheduledTodayReason: ss?.scheduledTodayReason ?? "schedule_unknown",
    scheduledTodayConfidence: ss?.scheduledTodayConfidence ?? "low",

    schedule: {
      alignment: ss?.alignmentScore ?? null,
      consistency: ss?.consistencyScore ?? null,
      recovery: recoveryScore,
      recoveryApplicable,
      recoveryStatus,
      confidence,
      reason: recoveryReason,
      consistencySamples: ss?.consistencyNSamples ?? null,
    },

    outcome: {
      adequacy: lo?.adequacyScore ?? null,
      efficiency: lo?.efficiencyScore ?? null,
      continuity: lo?.continuityScore ?? null,

      adequacyDenominator: lo?.adequacyScore != null ? "actual/planned" : null,
      efficiencyDenominator: lo?.efficiencyScore != null ? (lo?.hrTotalMin != null ? "blended_work_hr" : "working/actual") : null,
      continuityDenominator: lo?.continuityDenominator ?? null,
    },

    debug: {
      scheduleDetail: ss,
      outcomeDetail: lo,
    },
  };
}
