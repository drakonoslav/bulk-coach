import { DomainOutcome } from "./domainOutcome";

export type DomainBlock = {
  domainOutcome: DomainOutcome;
};

export type SleepDomainBlock = Record<string, unknown> & DomainBlock;

export type ReadinessResponse = {
  dateISO: string;
  scheduledToday: boolean | null;
  scheduledTodayReason: string;
  scheduledTodayConfidence: "high" | "low";
  sleepBlock: SleepDomainBlock;
  sleepTrending: unknown;
  adherence: {
    alignmentScore: number | null;
    bedDevMin: number | null;
    wakeDevMin: number | null;
    bedtimeDriftLateNights7d: number | null;
    wakeDriftEarlyNights7d: number | null;
    measuredNights7d: number | null;
    bedtimeDriftNote: string | null;
    wakeDriftNote: string | null;
    trainingOverrunMin: number | null;
    liftOverrunMin: number | null;
    actualCardioMin: number | null;
    plannedCardioMin: number;
    actualLiftMin: number | null;
    plannedLiftMin: number;
    mealAdherence: {
      mealsChecked: number;
      mealsTotal: number;
      earnedKcal: number;
      missedKcal: number;
      baselineHitPct: number;
      biggestMiss: string | null;
      mealDay: string | null;
    } | null;
  };
  primaryDriver: string | null;
  cardioBlock: DomainBlock;
  liftBlock: DomainBlock;
  placeholders: { mealTimingTracked: boolean };
};
