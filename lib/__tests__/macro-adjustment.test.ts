import {
  gramsForKcal,
  proposeMacroSafeAdjustment,
  KCAL_PER_G,
  BASELINE,
  type Baseline,
} from "../coaching-engine";

describe("gramsForKcal", () => {
  test("small kcal does not force unit foods", () => {
    expect(gramsForKcal("bananas", 30)).toBe(0);
    expect(gramsForKcal("eggs", 30)).toBe(0);
    expect(gramsForKcal("yogurt_cups", 30)).toBe(0);
  });

  test("unit foods return ±1 when kcal is at least half a unit", () => {
    expect(gramsForKcal("bananas", 60)).toBe(1);
    expect(gramsForKcal("eggs", 50)).toBe(1);
    expect(gramsForKcal("bananas", -60)).toBe(-1);
  });

  test("rounds directly to step for mct/dextrin (5g)", () => {
    expect(gramsForKcal("mct_g", 12.6 * 7.0)).toBe(15);
    expect(gramsForKcal("dextrin_g", 50)).toBe(roundToNearest5(50 / 3.87));
  });

  test("rounds directly to step for oats/whey/flax (10g)", () => {
    expect(gramsForKcal("oats_g", 100)).toBe(roundToNearest10(100 / 4.0));
    expect(gramsForKcal("whey_g", 75)).toBe(roundToNearest10(75 / 3.76));
    expect(gramsForKcal("flax_g", 50)).toBe(roundToNearest10(50 / 3.24));
  });

  test("returns 0 for unknown item key", () => {
    expect(gramsForKcal("unknown_item", 100)).toBe(0);
  });

  test("negative kcal produces negative grams", () => {
    expect(gramsForKcal("mct_g", -35)).toBe(-5);
    expect(gramsForKcal("oats_g", -200)).toBe(-50);
  });
});

describe("proposeMacroSafeAdjustment: adjustable-only policy", () => {
  const ADJUSTABLE = ["mct_g", "dextrin_g", "oats_g"];

  test("on cuts, only adjustable items appear", () => {
    const plan = proposeMacroSafeAdjustment(-100, BASELINE);
    for (const p of plan) {
      expect(ADJUSTABLE).toContain(p.item);
    }
  });

  test("on surpluses, only adjustable items appear", () => {
    const plan = proposeMacroSafeAdjustment(+200, BASELINE);
    for (const p of plan) {
      expect(ADJUSTABLE).toContain(p.item);
    }
  });

  test("whole foods never appear in any plan", () => {
    for (const delta of [-300, -100, +100, +300]) {
      const plan = proposeMacroSafeAdjustment(delta, BASELINE);
      const nonAdjustable = plan.filter((p) => !ADJUSTABLE.includes(p.item));
      expect(nonAdjustable).toHaveLength(0);
    }
  });

  test("whey/flax/bananas/eggs/yogurt never touched", () => {
    const blocked = new Set(["whey_g", "flax_g", "bananas", "eggs", "yogurt_cups"]);
    for (const delta of [-500, -100, +100, +500]) {
      const plan = proposeMacroSafeAdjustment(delta, BASELINE);
      for (const p of plan) {
        expect(blocked.has(p.item)).toBe(false);
      }
    }
  });
});

describe("proposeMacroSafeAdjustment: floor clamp", () => {
  test("never drives item below zero", () => {
    const baseline: Baseline = {
      ...BASELINE,
      items: { ...BASELINE.items, mct_g: 0 },
    };
    const plan = proposeMacroSafeAdjustment(-100, baseline);
    const mct = plan.find((p) => p.item === "mct_g");
    if (mct) {
      expect(baseline.items.mct_g + mct.deltaAmount).toBeGreaterThanOrEqual(0);
    }
  });

  test("clamps large cut when item has small baseline", () => {
    const baseline: Baseline = {
      ...BASELINE,
      items: { ...BASELINE.items, mct_g: 10 },
    };
    const plan = proposeMacroSafeAdjustment(-500, baseline);
    const mct = plan.find((p) => p.item === "mct_g");
    if (mct) {
      expect(mct.deltaAmount).toBeGreaterThanOrEqual(-10);
      expect(baseline.items.mct_g + mct.deltaAmount).toBeGreaterThanOrEqual(0);
    }
  });

  test("all items in plan stay non-negative after applying delta", () => {
    const baseline: Baseline = {
      ...BASELINE,
      items: { ...BASELINE.items, mct_g: 5, dextrin_g: 10, oats_g: 20 },
    };
    const plan = proposeMacroSafeAdjustment(-500, baseline);
    for (const p of plan) {
      const baseAmt = baseline.items[p.item] ?? 0;
      expect(baseAmt + p.deltaAmount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("proposeMacroSafeAdjustment: general behavior", () => {
  test("returns empty for zero change", () => {
    expect(proposeMacroSafeAdjustment(0, BASELINE)).toEqual([]);
  });

  test("+75 kcal produces a plan within ±25 of target", () => {
    const plan = proposeMacroSafeAdjustment(75, BASELINE);
    const totalAchieved = plan.reduce((s, p) => s + p.achievedKcal, 0);
    expect(Math.abs(totalAchieved - 75)).toBeLessThanOrEqual(25);
  });

  test("-100 kcal produces a plan within ±25 of target", () => {
    const plan = proposeMacroSafeAdjustment(-100, BASELINE);
    const totalAchieved = plan.reduce((s, p) => s + p.achievedKcal, 0);
    expect(Math.abs(totalAchieved - -100)).toBeLessThanOrEqual(25);
  });

  test("+200 kcal distributes across items in priority order", () => {
    const plan = proposeMacroSafeAdjustment(200, BASELINE);
    expect(plan.length).toBeGreaterThanOrEqual(1);
    const firstItem = plan[0].item;
    const firstIdx = BASELINE.adjustPriority.indexOf(firstItem);
    expect(firstIdx).toBe(0);
  });
});

function roundToNearest5(x: number): number {
  return Math.round(x / 5) * 5;
}

function roundToNearest10(x: number): number {
  return Math.round(x / 10) * 10;
}
