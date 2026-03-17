# Bulk Coach - Recomp Monitor App

## Overview
Bulk Coach is a mobile fitness tracking application designed to implement a feedback-controlled bulk/recomposition system. It allows users to log daily metrics such as weight, waist circumference, sleep, activity, and dietary adherence. The app provides weekly coaching recommendations, including calorie adjustments, based on this data, aiming for personalized and dynamic fitness monitoring. Key capabilities include body fat tracking, lean mass calculation, and a readiness system to guide training intensity, optimizing body composition goals.

## User Preferences
I prefer iterative development with clear communication on significant changes. When implementing new features or making architectural decisions, please ask for confirmation before proceeding. Ensure that code is well-documented and follows modern JavaScript/TypeScript best practices. I prioritize robust error handling and data integrity.

## System Architecture
The application features an Expo Router frontend with file-based routing and a 6-tab layout (Dashboard, Logbook, Plan, Report, Vitals, Metrics). The backend is an Express server communicating with a Postgres database via `pg` pool. Data persistence is handled by Postgres, with AsyncStorage for baseline data and user-specific data. Each device has a permanent user ID stored in AsyncStorage (`tracker_user_id`), used for segregating user data in the database.

Core logic is modularized into several engines and modules:
- **Coaching Engine**: Manages calorie adjustments and ingredient suggestions.
- **Erection Engine**: Handles snapshot parsing, delta computation, gap-fill imputation, and androgen proxy calculation.
- **Readiness Engine**: Computes readiness scores and manages training templates.
- **Canonical Health**: A vendor-agnostic health data layer with idempotent upserts and source-priority-aware vitals.
- **Validation Module**: Provides strict input validation for all API routes.
- **Workout Engine**: Implements a Compound Budget Points (CBP) drain model for workout progression and RPE-adjusted set logging.
- **Muscle Planner**: Manages a 17-muscle-group taxonomy with weekly volume tracking.
- **Day Classifier**: Deterministically classifies day states (e.g., LEAN_GAIN, CUT, RECOMP) using weight trends, recovery signals, and training load.
- **Adherence Metrics**: Modules for single-day and range-based adherence tracking.
- **Cardio and Lift Regulation Engines**: Unified 3x2 regulation architectures assessing Schedule Stability and Outcome.
- **Recovery Helpers**: Shared recovery modifiers applying `suppressionFactor` and `driftFactor`.
- **Health Data Adapters**: Modules for translating data from Fitbit, Apple HealthKit, and Polar devices.
- **Backup Module**: Provides versioned export/import with schema migration safety.
- **Fitbit Takeout Parser**: Handles parsing Google Takeout ZIP files for Fitbit data.
- **Sleep Alignment Module**: Implements a 3-layer sleep model for deviation classification and tracking provenance.
- **Androgen Oscillator Engine**: Implements a 3-layer convergent rhythm control model computing Acute Readiness, Tissue-Resource, and Endocrine-Seasonal scores for a composite interpretation and prescription.
- **Vitals v1 Module**: Provides enums, interfaces, meal/macro templates, and API routes for comprehensive vitals dashboard, baseline management, and daily recommendations.
- **Intel Vitals Integration**: Facilitates daily log data submission to an external Intel service for recommendations, storing responses in AsyncStorage.
- **Intervention Memory System**: Records state snapshots, actions, and outcomes for case-based reasoning and advisory policy recommendations.
- **Workout Game Persistence Layer**: Centralized persistence for workout data, ensuring data integrity and timezone-safe day resolution.
- **Intel Exercise Mapping**: Resolves Intel numeric exercise IDs to local strength exercise text slugs.
- **Context Lens**: Classifies physiological impact patterns around user-tagged life contexts using a multi-component disturbance score.

The application incorporates a versioned Excel workbook ingestion system. Users upload `.xlsx` files, which are stored as immutable snapshots in `workbook_snapshots` and `snapshot_sheet_rows` tables, with typed rows distributed across additional tables (biolog_rows, meal_line_rows, meal_template_rows, drift_event_rows, colony_metric_rows, threshold_lab_rows). The frontend `app/workbook.tsx` provides a version selector and displays data from these workbooks.

UI/UX decisions include a dark theme with a teal primary color (#00D4AA), a purple accent for vitals (#8B5CF6), and the Rubik font family. Authentication uses Bearer tokens. Shared formatting utilities are used for signal breakdown values. The Dashboard features CAPACITY charts for Readiness and sleep disruption metrics, and 3x2 regulation triads are rendered as horizontal fuel-gauge fill bars.

## External Dependencies
- **Postgres (Neon)**: Primary database.
- **Fitbit API (OAuth 2.0)**: For importing health and activity data.
- **Expo React Native**: Frontend framework.
- **Express.js**: Backend framework.
- **pg**: Node.js PostgreSQL client.
- **AsyncStorage**: Client-side storage.
- **react-native-health**: For Apple HealthKit integration.
- **react-native-ble-plx**: For Polar BLE device integration.