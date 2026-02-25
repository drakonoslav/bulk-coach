import { fmtScore100 } from "../format";

const API_BASE = `http://localhost:${process.env.PORT || 5000}`;
const AUTH = { headers: { Authorization: `Bearer ${process.env.API_KEY}` } };

async function getReadiness(date: string) {
  const res = await fetch(`${API_BASE}/api/readiness?date=${date}`, AUTH);
  return res.json();
}

describe("Cardio Schedule Recovery", () => {
  let cardioRecovery: any;

  beforeAll(async () => {
    const data = await getReadiness("2026-02-25");
    cardioRecovery = data.cardioBlock?.scheduleStability;
  });

  test("A) eventFound=true with availableAfterEvent=0 → score=100, confidence=low, reason=insufficient_post_event_days", () => {
    expect(cardioRecovery.recoveryScore).toBe(100);
    expect(typeof cardioRecovery.recoveryScore).toBe("number");
    expect(cardioRecovery.recoveryConfidence).toBe("low");
    expect(cardioRecovery.recoveryReason).toBe("insufficient_post_event_days");
  });

  test("recoveryScore is always a number, never null", () => {
    expect(cardioRecovery.recoveryScore).not.toBeNull();
    expect(typeof cardioRecovery.recoveryScore).toBe("number");
    expect(cardioRecovery.recoveryScore).toBeGreaterThanOrEqual(0);
    expect(cardioRecovery.recoveryScore).toBeLessThanOrEqual(100);
  });

  test("recoveryFollowDaysK is a number", () => {
    expect(typeof cardioRecovery.recoveryFollowDaysK).toBe("number");
  });

  test("recoveryConfidence is always high or low, never null", () => {
    expect(["high", "low"]).toContain(cardioRecovery.recoveryConfidence);
  });

  test("recoveryReason is always a valid enum, never null", () => {
    expect(["no_event", "insufficient_post_event_days", "partial_post_event_window", "computed"]).toContain(cardioRecovery.recoveryReason);
  });
});

describe("Lift Schedule Recovery", () => {
  let liftRecovery: any;

  beforeAll(async () => {
    const data = await getReadiness("2026-02-25");
    liftRecovery = data.liftBlock?.scheduleStability;
  });

  test("B) eventFound=true with availableAfterEvent=0 → score=100, confidence=low", () => {
    expect(liftRecovery.recoveryScore).toBe(100);
    expect(typeof liftRecovery.recoveryScore).toBe("number");
    expect(liftRecovery.recoveryConfidence).toBe("low");
  });

  test("recoveryScore is always a number in [0,100], never null", () => {
    expect(liftRecovery.recoveryScore).not.toBeNull();
    expect(typeof liftRecovery.recoveryScore).toBe("number");
    expect(liftRecovery.recoveryScore).toBeGreaterThanOrEqual(0);
    expect(liftRecovery.recoveryScore).toBeLessThanOrEqual(100);
  });

  test("recoveryConfidence is always high or low, never null", () => {
    expect(["high", "low"]).toContain(liftRecovery.recoveryConfidence);
  });

  test("recoveryReason is always a valid enum, never null", () => {
    expect(["no_event", "insufficient_post_event_days", "partial_post_event_window", "computed"]).toContain(liftRecovery.recoveryReason);
  });
});

describe("C) No event found scenario", () => {
  test("when no event exists, recoveryScore=100, confidence=low, reason=no_event", async () => {
    const data = await getReadiness("2020-01-01");
    const cardio = data.cardioBlock?.scheduleStability;
    const lift = data.liftBlock?.scheduleStability;

    if (cardio) {
      expect(typeof cardio.recoveryScore).toBe("number");
      expect(cardio.recoveryScore).toBe(100);
      expect(cardio.recoveryConfidence).toBe("low");
      expect(cardio.recoveryReason).toBe("no_event");
    }

    if (lift) {
      expect(typeof lift.recoveryScore).toBe("number");
      expect(lift.recoveryScore).toBe(100);
      expect(lift.recoveryConfidence).toBe("low");
      expect(lift.recoveryReason).toBe("no_event");
    }
  });
});

describe("D) UI formatting — Recovery always shows XX.XX / 100.00", () => {
  test("fmtScore100 always produces formatted string for any number", () => {
    expect(fmtScore100(100)).toBe("100.00 / 100.00");
    expect(fmtScore100(0)).toBe("0.00 / 100.00");
    expect(fmtScore100(73.456)).toBe("73.46 / 100.00");
    expect(fmtScore100(null)).toBe("—");
    expect(fmtScore100(undefined)).toBe("—");
  });

  test("recovery score from API always formats as XX.XX / 100.00 (never bare dash)", async () => {
    const data = await getReadiness("2026-02-25");
    const cardioScore = data.cardioBlock?.scheduleStability?.recoveryScore;
    const liftScore = data.liftBlock?.scheduleStability?.recoveryScore;

    const cardioFormatted = fmtScore100(cardioScore);
    const liftFormatted = fmtScore100(liftScore);

    expect(cardioFormatted).toMatch(/^\d+\.\d{2} \/ 100\.00$/);
    expect(liftFormatted).toMatch(/^\d+\.\d{2} \/ 100\.00$/);
    expect(cardioFormatted).not.toBe("—");
    expect(liftFormatted).not.toBe("—");
  });
});
