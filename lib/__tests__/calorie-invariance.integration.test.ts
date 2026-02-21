import {
  suggestCalorieAdjustment,
  weeklyDelta,
  type DailyEntry,
} from "../coaching-engine";
import { classifyStrengthPhase } from "../strength-index";
import { classifyMode } from "../structural-confidence";
import type { StrengthBaselines } from "../strength-index";

function isoDay(base: Date, i: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + i);
  return d.toISOString().slice(0, 10);
}

function makeEntries_21d_recomp_withStrength(): DailyEntry[] {
  const start = new Date("2026-01-01T12:00:00.000Z");
  return Array.from({ length: 21 }).map((_, i) => ({
    day: isoDay(start, i),
    morningWeightLb: 160 - i * 0.10,
    waistIn: 33.0 - i * 0.03,
    adherence: 1,
    pushupsReps: 20 + i,
    pullupsReps: 5 + Math.floor(i / 3),
    benchReps: 10 + Math.floor(i / 2),
    benchWeightLb: 45,
    ohpReps: 8 + Math.floor(i / 3),
    ohpWeightLb: 45,
    caloriesIn: 2695,
  }));
}

function stripStrength(entries: DailyEntry[]): DailyEntry[] {
  return entries.map((e) => ({
    ...e,
    pushupsReps: undefined,
    pullupsReps: undefined,
    benchReps: undefined,
    benchWeightLb: undefined,
    ohpReps: undefined,
    ohpWeightLb: undefined,
    fatFreeMassLb: undefined,
  }));
}

describe("coaching-engine calorie invariance vs strength-phase", () => {
  test("suggestCalorieAdjustment is a pure function of weight gain only", () => {
    const result1 = suggestCalorieAdjustment(0.3);
    const result2 = suggestCalorieAdjustment(0.3);
    expect(result1).toBe(result2);
    expect(result1).toBe(0);
  });

  test("weeklyDelta ignores strength fields entirely", () => {
    const withStrength = makeEntries_21d_recomp_withStrength();
    const withoutStrength = stripStrength(withStrength);

    const delta1 = weeklyDelta(withStrength);
    const delta2 = weeklyDelta(withoutStrength);

    expect(delta1).toBe(delta2);
  });

  test("suggestCalorieAdjustment returns same delta regardless of strength data presence", () => {
    const withStrength = makeEntries_21d_recomp_withStrength();
    const withoutStrength = stripStrength(withStrength);

    const wkGain1 = weeklyDelta(withStrength);
    const wkGain2 = weeklyDelta(withoutStrength);

    expect(wkGain1).toBe(wkGain2);

    if (wkGain1 != null && wkGain2 != null) {
      const cal1 = suggestCalorieAdjustment(wkGain1);
      const cal2 = suggestCalorieAdjustment(wkGain2);
      expect(cal1).toBe(cal2);
    }
  });

  test("calorie delta unchanged even if strength trend is extreme", () => {
    const entries = makeEntries_21d_recomp_withStrength().map((e, i) => ({
      ...e,
      pushupsReps: (e.pushupsReps ?? 0) + i * 5,
      benchReps: (e.benchReps ?? 0) + Math.floor(i / 1),
    }));

    const wkGainWith = weeklyDelta(entries);
    const wkGainWithout = weeklyDelta(stripStrength(entries));

    expect(wkGainWith).toBe(wkGainWithout);

    if (wkGainWith != null && wkGainWithout != null) {
      expect(suggestCalorieAdjustment(wkGainWith)).toBe(
        suggestCalorieAdjustment(wkGainWithout)
      );
    }
  });

  test("classifyStrengthPhase does not exist in suggestCalorieAdjustment call path", () => {
    const src = suggestCalorieAdjustment.toString();
    expect(src).not.toContain("classifyStrengthPhase");
    expect(src).not.toContain("strengthPhase");
  });

  test("classifyStrengthPhase does not exist in weeklyDelta call path", () => {
    const src = weeklyDelta.toString();
    expect(src).not.toContain("classifyStrengthPhase");
    expect(src).not.toContain("strengthPhase");
  });

  test("classifyMode calorieAction uses raw velocity, not StrengthPhase enum", () => {
    const baselines: StrengthBaselines = {
      pushups: 20,
      pullups: 5,
      benchBarReps: 10,
      ohpBarReps: 8,
    };

    const entries = makeEntries_21d_recomp_withStrength();

    const mode1 = classifyMode(entries, baselines);

    const strengthPhase = classifyStrengthPhase(mode1.strengthVelocityPct);

    expect(strengthPhase.phase).toBeDefined();
    expect(mode1.calorieAction).toBeDefined();
    expect(mode1.calorieAction.delta).toBeDefined();
  });

  test("classifyMode calorieAction identical with and without StrengthPhase classification existing", () => {
    const baselines: StrengthBaselines = {
      pushups: 20,
      pullups: 5,
      benchBarReps: 10,
      ohpBarReps: 8,
    };

    const entries = makeEntries_21d_recomp_withStrength();

    const mode1 = classifyMode(entries, baselines);

    const _phase = classifyStrengthPhase(mode1.strengthVelocityPct);

    const mode2 = classifyMode(entries, baselines);

    expect(mode1.calorieAction.delta).toBe(mode2.calorieAction.delta);
    expect(mode1.calorieAction.reason).toBe(mode2.calorieAction.reason);
  });
});
