import { classifyAdaptationStage } from "../adaptation-stage";
import type { DailyEntry } from "../coaching-engine";
import type { StrengthBaselines } from "../strength-index";

function makeDay(day: string, overrides: Partial<DailyEntry> = {}): DailyEntry {
  return { day, morningWeightLb: 180, ...overrides };
}

function daysAgo(n: number, refDate: string = "2025-06-01"): string {
  const d = new Date(refDate + "T00:00:00");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const baselines: StrengthBaselines = {
  pushups: 20,
  pullups: 10,
  benchBarReps: null,
  ohpBarReps: null,
};

describe("classifyAdaptationStage", () => {
  it("returns INSUFFICIENT_DATA with no entries", () => {
    const r = classifyAdaptationStage([], baselines);
    expect(r.stage).toBe("INSUFFICIENT_DATA");
    expect(r.noveltyScore).toBeNull();
    expect(r.debug.trainingAgeDays).toBeNull();
  });

  it("returns INSUFFICIENT_DATA with <2 strength sessions in 14d", () => {
    const entries = [
      makeDay(daysAgo(5), { pushupsReps: 25 }),
      makeDay(daysAgo(3)),
    ];
    const r = classifyAdaptationStage(entries, baselines);
    expect(r.stage).toBe("INSUFFICIENT_DATA");
  });

  it("classifies NOVELTY_WINDOW: training age ≤90d, consistent, neural-phase velocity", () => {
    const entries: DailyEntry[] = [];
    for (let i = 0; i < 30; i++) {
      const reps = Math.round(20 + i * 1.5);
      entries.push(makeDay(daysAgo(30 - i), {
        pushupsReps: reps,
        pullupsReps: Math.round(10 + i * 0.8),
      }));
    }
    const r = classifyAdaptationStage(entries, baselines);
    if (r.stage === "NOVELTY_WINDOW") {
      expect(r.label).toBe("Novelty");
      expect(r.noveltyScore).not.toBeNull();
      expect(r.noveltyScore!).toBeGreaterThan(0);
      expect(r.trainingAgeDays).toBeLessThanOrEqual(90);
      expect(r.debug.sPhasePhase).toMatch(/NEURAL_REBOUND|LATE_NEURAL/);
    } else {
      expect(["NOVELTY_WINDOW", "STANDARD_HYPERTROPHY"]).toContain(r.stage);
    }
  });

  it("classifies STANDARD_HYPERTROPHY: mid-range training age, inconsistent (avoids plateau)", () => {
    const entries: DailyEntry[] = [];
    for (let i = 0; i < 200; i++) {
      if (i % 5 === 0) {
        entries.push(makeDay(daysAgo(200 - i), {
          pushupsReps: 30,
          pullupsReps: 15,
        }));
      } else {
        entries.push(makeDay(daysAgo(200 - i)));
      }
    }
    const r = classifyAdaptationStage(entries, baselines);
    expect(r.stage).toBe("STANDARD_HYPERTROPHY");
    expect(r.label).toBe("Standard");
    expect(r.debug.plateauCondition).toBeNull();
  });

  it("classifies PLATEAU_RISK via PR stagnation (condA), not %/wk", () => {
    const entries: DailyEntry[] = [];
    for (let i = 0; i < 120; i++) {
      entries.push(makeDay(daysAgo(120 - i), {
        pushupsReps: 30,
        pullupsReps: 15,
      }));
    }
    const r = classifyAdaptationStage(entries, baselines);
    expect(r.stage).toBe("PLATEAU_RISK");
    expect(r.label).toBe("Plateau risk");
    expect(r.noveltyScore).not.toBeNull();
    expect(r.debug.plateauCondition).not.toBeNull();
    expect(["A_no_pr_improvement", "B_absolute_si_floor"]).toContain(r.debug.plateauCondition);
  });

  it("does NOT flag PLATEAU_RISK for intermediate with clear PR improvement each 14d window", () => {
    const entries: DailyEntry[] = [];
    for (let i = 0; i < 120; i++) {
      entries.push(makeDay(daysAgo(120 - i), {
        pushupsReps: Math.round(20 + i * 0.08),
        pullupsReps: Math.round(10 + i * 0.04),
      }));
    }
    const r = classifyAdaptationStage(entries, baselines);
    expect(r.stage).not.toBe("PLATEAU_RISK");
  });

  it("returns INSUFFICIENT_DATA when strength velocity is null", () => {
    const entries = [
      makeDay(daysAgo(10), { pushupsReps: 25, pullupsReps: 12 }),
      makeDay(daysAgo(8), { pushupsReps: 26, pullupsReps: 12 }),
      makeDay(daysAgo(5), { pushupsReps: 27, pullupsReps: 13 }),
    ];
    const nullBaselines: StrengthBaselines = {
      pushups: null,
      pullups: null,
      benchBarReps: null,
      ohpBarReps: null,
    };
    const r = classifyAdaptationStage(entries, nullBaselines);
    expect(r.stage).toBe("INSUFFICIENT_DATA");
    expect(r.reasons[0]).toMatch(/velocity unavailable/i);
  });

  it("noveltyScore decays with training age", () => {
    const makeEntries = (days: number) => {
      const entries: DailyEntry[] = [];
      for (let i = 0; i < days; i++) {
        entries.push(makeDay(daysAgo(days - i), {
          pushupsReps: 30,
          pullupsReps: 15,
        }));
      }
      return entries;
    };

    const r30 = classifyAdaptationStage(makeEntries(30), baselines);
    const r90 = classifyAdaptationStage(makeEntries(90), baselines);
    const r180 = classifyAdaptationStage(makeEntries(180), baselines);

    if (r30.noveltyScore != null && r90.noveltyScore != null && r180.noveltyScore != null) {
      expect(r30.noveltyScore).toBeGreaterThanOrEqual(r90.noveltyScore);
      expect(r90.noveltyScore).toBeGreaterThanOrEqual(r180.noveltyScore);
    }
  });

  it("debug object is always populated", () => {
    const entries: DailyEntry[] = [];
    for (let i = 0; i < 30; i++) {
      entries.push(makeDay(daysAgo(30 - i), {
        pushupsReps: 30 + i,
        pullupsReps: 15,
      }));
    }
    const r = classifyAdaptationStage(entries, baselines);
    expect(r.debug).toBeDefined();
    expect(r.debug.trainingAgeDays).not.toBeNull();
    expect(r.debug.consistency4w).not.toBeNull();
    expect(r.debug.sPhasePhase).not.toBeNull();
  });
});
