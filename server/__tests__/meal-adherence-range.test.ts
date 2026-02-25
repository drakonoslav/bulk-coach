import { reduceMealAdherenceRows, type MealAdherenceRow } from "../meal/computeMealAdherenceRange";

describe("reduceMealAdherenceRows", () => {
  const start = "2025-06-01";
  const end = "2025-06-14";

  it("returns null averages when no rows", () => {
    const result = reduceMealAdherenceRows([], start, end);
    expect(result.daysWithLogs).toBe(0);
    expect(result.daysTotal).toBe(14);
    expect(result.avgEarnedKcal).toBeNull();
    expect(result.avgMissedKcal).toBeNull();
    expect(result.avgBaselineHitPct).toBeNull();
    expect(result.avgMealsChecked).toBeNull();
    expect(result.avgMealsMissed).toBeNull();
    expect(result.biggestMiss).toBeNull();
    for (const pm of result.perMeal) {
      expect(pm.hitDays).toBe(0);
      expect(pm.missDays).toBe(0);
      expect(pm.hitPct).toBeNull();
    }
  });

  it("computes averages for two days with known checklists", () => {
    const rows: MealAdherenceRow[] = [
      {
        day: "2025-06-10",
        meal_checklist: {
          preCardio: true,
          postCardio: true,
          midday: true,
          preLift: true,
          postLift: true,
          evening: true,
        },
      },
      {
        day: "2025-06-11",
        meal_checklist: {
          preCardio: true,
          postCardio: false,
          midday: false,
          preLift: true,
          postLift: false,
          evening: true,
        },
      },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    expect(result.daysWithLogs).toBe(2);
    expect(result.daysTotal).toBe(14);

    const day1Earned = 104 + 644 + 303 + 385 + 268 + 992;
    const day2Earned = 104 + 385 + 992;
    expect(result.avgEarnedKcal).toBeCloseTo((day1Earned + day2Earned) / 2, 2);

    const day1Missed = Math.max(0, 2696 - day1Earned);
    const day2Missed = Math.max(0, 2696 - day2Earned);
    expect(result.avgMissedKcal).toBeCloseTo((day1Missed + day2Missed) / 2, 2);

    expect(result.avgMealsChecked).toBeCloseTo((6 + 3) / 2, 2);
    expect(result.avgMealsMissed).toBeCloseTo(6 - (6 + 3) / 2, 2);

    expect(result.avgBaselineHitPct).toBeCloseTo(
      (((day1Earned + day2Earned) / 2) / 2696) * 100,
      2,
    );

    const preCardio = result.perMeal.find(p => p.key === "preCardio")!;
    expect(preCardio.hitDays).toBe(2);
    expect(preCardio.missDays).toBe(0);
    expect(preCardio.hitPct).toBeCloseTo(100, 2);

    const postCardio = result.perMeal.find(p => p.key === "postCardio")!;
    expect(postCardio.hitDays).toBe(1);
    expect(postCardio.missDays).toBe(1);
    expect(postCardio.hitPct).toBeCloseTo(50, 2);
  });

  it("biggestMiss picks meal with most miss days, tie-broken by higher kcal", () => {
    const rows: MealAdherenceRow[] = [
      {
        day: "2025-06-10",
        meal_checklist: {
          preCardio: true,
          postCardio: false,
          midday: false,
          preLift: true,
          postLift: true,
          evening: true,
        },
      },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    expect(result.biggestMiss).toBe("Post-cardio");
  });

  it("biggestMiss is null when all meals checked", () => {
    const rows: MealAdherenceRow[] = [
      {
        day: "2025-06-10",
        meal_checklist: {
          preCardio: true,
          postCardio: true,
          midday: true,
          preLift: true,
          postLift: true,
          evening: true,
        },
      },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    expect(result.biggestMiss).toBeNull();
  });
});
