# Bulk Coach - Recomp Monitor App

## Overview
Bulk Coach is a mobile fitness tracking application designed to implement a feedback-controlled bulk/recomposition system. It allows users to log daily metrics like weight, waist circumference, sleep, activity, and dietary adherence. The app provides weekly coaching recommendations, including calorie adjustments based on this data, aiming for personalized and dynamic fitness monitoring. Key capabilities include body fat tracking, lean mass calculation, and a readiness system to guide training intensity, optimizing body composition goals.

## User Preferences
I prefer iterative development with clear communication on significant changes. When implementing new features or making architectural decisions, please ask for confirmation before proceeding. Ensure that code is well-documented and follows modern JavaScript/TypeScript best practices. I prioritize robust error handling and data integrity.

## System Architecture
The application features an Expo Router frontend with file-based routing and a 5-tab layout (Dashboard, Log, Plan, Report, Vitals). The backend is an Express server communicating with a Postgres database via `pg` pool. Data persistence is handled by Postgres, with AsyncStorage for baseline data.

Core logic is modularized into several engines and modules:
- **Coaching Engine**: Manages calorie adjustments and ingredient suggestions.
- **Erection Engine**: Handles snapshot parsing, delta computation, gap-fill imputation, and androgen proxy calculation.
- **Readiness Engine**: Computes readiness scores and manages training templates based on canonical health data.
- **Canonical Health**: A vendor-agnostic health data layer with idempotent upserts, source-priority-aware vitals upsert, HRV baseline computation, session strain scoring, recovery slope calculation, and HR oscillation-based bias detection.
- **Validation Module**: Provides strict input validation for all API routes.
- **Workout Engine**: Implements a Compound Budget Points (CBP) drain model for workout progression, phase state machine, and RPE-adjusted set logging.
- **Muscle Planner**: Manages a 17-muscle-group taxonomy with weekly volume tracking and deficit-based isolation target picking respecting readiness.
- **Day Classifier**: Deterministically classifies day states (LEAN_GAIN, CUT, RECOMP, DELOAD, SUPPRESSED) using weight trends, recovery signals, and training load.
- **Adherence Metrics**: Modules for single-day and range-based adherence tracking, including bedtime/wake drift and training adherence.
- **Cardio and Lift Regulation Engines**: Unified 3x2 regulation architectures for cardio and lifting, assessing Schedule Stability (alignment, consistency, recovery) and Outcome (adequacy, efficiency, continuity).
- **Recovery Helpers**: Shared recovery modifiers applying `suppressionFactor` and `driftFactor` across sleep, cardio, and lift domains.
- **Health Data Adapters**: Modules for translating data from Fitbit, Apple HealthKit, and Polar devices into the canonical format.
- **Backup Module**: Provides versioned export/import with schema migration safety.
- **Fitbit Takeout Parser**: Handles parsing Google Takeout ZIP files for Fitbit data.
- **Sleep Alignment Module**: Implements a 3-layer sleep model for deviation classification, tracking provenance and computing TIB/TST.
- **Intervention Memory System**: Records state snapshots, actions, and outcomes for case-based reasoning. It uses a weighted feature similarity engine to provide advisory policy recommendations with confidence tiers based on historical data and forecast alignment.
- **Workout Game Persistence Layer**: Centralized persistence via `persistWorkoutDerivedState()` for strength sets, game bridge entries, and daily log updates, ensuring data integrity and timezone-safe day resolution.
- **Intel Exercise Mapping**: Resolves Intel numeric exercise IDs to local strength exercise text slugs.
- **Context Lens**: Classifies physiological impact patterns around user-tagged life contexts using a multi-component disturbance score, including readiness deltas and adherence rates, supporting multi-day episode tracking and dual-baseline archiving.

UI/UX decisions include a dark theme with a teal primary color (#00D4AA), a purple accent for vitals (#8B5CF6), and the Rubik font family. Authentication uses Bearer tokens. Shared formatting utilities from `lib/format.ts` are used for signal breakdown values. The Dashboard CAPACITY chart displays Readiness and three sleep disruption metrics (Sleep Latency, Wake After Sleep Onset, Awake-in-Bed) with normalized percentages, exceedance fills, and blend colors for overlaps. The 3×2 regulation triads (Schedule: alignment/consistency/recovery; Outcome: adequacy/efficiency/continuity) are rendered as horizontal fuel-gauge fill bars with a green/amber/red color scale based on thresholds. Sleep efficiency and continuity metrics are provided with dual-unit fields (fraction and percentage) and invariant checks.

## External Dependencies
- **Postgres (Neon)**: Primary database.
- **Fitbit API (OAuth 2.0)**: For importing health and activity data.
- **Expo React Native**: Frontend framework.
- **Express.js**: Backend framework.
- **pg**: Node.js PostgreSQL client.
- **AsyncStorage**: Client-side storage.
- **react-native-health**: For Apple HealthKit integration.
- **react-native-ble-plx**: For Polar BLE device integration.