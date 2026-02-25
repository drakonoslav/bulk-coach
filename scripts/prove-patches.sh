#!/bin/bash
set -e

echo "=== PROOF 1: .toFixed() grep in app/ components/ ==="
grep -rn "\.toFixed(" app/ components/ --include="*.tsx" --include="*.ts" 2>/dev/null && { echo "FAIL"; exit 1; } || echo "OK"

echo ""
echo "=== PROOF 2: scheduledToday = true grep in server/ ==="
grep -rn "scheduledToday = true" server/ --include="*.ts" 2>/dev/null | grep -v __tests__ | grep -v ".test." && { echo "FAIL"; exit 1; } || echo "OK"

echo ""
echo "=== PROOF 3: ls -la server/schedule ==="
ls -la server/schedule

echo ""
echo "=== PROOF 4: ls -la server/cardio ==="
ls -la server/cardio

echo ""
echo "=== PROOF 5: ls -la lib/__tests__ ==="
ls -la lib/__tests__

echo ""
echo "=== PROOF 6: npm test (jest) ==="
npx jest --forceExit --detectOpenHandles --testPathPatterns="deriveScheduledToday|computeCardioContinuity|recoveryNoEvent" 2>&1

echo ""
echo "=== PROOF 7: guard:ui ==="
node scripts/guard-no-tofixed-ui.js

echo ""
echo "=== PROOF 8: guard:scheduled ==="
node scripts/guard-no-hardcode-scheduledToday.js

echo ""
echo "=== ALL PROOFS COMPLETE ==="
