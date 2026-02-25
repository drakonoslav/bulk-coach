import { reduceMealAdherenceRows, type MealAdherenceRow } from "../meal/computeMealAdherenceRange";

describe("reduceMealAdherenceRows", () => {
  const start = "2025-06-01";
  const end = "2025-06-14";

  const allChecked = {
    preCardio: true,
    postCardio: true,
    midday: true,
    preLift: true,
    postLift: true,
    evening: true,
  };

  it("returns null averages when no rows", () => {
    const result = reduceMealAdherenceRows([], start, end);
    expect(result.daysWithLogs).toBe(0);
    expect(result.daysTotal).toBe(14);
    expect(result.kcal.avgEarnedKcal).toBeNull();
    expect(result.kcal.avgMissedKcal).toBeNull();
    expect(result.kcal.avgBaselineHitPct).toBeNull();
    expect(result.kcal.trendKcalPerDay).toBeNull();
    expect(result.meals.avgMealsChecked).toBeNull();
    expect(result.meals.avgMealsMissed).toBeNull();
    expect(result.meals.mostMissedMealKey).toBeNull();
    expect(result.meals.adherenceConsistencyPct).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.biggestMiss).toBeNull();
    expect(result.nextBestMeal.key).toBeNull();
    for (const pm of result.perMeal) {
      expect(pm.hitDays).toBe(0);
      expect(pm.missDays).toBe(0);
      expect(pm.hitPct).toBeNull();
      expect(pm.currentStreak).toBe(0);
      expect(pm.longestStreak).toBe(0);
    }
  });

  it("computes averages for two days with known checklists", () => {
    const rows: MealAdherenceRow[] = [
      {
        day: "2025-06-10",
        meal_checklist: allChecked,
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
    expect(result.kcal.avgEarnedKcal).toBeCloseTo((day1Earned + day2Earned) / 2, 2);

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

    expect(result.confidence).toBe("low");
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
      { day: "2025-06-10", meal_checklist: allChecked },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    expect(result.biggestMiss).toBeNull();
  });

  it("computes per-meal streaks correctly", () => {
    const rows: MealAdherenceRow[] = [
      { day: "2025-06-01", meal_checklist: { ...allChecked, preLift: true } },
      { day: "2025-06-02", meal_checklist: { ...allChecked, preLift: true } },
      { day: "2025-06-03", meal_checklist: { ...allChecked, preLift: false } },
      { day: "2025-06-04", meal_checklist: { ...allChecked, preLift: true } },
      { day: "2025-06-05", meal_checklist: { ...allChecked, preLift: true } },
      { day: "2025-06-06", meal_checklist: { ...allChecked, preLift: true } },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    const preLift = result.perMeal.find(p => p.key === "preLift")!;
    expect(preLift.currentStreak).toBe(3);
    expect(preLift.longestStreak).toBe(3);
    expect(preLift.currentMissStreak).toBe(0);
    expect(preLift.longestMissStreak).toBe(1);

    const preCardio = result.perMeal.find(p => p.key === "preCardio")!;
    expect(preCardio.currentStreak).toBe(6);
    expect(preCardio.longestStreak).toBe(6);
  });

  it("missing-data days do not count as misses and break streak continuity", () => {
    const rows: MealAdherenceRow[] = [
      { day: "2025-06-01", meal_checklist: { ...allChecked, evening: true } },
      { day: "2025-06-02", meal_checklist: { ...allChecked, evening: true } },
      { day: "2025-06-05", meal_checklist: { ...allChecked, evening: true } },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    const evening = result.perMeal.find(p => p.key === "evening")!;
    expect(evening.hitDays).toBe(3);
    expect(evening.missDays).toBe(0);
    expect(evening.currentStreak).toBe(3);
    expect(evening.longestStreak).toBe(3);
  });

  it("computes trend slope: increasing kcal → positive slope", () => {
    const rows: MealAdherenceRow[] = [];
    for (let i = 1; i <= 7; i++) {
      const day = `2025-06-${String(i).padStart(2, "0")}`;
      const checklist: Record<string, boolean> = {
        preCardio: true,
        postCardio: i >= 3,
        midday: i >= 5,
        preLift: true,
        postLift: true,
        evening: true,
      };
      rows.push({ day, meal_checklist: checklist });
    }
    const result = reduceMealAdherenceRows(rows, start, end);
    expect(result.kcal.trendKcalPerDay).not.toBeNull();
    expect(result.kcal.trendKcalPerDay!).toBeGreaterThan(0);
  });

  it("trend is null with fewer than 5 logged days", () => {
    const rows: MealAdherenceRow[] = [
      { day: "2025-06-01", meal_checklist: allChecked },
      { day: "2025-06-02", meal_checklist: allChecked },
      { day: "2025-06-03", meal_checklist: allChecked },
      { day: "2025-06-04", meal_checklist: allChecked },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    expect(result.kcal.trendKcalPerDay).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("confidence levels: 5 → medium, 11 → high", () => {
    const makeRows = (n: number): MealAdherenceRow[] =>
      Array.from({ length: n }, (_, i) => ({
        day: `2025-06-${String(i + 1).padStart(2, "0")}`,
        meal_checklist: allChecked,
      }));

    expect(reduceMealAdherenceRows(makeRows(5), start, end).confidence).toBe("medium");
    expect(reduceMealAdherenceRows(makeRows(11), start, end).confidence).toBe("high");
  });

  it("nextBestMeal selects lowest hit pct meal", () => {
    const rows: MealAdherenceRow[] = [
      {
        day: "2025-06-10",
        meal_checklist: {
          preCardio: true,
          postCardio: false,
          midday: true,
          preLift: true,
          postLift: true,
          evening: true,
        },
      },
    ];
    const result = reduceMealAdherenceRows(rows, start, end);
    expect(result.nextBestMeal.key).toBe("postCardio");
    expect(result.nextBestMeal.label).toBe("Post-cardio");
  });
});
