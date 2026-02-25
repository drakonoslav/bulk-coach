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
      sleepEfficiencyFrac: sb?.sleepEfficiencyFrac ?? null,
      sleepContinuityFrac: sb?.sleepContinuityFrac ?? null,
      plannedSleepMin: sb?.plannedSleepMin ?? null,
      timeInBedMin: sb?.timeInBedMin ?? null,
      estimatedSleepMin: sb?.estimatedSleepMin ?? null,
      latencyMin: sb?.latencyMin ?? null,
      wasoMin: sb?.wasoMin ?? null,
      awakeInBedMin: sb?.awakeInBedMin ?? null,
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
