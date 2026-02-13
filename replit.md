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
- `server/readiness-engine.ts`: Computes readiness scores and manages training templates.
- `server/canonical-health.ts`: A vendor-agnostic health data layer, ensuring idempotent upserts for all canonical tables, HRV baseline computation, session strain scoring, and recovery slope calculation. It integrates with adapters for various health data sources.
- `server/adapters/fitbit.ts`: Translates Fitbit data into the canonical format.
- `server/backup.ts`: Provides versioned export/import functionality with merge/replace modes and schema migration safety.
- `server/fitbit-takeout.ts`: Parses Google Takeout ZIP files for Fitbit data, handling various CSV and JSON formats, and performing dual-writes to both `daily_log` and canonical tables.
- `server/sleep-alignment.ts`: Implements a 3-layer sleep model for deviation classification and trending.

UI/UX decisions include a dark theme with a teal primary color (#00D4AA), a purple accent for vitals (#8B5CF6), and the Rubik font family. The application features a comprehensive daily logging system, advanced body fat tracking with lean mass/fat mass auto-calculation, and a lean gain ratio (14d). The Dashboard and Report screens provide rich visualizations for trends and analysis. A key feature is the readiness system, which uses weighted deltas from HRV, RHR, sleep, and an androgen proxy to calculate a score (0-100), categorizing readiness into GREEN, YELLOW, and BLUE tiers, which then inform dual sliders for training type and exercise bias.

## External Dependencies
- **Postgres (Neon)**: Primary database for all persistent application data.
- **Fitbit API (OAuth 2.0)**: Integrated for importing health and activity data, with server-side OAuth endpoints for authentication, token management, and data retrieval.
- **Expo React Native**: Frontend framework for mobile application development.
- **Express.js**: Backend web framework.
- **pg**: Node.js PostgreSQL client.
- **AsyncStorage**: Used for client-side storage of baseline data.