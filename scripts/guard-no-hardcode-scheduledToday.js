const { execSync } = require("child_process");

try {
  const result = execSync('grep -rn "scheduledToday = true" server/ --include="*.ts" 2>/dev/null', { encoding: "utf8" });
  const lines = result.trim().split("\n").filter(l => l.trim());
  const nonTestLines = lines.filter(l => !l.includes("__tests__") && !l.includes(".test."));
  if (nonTestLines.length > 0) {
    console.error("FAIL: Hardcoded 'scheduledToday = true' found in server/:");
    console.error(nonTestLines.join("\n"));
    process.exit(1);
  }
} catch (e) {
  if (e.status === 1 && !e.stdout?.trim()) {
    console.log("PASS: No hardcoded 'scheduledToday = true' in server/");
    process.exit(0);
  }
  throw e;
}
console.log("PASS: No hardcoded 'scheduledToday = true' in server/");
