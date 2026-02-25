import { DomainOutcome } from "./domainOutcome";

export type DomainBlock = {
  domainOutcome: DomainOutcome;
};

export type ReadinessResponse = {
  dateISO: string;
  scheduledToday: boolean | null;
  scheduledTodayReason: string;
  scheduledTodayConfidence: "high" | "low";
  sleepBlock: Record<string, unknown> & DomainBlock;
  cardioBlock: DomainBlock;
  liftBlock: DomainBlock;
  adherence: Record<string, unknown>;
  primaryDriver: string | null;
  placeholders: { mealTimingTracked: boolean };
};
