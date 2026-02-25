import { buildReadinessResponse, BuildReadinessInput } from "../../server/readiness/buildReadinessResponse";
import { DomainOutcome } from "../../server/types/domainOutcome";

function makeDomainOutcome(domain: "sleep" | "cardio" | "lift"): DomainOutcome {
  return {
    domain,
    dateISO: "2025-06-01",
    scheduledToday: true,
    scheduledTodayReason: "day_of_week",
    scheduledTodayConfidence: "high",
    schedule: {
      alignment: 85,
      consistency: 90,
      recovery: 75,
      recoveryApplicable: true,
      confidence: "high",
    },
    outcome: {
      adequacy: 95,
      efficiency: 88,
      continuity: 82,
      adequacyDenominator: "planned",
      efficiencyDenominator: "total",
      continuityDenominator: "TIB",
    },
  };
}

function makeInput(): BuildReadinessInput {
  return {
    result: { dateISO: "2025-06-01", readinessScore: 78 },
    sleepBlock: {
      timeInBedMin: 480,
      timeAsleepMin: 440,
      domainOutcome: makeDomainOutcome("sleep"),
    },
    sleepDomainOutcome: makeDomainOutcome("sleep"),
    sleepTrending: { trend: "stable" },
    schedStab: {
      scheduledToday: true,
      scheduledTodayReason: "day_of_week",
      scheduledTodayConfidence: "high",
    },
    adherence: {
      alignmentScore: 90,
      bedDevMin: 5,
      wakeDevMin: -3,
      bedtimeDriftLateNights7d: 2,
      wakeDriftEarlyNights7d: 1,
      measuredNights7d: 7,
      bedtimeDriftNote: null,
      wakeDriftNote: null,
      trainingOverrunMin: null,
      liftOverrunMin: null,
      actualCardioMin: 38,
      plannedCardioMin: 40,
      actualLiftMin: 70,
      plannedLiftMin: 75,
      mealAdherence: null,
    },
    primaryDriver: null,
    cardioDomainOutcome: makeDomainOutcome("cardio"),
    liftDomainOutcome: makeDomainOutcome("lift"),
  };
}

function deepKeys(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object") return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(path);
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...deepKeys(v, path));
    }
  }
  return keys;
}

describe("readinessNoLegacyShape", () => {
  test("cardioBlock contains only domainOutcome", () => {
    const resp = buildReadinessResponse(makeInput());
    const cardioKeys = Object.keys(resp.cardioBlock);
    expect(cardioKeys).toEqual(["domainOutcome"]);
  });

  test("liftBlock contains only domainOutcome", () => {
    const resp = buildReadinessResponse(makeInput());
    const liftKeys = Object.keys(resp.liftBlock);
    expect(liftKeys).toEqual(["domainOutcome"]);
  });

  test("sleepBlock contains domainOutcome", () => {
    const resp = buildReadinessResponse(makeInput());
    expect(resp.sleepBlock).toHaveProperty("domainOutcome");
    expect(resp.sleepBlock.domainOutcome.domain).toBe("sleep");
  });

  test("top-level payload does NOT contain scheduleStability", () => {
    const resp = buildReadinessResponse(makeInput());
    const allKeys = deepKeys(resp);
    const forbidden = allKeys.filter(
      (k) =>
        k === "scheduleStability" ||
        k === "cardioBlock.scheduleStability" ||
        k === "liftBlock.scheduleStability"
    );
    expect(forbidden).toEqual([]);
  });

  test("cardioBlock and liftBlock do NOT contain legacy outcome key", () => {
    const resp = buildReadinessResponse(makeInput());
    const cardioKeys = Object.keys(resp.cardioBlock);
    const liftKeys = Object.keys(resp.liftBlock);
    expect(cardioKeys).not.toContain("outcome");
    expect(cardioKeys).not.toContain("scheduleStability");
    expect(liftKeys).not.toContain("outcome");
    expect(liftKeys).not.toContain("scheduleStability");
  });

  test("deep scan: no top-level key named scheduleStability anywhere in payload", () => {
    const resp = buildReadinessResponse(makeInput());
    const allKeys = deepKeys(resp);
    const ssKeys = allKeys.filter(
      (k) => k.split(".").pop() === "scheduleStability"
    );
    expect(ssKeys).toEqual([]);
  });

  test("deep scan: outcome only appears inside domainOutcome path", () => {
    const resp = buildReadinessResponse(makeInput());
    const allKeys = deepKeys(resp);
    const outcomeKeys = allKeys.filter((k) => {
      const parts = k.split(".");
      const idx = parts.lastIndexOf("outcome");
      if (idx === -1) return false;
      if (idx > 0 && parts[idx - 1] === "domainOutcome") return false;
      return true;
    });
    expect(outcomeKeys).toEqual([]);
  });
});
