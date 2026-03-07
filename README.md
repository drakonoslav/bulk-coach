# Bulk Coach - Recomp Monitor

A mobile fitness tracking application built with Expo React Native that implements a feedback-controlled bulk/recomposition system. Users log daily metrics and receive dynamic coaching recommendations that adapt to their physiological responses, optimizing body composition goals through calorie adjustments, training autoregulation, and multi-signal readiness analysis.

## Features

### Daily Logging & Body Composition

- Morning/evening weight with 7-day rolling averages and trend visualization
- Waist circumference tracking with 14-day velocity
- Body fat percentage with triple-reading averaging (morning and evening)
- Fat-free mass (lean mass) auto-calculation
- Meal checklist adherence (6 meal slots: pre-cardio, post-cardio, midday, pre-lift, post-lift, evening)
- Water intake, steps, pain scale, and performance notes

### Coaching Engine

- Weekly calorie adjustment recommendations based on weight and waist velocity
- Mode classification: determines if the user is in BULK, CUT, RECOMP, or UNCERTAIN state
- Ingredient-level meal plan adjustments distributed across specific meal slots
- Adaptation stage tracking (early, adapted, insufficient data)
- Structural Confidence Score (SCS) evaluating data quality before acting on signals

### Readiness System

- Readiness score (0-100) computed from HRV, RHR, sleep, and androgen proxy signals
- 7-day vs 28-day delta analysis to detect deviations from baseline
- Tiered output: GREEN / YELLOW / BLUE with confidence grading (High / Med / Low / None)
- Cortisol flag detection using multi-threshold criteria (HRV, sleep, proxy, RHR)
- Recovery-gated training autoregulation

### HPA Axis Tracking

- Hypothalamic-Pituitary-Adrenal axis score for systemic stress and CNS fatigue monitoring
- Automatic recomputation on daily log save

### Strength & Lifting Intel

- Normalized strength index across exercises (pushups, pullups, bench, OHP)
- Strength velocity tracking over 14-day windows (percent per week)
- Strength phase classification (neural, hypertrophy, insufficient data)
- Regional muscle index for body-part-specific progress
- Compound Budget Points (CBP) drain model for workout progression
- RPE-adjusted set logging with phase state machine

### Muscle Planner

- 17-muscle-group taxonomy with weekly volume tracking
- Deficit-based isolation target recommendations respecting current readiness
- Weekly set targets with actual vs planned comparison

### Workout Engine

- Session management with compound budget calculation from readiness
- Set-by-set fatigue tracking with phase transition prompts
- Automatic suggestions for when to switch from compound to isolation movements

### Sleep Analysis

- 3-layer sleep model: plan (bedtime/wake targets), actual (logged/imported), and deviation
- Sleep efficiency (TST/TIB) and continuity (fragmentation metric)
- Stage breakdown: REM, Core/Light, Deep, Awake
- Latency and WASO tracking
- Bedtime/wake drift adherence metrics
- Source provenance tracking for every sleep input

### Cardio Regulation

- Unified 3x2 regulation architecture
- Schedule Stability: alignment, consistency, recovery (with behavioral suppression)
- Outcome: adequacy, efficiency, continuity using productive-time model (zone 2 + zone 3)
- Heart rate zone tracking (zones 1-5)
- Configurable schedule with default window

### Lift Regulation

- Matching 3x2 regulation architecture (alignment, consistency, recovery / adequacy, efficiency, continuity)
- Working minutes tracking for efficiency scoring
- Behavioral continuity-aware recovery with suppression factor

### Day Classifier

- Deterministic daily state classification: LEAN_GAIN, CUT, RECOMP, DELOAD, SUPPRESSED, UNKNOWN
- Uses weight trends, recovery signals, and training load

### Forecast Engine

- Peak strength forecast with status classification
- Fatigue risk prediction from readiness and recovery trends
- Hypertrophy plateau detection using strength and FFM velocity

### Intervention Memory System

- Records state snapshots, actions, and outcomes for case-based reasoning
- Weighted feature similarity engine with overlap guard (min 4 features, 30% weight coverage)
- 3d/7d/14d outcome window evaluation with tri-state scoring
- Advisory-only policy recommendations with confidence tiers (high/medium/low)
- Self-match exclusion (same calendar day filtering)
- Automatic outcome evaluation on daily log save

### Context Lens

- Episode-based tracking for life events (travel, illness, work stress)
- Multi-component disturbance score using readiness deltas
- Dual-baseline comparison (terminal rolling + episode-wide genesis-to-terminus)
- Cortisol flag rate tracking over 21-day windows
- Backfill, carry-forward, and conclude lifecycle management

### Erection / Androgen Proxy Engine

- Nocturnal erection data tracking as hormonal health proxy
- Androgen proxy score computation
- Gap-fill imputation with linear interpolation
- Data confidence grading over 7, 14, and 30-day windows

### Health Data Import

- **Fitbit**: OAuth 2.0 API integration for sleep, activity, and vitals
- **Fitbit Google Takeout**: ZIP file parser for bulk historical import with chunked upload support
- **Apple HealthKit**: Batch import from iOS Health app
- **Polar BLE**: Direct Bluetooth connection with Polar H10 heart rate straps
- **Manual entry**: All metrics can be entered directly in the app

### Adherence Metrics

- Single-day and range-based adherence tracking
- Bedtime and wake drift measurement
- Training adherence scoring
- Late-night rate computation for context lens integration

### Backup & Recovery

- Versioned JSON export/import with schema migration safety
- Merge mode (upsert, preserving existing data) or replace mode
- Dry-run preview before import
- Full database reset option
- Accessible from both API and in-app UI

## App Structure (5 Tabs)

| Tab | Screen | Purpose |
|-----|--------|---------|
| Dashboard | `index.tsx` | Overview: signal charts, muscle map, weight trend, stats grid, macro targets, recent entries, intervention advisory |
| Log | `log.tsx` | Daily data entry: weight, body comp, strength, sleep, activity, nutrition, context episodes |
| Plan | `checklist.tsx` | Daily execution: locked meal template timeline, readiness/HPA status, Fitbit import, debug panels |
| Report | `report.tsx` | Analytics: coaching diagnosis, calorie adjustments, meal guide, weight/strength/lean-gain charts, SCS |
| Vitals | `vitals.tsx` | Health markers: androgen proxy tracking, data sources, backup/restore, context lens archive |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Expo Router (React Native), TypeScript |
| Backend | Express, TypeScript |
| Database | PostgreSQL (Neon-compatible) |
| Styling | React Native StyleSheet, dark theme (#1A1A2E bg, #00D4AA teal primary, #8B5CF6 purple accent) |
| Font | Rubik family |
| State | React Query (@tanstack/react-query), React Context, AsyncStorage |

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or a Neon database)
- npm

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `API_KEY` | Yes | Bearer token for API authentication |
| `SESSION_SECRET` | Yes | Random string for Express sessions |
| `EXPO_PUBLIC_DOMAIN` | No | Set automatically on Replit; for local dev set to `localhost:5000` |
| `FITBIT_CLIENT_ID` | No | For Fitbit OAuth integration |
| `FITBIT_CLIENT_SECRET` | No | For Fitbit OAuth integration |

## Running Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start the backend (port 5000)

```bash
npm run server:dev
```

The backend auto-creates all database tables and runs migrations on first startup.

### 3. Start the Expo dev server (port 8081)

In a second terminal:

```bash
npx expo start
```

- Press `w` to open the web version
- Scan the QR code with Expo Go on your phone for native testing

### On Replit

Both workflows are pre-configured:

- **Start Backend** runs `npm run server:dev`
- **Start Frontend** runs `npm run expo:dev` (sets Replit proxy env vars automatically)

## API Routes

### Authentication & System
- `GET /api/auth/token` - Returns configured API key
- `GET /api/sanity-check` - Data integrity check for a specific date
- `GET /api/day-state` - Day range with adherence and classification marks
- `GET /api/data-sources` - Data provider status and sync history
- `GET /api/data-sufficiency` - Checks if enough data exists for reliable coaching

### Daily Logs
- `POST /api/logs/upsert` - Create/update daily log (triggers readiness, HPA, intervention eval)
- `GET /api/logs` - All daily log entries
- `GET /api/logs/:day` - Single day entry
- `DELETE /api/logs/:day` - Delete day entry
- `POST /api/logs/reset-adherence` - Reset adherence fields for a date

### Readiness & Health Analytics
- `GET /api/dashboard` - Summary of metrics, trends, and readiness
- `GET /api/readiness` - Readiness score/tier for a date
- `GET /api/readiness/range` - Range of stored readiness scores
- `GET /api/readiness_audit` - Detailed signal data for readiness computation
- `GET /api/hpa` - HPA axis data for a date
- `GET /api/hpa/range` - HPA data range
- `POST /api/hpa/compute` - Trigger HPA recompute
- `GET /api/signals/chart` - Historical signal data for charting

### Workout & Strength
- `POST /api/workout/start` - Initialize workout session with CBP
- `POST /api/workout/:sessionId/set` - Log a set
- `GET /api/workout/:sessionId/next-prompt` - Next exercise recommendation
- `GET /api/workout/:sessionId/events` - Session event list
- `POST /api/workout/cbp` - Calculate potential CBP for readiness score
- `GET /api/muscle/weekly-load` - Weekly volume per muscle group
- `POST /api/muscle/isolation-targets` - Isolation exercise recommendations
- `GET /api/strength/baselines` - User strength baselines
- `POST /api/strength/baselines/compute` - Recalculate baselines

### Sleep & Schedule
- `GET /api/sleep-alignment` - Sleep performance vs plan
- `GET /api/sleep-plan` / `POST` - Manage sleep plan
- `GET /api/cardio-schedule` / `POST` - Manage cardio schedule
- `GET /api/lift-schedule` / `POST` - Manage lift schedule
- `GET /api/sleep-diagnostics/:date` - Debug sleep bucketing

### Nutrition & Context
- `GET /api/calorie-decisions` - Historical calorie adjustments
- `POST /api/calorie-decisions/upsert` - Record calorie decision
- `GET /api/presets` / `POST` - Meal plan presets
- `POST /api/context-events` - Record context event
- `GET /api/context-lens` - Context lens with adjusted baselines

### Intervention System
- `POST /api/intervention/record` - Record an intervention experience
- `POST /api/intervention/evaluate` - Manually evaluate pending outcomes
- `GET /api/intervention/policy` - Current state + advisory recommendation

### Data Import & Backup
- `POST /api/import/fitbit` - Fitbit CSV upload
- `POST /api/import/fitbit_takeout` - Fitbit Takeout ZIP upload
- `POST /api/import/takeout_chunk_upload` - Chunked Takeout upload
- `POST /api/import/healthkit/batch` - Apple HealthKit batch import
- `GET /api/backup/export` - Full database JSON backup
- `POST /api/backup/import` - Restore from JSON backup
- `POST /api/reset-database` - Wipe user-scoped data

## Project Structure

```
app/
  (tabs)/
    _layout.tsx         # Tab layout (native + classic fallback)
    index.tsx           # Dashboard
    log.tsx             # Daily Log
    checklist.tsx       # Plan / Daily Checklist
    report.tsx          # Weekly Report
    vitals.tsx          # Vitals & Backup
  _layout.tsx           # Root layout with providers

components/
  InterventionAdvisoryCard.tsx  # Advisory recommendation card
  ContextLensCard.tsx           # Context episode impact card
  FuelGauge.tsx                 # 3x2 regulation triad visualization
  MuscleMapCard.tsx             # Muscle state visualization
  ...                           # Additional UI components

server/
  index.ts              # Express entry point
  routes.ts             # All API routes
  db.ts                 # Postgres pool + schema init + migrations
  readiness-engine.ts   # Readiness score computation
  hpa-engine.ts         # HPA axis computation
  erection-engine.ts    # Androgen proxy computation
  day-classifier.ts     # Day state classification
  workout-engine.ts     # CBP drain model + session management
  muscle-planner.ts     # Volume tracking + isolation targets
  forecast-engine.ts    # Strength/fatigue/plateau forecasting
  context-lens.ts       # Episode disturbance scoring
  cardio-regulation.ts  # Cardio 3x2 regulation
  lift-regulation.ts    # Lift 3x2 regulation
  recovery-helpers.ts   # Shared recovery modifiers
  sleep-alignment.ts    # Sleep plan adherence
  adherence-metrics.ts  # Adherence computation
  intervention-store.ts # Intervention DB layer
  intervention-engine.ts    # Intervention orchestrator
  intervention-evaluator.ts # Outcome evaluation
  backup.ts             # Export/import logic
  fitbit-takeout.ts     # Google Takeout ZIP parser
  fitbit-import.ts      # Single CSV Fitbit import
  recompute.ts          # Dashboard cache recompute
  adapters/             # Health data adapters (Fitbit, HealthKit, Polar)

lib/
  coaching-engine.ts        # Calorie adjustments + mode classification
  intervention-types.ts     # Intervention type definitions
  intervention-state.ts     # Snapshot builder + action constructors
  intervention-similarity.ts # Weighted feature similarity
  intervention-outcomes.ts  # Outcome window scoring
  intervention-policy.ts    # Case-based policy engine
  forecast-types.ts         # Forecast type definitions
  forecast-fatigue-risk.ts  # Fatigue risk forecasting
  forecast-plateau.ts       # Plateau detection
  forecast-peak-strength.ts # Peak strength forecasting
  recovery-index.ts         # Recovery index computation
  strength-index.ts         # Strength scoring
  adaptation-stage.ts       # Adaptation classification
  structural-confidence.ts  # SCS computation
  sleep-derivation.ts       # Sleep stage analysis
  format.ts                 # Shared formatting utilities
  entry-storage.ts          # API-backed CRUD
  query-client.ts           # React Query setup

scripts/
  seed-dev.ts           # Dev data seeder (60 days synthetic data)
```

## Seed Data (Dev Mode)

```bash
npx tsx scripts/seed-dev.ts        # Populate with 60 days of synthetic data
npx tsx scripts/seed-dev.ts --clear # Clear seeded data
```

## License

Private - not for redistribution.
