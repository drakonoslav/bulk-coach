# Bulk Coach - Recomp Monitor App

## Overview
Bulk Coach is a mobile fitness tracking application built with Expo React Native, designed to implement a feedback-controlled bulk/recomposition system. The app empowers users to log daily metrics such as weight, waist circumference, sleep, activity levels, and dietary adherence. Based on this data, the application provides weekly coaching recommendations, including calorie adjustments tailored to their specific meal plan. The core vision is to offer a personalized and dynamic fitness monitoring tool that adapts to the user's physiological responses, optimizing their body composition goals. It includes advanced features like body fat tracking, lean mass calculation, and a sophisticated readiness system to guide training intensity.

## User Preferences
I prefer iterative development with clear communication on significant changes. When implementing new features or making architectural decisions, please ask for confirmation before proceeding. Ensure that code is well-documented and follows modern JavaScript/TypeScript best practices. I prioritize robust error handling and data integrity.

## System Architecture
The application is built with an Expo Router frontend, utilizing file-based routing and a 5-tab layout (Dashboard, Log, Plan, Report, Vitals). The backend is an Express server communicating with a Postgres database via `pg` pool. All data persistence is handled by Postgres, with AsyncStorage used for specific baseline data.

Core logic is modularized into several engines and modules:
- **Coaching Engine**: Manages calorie adjustments and ingredient suggestions.
- **Erection Engine**: Handles snapshot parsing, delta computation, gap-fill imputation, and androgen proxy calculation.
- **Readiness Engine**: Computes readiness scores and manages training templates based on canonical health data.
- **Canonical Health**: A vendor-agnostic health data layer with idempotent upserts for all canonical tables, source-priority-aware vitals upsert, HRV baseline computation, session strain scoring, recovery slope calculation, and HR oscillation-based bias detection.
- **Validation Module**: Provides strict input validation for all API routes.
- **Workout Engine**: Implements a Compound Budget Points (CBP) drain model for workout progression, phase state machine, and RPE-adjusted set logging.
- **Muscle Planner**: Manages a 17-muscle-group taxonomy with weekly volume tracking and deficit-based isolation target picking respecting readiness.
- **Day Classifier**: Deterministically classifies day states (LEAN_GAIN, CUT, RECOMP, DELOAD, SUPPRESSED) using weight trends, recovery signals, and training load.
- **Adherence Metrics**: Modules for single-day and range-based adherence tracking, including bedtime/wake drift and training adherence.
- **Cardio Regulation Engine**: Unified 3×2 regulation architecture for cardio. Schedule Stability: alignment (start time deviation from planned), consistency (SD of start times across 7 sessions), recovery (return to schedule after drift event). Outcome: adequacy (100×actual/planned, capped 110), efficiency (100×zone2Min/sessionDuration), continuity (100×(1−outOfZone/sessionDuration)). Default schedule: 06:00–06:40 (40 min). File: `server/cardio-regulation.ts`.
- **Lift Regulation Engine**: Unified 3×2 regulation architecture for lifting. Schedule Stability: alignment, consistency, recovery (identical logic to cardio). Outcome: adequacy (100×actualMin/plannedMin, capped 110), efficiency (not_available—future: activeLiftingTime/sessionDuration), continuity (not_available—future: restInterval variance). Default schedule: 17:00–18:15 (75 min). File: `server/lift-regulation.ts`.
- **Health Data Adapters**: Modules for translating data from Fitbit, Apple HealthKit, and Polar devices into the canonical format, supporting exercises, vitals, and sleep.
- **Backup Module**: Provides versioned export/import functionality with schema migration safety.
- **Fitbit Takeout Parser**: Handles parsing Google Takeout ZIP files for Fitbit data.
- **Sleep Alignment Module**: Implements a 3-layer sleep model for deviation classification. Canonical plan defaults: plannedBedtime=21:45, plannedWakeTime=05:30 (windDownTime=21:30 is UI-only). The sleep block includes a structured `sources` object tracking provenance of every input: `planBed`/`planWake` (app_settings vs DEFAULT), `actualBed`/`actualWake` (daily_log vs sleep_summary_daily vs yesterday fallback), `dataDay`, and `tib`/`tst` computation method (stages_sum, spanMinutes, sleep_minutes, canonical_total_sleep_minutes). Debug endpoint: `GET /api/readiness_audit?date=YYYY-MM-DD`.
- **Context Lens**: Classifies physiological impact patterns around user-tagged life contexts using a multi-component disturbance score. Uses ReadinessDeltas outputs (hrv_pct, sleep_pct, proxy_pct in percent points; rhr_bpm in absolute bpm delta) plus adherence lateRate (bedtimeDriftLateNights7d/MeasuredNights7d) for drift. FullSwing constants: HRV 8 pct, Sleep 10 pct, Proxy 10 pct, RHR 3 bpm, LATE_RATE 3/7. Cortisol flag: 3-of-4 thresholds (HRV<=-8, Sleep<=-10, Proxy<=-10, RHR>=+3 bpm). Episode system supports multi-day tracking with backfill, carry-forward, and conclude lifecycle. On conclude, stores dual-baseline archive in summary_json: (1) terminalRolling = rolling-window state at end_day (disturbance, components, deltas, cortisolFlagRate21d, phase), (2) episodeWide = genesis→terminus comparison using first/last 7 tagged days (fallback to 3; insufficient_data if <3). Interpretation thresholds: improving ≤-5, worsening ≥+5, else flat.

UI/UX decisions include a dark theme with a teal primary color (#00D4AA), a purple accent for vitals (#8B5CF6), and the Rubik font family. Authentication uses Bearer token via an `API_KEY` environment variable. All signal breakdown values use shared formatting utilities from `lib/format.ts` (`fmtScore100`, `fmtScore110`, `fmtPct`, `fmtRaw`, `scoreColor`). Backend returns full-precision floats; `.toFixed(2)` applied only at the render layer. Debug panels show raw values (6 decimals) alongside UI-formatted values (2 decimals). Sleep efficiency and continuity expose dual-unit fields: `sleepEfficiencyFrac` (0–1) + `sleepEfficiencyPct` (0–100), and `sleepContinuityFrac` (0–1) + `sleepContinuityPct` (0–100). The readiness audit endpoint includes a `unitInvariants` block asserting `abs(pct − frac×100) < 0.01` for both metrics. UI displays pct only; debug panels show both with PASS/FAIL invariant check.

The Canonical Health Schema is designed with multi-user primary keys and source prioritization to ensure data integrity and flexibility. It includes detailed models for workout sessions, HRV analysis (3-window RR model), and physiological bias computation.

## External Dependencies
- **Postgres (Neon)**: Primary database.
- **Fitbit API (OAuth 2.0)**: Integrated for importing health and activity data.
- **Expo React Native**: Frontend framework.
- **Express.js**: Backend framework.
- **pg**: Node.js PostgreSQL client.
- **AsyncStorage**: Client-side storage for baseline data.
- **react-native-health**: For Apple HealthKit integration.
- **react-native-ble-plx**: For Polar BLE device integration.