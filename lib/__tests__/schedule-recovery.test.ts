import { fmtScore100 } from "../format";

const API_BASE = `http://localhost:${process.env.PORT || 5000}`;
const AUTH = { headers: { Authorization: `Bearer ${process.env.API_KEY}` } };

async function getReadiness(date: string) {
  const res = await fetch(`${API_BASE}/api/readiness?date=${date}`, AUTH);
  return res.json();
}

function getScheduleDetail(block: any) {
  return (block?.domainOutcome?.debug as any)?.scheduleDetail;
}

function getDomainSchedule(block: any) {
  return block?.domainOutcome?.schedule;
}

describe("Cardio Schedule Recovery", () => {
  let cardioDetail: any;
  let cardioSchedule: any;

  beforeAll(async () => {
    const data = await getReadiness("2026-02-25");
    cardioDetail = getScheduleDetail(data.cardioBlock);
    cardioSchedule = getDomainSchedule(data.cardioBlock);
  });

  test("recoveryScore is a number or null", () => {
    const score = cardioDetail?.recoveryScore;
    if (score != null) {
      expect(typeof score).toBe("number");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    } else {
      expect(score).toBeNull();
    }
  });

  test("domainOutcome.schedule.recovery matches detail.recoveryScore", () => {
    expect(cardioSchedule?.recovery).toEqual(cardioDetail?.recoveryScore ?? null);
  });

  test("recoveryFollowDaysK is a number", () => {
    expect(typeof cardioDetail?.recoveryFollowDaysK).toBe("number");
  });

  test("recoveryConfidence is always high or low, never null", () => {
    expect(["high", "low"]).toContain(cardioDetail?.recoveryConfidence);
  });

  test("recoveryReason is always a valid enum, never null", () => {
    expect(["no_event", "insufficient_post_event_days", "partial_post_event_window", "computed", "missing_scheduled_data"]).toContain(cardioDetail?.recoveryReason);
  });

  test("when reason=no_event, recoveryScore is null (no fake 100)", () => {
    if (cardioDetail?.recoveryReason === "no_event") {
      expect(cardioDetail.recoveryScore).toBeNull();
    }
  });
});

describe("Lift Schedule Recovery", () => {
  let liftDetail: any;
  let liftSchedule: any;

  beforeAll(async () => {
    const data = await getReadiness("2026-02-25");
    liftDetail = getScheduleDetail(data.liftBlock);
    liftSchedule = getDomainSchedule(data.liftBlock);
  });

  test("recoveryScore is a number or null", () => {
    const score = liftDetail?.recoveryScore;
    if (score != null) {
      expect(typeof score).toBe("number");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    } else {
      expect(score).toBeNull();
    }
  });

  test("domainOutcome.schedule.recovery matches detail.recoveryScore", () => {
    expect(liftSchedule?.recovery).toEqual(liftDetail?.recoveryScore ?? null);
  });

  test("recoveryConfidence is always high or low, never null", () => {
    expect(["high", "low"]).toContain(liftDetail?.recoveryConfidence);
  });

  test("recoveryReason is always a valid enum, never null", () => {
    expect(["no_event", "insufficient_post_event_days", "partial_post_event_window", "computed", "missing_scheduled_data"]).toContain(liftDetail?.recoveryReason);
  });

  test("when reason=no_event, recoveryScore is null (no fake 100)", () => {
    if (liftDetail?.recoveryReason === "no_event") {
      expect(liftDetail.recoveryScore).toBeNull();
    }
  });
});

describe("C) No event found scenario", () => {
  test("when no event exists, recoveryScore=null, confidence=low, reason=no_event", async () => {
    const data = await getReadiness("2020-01-01");
    const cardio = getScheduleDetail(data.cardioBlock);
    const lift = getScheduleDetail(data.liftBlock);

    if (cardio) {
      expect(cardio.recoveryReason).toBe("no_event");
      expect(cardio.recoveryScore).toBeNull();
      expect(cardio.recoveryConfidence).toBe("low");
    }

    if (lift) {
      expect(lift.recoveryReason).toBe("no_event");
      expect(lift.recoveryScore).toBeNull();
      expect(lift.recoveryConfidence).toBe("low");
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

  test("recovery score from API formats correctly (number → XX.XX / 100.00, null → —)", async () => {
    const data = await getReadiness("2026-02-25");
    const cardioDetail = getScheduleDetail(data.cardioBlock);
    const liftDetail = getScheduleDetail(data.liftBlock);

    const cardioFormatted = fmtScore100(cardioDetail?.recoveryScore);
    const liftFormatted = fmtScore100(liftDetail?.recoveryScore);

    if (cardioDetail?.recoveryScore != null) {
      expect(cardioFormatted).toMatch(/^\d+\.\d{2} \/ 100\.00$/);
    } else {
      expect(cardioFormatted).toBe("—");
    }

    if (liftDetail?.recoveryScore != null) {
      expect(liftFormatted).toMatch(/^\d+\.\d{2} \/ 100\.00$/);
    } else {
      expect(liftFormatted).toBe("—");
    }
  });
});
