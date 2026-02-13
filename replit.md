# Bulk Coach - Recomp Monitor App

## Overview
A mobile fitness tracking app built with Expo React Native that implements a feedback-controlled bulk/recomp system. Users log daily metrics (weight, waist, sleep, activity, adherence) and receive weekly coaching recommendations for calorie adjustments based on their locked meal plan.

## Recent Changes
- 2026-02-10: Initial build - Dashboard, Daily Log, Weekly Report screens
- 2026-02-10: Coaching engine with rolling averages, calorie adjustment, ingredient tweaks, diagnosis
- 2026-02-10: v2 features - Daily Checklist tab, Deload Week flag, Cardio Fuel Guardrail
- 2026-02-10: v3 body composition - BF% inputs (3 AM + optional 3 PM readings with auto-averaging), lean mass/fat mass auto-calculation, lean gain ratio (14d), BIA noise detection in diagnosis
- 2026-02-10: v3.1 rolling lean gain ratio - rolling 14-day lean gain ratio series with color-coded trend chart in Report
- 2026-02-11: v4 erection session tracking - Vitals tab with cumulative snapshot uploads, delta computation, gap-fill imputation (linear interpolation), androgen proxy calculation with 7d rolling averages, badges on Log screen, proxy chart on Report tab with imputed toggle
- 2026-02-11: v4.1 data confidence - confidence endpoint with 7d/14d/30d rolling windows, grading (High/Med/Low/None), measured/imputed/multi-night counts; confidence strips on Vitals and Report tabs; snapshot cleanup on invalid delta; measured-only defaults audited
- 2026-02-11: v4.2 chain recompute - when a snapshot N is inserted between existing snapshots, the next snapshot's derived session is re-derived using the new delta, gap-fill is re-run for the range, and proxy scores are recomputed; applies to all paths (baseline, baseline_seed, mid-chain)
- 2026-02-11: v4.2.1 buffered recompute range - recompute uses min(sessionDate, next.sessionDate) - 30d through max + 1d for proper imputed gap re-evaluation and proxy rolling series; server-side future date validation on snapshot upload
- 2026-02-11: v5 backup system - full backup export/import with versioned JSON; merge/replace modes; dry-run preview; schema-safe upserts; recompute-after-restore; Backup & Restore UI in Vitals tab with export (share sheet) and import (document picker with dry-run confirmation)
- 2026-02-11: v6 readiness system - recovery-gated training intensity with readiness score (0-100), three tiers (GREEN/YELLOW/RED), HRV/RHR/sleep/proxy weighted deltas (7d vs 28d baselines), confidence grading, training template system (Push/Pull/Legs with per-tier exercise labels), readiness card on Report+Plan tabs, readiness badge on Log screen, readiness trend chart, auto-recompute triggers on daily log/erection upload/Fitbit import
- 2026-02-11: v7 dual-slider autoregulation - rewrote readiness engine with subscores centered at 50, new signal weights (HRV 30%, RHR 20%, Sleep 20%, Proxy 20%), confidence dampener (High 1.0, Med 0.9, Low 0.75, None 0.6), cortisol suppression flag, dual sliders (type_lean and exercise_bias), new tiers GREEN>=75/YELLOW 60-74/BLUE<60 (replacing RED), Type A+B training splits, frontend updated with slider visualizations and cortisol banner
- 2026-02-11: v8 Fitbit Takeout v2 - comprehensive rewrite of Takeout ZIP importer: dynamic Fitbit root detection (scans ZIP for /Fitbit/ path), CSV monthly shard parsers (steps_*.csv, calories_*.csv, active_minutes_*.csv, time_in_heart_rate_zone_*.csv, calories_in_heart_rate_zone_*.csv), single CSV parsers (daily_resting_heart_rate.csv, sleep_score.csv, UserSleeps_*.csv), JSON daily file parsers (steps-*.json, calories-*.json, time_in_heart_rate_zones-*.json, resting_heart_rate-*.json, sleep-*.json), COALESCE upsert preserving manual entries, daysInserted/daysUpdated tracking, fitbit_root_prefix in audit table, SHA256 deduplicate, range-based recompute
- 2026-02-11: v9 analysis window - analysis_start_date in app_settings (default today-60d), readiness/baselines computed only from recent data, data sufficiency endpoint with 7d/14d/30d gates and per-signal counts, Rebaseline button (resets to last 60d + triggers recompute), Analysis Window card on Plan tab with gate indicators and signal breakdown, sufficiency strip on Report tab
- 2026-02-11: v10 signal breakdown + rule card - readiness-deltas.ts utility (7d vs 28d % deltas for Sleep/HRV/Proxy, absolute bpm delta for RHR, with clamping and formatting), Signal Breakdown card on Report+Plan tabs showing per-signal delta vs baseline + confidence line, Today's Training Rule card (High Neural Day / Moderate / Pump-Technique based on score + confidence), mindset subtitle under readiness score
- 2026-02-11: v11 sleep deviation type - deterministic classification (efficient_on_plan / behavioral_drift / physiological_shortfall / oversleep_spillover) with tolerances (BED_TOL=20, WAKE_TOL=20, SLEEP_TOL=20, OVERSLEEP_TOL=30), formatted deviation lines (bed +Nm / wake −Nm with U+2212 minus, noise floor <3m→0), shortfall line, human labels on Log/Plan/Report tabs; live-computed on Log screen from form values + sleep plan settings; server-side via computeSleepBlock → classifySleepDeviation
- 2026-02-11: v12 shared helpers + flat API - created `lib/sleep-timing.ts` with exact drop-in helpers (noiseFloorMinutes, formatSignedMinutes, sleepAlignmentScore, formatBedWakeDeviation, classifySleepDeviation); flat `sleepAlignment` object in API response (plannedBedTime, plannedWakeTime, observedBedLocal, observedWakeLocal, bedDeviationMin, wakeDeviationMin, alignmentScore, deviationLabel, shortfallMin, classification); removed old nested alignment/deviation structure; updated all UI consumers (Log/Plan/Report) to use sleepAlignment fields; 27 unit tests passing
- 2026-02-13: v14 Fitbit OAuth 2.0 - server-side OAuth endpoints (start, callback, status, disconnect), fitbit_oauth_tokens table, CSRF state validation, token refresh helper, Basic Auth token exchange, env vars FITBIT_CLIENT_ID/FITBIT_CLIENT_SECRET/FITBIT_REDIRECT_URI
- 2026-02-11: v13 meal adjustment guide - read-only presentation layer on Report tab; MEAL_SLOTS mapping (6 meals with ingredient baselines + prep/home zone classification); distributeDeltasToMeals() distributes calorie deltas proportionally across meals containing each ingredient; MealAdjustmentGuide component with summary bar, total adjustments, PREP REQUIRED zone (10:30 mid-morning, 14:45 pre-lift) and AT HOME zone (05:30 pre-cardio, 06:45 post-cardio, 17:10 post-lift, 20:00 evening); per-meal delta + new total display; does not mutate plan state or macros

## Architecture
- **Frontend**: Expo Router with file-based routing, 5-tab layout (Dashboard, Log, Plan, Report, Vitals)
- **Backend**: Express server on port 5000 with Postgres (Neon) via pg pool
- **Storage**: Postgres for all data persistence, AsyncStorage for baseline only
- **Engine**: `lib/coaching-engine.ts` - coaching logic; `server/erection-engine.ts` - snapshot parsing, delta computation, gap-fill imputation, androgen proxy calculation; `server/readiness-engine.ts` - readiness score computation, training template management
- **Backup**: `server/backup.ts` - versioned export/import with merge/replace modes, dry-run, schema migration safety, full recompute after restore
- **Fitbit Takeout**: `server/fitbit-takeout.ts` - Google Takeout ZIP parser with dynamic /Fitbit/ root detection, CSV monthly shard + JSON daily file parsers, COALESCE upsert, SHA256 dedupe, fitbit_root_prefix audit
- **Sleep Alignment**: `server/sleep-alignment.ts` - 3-layer sleep model (schedule adherence, adequacy, efficiency), sleep deviation classification, 7d/28d trending; `lib/sleep-deviation.ts` - client-side deviation classifier for live Log screen computation
- **Data**: `lib/entry-storage.ts` - API-backed CRUD for daily entries
- **Design**: Dark theme with teal primary (#00D4AA), purple accent (#8B5CF6) for vitals, Rubik font family

## Key Features
- Date navigation on Log screen: prev/next day arrows, "Today"/"Yesterday" labels, "Logged" badge, "Jump to Today" chip, edit past entries
- Daily logging: weight, waist, body fat %, sleep, water, steps, cardio, lift, deload week, adherence, notes
- Body fat tracking: 3 AM readings + optional 3 PM readings, auto-averaged per session
- Lean mass/fat mass auto-calculated from weight and BF%
- Lean gain ratio (14d): delta lean mass / delta weight, clamped -1.0 to 2.0
- Dashboard: lean mass trend card (purple #A78BFA), BF% stat card (pink #F472B6), BF% pills on entries
- Report: lean gain analysis section with color-coded ratio gauge, rolling ratio trend chart, and lean mass trend chart
- Daily Checklist (Plan tab): locked shake-time template with all 12 meal/activity anchors
- Training readiness card on Plan tab: score, tier badge, progress bar, dual sliders (type_lean, exercise_bias), cortisol flag, per-split exercise recommendations, signal drivers
- 7-day rolling averages and weight trend visualization
- Weekly calorie adjustment recommendations (+0.25-0.5 lb/week target)
- Ingredient-level adjustment suggestions (MCT first, whey last)
- Diet vs Training diagnosis heuristics with deload week suppression and BIA noise detection
- Cardio fuel guardrail: >45min cardio triggers +25g carb suggestion (dextrin preferred)
- Readiness score: 0-100 composite from HRV (+30%), RHR (-20%), sleep (+20%), proxy (+20%) deltas vs 28d baseline, confidence dampened
- Three training tiers: GREEN (>=75, heavy compounds), YELLOW (60-74, normal hypertrophy), BLUE (<60, deload/pump)
- Dual sliders: type_lean (hypertrophy↔strength) and exercise_bias (isolation↔compound) derived from readiness score
- Cortisol suppression flag: caps readiness at 74 and forces exercise_bias ≤ 0 when 3+ signals degraded
- Readiness badge on Log screen with tier color and score
- Readiness card on Report tab with trend chart (14d), dual sliders, cortisol flag

## Readiness System
- **Weights**: HRV 30%, RHR 20% (inverted), Sleep 20%, Androgen Proxy 20%
- **Baselines**: 7d rolling vs 28d rolling for each signal, subscores centered at 50
- **Tiers**: GREEN >= 75, YELLOW 60-74, BLUE < 60
- **Confidence**: Dampener multiplier (High 1.0, Med 0.9, Low 0.75, None 0.6) applied to raw score
- **Dual Sliders**: type_lean = (readiness - 60) / 20, exercise_bias = (readiness - 65) / 20, both clamped [-1, 1]
- **Cortisol Flag**: Triggers when confidence ≠ None and 3+ signals degraded; caps readiness at 74, forces exercise_bias ≤ 0
- **Training Templates**: Type A (Push/Pull/Legs) and Type B (Arms/Delts/Legs/Torso/Posterior) with per-tier exercise labels
- **Recompute Triggers**: Daily log upsert, erection snapshot upload, Fitbit CSV import
- **DB Tables**: readiness_daily (date, score, tier, confidence, signal values, drivers), training_template (type, sessions JSON), app_settings (key/value for analysis_start_date)
- **Analysis Window**: analysis_start_date defaults to today-60d; readiness only uses data from this date forward; data sufficiency gates at 7d/14d/30d; Rebaseline button resets to last 60d and triggers recompute
- **Data Sufficiency**: Per-signal day counts (HRV, RHR, sleep, steps, proxy), gate labels for missing data thresholds

## Baseline Plan (locked)
- 2695 kcal | P173.9g C330.9g F54.4g
- Adjustment priority: MCT > Dextrin > Oats > Bananas > Eggs > Flax > Whey > Yogurt
- Cardio fuel: threshold 45min, +25g carbs via dextrin
