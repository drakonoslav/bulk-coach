# Bulk Coach - Recomp Monitor App

## Overview
Bulk Coach is a mobile fitness tracking application built with Expo React Native, designed to implement a feedback-controlled bulk/recomposition system. The app empowers users to log daily metrics such as weight, waist circumference, sleep, activity levels, and dietary adherence. Based on this data, the application provides weekly coaching recommendations, including calorie adjustments tailored to their specific meal plan. The core vision is to offer a personalized and dynamic fitness monitoring tool that adapts to the user's physiological responses, optimizing their body composition goals. It includes advanced features like body fat tracking, lean mass calculation, and a sophisticated readiness system to guide training intensity.

## User Preferences
I prefer iterative development with clear communication on significant changes. When implementing new features or making architectural decisions, please ask for confirmation before proceeding. Ensure that code is well-documented and follows modern JavaScript/TypeScript best practices. I prioritize robust error handling and data integrity.

## System Architecture
The application is built with an Expo Router frontend, utilizing file-based routing and a 5-tab layout (Dashboard, Log, Plan, Report, Vitals). The backend is an Express server communicating with a Postgres database (Neon) via `pg` pool. All data persistence is handled by Postgres, with AsyncStorage used for specific baseline data.

Core logic is modularized:
- `lib/coaching-engine.ts`: Manages coaching logic, including calorie adjustments and ingredient suggestions.
- `server/erection-engine.ts`: Handles snapshot parsing, delta computation, gap-fill imputation, and androgen proxy calculation.
- `server/readiness-engine.ts`: Computes readiness scores and manages training templates. Reads from canonical tables (vitals_daily, sleep_summary_daily) — fully decoupled from Fitbit.
- `server/canonical-health.ts`: Vendor-agnostic health data layer with idempotent upserts for all canonical tables, source-priority-aware vitals upsert (healthkit > polar > fitbit > manual — lower-priority sources only gap-fill NULLs), HRV baseline computation (7d rolling median, RMSSD+SDNN deviation %), session strain scoring, recovery slope calculation, 3-window RR processing (baseline/active/recovery RMSSD, suppression %, rebound %), HR oscillation-based bias detection (strength_bias, cardio_bias), and time-to-recovery computation.
- `server/validation.ts`: Input validation module — parseStrictISOTimestamp, validateHrBpm (25-250), validateRrMs (300-2000), validateSleepMinutes (0-1000), toUTCDateString(ts, timezone) for timezone-aware date derivation, ensureUTCTimestamp. All Phase 2 routes use these validators and return detailed error arrays.
- `server/workout-engine.ts`: Workout game engine with CBP (Compound Budget Points) drain model, phase state machine (COMPOUND→ISOLATION), set logging with RPE-adjusted drain, and automatic phase transitions based on budget depletion rules.
- `server/muscle-planner.ts`: 17-muscle-group taxonomy with weekly volume tracking (hard_sets/total_sets), deficit-based isolation target picker respecting readiness-gated systemic load, and day-type-aware muscle selection (PPL/Upper-Lower/Full Body).
- `server/adapters/fitbit.ts`: Translates Fitbit data into the canonical format.
- `server/adapters/healthkit.ts`: Translates Apple HealthKit data (workouts, HR, heartbeat series, sleep categories, vitals) into canonical format. Handles HKHeartbeatSeries → RR interval conversion. Implements `buildSyncPayloads()` returning `HealthKitSyncResult` with sleep/vitals/workout payloads. Phase 2 complete.
- `hooks/useHealthKit.ts`: Client-side HealthKit hook. Uses `Constants.appOwnership` to detect Expo Go vs Dev Client. Only attempts `require("react-native-health")` when NOT in Expo Go. Exports `debugInfo: { runtime, moduleLoaded }` for UI diagnostics. Manages permission flow, multi-day sync (sleep/vitals/workouts/HR samples), and progress reporting.
- `server/adapters/polar.ts`: Translates Polar API + BLE data into canonical format. Supports exercise sessions, nightly recharge HRV/SDNN, daily activity, sleep, and real-time BLE RR intervals. Implements `createBufferingUploader()` for live BLE streaming with auto-flush at configurable buffer size. Phase 2 complete.
- `server/phase2-types.ts`: Shared TypeScript interfaces for Phase 2 contracts — DataSource enum, upsert payload types (SleepSummaryUpsertPayload, VitalsDailyUpsertPayload, WorkoutSessionUpsertPayload, HrSamplesUpsertBulkPayload, RrIntervalsUpsertBulkPayload), adapter interfaces (IHealthKitAdapter, IPolarBleAdapter), and response types.
- `server/backup.ts`: Provides versioned export/import functionality with merge/replace modes and schema migration safety.
- `server/fitbit-takeout.ts`: Parses Google Takeout ZIP files for Fitbit data, handling various CSV and JSON formats, and performing dual-writes to both `daily_log` and canonical tables via Fitbit adapter.
- `server/sleep-alignment.ts`: Implements a 3-layer sleep model for deviation classification and trending.

UI/UX decisions include a dark theme with a teal primary color (#00D4AA), a purple accent for vitals (#8B5CF6), and the Rubik font family.

## Canonical Health Schema
- **Architecture**: Vendor-agnostic data layer. All adapters (Fitbit, future HealthKit/Polar) map into canonical tables. All baseline and readiness logic reads from canonical tables only.
- **Tables**: `vitals_daily`, `sleep_summary_daily`, `workout_session` (+ min_session_rmssd, post_session_rmssd, hrv_suppression_pct, hrv_rebound_pct, time_to_recovery_sec), `workout_hr_samples`, `workout_rr_intervals`, `hrv_baseline_daily`, `workout_events` (session events, phase transitions, CBP tracking), `muscle_weekly_load` (per-muscle weekly volume tracking)
- **Multi-User PKs**: workout_hr_samples PK = (user_id, session_id, ts), workout_rr_intervals PK = (user_id, session_id, ts). All tables scoped by user_id.
- **Source Priority**: SOURCE_PRIORITY map: healthkit=1, polar=2, fitbit=3, manual=4. Lower-priority upserts use COALESCE(existing, new) to gap-fill only. Higher-priority sources fully overwrite.
- **Validation**: All Phase 2 routes validate inputs before DB insert. HR 25-250 bpm, RR 300-2000 ms, sleep 0-1000 min, strict ISO timestamps. Errors return `{ok:false, errors:[...]}`.
- **Timezone Standard**: `toUTCDateString(ts, timezone)` derives local date from UTC timestamp + IANA timezone. Workout sessions auto-derive date from start_ts when timezone provided.
- **Session Model**: Each workout_session has session_id (PK), start_ts, end_ts, source, workout_type, strain_score, strength_bias (0-1), cardio_bias (0-1)
- **3-Window RR Model**: `processSessionRrIntervals()` splits RR intervals into baseline (pre-session 120s), active (during workout), and recovery (post-session 600s, skips first 60s artifact). Computes pre/min/post RMSSD. Rolling min uses time-based 60s windows stepping 10s with p10 (not absolute min). hrv_suppression_pct = clamp((pre-min)/pre, 0-100), hrv_rebound_pct = clamp((post-min)/(pre-min), 0-100). Resting HR = median baseline HR samples (fallback: 60000/mean_baseline_RR). Recovery target = restingHr + 0.10*(peakHr - restingHr), requires 30s sustained under target on 15s smoothed HR. Min beat thresholds: baseline >= 60, recovery >= 60, rolling window >= 20.
- **HR Oscillation Bias**: `computeSessionBiasesFromPhysiology()` uses HR amplitude + oscillation count for strength detection (intermittent high-low pattern) vs sustained high HR for cardio detection.
- **Workout Engine**: CBP formula = Math.pow(readinessScore/100, 1.4) * 100. Compound drain = 8 + RPE adjustment, isolation drain = 3 + RPE adjustment. Phase switches to ISOLATION when CBP ≤ 25 or after 8+ compounds with CBP ≤ 40.
- **Muscle Planner**: 17 granular muscle groups with weekly targets. Low-systemic muscles (delts, biceps, triceps, calves, abs, neck) used when readiness < 60. Isolation targets picked by volume deficit + priority boost.
- **API**: `/api/canonical/workouts/:sessionId/analyze-hrv` (POST), `/api/workout/start` (POST), `/api/workout/:sessionId/set` (POST), `/api/workout/:sessionId/events` (GET), `/api/workout/cbp` (POST), `/api/muscle/weekly-load` (GET), `/api/muscle/isolation-targets` (POST), `/api/muscle/targets` (GET)
- **Phase 2 API**: `/api/canonical/sleep/upsert` (POST), `/api/canonical/vitals/upsert` (POST), `/api/canonical/workouts/upsert-session` (POST), `/api/canonical/workouts/hr-samples/upsert-bulk` (POST), `/api/canonical/workouts/rr-intervals/upsert-bulk` (POST)
- **HRV Response Flag**: `hrv_response_flag` TEXT column on workout_session: "suppressed"|"increased"|"flat"|"insufficient". Ratio = (pre-min)/pre; >0.05 = suppressed, <-0.05 = increased, else flat.
- **Bias Normalization**: strength_bias rounded to 4 decimals, cardio_bias = 1 - strength_bias (ensures exact 1.0 sum).
- **Data Sources API**: `/api/data-sources` (GET) returns per-source record counts (workouts/vitals/sleep) and last sync timestamp.
- **Phase 2**: HealthKit adapter (react-native-health), Polar BLE adapter (react-native-ble-plx) — both require native dev build, will use same canonical schema. Adapters are built (`server/adapters/healthkit.ts`, `server/adapters/polar.ts`); sync UI in Vitals tab shows connection status.
- **Phase 3 Screens**: `app/healthkit.tsx` (HealthKit sync UI with 7d/30d sync, permission flow, result counts), `app/polar.tsx` (Polar H10 BLE scan/connect/stream with 120s baseline capture, live HR/RR display, post-session HRV analysis), `app/workout.tsx` (Game Guide with CBP bar, phase indicator, muscle grid, RPE selector, set logging, isolation targets).
- **Phase 3 Hooks**: `hooks/useHealthKit.ts` (HealthKit permission + multi-day sync), `hooks/usePolarH10.ts` (BLE scan/connect/stream with buffer upload), `hooks/useWorkoutEngine.ts` (workout start/logSet/end with server state sync).
- **iOS Dev Build**: `IOS_DEV_BUILD.md` documents EAS setup, required packages (react-native-health, react-native-ble-plx), config plugins, entitlements, and Info.plist settings.

## External Dependencies
- **Postgres (Neon)**: Primary database for all persistent application data.
- **Fitbit API (OAuth 2.0)**: Integrated for importing health and activity data, with server-side OAuth endpoints for authentication, token management, and data retrieval.
- **Expo React Native**: Frontend framework for mobile application development.
- **Express.js**: Backend web framework.
- **pg**: Node.js PostgreSQL client.
- **AsyncStorage**: Used for client-side storage of baseline data.
