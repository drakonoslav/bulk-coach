const { execSync } = require("child_process");

let failures = [];

const patterns = [
  {
    desc: "UI references *.scheduleStability",
    pattern: "(sleepBlock|cardioBlock|liftBlock)\\??\\.scheduleStability\\b",
  },
  {
    desc: "UI references cardioBlock.outcome (legacy)",
    pattern: "cardioBlock\\??\\.outcome\\b",
  },
  {
    desc: "UI references liftBlock.outcome (legacy)",
    pattern: "liftBlock\\??\\.outcome\\b",
  },
];

for (const p of patterns) {
  try {
    const result = execSync(
      `rg -n "${p.pattern}" app/ components/ 2>/dev/null`,
      { encoding: "utf8" }
    );
    if (result.trim().length > 0) {
      failures.push(`${p.desc}:\n${result.trim()}`);
    }
  } catch (_e) {
  }
}

if (failures.length > 0) {
  console.error("FAIL: guard-no-legacy-ui");
  failures.forEach((f) => console.error("  " + f));
  process.exit(1);
}

console.log("PASS: guard-no-legacy-ui — no legacy field references in UI");
