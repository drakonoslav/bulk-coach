# FITBIT_DATAFLOW.md — Complete Dataflow Map

Generated from source code tracing, not assertions.

---

## 1. Importer Outputs

### Source: `server/fitbit-takeout.ts` → `importFitbitTakeout()` (line 776)

Entry point: `POST /api/fitbit/takeout/finalize` in `server/routes.ts` → calls `importFitbitTakeout()` in a background job.

#### 1.1 Metrics Imported

| Metric | CSV Parser Function (line) | CSV File Patterns | JSON Parser Function (line) | JSON File Patterns |
|---|---|---|---|---|
| Steps | `parseStepsCSV` (340) | `steps_*.csv` | `parseStepsJSON` (587) | `steps-*.json` |
| Calories | `parseCaloriesCSV` (368) | `calories_*.csv` | `parseCaloriesJSON` (625) | `calories-*.json` |
| Active Minutes | `parseActiveMinutesCSV` (396) | `active_minutes_*.csv` | — | — |
| HR Zones (time) | `parseTimeInZoneCSV` (431) | `time_in_heart_rate_zone_*.csv` | `parseHeartRateZonesJSON` (663) | `time_in_heart_rate_zones-*.json` |
| Calories in Zone | `parseCaloriesInZoneCSV` (468) | `calories_in_heart_rate_zone_*.csv` | — | — |
| Resting HR | `parseDailyRestingHrCSV` (485) | `daily_resting_heart_rate.csv` | `parseRestingHrJSON` (700) | `resting_heart_rate-*.json` |
| Sleep (main) | `parseUserSleepsCSV` (509) | `UserSleeps_*.csv` | `parseSleepJSON` (730) | `sleep-*.json` |
| Sleep Score | `parseSleepScoreCSV` (554) | `sleep_score.csv` | — | — |
| HRV | — | — | — | — |

**HRV**: No Fitbit parser exists. The `hrv` column in `DayBucket` (line 49) is defined but never populated by any parser. It is always `null` from Fitbit import. HRV can only be set via manual daily log entry (`POST /api/logs/upsert`).

#### 1.2 Date Bucketing Rules

| Metric | Bucketing Rule | Function |
|---|---|---|
| Steps, Calories, Active Minutes, Zones, Resting HR | ISO date extraction: `YYYY-MM-DD` from timestamp column | `extractDateFromISO()` (line 217) |
| Sleep (CSV) | **Wake-date rule**: `sleep_end` (UTC) + `end_utc_offset` → local datetime → `DATE(local)` = bucket_date | `parseUTCTimestampToLocalDate()` (line 240) called from `parseUserSleepsCSV()` (line 526) |
| Sleep (JSON) | **Wake-date rule**: `endTime` field → parsed as local date | `parseFitbitEndTimeToWakeDate()` (line 232) called from `parseSleepJSON()` (line 743) |
| Sleep (JSON fallback) | If no `endTime`, uses `dateOfSleep` field directly | `parseSleepJSON()` (line 745-746) |

**Sleep Day Assignment Example (wake-date rule)**:
- Sleep session: start 2026-02-09 23:30, end 2026-02-10 07:15 (EST, offset -05:00)
- `sleep_end` UTC = `2026-02-10 12:15:00`
- Apply offset -05:00 → local = `2026-02-10 07:15:00`
- `DATE(local)` = `2026-02-10` → bucket_date = `2026-02-10`
- Multiple sleep segments on the same wake-date are **summed** (`b.sleepMinutes = (b.sleepMinutes || 0) + mins`, line 536/767)

**Timezone**: Configurable via `timezone` parameter on import (default `"America/New_York"`, line 779). Stored in `fitbit_takeout_imports.timezone`. Used only for sleep JSON fallback; CSV sleep uses explicit `end_utc_offset` column.

#### 1.3 Destination Tables/Columns

**Primary: `daily_log`** — upsert at lines 1007-1041

| DayBucket Field | daily_log Column | COALESCE Behavior (default mode) |
|---|---|---|
| `steps` | `steps` | `COALESCE($2, daily_log.steps)` — Fitbit fills only if no manual entry |
| `cardioMin` | `cardio_min` | `COALESCE($3, daily_log.cardio_min)` |
| `activeZoneMinutes` | `active_zone_minutes` | `COALESCE($4, daily_log.active_zone_minutes)` |
| `sleepMinutes` | `sleep_minutes` | `COALESCE($5, daily_log.sleep_minutes)` |
| `energyBurnedKcal` | `energy_burned_kcal` | `COALESCE($6, daily_log.energy_burned_kcal)` |
| `restingHr` | `resting_hr` | `COALESCE($7, daily_log.resting_hr)` |
| `hrv` | `hrv` | `COALESCE($8, daily_log.hrv)` — always null from Fitbit |
| `zone1Min` | `zone1_min` | `COALESCE($9, daily_log.zone1_min)` |
| `zone2Min` | `zone2_min` | `COALESCE($10, daily_log.zone2_min)` |
| `zone3Min` | `zone3_min` | `COALESCE($11, daily_log.zone3_min)` |
| `belowZone1Min` | `below_zone1_min` | `COALESCE($12, daily_log.below_zone1_min)` |

**NOT populated from Fitbit** (only from manual daily log `POST /api/logs/upsert`):
- `sleep_start`, `sleep_end` — never written by importer
- `morning_weight_lb`, `evening_weight_lb`, `waist_in`
- `bf_morning_*`, `bf_evening_*`
- `sleep_quality`, `water_liters`, `lift_done`, `deload_week`
- `adherence`, `performance_note`, `notes`

**Audit Tables**:

| Table | Purpose | Written at |
|---|---|---|
| `fitbit_takeout_imports` | Import-level metadata (sha256, date range, timezone, root prefix) | Line 1054 |
| `fitbit_daily_sources` | Per-date, per-metric source attribution (csv/json/both, file path, row count, value) | `persistDiagnosticsToDB()` line 1109 |
| `fitbit_sleep_bucketing` | Per-sleep-segment bucketing detail (sleep_end_raw, sleep_end_local, bucket_date, minutes) | Line 1129 |
| `fitbit_import_conflicts` | CSV vs JSON conflict records with chosen resolution | Line 1148 |
| `fitbit_import_file_contributions` | Per-file contribution summary | Line 1138 |

#### 1.4 Conflict Resolution

**Rule**: CSV is always preferred over JSON. Implemented per-metric.

**Mechanism** (example for steps, line 611-614):
1. CSV files are parsed first (lines 859-901), building `csvStepsDays` set
2. JSON files are parsed second (lines 906-927)
3. Each JSON parser checks `if (csvDays.has(date))` before writing
4. If CSV already has data for that date: conflict is logged, JSON value is **skipped**
5. Conflict record includes both values and `resolution: "csv_preferred"`

Same pattern for: calories (line 649), zones (line 678), restingHr (line 717), sleep (line 762)

---

## 2. DB → Computations

### 2.1 Readiness Score

**File**: `server/readiness-engine.ts` → `computeReadiness()` (line 149)

**Input columns**:

| Input | Source Table.Column | Query (line) |
|---|---|---|
| `hrv` | `daily_log.hrv` | Line 155: `SELECT day, hrv, resting_hr, sleep_minutes FROM daily_log WHERE day BETWEEN $1 AND $2` |
| `resting_hr` | `daily_log.resting_hr` | Same query |
| `sleep_minutes` | `daily_log.sleep_minutes` | Same query |
| `proxy_score` | `androgen_proxy_daily.proxy_score` | Line 163: `WHERE computed_with_imputed = FALSE` |

**Formula** (lines 223-232):
```
HRV_score    = scoreFromDelta(hrvDelta, fullSwing=0.10, invert=false)
RHR_score    = scoreFromDelta(rhrDelta, fullSwing=0.05, invert=true)     // inverted: higher RHR = lower score
Sleep_score  = scoreFromDelta(sleepDelta, fullSwing=0.10, invert=false)
Proxy_score  = scoreFromDelta(proxyDelta, fullSwing=0.10, invert=false)

readiness_raw = 0.30 * HRV_score + 0.20 * RHR_score + 0.20 * Sleep_score + 0.20 * Proxy_score
```

Note: Weights sum to 0.90, not 1.0. The missing 0.10 is effectively zero-weighted (no 5th signal).

**`scoreFromDelta()` function** (line 25-29):
```
delta = (7d_mean - 28d_mean) / 28d_mean     // computeDeltas() line 20
scaled = clamp(delta / fullSwing, -1, 1)
base = 50 + 50 * scaled                      // centers at 50, range [0, 100]
if invert: return 100 - base                  // for RHR where higher = worse
if delta is null: return 50                   // neutral fallback
```

**Confidence dampener** (lines 248-261):
```
Grading based on erection_sessions in last 7 days:
  High:  measured_sessions >= 5 AND measured_proxy_nights >= 4  → multiplier 1.0
  Med:   measured_sessions >= 3 AND measured_proxy_nights >= 2  → multiplier 0.9
  Low:   measured_sessions >= 1 OR measured_proxy_nights >= 1   → multiplier 0.75
  None:  otherwise                                              → multiplier 0.6

readiness = clamp(readiness_raw * confidence_multiplier, 0, 100)
```

**Time windows** (lines 206-207):
```
last7  = arr.slice(max(0, len - 7))    // 7-day rolling
last28 = arr.slice(max(0, len - 28))   // 28-day rolling (baseline)
```

Data is pulled from `max(analysisStartDate, date - 34d)` through `date` (line 152).

**Analysis window**: `app_settings` table, key `analysis_start_date` (default: today - 60 days). Set by `getAnalysisStartDate()` line 65. Data before this date is excluded.

**Tiers** (lines 309-316):
```
GREEN:  readiness >= 75
YELLOW: readiness >= 60 AND < 75
BLUE:   readiness < 60
```

**Persistence**: `readiness_daily` table via `persistReadiness()` (line 384).

### 2.2 Dual Sliders

**File**: `server/readiness-engine.ts` lines 318-326

```
type_lean    = clamp((readiness - 60) / 20, -1, 1)
exercise_bias = clamp((readiness - 65) / 20, -1, 1)

If cortisolFlag: exercise_bias = min(exercise_bias, 0)
```

### 2.3 Cortisol Suppression Flag

**File**: `server/readiness-engine.ts` lines 291-301

**Inputs**: All four signal deltas (7d vs 28d percentage change):

| Signal | Threshold | Meaning |
|---|---|---|
| HRV delta | <= -0.08 (8% drop) | HRV suppressed |
| RHR delta | >= +0.03 (3% rise) | RHR elevated |
| Sleep delta | <= -0.10 (10% drop) | Sleep low |
| Proxy delta | <= -0.10 (10% drop) | Proxy low |

**Trigger**: `confidenceGrade !== "None" AND flagCount >= 3` (3+ signals degraded)

**Effect**: Caps readiness at 74, forces `exercise_bias <= 0`

**Gating**: Only fires if confidence is NOT "None" (i.e., requires at least some erection data to exist).

### 2.4 Signal Breakdown (Deltas)

**File**: `server/readiness-deltas.ts` → `computeReadinessDeltas()` (line 70)

| Signal | Computation | Clamping | Display Format |
|---|---|---|---|
| Sleep | `pctDelta(sleep7d, sleep28d)` = `(7d - 28d) / 28d * 100` | [-50%, +50%] | `"+5%"` / `"-3%"` |
| HRV | `pctDelta(hrv7d, hrv28d)` | [-50%, +50%] | `"+8%"` / `"-12%"` |
| RHR | `absDelta(rhr7d, rhr28d)` = `7d - 28d` (absolute bpm) | [-20, +20] bpm | `"+2 bpm"` / `"-1 bpm"` |
| Proxy | `pctDelta(proxy7d, proxy28d)` | [-80%, +80%] | `"+15%"` / `"-22%"` |

Called from `computeReadiness()` at line 339.

### 2.5 Data Sufficiency

**File**: `server/readiness-engine.ts` → `getDataSufficiency()` (line 98)

**Input**: Counts from `daily_log` and `androgen_proxy_daily` within analysis window.

| Gate | Threshold | Label if not met |
|---|---|---|
| gate7 | daysWithData >= 7 | "Need N more days for basic trends" |
| gate14 | daysWithData >= 14 | "Need N more days for rolling averages" |
| gate30 | daysWithData >= 30 | "Need N more days for full baselines" |

**Per-signal counts** (lines 107-118):
- `hrv`: `COUNT(*) FILTER (WHERE hrv IS NOT NULL)`
- `rhr`: `COUNT(*) FILTER (WHERE resting_hr IS NOT NULL)`
- `sleep`: `COUNT(*) FILTER (WHERE sleep_minutes IS NOT NULL)`
- `steps`: `COUNT(*) FILTER (WHERE steps IS NOT NULL)`
- `proxy`: `COUNT(*) FROM androgen_proxy_daily WHERE computed_with_imputed = FALSE`

### 2.6 Cardio Fuel Guardrail

**File**: `lib/coaching-engine.ts` → `cardioFuelNote()` (line 264)

**Input**: `cardioMin` from daily log entry (which can come from Fitbit `cardio_min` or manual entry)

**Rule**:
```
if (cardioMin > baseline.cardioFuel.thresholdMin)    // thresholdMin = 45
  add = thresholdMin - baseline.cardioFuel.thresholdMin + carbsPerExtraMin * extra
  → suggest "+Ng carbs: dextrin preferred"
```

### 2.7 Weekly Coaching / Calorie Adjustment

**File**: `lib/coaching-engine.ts` → `analyzeWeek()` and `diagnoseDrivers()`

**Inputs from daily_log**: `morning_weight_lb`, `waist_in`, `adherence`, `cardio_min`, `sleep_minutes`, `deload_week`, `performance_note`, `bf_morning_pct`, `bf_evening_pct`

Not directly Fitbit-dependent except through `sleep_minutes`, `steps`, `cardio_min` which Fitbit can populate.

---

## 3. UI Mapping

### 3.1 Report Tab (`app/(tabs)/report.tsx`)

| UI Element | API Endpoint | Key Fields Used | Origin |
|---|---|---|---|
| Readiness Card (score, tier, sliders) | `GET /api/readiness?date=YYYY-MM-DD` | `readinessScore`, `readinessTier`, `typeLean`, `exerciseBias`, `cortisolFlag`, `confidenceGrade`, `drivers`, `gate`, `daysInWindow` | `computeReadiness()` |
| Signal Breakdown strip | Same endpoint | `deltas.sleep_str`, `deltas.hrv_str`, `deltas.rhr_str`, `deltas.proxy_str`, `deltas.sleep_pct`, `deltas.hrv_pct`, `deltas.rhr_bpm`, `deltas.proxy_pct` | `computeReadinessDeltas()` |
| Readiness Trend Chart | `GET /api/readiness/range?from=&to=` | `[{date, readinessScore, readinessTier}]` | `getReadinessRange()` → `readiness_daily` table |
| Sufficiency strip | `GET /api/data-sufficiency` | `gate7`, `gate14`, `gate30`, `gateLabel`, `signals.*` | `getDataSufficiency()` |

### 3.2 Plan Tab (`app/(tabs)/checklist.tsx`)

| UI Element | API Endpoint | Key Fields Used | Origin |
|---|---|---|---|
| Training Readiness Card | `GET /api/readiness?date=YYYY-MM-DD` | Same as Report + `drivers[]`, `cortisolFlag` | `computeReadiness()` |
| Analysis Window card | `GET /api/data-sufficiency` | `analysisStartDate`, `daysWithData`, `totalDaysInRange`, `gate*`, `signals.*` | `getDataSufficiency()` |
| Training Template (exercises) | `GET /api/training/template` | `sessions[]` with per-tier exercise labels | `getTrainingTemplate()` |

### 3.3 Log Tab (`app/(tabs)/log.tsx`)

| UI Element | API Endpoint | Key Fields Used | Origin |
|---|---|---|---|
| Readiness Badge | `GET /api/readiness?date=YYYY-MM-DD` | `readinessScore`, `readinessTier` | `getReadiness()` → `readiness_daily` |

### 3.4 Vitals Tab

Proxy-related UI (not directly Fitbit):
- `GET /api/erection/proxy` → androgen proxy chart
- `GET /api/erection/confidence` → confidence strips

---

## 4. Field Dependency Table

### 4.1 Fitbit-Populated Fields — Full Chain

| Fitbit Source Field | daily_log Column | Used By Computation | Used By UI |
|---|---|---|---|
| `minutesAsleep` (CSV/JSON) | `sleep_minutes` | readiness sleep delta (7d vs 28d) → readiness score (20% weight) + cortisol flag (sleep_low threshold -10%) | Report: signal breakdown sleep row, readiness score, cortisol banner. Plan: readiness card, signal breakdown. Log: readiness badge |
| `beats per minute` / RHR (CSV/JSON) | `resting_hr` | readiness RHR delta (7d vs 28d, inverted) → readiness score (20% weight) + cortisol flag (rhr_elevated threshold +3%) | Report: signal breakdown RHR row, readiness score. Plan: readiness card. Log: readiness badge |
| `steps` / step count (CSV/JSON) | `steps` | data sufficiency signal count only (not in readiness formula) | Plan: Analysis Window signal breakdown (count only). Dashboard: stat display |
| `calories` / kcal (CSV/JSON) | `energy_burned_kcal` | **NOT USED** by any computation | **NOT USED** by any UI element currently |
| `moderate + very` active minutes | `active_zone_minutes` | **NOT USED** directly by readiness. Used implicitly via `cardio_min` for cardio fuel guardrail | Plan: checklist context |
| `moderate + very` from active_minutes CSV | `cardio_min` | cardio fuel guardrail (>45min → +carbs suggestion) | Coaching: weekly report cardio fuel note |
| HR zone times (zone1/2/3/below) | `zone1_min`, `zone2_min`, `zone3_min`, `below_zone1_min` | **NOT USED** by any computation | **NOT USED** by any UI element currently |
| HRV (not parsed) | `hrv` | readiness HRV delta (30% weight) — but always null from Fitbit, so defaults to score 50 (neutral) | Report: signal breakdown HRV row shows "—" |

### 4.2 Non-Fitbit Fields Used By Readiness

| Source | daily_log Column | Computation |
|---|---|---|
| Erection snapshot uploads | `androgen_proxy_daily.proxy_score` | readiness proxy delta (20% weight), cortisol flag |
| Manual daily log | `hrv` | readiness HRV delta (30% weight) |

### 4.3 Fields Fitbit Imports But Are NOT Used Downstream

| daily_log Column | Populated By | Status |
|---|---|---|
| `energy_burned_kcal` | Fitbit calories CSV/JSON | **UNUSED** — no computation or UI reads this |
| `zone1_min` | Fitbit time-in-zone CSV/JSON | **UNUSED** — stored but not displayed or computed |
| `zone2_min` | Same | **UNUSED** |
| `zone3_min` | Same | **UNUSED** |
| `below_zone1_min` | Same | **UNUSED** |
| `active_zone_minutes` | Fitbit active minutes CSV | **UNUSED** — only `cardio_min` feeds guardrail |

### 4.4 daily_log Columns NOT Populated By Fitbit

| Column | Source | Impact |
|---|---|---|
| `sleep_start` | Manual log only | Not used by readiness (readiness uses `sleep_minutes` only) |
| `sleep_end` | Manual log only | Not used by readiness |
| `hrv` | Manual log only | readiness HRV delta (30% weight) — without manual entry, defaults to neutral 50 |
| `morning_weight_lb` | Manual log only | Weekly coaching weight trend |
| `waist_in` | Manual log only | Weekly coaching |
| `bf_morning_*`, `bf_evening_*` | Manual log only | Body composition tracking |

---

## 5. Explicit Answers

### 5.1 Sleep start/end

**Q: Does Fitbit import populate `daily_log.sleep_start` and `daily_log.sleep_end`?**

**A: No.** The importer's upsert SQL (lines 1009-1040) writes these columns: `steps, cardio_min, active_zone_minutes, sleep_minutes, energy_burned_kcal, resting_hr, hrv, zone1_min, zone2_min, zone3_min, below_zone1_min`. Neither `sleep_start` nor `sleep_end` appear in the INSERT or UPDATE clause.

The wake time IS stored in `fitbit_sleep_bucketing.sleep_end_raw` and `sleep_end_local`, and `sleep_start` could be derived as `wake_time - minutes_asleep`. But this derivation is not implemented.

**Q: Does readiness use `sleep_start`/`sleep_end`?**

**A: No.** The readiness query (line 155) is:
```sql
SELECT day, hrv, resting_hr, sleep_minutes FROM daily_log
```
It reads only `sleep_minutes`. The `sleep_start` and `sleep_end` columns are not referenced anywhere in `readiness-engine.ts`.

### 5.2 Timezone Correctness

**Q: What timezone is used for parsing?**

**A:** The `timezone` parameter (default `"America/New_York"`, line 779) is passed to `importFitbitTakeout()`. However, it is only used for JSON sleep parsing as a fallback in `parseFitbitEndTimeToWakeDate()` (line 232). CSV sleep uses the explicit `end_utc_offset` column from the CSV itself via `parseUTCTimestampToLocalDate()` (line 240).

**Q: How is off-by-one prevented for midnight-crossing sleep?**

**A:** The wake-date rule. Sleep is bucketed to the date the user **woke up**, not the date they fell asleep. `parseUTCTimestampToLocalDate()` (line 240-254) converts `sleep_end` UTC + offset to local datetime, then takes `DATE(local)`.

Example:
- Sleep: 2026-02-09 23:30 → wake 2026-02-10 07:15 (EST -05:00)
- `sleep_end` UTC = `2026-02-10 12:15:00`, offset = `-05:00`
- Local = `2026-02-10 07:15:00` → bucket_date = `2026-02-10`
- This is D (the day you woke up), not D-1 (when you fell asleep)

### 5.3 Readiness Inputs Confirmation

**Confirmed.** `computeReadiness()` (line 149) reads:
1. `daily_log.hrv` → HRV signal (30% weight)
2. `daily_log.resting_hr` → RHR signal (20% weight, inverted)
3. `daily_log.sleep_minutes` → Sleep signal (20% weight)
4. `androgen_proxy_daily.proxy_score` → Proxy signal (20% weight)

Normalization: `scoreFromDelta(delta, fullSwing, invert)`:
- `delta = (mean_7d - mean_28d) / mean_28d` (fractional change)
- `scaled = clamp(delta / fullSwing, -1, 1)` where fullSwing = 0.10 for HRV/Sleep/Proxy, 0.05 for RHR
- `score = 50 + 50 * scaled` (range 0-100, centered at 50)
- For RHR (inverted): `score = 100 - (50 + 50 * scaled)`

### 5.4 Cortisol Suppression Flag

**Confirmed.**

Signals used (all four): HRV delta, RHR delta, Sleep delta, Proxy delta

Thresholds:
- HRV: `delta <= -0.08` (8% drop vs baseline)
- RHR: `delta >= +0.03` (3% rise vs baseline)
- Sleep: `delta <= -0.10` (10% drop vs baseline)
- Proxy: `delta <= -0.10` (10% drop vs baseline)

Trigger: `confidenceGrade !== "None" AND 3+ of 4 signals are degraded`

**Gating**: Requires confidence ≠ None. If no erection data exists at all (confidence = None), cortisol flag cannot fire regardless of signal status.

---

## 6. Recompute Trigger Chain

After import completes (`importFitbitTakeout()` line 1048-1051):
1. `recomputeRangeSpan(minDate, maxDate)` → line 1158
2. Inside that: `recomputeRange(dayStr)` every 7 days across imported range (erection engine recompute)
3. Then: `recomputeReadinessRange(minDay)` → `server/readiness-engine.ts` line 423
4. Inside that: For each day in `[targetDate - 7d, targetDate + 1d]`, calls `computeReadiness(day)` → `persistReadiness(result)`

---

## 7. API Route Map

| Endpoint | Method | File:Line | Handler |
|---|---|---|---|
| `/api/readiness` | GET | `routes.ts` (search for endpoint) | `getReadiness(date)` or `computeReadiness(date)` |
| `/api/readiness/range` | GET | `routes.ts` | `getReadinessRange(from, to)` |
| `/api/data-sufficiency` | GET | `routes.ts` | `getDataSufficiency()` |
| `/api/training/template` | GET | `routes.ts` | `getTrainingTemplate()` |
| `/api/logs/upsert` | POST | `routes.ts:50` | Direct SQL upsert to `daily_log` |
| `/api/fitbit/takeout/finalize` | POST | `routes.ts` | Background job → `importFitbitTakeout()` |
| `/api/fitbit/diagnostics/:date` | GET | `routes.ts` | `getDiagnosticsFromDB(date)` |
