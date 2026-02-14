#!/bin/bash
set -e

BASE="http://localhost:5000"
PASS=0
FAIL=0
SESSION_ID="fixture_phase2_$(date +%s)"

check() {
  local desc="$1"
  local actual="$2"
  local expected="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc"
    echo "    expected to contain: $expected"
    echo "    got: $actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Phase 2 Endpoint Fixture Tests ==="
echo ""

echo "1. Sleep upsert"
R=$(curl -s -X POST "$BASE/api/canonical/sleep/upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "date":"2026-02-12",
    "sleep_start":"2026-02-12T22:30:00Z",
    "sleep_end":"2026-02-13T06:15:00Z",
    "total_sleep_minutes":420,
    "rem_minutes":90,
    "deep_minutes":75,
    "light_or_core_minutes":255,
    "awake_minutes":15,
    "sleep_efficiency":93.3,
    "source":"apple_health",
    "timezone":"America/Los_Angeles"
  }')
check "returns ok" "$R" '"ok":true'
check "returns date" "$R" '"date":"2026-02-12"'
check "returns updated_at" "$R" '"updated_at"'

echo ""
echo "2. Sleep upsert (idempotent re-upsert)"
R2=$(curl -s -X POST "$BASE/api/canonical/sleep/upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "date":"2026-02-12",
    "sleep_start":"2026-02-12T22:30:00Z",
    "sleep_end":"2026-02-13T06:15:00Z",
    "total_sleep_minutes":420,
    "rem_minutes":90,
    "deep_minutes":75,
    "light_or_core_minutes":255,
    "source":"apple_health",
    "timezone":"America/Los_Angeles"
  }')
check "idempotent ok" "$R2" '"ok":true'

echo ""
echo "3. Sleep upsert (validation)"
R3=$(curl -s -X POST "$BASE/api/canonical/sleep/upsert" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-02-12","source":"apple_health"}')
check "rejects missing total_sleep_minutes" "$R3" '"error"'

echo ""
echo "4. Vitals upsert"
R=$(curl -s -X POST "$BASE/api/canonical/vitals/upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "date":"2026-02-12",
    "resting_hr":62,
    "hrv_sdnn_ms":45.2,
    "hrv_rmssd_ms":38.5,
    "spo2":97.5,
    "respiratory_rate":15.2,
    "steps":8500,
    "active_energy_kcal":350,
    "source":"apple_health",
    "timezone":"America/Los_Angeles"
  }')
check "returns ok" "$R" '"ok":true'
check "returns date" "$R" '"date":"2026-02-12"'

echo ""
echo "5. Vitals upsert (validation)"
R=$(curl -s -X POST "$BASE/api/canonical/vitals/upsert" \
  -H "Content-Type: application/json" \
  -d '{"resting_hr":62}')
check "rejects missing date+source" "$R" '"error"'

echo ""
echo "6. Workout session upsert"
R=$(curl -s -X POST "$BASE/api/canonical/workouts/upsert-session" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\":\"$SESSION_ID\",
    \"date\":\"2026-02-12\",
    \"start_ts\":\"2026-02-12T07:00:00Z\",
    \"end_ts\":\"2026-02-12T08:15:00Z\",
    \"workout_type\":\"strength\",
    \"calories_burned\":450,
    \"source\":\"apple_health\",
    \"timezone\":\"America/Los_Angeles\"
  }")
check "returns ok" "$R" '"ok":true'
check "returns session_id" "$R" "\"session_id\":\"$SESSION_ID\""

echo ""
echo "7. Workout session upsert (validation)"
R=$(curl -s -X POST "$BASE/api/canonical/workouts/upsert-session" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"x"}')
check "rejects missing fields" "$R" '"error"'

echo ""
echo "8. HR samples bulk upsert"
R=$(curl -s -X POST "$BASE/api/canonical/workouts/hr-samples/upsert-bulk" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\":\"$SESSION_ID\",
    \"source\":\"apple_health\",
    \"samples\":[
      {\"ts\":\"2026-02-12T06:55:00Z\",\"hr_bpm\":68},
      {\"ts\":\"2026-02-12T06:56:00Z\",\"hr_bpm\":70},
      {\"ts\":\"2026-02-12T06:57:00Z\",\"hr_bpm\":69},
      {\"ts\":\"2026-02-12T06:58:00Z\",\"hr_bpm\":71},
      {\"ts\":\"2026-02-12T06:59:00Z\",\"hr_bpm\":67},
      {\"ts\":\"2026-02-12T07:00:00Z\",\"hr_bpm\":72},
      {\"ts\":\"2026-02-12T07:05:00Z\",\"hr_bpm\":110},
      {\"ts\":\"2026-02-12T07:10:00Z\",\"hr_bpm\":135},
      {\"ts\":\"2026-02-12T07:15:00Z\",\"hr_bpm\":145},
      {\"ts\":\"2026-02-12T07:30:00Z\",\"hr_bpm\":150},
      {\"ts\":\"2026-02-12T07:45:00Z\",\"hr_bpm\":148},
      {\"ts\":\"2026-02-12T08:00:00Z\",\"hr_bpm\":140},
      {\"ts\":\"2026-02-12T08:15:00Z\",\"hr_bpm\":130},
      {\"ts\":\"2026-02-12T08:20:00Z\",\"hr_bpm\":100},
      {\"ts\":\"2026-02-12T08:25:00Z\",\"hr_bpm\":85},
      {\"ts\":\"2026-02-12T08:30:00Z\",\"hr_bpm\":78}
    ]
  }")
check "returns ok" "$R" '"ok":true'
check "returns session_id" "$R" "\"session_id\":\"$SESSION_ID\""
check "inserted 16 samples" "$R" '"inserted_or_updated":16'

echo ""
echo "9. HR samples bulk upsert (validation)"
R=$(curl -s -X POST "$BASE/api/canonical/workouts/hr-samples/upsert-bulk" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"x"}')
check "rejects missing samples array" "$R" '"error"'

echo ""
echo "10. RR intervals bulk upsert"
R=$(curl -s -X POST "$BASE/api/canonical/workouts/rr-intervals/upsert-bulk" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\":\"$SESSION_ID\",
    \"source\":\"apple_health\",
    \"intervals\":[
      {\"ts\":\"2026-02-12T06:55:00Z\",\"rr_ms\":882},
      {\"ts\":\"2026-02-12T06:55:01Z\",\"rr_ms\":857},
      {\"ts\":\"2026-02-12T06:55:02Z\",\"rr_ms\":870},
      {\"ts\":\"2026-02-12T06:56:00Z\",\"rr_ms\":861},
      {\"ts\":\"2026-02-12T06:57:00Z\",\"rr_ms\":875},
      {\"ts\":\"2026-02-12T07:05:00Z\",\"rr_ms\":545},
      {\"ts\":\"2026-02-12T07:05:01Z\",\"rr_ms\":530},
      {\"ts\":\"2026-02-12T07:10:00Z\",\"rr_ms\":444},
      {\"ts\":\"2026-02-12T07:15:00Z\",\"rr_ms\":414},
      {\"ts\":\"2026-02-12T07:30:00Z\",\"rr_ms\":400},
      {\"ts\":\"2026-02-12T08:20:00Z\",\"rr_ms\":600},
      {\"ts\":\"2026-02-12T08:25:00Z\",\"rr_ms\":706},
      {\"ts\":\"2026-02-12T08:30:00Z\",\"rr_ms\":769}
    ]
  }")
check "returns ok" "$R" '"ok":true'
check "inserted 13 intervals" "$R" '"inserted_or_updated":13'

echo ""
echo "11. RR intervals bulk upsert (validation)"
R=$(curl -s -X POST "$BASE/api/canonical/workouts/rr-intervals/upsert-bulk" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"x","source":"polar"}')
check "rejects missing intervals array" "$R" '"error"'

echo ""
echo "12. Analyze HRV (existing session)"
R=$(curl -s -X POST "$BASE/api/canonical/workouts/$SESSION_ID/analyze-hrv" \
  -H "Content-Type: application/json" \
  -d '{}')
check "returns ok" "$R" '"ok":true'
check "returns session_id" "$R" "\"session_id\":\"$SESSION_ID\""
check "has hrv_response_flag" "$R" '"hrv_response_flag"'

echo ""
echo "13. Read-back: GET canonical sleep"
R=$(curl -s "$BASE/api/canonical/sleep?start=2026-02-12&end=2026-02-12")
check "sleep returns data" "$R" '2026-02-12'
check "sleep source is apple_health" "$R" '"source":"apple_health"'

echo ""
echo "14. Read-back: GET canonical vitals"
R=$(curl -s "$BASE/api/canonical/vitals?start=2026-02-12&end=2026-02-12")
check "vitals returns data" "$R" '2026-02-12'
check "vitals has steps" "$R" '"steps":8500'

echo ""
echo "15. Read-back: GET canonical workouts"
R=$(curl -s "$BASE/api/canonical/workouts?start=2026-02-12&end=2026-02-12")
check "workouts returns data" "$R" "\"session_id\":\"$SESSION_ID\""

echo ""
echo "16. Read-back: GET HR samples"
R=$(curl -s "$BASE/api/canonical/workouts/$SESSION_ID/hr")
check "hr samples returned" "$R" '"hr_bpm"'

echo ""
echo "17. Read-back: GET RR intervals"
R=$(curl -s "$BASE/api/canonical/workouts/$SESSION_ID/rr")
check "rr intervals returned" "$R" '"rr_ms"'

echo ""
echo "18. Polar source test (sleep upsert)"
R=$(curl -s -X POST "$BASE/api/canonical/sleep/upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "date":"2026-02-11",
    "sleep_start":"2026-02-11T23:00:00Z",
    "sleep_end":"2026-02-12T07:00:00Z",
    "total_sleep_minutes":440,
    "deep_minutes":80,
    "rem_minutes":100,
    "source":"polar",
    "timezone":"Europe/Helsinki"
  }')
check "polar sleep ok" "$R" '"ok":true'

echo ""
echo "19. Data sources check"
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/data-sources" 2>/dev/null)
if [ "$R" = "200" ]; then
  R2=$(curl -s "$BASE/api/data-sources")
  check "data sources ok" "$R2" 'Apple Health'
else
  echo "  SKIP: /api/data-sources endpoint not found (ok for Phase 2)"
fi

echo ""
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
echo "==========================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
