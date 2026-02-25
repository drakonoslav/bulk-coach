const fs = require("fs");
const path = require("path");

let failures = [];

const routesPath = path.join(__dirname, "..", "server", "routes.ts");
const routesSrc = fs.readFileSync(routesPath, "utf8");

const readinessStart = routesSrc.indexOf('app.get("/api/readiness"');
if (readinessStart === -1) {
  console.error("FAIL: Could not find /api/readiness endpoint in routes.ts");
  process.exit(1);
}

const auditStart = routesSrc.indexOf('app.get("/api/readiness_audit"');
const endIdx = auditStart !== -1 ? auditStart : routesSrc.length;
const readinessSection = routesSrc.slice(readinessStart, endIdx);

const usesBuilder = /buildReadinessResponse\(/.test(readinessSection);
const inlineJson = readinessSection.match(/res\.json\(\{[\s\S]*?\n\s*\}\);/);

if (usesBuilder) {
  const builderPath = path.join(__dirname, "..", "server", "readiness", "buildReadinessResponse.ts");
  if (!fs.existsSync(builderPath)) {
    console.error("FAIL: routes.ts references buildReadinessResponse but file not found");
    process.exit(1);
  }
  const builderSrc = fs.readFileSync(builderPath, "utf8");

  const returnMatch = builderSrc.match(/return\s*\{[\s\S]*?\}\s*as\s+ReadinessResponse;/);
  if (!returnMatch) {
    console.error("FAIL: Could not find return {...} in buildReadinessResponse.ts");
    process.exit(1);
  }
  const returnBody = returnMatch[0];

  if (/\bscheduleStability\b/.test(returnBody)) {
    failures.push("buildReadinessResponse return contains 'scheduleStability'");
  }

  const cardioMatch = returnBody.match(/cardioBlock\s*:\s*\{([^}]*)\}/);
  if (cardioMatch) {
    const body = cardioMatch[1];
    if (/\bscheduleStability\b/.test(body)) {
      failures.push("cardioBlock in builder contains 'scheduleStability'");
    }
    if (/\boutcome\b/.test(body) && !/domainOutcome/.test(body)) {
      failures.push("cardioBlock in builder contains legacy 'outcome'");
    }
  }

  const liftMatch = returnBody.match(/liftBlock\s*:\s*\{([^}]*)\}/);
  if (liftMatch) {
    const body = liftMatch[1];
    if (/\bscheduleStability\b/.test(body)) {
      failures.push("liftBlock in builder contains 'scheduleStability'");
    }
    if (/\boutcome\b/.test(body) && !/domainOutcome/.test(body)) {
      failures.push("liftBlock in builder contains legacy 'outcome'");
    }
  }
} else if (inlineJson) {
  const payload = inlineJson[0];
  if (/\bscheduleStability\b/.test(payload)) {
    failures.push("res.json payload contains 'scheduleStability'");
  }
  const cardioMatch = payload.match(/cardioBlock\s*:\s*\{([^}]*)\}/);
  if (cardioMatch) {
    const body = cardioMatch[1];
    if (/\boutcome\b/.test(body) && !/domainOutcome/.test(body)) {
      failures.push("cardioBlock contains legacy 'outcome'");
    }
    if (/\bscheduleStability\b/.test(body)) {
      failures.push("cardioBlock contains 'scheduleStability'");
    }
  }
  const liftMatch = payload.match(/liftBlock\s*:\s*\{([^}]*)\}/);
  if (liftMatch) {
    const body = liftMatch[1];
    if (/\boutcome\b/.test(body) && !/domainOutcome/.test(body)) {
      failures.push("liftBlock contains legacy 'outcome'");
    }
    if (/\bscheduleStability\b/.test(body)) {
      failures.push("liftBlock contains 'scheduleStability'");
    }
  }
} else {
  console.error("FAIL: No res.json or buildReadinessResponse found in /api/readiness handler");
  process.exit(1);
}

if (/\bscheduleStability\s*:/.test(readinessSection) && !/recoveryShapeChecks/.test(readinessSection.split("scheduleStability")[0].slice(-200))) {
  const lines = readinessSection.split("\n");
  for (const line of lines) {
    if (/\bscheduleStability\s*:/.test(line) && !/const\s+[cl]s\s*=/.test(line) && !/recoveryShapeChecks/.test(line) && !/buildReadinessResponse/.test(line)) {
      if (/res\.json|readinessPayload|return\s*\{/.test(line)) {
        failures.push("scheduleStability appears in response assembly: " + line.trim());
      }
    }
  }
}

if (failures.length > 0) {
  console.error("FAIL: guard-no-legacy-readiness");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}

console.log("PASS: guard-no-legacy-readiness — no legacy fields in main readiness payload");
