import { DomainOutcome } from "../types/domainOutcome";
import { ReadinessResponse } from "../types/readinessResponse";

export interface BuildReadinessInput {
  result: Record<string, unknown>;
  sleepBlock: Record<string, unknown>;
  sleepDomainOutcome: DomainOutcome;
  sleepTrending: unknown;
  schedStab: {
    scheduledToday: boolean | null;
    scheduledTodayReason: string;
    scheduledTodayConfidence: "high" | "low";
  };
  adherence: ReadinessResponse["adherence"];
  primaryDriver: string | null;
  cardioDomainOutcome: DomainOutcome;
  liftDomainOutcome: DomainOutcome;
}

export function buildReadinessResponse(input: BuildReadinessInput): ReadinessResponse {
  const {
    result,
    sleepBlock,
    sleepDomainOutcome,
    sleepTrending,
    schedStab,
    adherence,
    primaryDriver,
    cardioDomainOutcome,
    liftDomainOutcome,
  } = input;

  return {
    ...result,
    dateISO: (result as any).dateISO ?? "",
    scheduledToday: schedStab.scheduledToday,
    scheduledTodayReason: schedStab.scheduledTodayReason,
    scheduledTodayConfidence: schedStab.scheduledTodayConfidence,
    sleepBlock: { ...sleepBlock, domainOutcome: sleepDomainOutcome },
    sleepTrending,
    adherence,
    primaryDriver,
    cardioBlock: { domainOutcome: cardioDomainOutcome },
    liftBlock: { domainOutcome: liftDomainOutcome },
    placeholders: {
      mealTimingTracked: false,
    },
  } as ReadinessResponse;
}
