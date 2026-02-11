# Bulk Coach - Recomp Monitor

A mobile fitness tracking app built with Expo React Native that implements a feedback-controlled bulk/recomp system. Users log daily metrics (weight, waist, sleep, activity, adherence) and receive weekly coaching recommendations for calorie adjustments based on their locked meal plan.

## Features

- Daily logging: weight, waist, body fat %, sleep, water, steps, cardio, lift, adherence
- Body composition tracking with lean mass / fat mass auto-calculation
- 7-day rolling averages and weight trend visualization
- Weekly calorie adjustment recommendations
- Readiness score (0-100) from HRV, RHR, sleep, and androgen proxy signals
- Recovery-gated training autoregulation with dual sliders
- Fitbit Google Takeout ZIP import (sleep, HRV, RHR, steps, calories, heart rate zones)
- Sleep plan adherence tracking with deviation and efficiency metrics
- Full backup/restore with single-file JSON export

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | Expo Router (React Native), TypeScript |
| Backend  | Express, TypeScript                 |
| Database | PostgreSQL (Neon-compatible)         |
| Styling  | React Native StyleSheet, dark theme |

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or a Neon database)
- npm

## Environment Variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable           | Required | Description                                |
|--------------------|----------|--------------------------------------------|
| `DATABASE_URL`     | Yes      | Postgres connection string                 |
| `SESSION_SECRET`   | Yes      | Random string for Express sessions         |
| `EXPO_PUBLIC_DOMAIN` | No     | Set automatically on Replit; for local dev set to `localhost:5000` |

## Running Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start the backend (port 5000)

```bash
npm run server:dev
```

The backend auto-creates all database tables on first startup.

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

## Seed Data (Dev Mode)

To populate the database with 60 days of synthetic data for UI testing:

```bash
npx tsx scripts/seed-dev.ts
```

This inserts fake `daily_log`, `readiness_daily`, and `androgen_proxy_daily` rows so every screen has data to render. Run it once after setting up a fresh database.

To clear seeded data:

```bash
npx tsx scripts/seed-dev.ts --clear
```

## Backup & Restore

### Export

```
GET /api/backup/export
```

Returns a single JSON file (`bulk-coach-backup-YYYY-MM-DD.json`) containing all daily logs, dashboard cache, erection data, proxy scores, and Fitbit import records.

You can also export from the app's Vitals tab (share sheet).

### Import

```
POST /api/backup/import
```

Upload the JSON file as multipart form data (field name: `file`). Supports:

- `mode=merge` (default) - upserts rows, preserving existing data
- `mode=replace` - drops and re-inserts all rows
- `dry_run=true` - preview what would change without writing

The app's Vitals tab has an import button with dry-run confirmation.

## Project Structure

```
app/
  (tabs)/
    index.tsx         # Dashboard
    log.tsx           # Daily Log
    checklist.tsx     # Plan / Daily Checklist
    report.tsx        # Weekly Report
    vitals.tsx        # Vitals & Backup
  _layout.tsx         # Root layout with providers

server/
  index.ts            # Express entry point
  routes.ts           # All API routes
  db.ts               # Postgres pool + schema init
  backup.ts           # Export/import logic
  fitbit-takeout.ts   # Google Takeout ZIP parser
  fitbit-import.ts    # Single CSV Fitbit import
  readiness-engine.ts # Readiness score computation
  readiness-deltas.ts # Signal delta formatting
  sleep-alignment.ts  # Sleep plan adherence
  recompute.ts        # Dashboard cache recompute
  erection-engine.ts  # Androgen proxy computation

lib/
  coaching-engine.ts  # Coaching logic
  entry-storage.ts    # API-backed CRUD
  query-client.ts     # React Query setup

scripts/
  seed-dev.ts         # Dev data seeder
```

## License

Private - not for redistribution.
