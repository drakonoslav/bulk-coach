export type Domain = "sleep" | "cardio" | "lift";

export type PlannedSchedule = {
  daysOfWeek?: number[];
  frequencyPerWeek?: number;
  overridesByDateISO?: Record<string, boolean>;
};

export type ScheduledTodayResult =
  | { scheduledToday: true; confidence: "high"; reason: "explicit_override_true" | "days_of_week_match" | "frequency_rule_match" }
  | { scheduledToday: false; confidence: "high"; reason: "explicit_override_false" | "days_of_week_miss" }
  | { scheduledToday: null; confidence: "low"; reason: "schedule_unknown" | "date_invalid" };

export function deriveScheduledToday(
  _domain: Domain,
  dateISO: string,
  plan: PlannedSchedule | null | undefined,
): ScheduledTodayResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    return { scheduledToday: null, confidence: "low", reason: "date_invalid" };
  }

  const parsed = new Date(dateISO + "T00:00:00");
  if (isNaN(parsed.getTime())) {
    return { scheduledToday: null, confidence: "low", reason: "date_invalid" };
  }

  if (plan?.overridesByDateISO?.[dateISO] === true) {
    return { scheduledToday: true, confidence: "high", reason: "explicit_override_true" };
  }
  if (plan?.overridesByDateISO?.[dateISO] === false) {
    return { scheduledToday: false, confidence: "high", reason: "explicit_override_false" };
  }

  if (plan?.daysOfWeek != null && Array.isArray(plan.daysOfWeek)) {
    const dow = parsed.getUTCDay();
    if (plan.daysOfWeek.includes(dow)) {
      return { scheduledToday: true, confidence: "high", reason: "days_of_week_match" };
    } else {
      return { scheduledToday: false, confidence: "high", reason: "days_of_week_miss" };
    }
  }

  if (plan?.frequencyPerWeek != null) {
    return { scheduledToday: null, confidence: "low", reason: "schedule_unknown" };
  }

  return { scheduledToday: null, confidence: "low", reason: "schedule_unknown" };
}
