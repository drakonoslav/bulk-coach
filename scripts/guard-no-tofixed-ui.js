const { execSync } = require("child_process");

try {
  const result = execSync('grep -rn "\\.toFixed(" app/ components/ --include="*.tsx" --include="*.ts" 2>/dev/null', { encoding: "utf8" });
  if (result.trim()) {
    console.error("FAIL: .toFixed() found in UI layer:");
    console.error(result);
    process.exit(1);
  }
} catch (e) {
  if (e.status === 1 && !e.stdout?.trim()) {
    console.log("PASS: No .toFixed() calls in app/ or components/");
    process.exit(0);
  }
  throw e;
}
console.log("PASS: No .toFixed() calls in app/ or components/");
