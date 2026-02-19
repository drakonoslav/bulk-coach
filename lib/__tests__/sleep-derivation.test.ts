import { deriveSleep, clockTibMinutes } from "../sleep-derivation";

describe("clockTibMinutes", () => {
  it("computes minutes between bed and wake crossing midnight", () => {
    expect(clockTibMinutes("22:30", "05:30")).toBe(420);
  });
  it("computes minutes same-day", () => {
    expect(clockTibMinutes("01:00", "08:00")).toBe(420);
  });
  it("returns null for invalid input", () => {
    expect(clockTibMinutes("abc", "05:30")).toBeNull();
  });
});

describe("deriveSleep", () => {
  test("1 — Stages-only: awakeInBed == awakeStage, latencyProxy == 0", () => {
    const result = deriveSleep({
      awakeStageMin: 30,
      remMin: 120,
      coreMin: 200,
      deepMin: 90,
    });

    expect(result.sleepSourceMode).toBe("stage_sum");
    expect(result.tib).toBe(30 + 120 + 200 + 90);
    expect(result.tst).toBe(120 + 200 + 90);
    expect(result.awakeInBed).toBe(30);
    expect(result.wasoEst).toBe(30);
    expect(result.latencyProxy).toBe(0);
  });

  test("2 — Clock TIB larger than stages: latencyProxy = 7", () => {
    const result = deriveSleep({
      actualBedTime: "22:00",
      actualWakeTime: "05:50",
      awakeStageMin: 23,
      remMin: 140,
      coreMin: 200,
      deepMin: 100,
    });

    expect(result.sleepSourceMode).toBe("clock_tib");
    expect(result.tib).toBe(470);
    expect(result.tst).toBe(440);
    expect(result.awakeInBed).toBe(30);
    expect(result.wasoEst).toBe(23);
    expect(result.latencyProxy).toBe(7);
  });

  test("3 — Clock TIB smaller than TST: clamp awakeInBed=0, latencyProxy=0", () => {
    const result = deriveSleep({
      actualBedTime: "23:00",
      actualWakeTime: "05:40",
      awakeStageMin: 10,
      remMin: 140,
      coreMin: 200,
      deepMin: 100,
    });

    expect(result.sleepSourceMode).toBe("clock_tib");
    expect(result.tib).toBe(400);
    expect(result.tst).toBe(440);
    expect(result.awakeInBed).toBe(0);
    expect(result.latencyProxy).toBe(0);
  });

  test("4 — No awakeStage: wasoEst null, latencyProxy null", () => {
    const result = deriveSleep({
      actualBedTime: "22:30",
      actualWakeTime: "06:00",
      timeAsleepMin: 400,
    });

    expect(result.sleepSourceMode).toBe("clock_tib");
    expect(result.tib).toBe(450);
    expect(result.tst).toBe(400);
    expect(result.awakeInBed).toBe(50);
    expect(result.wasoEst).toBeNull();
    expect(result.latencyProxy).toBeNull();
  });

  test("manual mode: only TST, no bed/wake, no stages", () => {
    const result = deriveSleep({
      timeAsleepMin: 420,
    });

    expect(result.sleepSourceMode).toBe("manual");
    expect(result.tib).toBeNull();
    expect(result.tst).toBe(420);
    expect(result.awakeInBed).toBeNull();
    expect(result.wasoEst).toBeNull();
    expect(result.latencyProxy).toBeNull();
  });
});
