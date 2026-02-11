import {
  classifySleepDeviation,
  formatSignedMinutes,
  formatBedWakeDeviation,
  sleepAlignmentScore,
  noiseFloorMinutes,
} from "../lib/sleep-timing";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (e: any) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

function assertEqual(actual: any, expected: any, msg?: string) {
  if (actual !== expected) {
    throw new Error(`${msg || "Assertion failed"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("=== Sleep Classifier Tests ===\n");

console.log("1) classifySleepDeviation precedence:");

test("wake +35m, bed 0m => oversleep_spillover", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 0, wakeDevMin: 35, shortfallMin: 0 }), "oversleep_spillover");
});

test("bed +5m, wake -5m, shortfall 300m => physiological_shortfall (shortfall wins)", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 5, wakeDevMin: -5, shortfallMin: 300 }), "physiological_shortfall");
});

test("bed +30m, wake 0m, shortfall 20m => behavioral_drift (shortfall < 30 so drift wins)", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 30, wakeDevMin: 0, shortfallMin: 20 }), "behavioral_drift");
});

test("bed +10m, wake -5m, shortfall 0m => efficient_on_plan", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 10, wakeDevMin: -5, shortfallMin: 0 }), "efficient_on_plan");
});

test("all null => insufficient_data", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: null, wakeDevMin: null, shortfallMin: null }), "insufficient_data");
});

test("wake +20m exactly = oversleep_spillover threshold", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 0, wakeDevMin: 20, shortfallMin: 0 }), "oversleep_spillover");
});

test("shortfall 30m exactly = physiological_shortfall threshold", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 0, wakeDevMin: 0, shortfallMin: 30 }), "physiological_shortfall");
});

test("oversleep wins even when shortfall also present", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 0, wakeDevMin: 25, shortfallMin: 50 }), "oversleep_spillover");
});

test("bed +30m, shortfall 376m => physiological_shortfall (shortfall >= 30 wins over drift)", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 30, wakeDevMin: 15, shortfallMin: 376 }), "physiological_shortfall");
});

test("bed +16m (just outside BED_OK=15) => behavioral_drift", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 16, wakeDevMin: 0, shortfallMin: 0 }), "behavioral_drift");
});

test("wake +11m (just outside WAKE_OK=10) but < 20 => behavioral_drift", () => {
  assertEqual(classifySleepDeviation({ bedDevMin: 0, wakeDevMin: 11, shortfallMin: 0 }), "behavioral_drift");
});

console.log("\n2) formatSignedMinutes:");

test("null => em dash", () => {
  assertEqual(formatSignedMinutes(null), "\u2014");
});

test("0 => 0m", () => {
  assertEqual(formatSignedMinutes(0), "0m");
});

test("2 (< 3 noise floor) => 0m", () => {
  assertEqual(formatSignedMinutes(2), "0m");
});

test("-2 (< 3 noise floor) => 0m", () => {
  assertEqual(formatSignedMinutes(-2), "0m");
});

test("+15 => +15m", () => {
  assertEqual(formatSignedMinutes(15), "+15m");
});

test("-10 => \u221210m (U+2212 minus)", () => {
  assertEqual(formatSignedMinutes(-10), "\u221210m");
});

console.log("\n3) formatBedWakeDeviation:");

test("bed +15m / wake \u221210m", () => {
  assertEqual(formatBedWakeDeviation(15, -10), "bed +15m / wake \u221210m");
});

test("both null => bed \u2014 / wake \u2014", () => {
  assertEqual(formatBedWakeDeviation(null, null), "bed \u2014 / wake \u2014");
});

console.log("\n4) sleepAlignmentScore:");

test("within tolerance (bed +10, wake -5) => 100", () => {
  assertEqual(sleepAlignmentScore(10, -5), 100);
});

test("null bed => null", () => {
  assertEqual(sleepAlignmentScore(null, 5), null);
});

test("null wake => null", () => {
  assertEqual(sleepAlignmentScore(5, null), null);
});

test("bed +75m, wake 0m => 50 (bed 60 over, wake 0 over => avg 0.5)", () => {
  assertEqual(sleepAlignmentScore(75, 0), 50);
});

test("bed 0m, wake +70m => 50 (bed 0 over, wake 60 over => avg 0.5)", () => {
  assertEqual(sleepAlignmentScore(0, 70), 50);
});

test("bed +15m exactly (at BED_OK) => 100", () => {
  assertEqual(sleepAlignmentScore(15, 0), 100);
});

test("bed +10m exactly (at WAKE_OK) => 100", () => {
  assertEqual(sleepAlignmentScore(0, 10), 100);
});

console.log("\n5) noiseFloorMinutes:");

test("null => null", () => {
  assertEqual(noiseFloorMinutes(null), null);
});

test("NaN => null", () => {
  assertEqual(noiseFloorMinutes(NaN), null);
});

test("2.5 (abs < 3) => 0", () => {
  assertEqual(noiseFloorMinutes(2.5), 0);
});

test("-2.5 (abs < 3) => 0", () => {
  assertEqual(noiseFloorMinutes(-2.5), 0);
});

test("3.4 => 3 (rounds to 3, abs >= 3)", () => {
  assertEqual(noiseFloorMinutes(3.4), 3);
});

console.log("\n=== All tests complete ===");
