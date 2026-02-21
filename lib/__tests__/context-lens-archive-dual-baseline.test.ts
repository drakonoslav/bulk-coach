import {
  computeDisturbanceScore,
} from "../../server/context-lens";

describe("Episode-wide window selection logic", () => {
  const mockDays = (count: number, startDate = "2025-01-01"): string[] => {
    const days: string[] = [];
    const d = new Date(startDate + "T00:00:00Z");
    for (let i = 0; i < count; i++) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      days.push(`${y}-${m}-${day}`);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return days;
  };

  function selectWindows(taggedDays: string[]) {
    const sorted = [...taggedDays].sort();
    if (sorted.length < 3) {
      return { windowSize: 0, insufficient: true, startWindow: [], endWindow: [] };
    }
    const windowSize = sorted.length >= 7 ? 7 : 3;
    const startWindow = sorted.slice(0, windowSize);
    const endWindow = sorted.slice(-windowSize);
    return { windowSize, insufficient: false, startWindow, endWindow };
  }

  function computeInterpretation(disturbanceChange: number | null): "improving" | "flat" | "worsening" | "insufficient_data" {
    if (disturbanceChange === null) return "insufficient_data";
    if (disturbanceChange <= -5) return "improving";
    if (disturbanceChange >= 5) return "worsening";
    return "flat";
  }

  test("14 tagged days -> start/end windows use 7 each", () => {
    const days = mockDays(14);
    const result = selectWindows(days);
    expect(result.windowSize).toBe(7);
    expect(result.startWindow).toHaveLength(7);
    expect(result.endWindow).toHaveLength(7);
    expect(result.startWindow[0]).toBe("2025-01-01");
    expect(result.startWindow[6]).toBe("2025-01-07");
    expect(result.endWindow[0]).toBe("2025-01-08");
    expect(result.endWindow[6]).toBe("2025-01-14");
  });

  test("6 tagged days -> windows use 3 each", () => {
    const days = mockDays(6);
    const result = selectWindows(days);
    expect(result.windowSize).toBe(3);
    expect(result.startWindow).toHaveLength(3);
    expect(result.endWindow).toHaveLength(3);
    expect(result.startWindow[0]).toBe("2025-01-01");
    expect(result.startWindow[2]).toBe("2025-01-03");
    expect(result.endWindow[0]).toBe("2025-01-04");
    expect(result.endWindow[2]).toBe("2025-01-06");
  });

  test("2 tagged days -> insufficient_data", () => {
    const days = mockDays(2);
    const result = selectWindows(days);
    expect(result.insufficient).toBe(true);
    expect(result.windowSize).toBe(0);
  });

  test("exactly 7 tagged days -> windows use 7 each (overlapping)", () => {
    const days = mockDays(7);
    const result = selectWindows(days);
    expect(result.windowSize).toBe(7);
    expect(result.startWindow).toHaveLength(7);
    expect(result.endWindow).toHaveLength(7);
    expect(result.startWindow).toEqual(result.endWindow);
  });

  test("exactly 3 tagged days -> windows use 3 each (fully overlapping)", () => {
    const days = mockDays(3);
    const result = selectWindows(days);
    expect(result.windowSize).toBe(3);
    expect(result.startWindow).toEqual(result.endWindow);
  });

  test("non-consecutive tagged days still slice correctly", () => {
    const days = ["2025-01-01", "2025-01-03", "2025-01-05", "2025-01-10", "2025-01-15", "2025-01-20", "2025-01-25"];
    const result = selectWindows(days);
    expect(result.windowSize).toBe(7);
    expect(result.startWindow[0]).toBe("2025-01-01");
    expect(result.endWindow[6]).toBe("2025-01-25");
  });

  test("episode-restricted: does not leak outside [start_day, end_day]", () => {
    const allEvents = [
      "2024-12-28", "2024-12-29", "2024-12-30",
      "2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04",
      "2025-01-10",
    ];
    const episodeStart = "2025-01-01";
    const episodeEnd = "2025-01-04";
    const episodeRestricted = allEvents.filter(d => d >= episodeStart && d <= episodeEnd);
    const result = selectWindows(episodeRestricted);
    expect(result.windowSize).toBe(3);
    expect(result.startWindow.every(d => d >= episodeStart && d <= episodeEnd)).toBe(true);
    expect(result.endWindow.every(d => d >= episodeStart && d <= episodeEnd)).toBe(true);
  });
});

describe("Interpretation thresholds", () => {
  function computeInterpretation(disturbanceChange: number | null): string {
    if (disturbanceChange === null) return "insufficient_data";
    if (disturbanceChange <= -5) return "improving";
    if (disturbanceChange >= 5) return "worsening";
    return "flat";
  }

  test("disturbanceChange <= -5 -> improving", () => {
    expect(computeInterpretation(-5)).toBe("improving");
    expect(computeInterpretation(-10)).toBe("improving");
    expect(computeInterpretation(-5.1)).toBe("improving");
  });

  test("disturbanceChange >= 5 -> worsening", () => {
    expect(computeInterpretation(5)).toBe("worsening");
    expect(computeInterpretation(10)).toBe("worsening");
    expect(computeInterpretation(5.1)).toBe("worsening");
  });

  test("disturbanceChange between -5 and 5 (exclusive) -> flat", () => {
    expect(computeInterpretation(0)).toBe("flat");
    expect(computeInterpretation(4.9)).toBe("flat");
    expect(computeInterpretation(-4.9)).toBe("flat");
  });

  test("null disturbanceChange -> insufficient_data", () => {
    expect(computeInterpretation(null)).toBe("insufficient_data");
  });
});

describe("Terminal rolling matches engine output", () => {
  test("disturbance score from engine feeds into terminalRolling correctly", () => {
    const engineResult = computeDisturbanceScore({
      hrv_pct: -8,
      rhr_bpm: 3,
      sleep_pct: -10,
      proxy_pct: -10,
      bedtimeDriftLateNights7d: 3,
      bedtimeDriftMeasuredNights7d: 7,
    });

    const terminalRolling = {
      day: "2025-02-01",
      disturbanceScore: engineResult.score,
      components: {
        hrv: engineResult.components.hrv,
        rhr: engineResult.components.rhr,
        sleep: engineResult.components.slp,
        proxy: engineResult.components.prx,
        drift: engineResult.components.drf,
      },
      deltas: {
        hrv_pct: -8,
        sleep_pct: -10,
        proxy_pct: -10,
        rhr_bpm: 3,
        lateRate: 3 / 7,
      },
      cortisolFlagRate21d: null,
      phase: "NOVELTY_DISTURBANCE",
    };

    expect(terminalRolling.disturbanceScore).toBe(engineResult.score);
    expect(terminalRolling.components.hrv).toBe(engineResult.components.hrv);
    expect(terminalRolling.components.rhr).toBe(engineResult.components.rhr);
    expect(terminalRolling.components.sleep).toBe(engineResult.components.slp);
    expect(terminalRolling.components.proxy).toBe(engineResult.components.prx);
    expect(terminalRolling.components.drift).toBe(engineResult.components.drf);
  });

  test("neutral engine output produces score of 50 in terminalRolling", () => {
    const engineResult = computeDisturbanceScore({
      hrv_pct: 0,
      rhr_bpm: 0,
      sleep_pct: 0,
      proxy_pct: 0,
      bedtimeDriftLateNights7d: 0,
      bedtimeDriftMeasuredNights7d: 7,
    });

    expect(engineResult.score).toBe(50);
    expect(Math.abs(engineResult.components.hrv)).toBe(0);
    expect(Math.abs(engineResult.components.rhr)).toBe(0);
    expect(Math.abs(engineResult.components.slp)).toBe(0);
    expect(Math.abs(engineResult.components.prx)).toBe(0);
    expect(Math.abs(engineResult.components.drf)).toBe(0);
  });

  test("component mapping: slp -> sleep, prx -> proxy, drf -> drift", () => {
    const engineResult = computeDisturbanceScore({
      hrv_pct: -12,
      rhr_bpm: 5,
      sleep_pct: -15,
      proxy_pct: -20,
      bedtimeDriftLateNights7d: 5,
      bedtimeDriftMeasuredNights7d: 7,
    });

    const mapped = {
      hrv: engineResult.components.hrv,
      rhr: engineResult.components.rhr,
      sleep: engineResult.components.slp,
      proxy: engineResult.components.prx,
      drift: engineResult.components.drf,
    };

    expect(mapped.hrv).toBeGreaterThan(0);
    expect(mapped.rhr).toBeGreaterThan(0);
    expect(mapped.sleep).toBeGreaterThan(0);
    expect(mapped.proxy).toBeGreaterThan(0);
    expect(mapped.drift).toBeGreaterThan(0);
    expect(engineResult.score).toBeGreaterThan(50);
  });

  test("terminalRolling snapshot accurately reproduces engine result", () => {
    const engineResult = computeDisturbanceScore({
      hrv_pct: -6,
      rhr_bpm: 2,
      sleep_pct: -8,
      proxy_pct: -5,
      bedtimeDriftLateNights7d: 2,
      bedtimeDriftMeasuredNights7d: 7,
    });

    const terminalRolling = {
      disturbanceScore: engineResult.score,
      components: {
        hrv: engineResult.components.hrv,
        rhr: engineResult.components.rhr,
        sleep: engineResult.components.slp,
        proxy: engineResult.components.prx,
        drift: engineResult.components.drf,
      },
    };

    const engineAgain = computeDisturbanceScore({
      hrv_pct: -6,
      rhr_bpm: 2,
      sleep_pct: -8,
      proxy_pct: -5,
      bedtimeDriftLateNights7d: 2,
      bedtimeDriftMeasuredNights7d: 7,
    });

    expect(terminalRolling.disturbanceScore).toBe(engineAgain.score);
    expect(terminalRolling.components.hrv).toBe(engineAgain.components.hrv);
    expect(terminalRolling.components.rhr).toBe(engineAgain.components.rhr);
    expect(terminalRolling.components.sleep).toBe(engineAgain.components.slp);
    expect(terminalRolling.components.proxy).toBe(engineAgain.components.prx);
    expect(terminalRolling.components.drift).toBe(engineAgain.components.drf);
  });
});
