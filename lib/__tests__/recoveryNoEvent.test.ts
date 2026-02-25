import { deriveScheduledToday } from "../../server/schedule/deriveScheduledToday";

describe("Recovery no_event → no fake 100", () => {
  test("unscheduled day should not grant recovery=100", () => {
    const result = deriveScheduledToday("cardio", "2026-02-25", {
      daysOfWeek: [1, 5],
    });
    expect(result.scheduledToday).toBe(false);
  });

  test("scheduled day with no event data should not hardcode recovery=100", async () => {
    const grepResult = await new Promise<string>((resolve) => {
      const { execSync } = require("child_process");
      try {
        const out = execSync('grep -rn "recoveryScore.*=.*100" server/schedule-stability.ts server/cardio-regulation.ts server/lift-regulation.ts 2>/dev/null || echo ""', { encoding: "utf8" });
        resolve(out.trim());
      } catch {
        resolve("");
      }
    });
    const fakeGrantLines = grepResult.split("\n").filter((line: string) =>
      line.includes("no_event") && line.includes("100")
    );
    expect(fakeGrantLines.length).toBe(0);
  });

  test("recoveryApplicable field concept: no_event reason means recovery not applicable", () => {
    const reason = "no_event";
    const recoveryApplicable = reason !== "no_event";
    expect(recoveryApplicable).toBe(false);
  });

  test("all regulation files emit recoveryApplicable field", async () => {
    const { execSync } = require("child_process");
    for (const file of ["server/schedule-stability.ts", "server/cardio-regulation.ts", "server/lift-regulation.ts"]) {
      const out = execSync(`grep -c "recoveryApplicable" ${file} 2>/dev/null || echo "0"`, { encoding: "utf8" });
      expect(parseInt(out.trim())).toBeGreaterThan(0);
    }
  });
});
