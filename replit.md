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
- **Health Data Adapters**: Modules for translating data from Fitbit, Apple HealthKit, and Polar devices into the canonical format, supporting exercises, vitals, and sleep.
- **Backup Module**: Provides versioned export/import functionality with schema migration safety.
- **Fitbit Takeout Parser**: Handles parsing Google Takeout ZIP files for Fitbit data.
- **Sleep Alignment Module**: Implements a 3-layer sleep model for deviation classification.
- **Context Lens**: Classifies physiological impact patterns around user-tagged life contexts using a multi-component disturbance score.

UI/UX decisions include a dark theme with a teal primary color (#00D4AA), a purple accent for vitals (#8B5CF6), and the Rubik font family. Authentication uses Bearer token via an `API_KEY` environment variable.

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