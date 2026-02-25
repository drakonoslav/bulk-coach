import { DomainOutcome, Confidence } from "../types/domainOutcome";

export function toDomainOutcomeSleep(args: {
  dateISO: string;
  scheduledToday: boolean | null;
  scheduledTodayReason: string;
  scheduledTodayConfidence: "high" | "low";
  scheduleStability: any;
  sleepBlock: any;
}): DomainOutcome {
  const ss = args.scheduleStability;
  const sb = args.sleepBlock;
  const sa = sb?.sleepAlignment;

  const recoveryReason = ss?.recoveryReason ?? "no_event";
  const recoveryApplicable = ss?.recoveryApplicable ?? (recoveryReason !== "no_event");

  const confidence: Confidence =
    ss?.recoveryConfidence === "high" ? "high" :
    ss?.recoveryConfidence === "medium" ? "medium" : "low";

  return {
    domain: "sleep",
    dateISO: args.dateISO,

    scheduledToday: args.scheduledToday,
    scheduledTodayReason: args.scheduledTodayReason,
    scheduledTodayConfidence: args.scheduledTodayConfidence,

    schedule: {
      alignment: sa?.alignmentScore ?? null,
      consistency: ss?.scheduleConsistencyScore ?? null,
      recovery: ss?.scheduleRecoveryScore ?? null,
      recoveryApplicable,
      confidence,
      reason: recoveryReason,
      consistencySamples: ss?.scheduleConsistencyNSamples ?? null,
    },

    outcome: {
      adequacy: sb?.sleepAdequacyScore ?? null,
      efficiency: sb?.sleepEfficiencyPct ?? null,
      continuity: sb?.sleepContinuityPct ?? null,

      adequacyDenominator: sb?.sleepAdequacyScore != null ? "TST/planned" : null,
      efficiencyDenominator: sb?.sleepEfficiencyPct != null ? "TST/TIB" : null,
      continuityDenominator: sb?.continuityDenominator ?? null,
    },

    debug: {
      scheduleDetail: ss,
      outcomeDetail: sb,
    },
  };
}
