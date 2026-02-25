export type Domain = "sleep" | "cardio" | "lift";
export type Confidence = "high" | "medium" | "low";
export type RecoveryStatus = "not_applicable" | "insufficient_data" | "computed";

export type ScheduleBlock = {
  alignment: number | null;
  consistency: number | null;
  recovery: number | null;
  recoveryApplicable: boolean;
  recoveryStatus: RecoveryStatus;
  confidence: Confidence;
  reason?: string | null;
  consistencySamples?: number | null;
};

export type OutcomeBlock = {
  adequacy: number | null;
  efficiency: number | null;
  continuity: number | null;

  adequacyDenominator: string | null;
  efficiencyDenominator: string | null;
  continuityDenominator: string | null;
};

export type DomainOutcome = {
  domain: Domain;
  dateISO: string;

  scheduledToday: boolean | null;
  scheduledTodayReason: string;
  scheduledTodayConfidence: "high" | "low";

  schedule: ScheduleBlock;
  outcome: OutcomeBlock;

  debug?: Record<string, unknown>;
};
