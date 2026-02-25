import { fmtScore100 } from "../format";

const API_BASE = `http://localhost:${process.env.PORT || 5000}`;
const AUTH = { headers: { Authorization: `Bearer ${process.env.API_KEY}` } };

async function getReadiness(date: string) {
  const res = await fetch(`${API_BASE}/api/readiness?date=${date}`, AUTH);
  return res.json();
}

function getCanonicalSchedule(block: any) {
  return block?.domainOutcome?.schedule;
}

function getScheduleDetail(block: any) {
  return (block?.domainOutcome?.debug as any)?.scheduleDetail;
}

describe("Cardio Schedule Recovery (canonical)", () => {
  let sched: any;
  let detail: any;

  beforeAll(async () => {
    const data = await getReadiness("2026-02-25");
    sched = getCanonicalSchedule(data.cardioBlock);
    detail = getScheduleDetail(data.cardioBlock);
  });

  test("schedule block is defined with recoveryApplicable boolean", () => {
    expect(sched).toBeDefined();
    expect(typeof sched.recoveryApplicable).toBe("boolean");
  });

  test("if recoveryApplicable=false → recovery=null, reason=no_event", () => {
    if (!sched.recoveryApplicable) {
      expect(sched.recovery).toBeNull();
      expect(sched.reason).toBe("no_event");
    }
  });

  test("if recoveryApplicable=true and reason=computed → recovery is finite number 0..100", () => {
    if (sched.recoveryApplicable && sched.reason === "computed") {
      expect(sched.recovery).not.toBeNull();
      expect(typeof sched.recovery).toBe("number");
      expect(sched.recovery).toBeGreaterThanOrEqual(0);
      expect(sched.recovery).toBeLessThanOrEqual(100);
      expect(sched.confidence).toBeDefined();
    }
  });

  test("if recoveryApplicable=true and reason=insufficient_post_event_days → recovery=null (no fake 100)", () => {
    if (sched.recoveryApplicable && sched.reason === "insufficient_post_event_days") {
      expect(sched.recovery).toBeNull();
    }
  });

  test("canonical schedule.recovery matches debug detail.recoveryScore", () => {
    expect(sched.recovery).toEqual(detail?.recoveryScore ?? null);
  });

  test("detail.recoveryConfidence is always high or low", () => {
    expect(["high", "low"]).toContain(detail?.recoveryConfidence);
  });

  test("detail.recoveryReason is a valid enum", () => {
    expect(["no_event", "insufficient_post_event_days", "partial_post_event_window", "computed", "missing_scheduled_data"]).toContain(detail?.recoveryReason);
  });

  test("detail.recoveryFollowDaysK is a number", () => {
    expect(typeof detail?.recoveryFollowDaysK).toBe("number");
  });
});

describe("Lift Schedule Recovery (canonical)", () => {
  let sched: any;
  let detail: any;

  beforeAll(async () => {
    const data = await getReadiness("2026-02-25");
    sched = getCanonicalSchedule(data.liftBlock);
    detail = getScheduleDetail(data.liftBlock);
  });

  test("schedule block is defined with recoveryApplicable boolean", () => {
    expect(sched).toBeDefined();
    expect(typeof sched.recoveryApplicable).toBe("boolean");
  });

  test("if recoveryApplicable=false → recovery=null, reason=no_event", () => {
    if (!sched.recoveryApplicable) {
      expect(sched.recovery).toBeNull();
      expect(sched.reason).toBe("no_event");
    }
  });

  test("if recoveryApplicable=true and reason=computed → recovery is finite number 0..100", () => {
    if (sched.recoveryApplicable && sched.reason === "computed") {
      expect(sched.recovery).not.toBeNull();
      expect(typeof sched.recovery).toBe("number");
      expect(sched.recovery).toBeGreaterThanOrEqual(0);
      expect(sched.recovery).toBeLessThanOrEqual(100);
      expect(sched.confidence).toBeDefined();
    }
  });

  test("if recoveryApplicable=true and reason=insufficient_post_event_days → recovery=null (no fake 100)", () => {
    if (sched.recoveryApplicable && sched.reason === "insufficient_post_event_days") {
      expect(sched.recovery).toBeNull();
    }
  });

  test("canonical schedule.recovery matches debug detail.recoveryScore", () => {
    expect(sched.recovery).toEqual(detail?.recoveryScore ?? null);
  });

  test("detail.recoveryConfidence is always high or low", () => {
    expect(["high", "low"]).toContain(detail?.recoveryConfidence);
  });

  test("detail.recoveryReason is a valid enum", () => {
    expect(["no_event", "insufficient_post_event_days", "partial_post_event_window", "computed", "missing_scheduled_data"]).toContain(detail?.recoveryReason);
  });
});

describe("No event found scenario (canonical)", () => {
  test("far-past date: recoveryApplicable=false, recovery=null, reason=no_event", async () => {
    const data = await getReadiness("2020-01-01");
    const cardio = getCanonicalSchedule(data.cardioBlock);
    const lift = getCanonicalSchedule(data.liftBlock);

    if (cardio) {
      expect(cardio.recoveryApplicable).toBe(false);
      expect(cardio.recovery).toBeNull();
      expect(cardio.reason).toBe("no_event");
    }

    if (lift) {
      expect(lift.recoveryApplicable).toBe(false);
      expect(lift.recovery).toBeNull();
      expect(lift.reason).toBe("no_event");
    }
  });
});

describe("UI formatting — Recovery display", () => {
  test("fmtScore100 produces correct formatted strings", () => {
    expect(fmtScore100(100)).toBe("100.00 / 100.00");
    expect(fmtScore100(0)).toBe("0.00 / 100.00");
    expect(fmtScore100(73.456)).toBe("73.46 / 100.00");
    expect(fmtScore100(null)).toBe("—");
    expect(fmtScore100(undefined)).toBe("—");
  });

  test("recovery score formats correctly: number → XX.XX / 100.00, null → —", async () => {
    const data = await getReadiness("2026-02-25");
    const cardioSched = getCanonicalSchedule(data.cardioBlock);
    const liftSched = getCanonicalSchedule(data.liftBlock);

    const cardioFormatted = fmtScore100(cardioSched?.recovery);
    const liftFormatted = fmtScore100(liftSched?.recovery);

    if (cardioSched?.recovery != null) {
      expect(cardioFormatted).toMatch(/^\d+\.\d{2} \/ 100\.00$/);
    } else {
      expect(cardioFormatted).toBe("—");
    }

    if (liftSched?.recovery != null) {
      expect(liftFormatted).toMatch(/^\d+\.\d{2} \/ 100\.00$/);
    } else {
      expect(liftFormatted).toBe("—");
    }
  });
});
