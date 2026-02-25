import { deriveScheduledToday } from "../../server/schedule/deriveScheduledToday";

describe("deriveScheduledToday", () => {
  test("explicit override true → scheduledToday=true, high confidence", () => {
    const result = deriveScheduledToday("cardio", "2026-02-25", {
      overridesByDateISO: { "2026-02-25": true },
    });
    expect(result.scheduledToday).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.reason).toBe("explicit_override_true");
  });

  test("explicit override false → scheduledToday=false, high confidence", () => {
    const result = deriveScheduledToday("lift", "2026-02-25", {
      overridesByDateISO: { "2026-02-25": false },
    });
    expect(result.scheduledToday).toBe(false);
    expect(result.confidence).toBe("high");
    expect(result.reason).toBe("explicit_override_false");
  });

  test("daysOfWeek match → scheduledToday=true", () => {
    const wed = "2026-02-25";
    const result = deriveScheduledToday("cardio", wed, {
      daysOfWeek: [3],
    });
    expect(result.scheduledToday).toBe(true);
    expect(result.reason).toBe("days_of_week_match");
  });

  test("daysOfWeek miss → scheduledToday=false", () => {
    const wed = "2026-02-25";
    const result = deriveScheduledToday("lift", wed, {
      daysOfWeek: [1, 5],
    });
    expect(result.scheduledToday).toBe(false);
    expect(result.reason).toBe("days_of_week_miss");
  });

  test("frequencyPerWeek only → scheduledToday=null, low confidence", () => {
    const result = deriveScheduledToday("cardio", "2026-02-25", {
      frequencyPerWeek: 3,
    });
    expect(result.scheduledToday).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.reason).toBe("schedule_unknown");
  });

  test("null plan → scheduledToday=null, schedule_unknown", () => {
    const result = deriveScheduledToday("sleep", "2026-02-25", null);
    expect(result.scheduledToday).toBeNull();
    expect(result.reason).toBe("schedule_unknown");
  });

  test("invalid date → scheduledToday=null, date_invalid", () => {
    const result = deriveScheduledToday("cardio", "not-a-date", null);
    expect(result.scheduledToday).toBeNull();
    expect(result.reason).toBe("date_invalid");
  });

  test("override takes precedence over daysOfWeek", () => {
    const result = deriveScheduledToday("lift", "2026-02-25", {
      daysOfWeek: [1, 5],
      overridesByDateISO: { "2026-02-25": true },
    });
    expect(result.scheduledToday).toBe(true);
    expect(result.reason).toBe("explicit_override_true");
  });

  test("all three domains accepted", () => {
    for (const domain of ["sleep", "cardio", "lift"] as const) {
      const result = deriveScheduledToday(domain, "2026-02-25", null);
      expect(result).toHaveProperty("scheduledToday");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reason");
    }
  });
});
