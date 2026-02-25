import { DomainOutcome, Confidence } from "../types/domainOutcome";

export function toDomainOutcomeLift(args: {
  dateISO: string;
  scheduleStability: any;
  outcome: any;
}): DomainOutcome {
  const ss = args.scheduleStability;
  const lo = args.outcome;

  const recoveryReason = ss?.recoveryReason ?? "no_event";
  const recoveryApplicable = ss?.recoveryApplicable ?? (recoveryReason !== "no_event");

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
      recovery: ss?.recoveryScore ?? null,
      recoveryApplicable,
      confidence,
      reason: recoveryReason,
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
      actualMin: lo?.actualMin ?? null,
      plannedMin: lo?.plannedMin ?? null,
      workingMin: lo?.workingMin ?? null,
      idleMin: lo?.idleMin ?? null,
      hrTotalMin: lo?.hrTotalMin ?? null,
      workFrac: lo?.workFrac ?? null,
      hrEngageFrac: lo?.hrEngageFrac ?? null,
      liftZ1Min: lo?.liftZ1Min ?? null,
      liftZ2Min: lo?.liftZ2Min ?? null,
      liftZ3Min: lo?.liftZ3Min ?? null,
      liftZ4Min: lo?.liftZ4Min ?? null,
      liftZ5Min: lo?.liftZ5Min ?? null,
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
