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
- `server/canonical-health.ts`: Vendor-agnostic health data layer with idempotent upserts for all canonical tables, HRV baseline computation (7d rolling median, RMSSD+SDNN deviation %), session strain scoring, recovery slope calculation, session baseline HRV (pre-session RMSSD from RR intervals, suppression depth, rebound speed), and session bias computation (strength_bias, cardio_bias).
- `server/adapters/fitbit.ts`: Translates Fitbit data into the canonical format. Fitbit is just one adapter; future adapters for HealthKit and Polar BLE will use the same canonical schema.
- `server/backup.ts`: Provides versioned export/import functionality with merge/replace modes and schema migration safety.
- `server/fitbit-takeout.ts`: Parses Google Takeout ZIP files for Fitbit data, handling various CSV and JSON formats, and performing dual-writes to both `daily_log` and canonical tables via Fitbit adapter.
- `server/sleep-alignment.ts`: Implements a 3-layer sleep model for deviation classification and trending.

UI/UX decisions include a dark theme with a teal primary color (#00D4AA), a purple accent for vitals (#8B5CF6), and the Rubik font family.

## Canonical Health Schema
- **Architecture**: Vendor-agnostic data layer. All adapters (Fitbit, future HealthKit/Polar) map into canonical tables. All baseline and readiness logic reads from canonical tables only.
- **Tables**: `vitals_daily` (HR, HRV RMSSD/SDNN, SpO2, skin temp, steps, zones, source), `sleep_summary_daily` (sleep/wake times, stages, efficiency, latency, WASO, source), `workout_session` (type, duration, HR, strain, recovery slope, strength_bias, cardio_bias, pre_session_rmssd, suppression_depth_pct, rebound_bpm_per_min, baseline_window_seconds, source), `workout_hr_samples` (per-second HR during workouts), `workout_rr_intervals` (RR intervals during workouts), `hrv_baseline_daily` (night/morning HRV, 7d median baseline, deviation %)
- **Session Model**: Each workout_session has session_id (PK), start_ts, end_ts, source (polar/apple_health/fitbit), workout_type (strength/cardio/hiit/flexibility/other), strain_score, strength_bias (0-1), cardio_bias (0-1)
- **Pre-Workout Baseline Rule**: Before each session, 2-3 min resting RR intervals are captured. `computeSessionBaselineHrv()` extracts RR intervals in the baseline window (default 120s before start_ts), computes RMSSD via successive differences. This becomes the Session Baseline HRV.
- **Suppression & Rebound**: `computeSuppressionAndRebound()` derives peak HR during workout vs resting HR (from pre-session RMSSD) → suppression_depth_pct; post-session HR decay over first 5 min → rebound_bpm_per_min.
- **API**: `/api/canonical/workouts/:sessionId/analyze-hrv` (POST) triggers full session HRV analysis from stored RR intervals + HR samples, auto-updates workout_session row.
- **Phase 2**: HealthKit adapter (react-native-health), Polar BLE adapter (react-native-ble-plx) — both require native dev build, will use same canonical schema.

## External Dependencies
- **Postgres (Neon)**: Primary database for all persistent application data.
- **Fitbit API (OAuth 2.0)**: Integrated for importing health and activity data, with server-side OAuth endpoints for authentication, token management, and data retrieval.
- **Expo React Native**: Frontend framework for mobile application development.
- **Express.js**: Backend web framework.
- **pg**: Node.js PostgreSQL client.
- **AsyncStorage**: Used for client-side storage of baseline data.
