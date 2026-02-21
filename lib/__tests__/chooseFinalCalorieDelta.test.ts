type CalorieSource = "weight_only" | "mode_override";

function chooseFinalCalorieDelta(
  kcalAdjWeightOnly: number,
  modeDelta: number,
  modePriority: "high" | "medium" | "low"
): { delta: number; source: CalorieSource } {
  if (modeDelta !== 0 && modePriority === "high") {
    return { delta: modeDelta, source: "mode_override" };
  }
  return { delta: kcalAdjWeightOnly, source: "weight_only" };
}

describe("chooseFinalCalorieDelta — arbiter logic", () => {
  test("low priority mode action: weight-only wins", () => {
    const result = chooseFinalCalorieDelta(100, 50, "low");
    expect(result.delta).toBe(100);
    expect(result.source).toBe("weight_only");
  });

  test("medium priority mode action: weight-only wins", () => {
    const result = chooseFinalCalorieDelta(100, -100, "medium");
    expect(result.delta).toBe(100);
    expect(result.source).toBe("weight_only");
  });

  test("high priority mode action: mode override wins", () => {
    const result = chooseFinalCalorieDelta(100, -100, "high");
    expect(result.delta).toBe(-100);
    expect(result.source).toBe("mode_override");
  });

  test("high priority but modeDelta is 0: weight-only wins", () => {
    const result = chooseFinalCalorieDelta(75, 0, "high");
    expect(result.delta).toBe(75);
    expect(result.source).toBe("weight_only");
  });

  test("both deltas are 0: returns 0 weight-only", () => {
    const result = chooseFinalCalorieDelta(0, 0, "low");
    expect(result.delta).toBe(0);
    expect(result.source).toBe("weight_only");
  });

  test("high priority negative override replaces positive weight-only", () => {
    const result = chooseFinalCalorieDelta(100, -100, "high");
    expect(result.delta).toBe(-100);
    expect(result.source).toBe("mode_override");
  });

  test("low priority recomp fuel (+50) does not override weight-only (+100)", () => {
    const result = chooseFinalCalorieDelta(100, 50, "low");
    expect(result.delta).toBe(100);
    expect(result.source).toBe("weight_only");
  });

  test("high priority plateau hold (0) with modeDelta=0: falls through to weight-only", () => {
    const result = chooseFinalCalorieDelta(75, 0, "high");
    expect(result.delta).toBe(75);
    expect(result.source).toBe("weight_only");
  });

  test("high priority waist guardrail (-100) overrides weight-only (+75)", () => {
    const result = chooseFinalCalorieDelta(75, -100, "high");
    expect(result.delta).toBe(-100);
    expect(result.source).toBe("mode_override");
  });

  test("medium priority 'weight gain too fast' (-100) does NOT override weight-only", () => {
    const result = chooseFinalCalorieDelta(0, -100, "medium");
    expect(result.delta).toBe(0);
    expect(result.source).toBe("weight_only");
  });

  test("high priority protect lean tissue (+75) overrides weight-only (0)", () => {
    const result = chooseFinalCalorieDelta(0, 75, "high");
    expect(result.delta).toBe(75);
    expect(result.source).toBe("mode_override");
  });

  test("all real high-priority reasons produce mode_override", () => {
    const highPriorityDeltas = [-100, 0, 50, 75, 100];
    for (const d of highPriorityDeltas) {
      if (d === 0) continue;
      const result = chooseFinalCalorieDelta(0, d, "high");
      expect(result.source).toBe("mode_override");
      expect(result.delta).toBe(d);
    }
  });

  test("no low/medium priority ever produces mode_override", () => {
    const priorities: Array<"low" | "medium"> = ["low", "medium"];
    const deltas = [-100, -50, 0, 50, 75, 100];
    for (const p of priorities) {
      for (const d of deltas) {
        const result = chooseFinalCalorieDelta(0, d, p);
        expect(result.source).toBe("weight_only");
      }
    }
  });
});
