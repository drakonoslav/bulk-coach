import { toDomainOutcomeSleep } from "../../server/sleep/toDomainOutcomeSleep";
import { toDomainOutcomeCardio } from "../../server/cardio/toDomainOutcomeCardio";
import { toDomainOutcomeLift } from "../../server/lift/toDomainOutcomeLift";
import { DomainOutcome } from "../../server/types/domainOutcome";

const SCHEDULE_KEYS = ["alignment", "consistency", "recovery", "recoveryApplicable", "confidence"] as const;
const OUTCOME_KEYS = ["adequacy", "efficiency", "continuity", "adequacyDenominator", "efficiencyDenominator", "continuityDenominator"] as const;
const TOP_KEYS = ["domain", "dateISO", "scheduledToday", "scheduledTodayReason", "scheduledTodayConfidence", "schedule", "outcome"] as const;

function assertDomainOutcomeShape(result: DomainOutcome, expectedDomain: string) {
  for (const key of TOP_KEYS) {
    expect(result).toHaveProperty(key);
  }
  expect(result.domain).toBe(expectedDomain);
  expect(typeof result.dateISO).toBe("string");

  expect(result.scheduledToday === null || typeof result.scheduledToday === "boolean").toBe(true);
  expect(typeof result.scheduledTodayReason).toBe("string");
  expect(["high", "low"]).toContain(result.scheduledTodayConfidence);

  for (const key of SCHEDULE_KEYS) {
    expect(result.schedule).toHaveProperty(key);
  }
  expect(typeof result.schedule.recoveryApplicable).toBe("boolean");
  expect(["high", "medium", "low"]).toContain(result.schedule.confidence);
  for (const key of ["alignment", "consistency", "recovery"] as const) {
    const v = result.schedule[key];
    expect(v === null || typeof v === "number").toBe(true);
  }

  for (const key of OUTCOME_KEYS) {
    expect(result.outcome).toHaveProperty(key);
  }
  for (const key of ["adequacy", "efficiency", "continuity"] as const) {
    const v = result.outcome[key];
    expect(v === null || typeof v === "number").toBe(true);
  }
  for (const key of ["adequacyDenominator", "efficiencyDenominator", "continuityDenominator"] as const) {
    const v = result.outcome[key];
    expect(v === null || typeof v === "string").toBe(true);
  }
}

describe("DomainOutcome shape consistency", () => {
  const mockScheduleStability = {
    scheduleConsistencyScore: 85,
    scheduleRecoveryScore: 72,
    recoveryConfidence: "high",
    recoveryReason: "computed",
    recoveryApplicable: true,
    scheduledToday: true,
    scheduledTodayReason: "days_of_week_match",
    scheduledTodayConfidence: "high" as const,
    hasActualDataToday: true,
    missStreak: 0,
    suppressionFactor: 1,
    driftPenalty: 0.1,
    driftFactor: 0.95,
    recoveryRaw: 75,
    recoverySuppressed: 75,
    recoveryFinal: 71.25,
    alignmentScore: 90,
    consistencyScore: 85,
    recoveryScore: 72,
  };

  test("Sleep wrapper produces valid DomainOutcome shape", () => {
    const result = toDomainOutcomeSleep({
      dateISO: "2026-02-25",
      scheduledToday: true,
      scheduledTodayReason: "days_of_week_match",
      scheduledTodayConfidence: "high",
      scheduleStability: {
        ...mockScheduleStability,
        scheduleRecoveryScore: 72,
      },
      sleepBlock: {
        sleepAlignment: { alignmentScore: 88 },
        sleepAdequacyScore: 95,
        sleepEfficiencyPct: 91.5,
        sleepEfficiencyFrac: 0.915,
        sleepContinuityPct: 87.3,
        sleepContinuityFrac: 0.873,
        continuityDenominator: "TIB",
        plannedSleepMin: 465,
        timeInBedMin: 480,
        estimatedSleepMin: 440,
        latencyMin: 8,
        wasoMin: 12,
        awakeInBedMin: 20,
      },
    });
    assertDomainOutcomeShape(result, "sleep");
    expect(result.outcome.continuityDenominator).toBe("TIB");
    expect(result.debug).toBeDefined();
  });

  test("Cardio wrapper produces valid DomainOutcome shape", () => {
    const result = toDomainOutcomeCardio({
      dateISO: "2026-02-25",
      scheduleStability: mockScheduleStability,
      outcome: {
        adequacyScore: 105,
        adequacySource: "productive",
        efficiencyScore: 88,
        continuityScore: 92,
        continuityDenominator: "total_weighted_offband",
        productiveMin: 32,
        cardioTotalMin: 40,
        cardioTotalSource: "zones_sum",
        plannedDurationMin: 40,
        offBandMin: 5,
        offBandWeighted: 3.5,
        z1Min: 3, z2Min: 20, z3Min: 12, z4Min: 3, z5Min: 2,
      },
    });
    assertDomainOutcomeShape(result, "cardio");
    expect(result.outcome.continuityDenominator).toBe("total_weighted_offband");
    expect(result.debug).toBeDefined();
  });

  test("Lift wrapper produces valid DomainOutcome shape", () => {
    const result = toDomainOutcomeLift({
      dateISO: "2026-02-25",
      scheduleStability: mockScheduleStability,
      outcome: {
        adequacyScore: 100,
        efficiencyScore: 85,
        continuityScore: 90,
        continuityDenominator: "actual_idle",
        actualMin: 75,
        plannedMin: 75,
        workingMin: 60,
        idleMin: 15,
        hrTotalMin: null,
        workFrac: 0.8,
        hrEngageFrac: null,
      },
    });
    assertDomainOutcomeShape(result, "lift");
    expect(result.debug).toBeDefined();
  });

  test("All three wrappers produce identical top-level key sets", () => {
    const sleep = toDomainOutcomeSleep({
      dateISO: "2026-02-25",
      scheduledToday: null,
      scheduledTodayReason: "schedule_unknown",
      scheduledTodayConfidence: "low",
      scheduleStability: {},
      sleepBlock: null,
    });
    const cardio = toDomainOutcomeCardio({
      dateISO: "2026-02-25",
      scheduleStability: {},
      outcome: {},
    });
    const lift = toDomainOutcomeLift({
      dateISO: "2026-02-25",
      scheduleStability: {},
      outcome: {},
    });

    const sleepKeys = Object.keys(sleep).sort();
    const cardioKeys = Object.keys(cardio).sort();
    const liftKeys = Object.keys(lift).sort();
    expect(sleepKeys).toEqual(cardioKeys);
    expect(sleepKeys).toEqual(liftKeys);

    const sleepSchedKeys = Object.keys(sleep.schedule).sort();
    const cardioSchedKeys = Object.keys(cardio.schedule).sort();
    const liftSchedKeys = Object.keys(lift.schedule).sort();
    expect(sleepSchedKeys).toEqual(cardioSchedKeys);
    expect(sleepSchedKeys).toEqual(liftSchedKeys);

    const sleepOutKeys = Object.keys(sleep.outcome).sort();
    const cardioOutKeys = Object.keys(cardio.outcome).sort();
    const liftOutKeys = Object.keys(lift.outcome).sort();
    expect(sleepOutKeys).toEqual(cardioOutKeys);
    expect(sleepOutKeys).toEqual(liftOutKeys);
  });

  test("Null inputs produce valid shape with null scores", () => {
    const result = toDomainOutcomeSleep({
      dateISO: "2026-02-25",
      scheduledToday: null,
      scheduledTodayReason: "schedule_unknown",
      scheduledTodayConfidence: "low",
      scheduleStability: null,
      sleepBlock: null,
    });
    assertDomainOutcomeShape(result, "sleep");
    expect(result.schedule.alignment).toBeNull();
    expect(result.schedule.consistency).toBeNull();
    expect(result.schedule.recovery).toBeNull();
    expect(result.outcome.adequacy).toBeNull();
    expect(result.outcome.efficiency).toBeNull();
    expect(result.outcome.continuity).toBeNull();
  });
});
