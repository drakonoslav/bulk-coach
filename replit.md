# Bulk Coach - Recomp Monitor App

## Trust Hierarchy — Non-Negotiable

The Excel workbook exists because the app lost trust when dev and prod diverged. It is the canonical memory system. The app's job is to host it faithfully, not reinterpret it.

```
1. Excel workbook        = canonical organism (user's trust anchor)
2. Postgres snapshot     = hosted runtime copy of canonical organism
3. App UI                = window into hosted truth
4. Native app logic      = lab layer — earns authority later, not assumed
```

**Rules that follow from this hierarchy:**
- The app never outranks the workbook until it has earned that right through proven parity
- No silent fallbacks. No legacy data paths alongside workbook paths. No dual truth.
- Every route that reads workbook data must prove it via provenance (`activeWorkbookSnapshotId`)
- New native logic is a lab layer only — it does not write to or override snapshot truth
- Proof required at three levels before any change counts as real: SOURCE → BUILD → RUNTIME
- Dev parity with prod must be verified at the runtime level, not assumed from source inspection

## Overview
Bulk Coach is a mobile fitness tracking application for feedback-controlled bulk/recomposition. Users log daily metrics (weight, waist, sleep, activity, dietary adherence). The app provides weekly coaching recommendations and calorie adjustments. Key capabilities: body fat tracking, lean mass calculation, readiness system for training intensity, and full body composition monitoring.

## User Preferences
Iterative development with clear communication on significant changes. Ask for confirmation before major architectural decisions. Well-documented code, modern TypeScript best practices, robust error handling, data integrity. Every major change verified at source + build + runtime level before declaring success.

## Multi-User Architecture
Each device has a permanent user ID in AsyncStorage (`tracker_user_id`). Sent as `X-User-Id` header on every API request. Backend `requireAuth` middleware uses it for all DB queries. Every table has a `user_id` column. `ADMIN_USER_ID` env var designates the owner. Intel recommendation cache keyed by `intel_recommendation_{userId}_{date}`.

## Onboarding & Identity
First launch (no `user_profile` in AsyncStorage) routes to `/onboarding`. User enters name + birthday. Creates `UserProfile` (`lib/profile.ts`) with a UUID stored under `tracker_user_id` + `user_profile` AsyncStorage keys. System reset (via Vitals tab) wipes DB rows, clears profile, redirects to onboarding. Profile: `lib/profile.ts`; identity helpers: `lib/user-identity.ts`.

## Migration Status — Safe Gut Renovation
**Source of truth**: `workbook_snapshots` + typed rows tables (Postgres).
**Banned paths**: MemStorage (disabled), `local_default` fallback on canonical routes.

| Pass | Status | Description |
|------|--------|-------------|
| 1 — Inventory | ✓ | All persistence paths mapped |
| 2 — Source-of-truth matrix | ✓ | KEEP/GUT/RISK lists produced |
| 3 — Freeze unsafe writes | ✓ | MemStorage gutted; tracker/checklist/metrics quarantined |
| 4 — Clean Postgres schema | ✓ | workbook_snapshots, workbook_sheet_rows, biolog_rows |
| 5 — Rebuild upload/parsing spine | ✓ | upload.ts, workbookParser.ts, workbookFilename.ts; 8 tables |
| 6 — Active snapshot selection | ✓ | PATCH /api/workbooks/:id/activate + alias |
| 7 — Reconnect screens to workbook truth | ✓ | workbook.tsx, biolog, nutrition, colony, dashboard |
| 8 — Provenance display | ✓ | _provenance on every API response |
| 9 — Disable legacy screens | ✓ | report.tsx quarantined; BASELINE gated; vitals advisory |
| 9b — Colony/Drift/Threshold tables | ✓ | migration 004: drift_event_rows + colony_metric_rows + threshold_lab_rows; 13/13 proof tests PASS |
| 9c — Biolog canonical + derived layer | ✓ | biologCanonical.ts: 24-field header map + alias resolution; biologDerived.ts: sleep/body comp derived metrics; GET /api/biolog/derived; GET /api/workbook/dashboard |
| 10 — Native engine lab | Pending | After parity only |

**Quarantined tabs**: tracker.tsx, checklist.tsx, metrics.tsx, report.tsx (show QuarantinedScreen)

## Biolog Header Map (Translation Layer)
`server/services/biologCanonical.ts` — strict translation layer. Maps raw Excel column headers → canonical field names. Uses normalization (lowercase, strip spaces/underscores) + alias support for historical workbook variants. Stores canonical fields + raw_json. Does NOT infer missing fields, does NOT fallback to legacy sources.

Key canonical fields: `biolog_date`, `phase_rec`, `body_temp`, `actual_bedtime`, `rem_sleep`, `core_sleep`, `deep_sleep`, `awake_sleep`, `resting_hr`, `hrv`, `scheduled_bedtime`, `scheduled_waketime`, `bodyweight_lb`, `bodyfat_pct`, `skeletal_mass_pct`, `ffm_lb`, `waist_in`, `navel_waist_in`, `chest_in`, `hips_in`, `neck_in`, `arm_left_in`, `arm_right_in`, `thigh_in`.

Header map docs: `docs/biolog-header-map.md`

## Biolog Derived Layer
`server/services/biologDerived.ts` — derived physiological metrics computed ONLY from workbook inputs. Does NOT override `phase_rec`. Does NOT fallback to `daily_log`. Does NOT infer missing values.

Derived fields: sleep stage minutes (rem/core/deep/awake), total_sleep_min, total_in_bed_min, sleep_efficiency_pct, stage percentages, bedtime_deviation_min, fat_mass_lb, ffm_calc_lb, ffm_gap_lb, skeletal_mass_lb, waist_to_navel_delta_in, arm_avg_in, arm_asymmetry_in, usability flags (usable_sleep_row, usable_bodycomp_row, usable_measurement_row).

## Canonical API Endpoints
All require `Authorization: Bearer <token>` + `X-User-Id: <id>`. No fallbacks. All responses include `_provenance.activeWorkbookSnapshotId`.

**Snapshot management**:
- `POST /api/upload-workbook` → writes 8 tables: workbook_snapshots + snapshot_sheet_rows + biolog_rows + meal_line_rows + meal_template_rows + drift_event_rows + colony_metric_rows + threshold_lab_rows; parses filename_date
- `GET /api/snapshots` → `{ snapshots: WorkbookSnapshot[], _provenance }` (camelCase, filenameDate included)
- `GET /api/snapshots/active` → `{ activeSnapshot: WorkbookSnapshot, _provenance }`
- `PATCH /api/workbooks/:id/activate` → `{ ok, activatedSnapshotId, _provenance }` (canonical)
- `PATCH /api/snapshots/:id/activate` → same handler (backward-compat alias)
- `DELETE /api/snapshots/:id` → cascade delete all 8 child tables via FK ON DELETE CASCADE

**Data routes (require active snapshot)**:
- `GET /api/biolog` → biolog_rows; raw rows with provenance
- `GET /api/biolog/derived` → biolog_rows with canonical header mapping + derived metrics per row; phase NEVER overridden; includes `canonical` + `derived` per row
- `GET /api/nutrition/summary[?phase=X]` → meal_template_rows; phases array or per-phase totals
- `GET /api/nutrition[?phase=X]` → meal_line_rows; line items
- `GET /api/colony` → `{ colonyCoord, driftHistory, thresholdLab, _provenance }` from 3 dedicated tables; drift dates ISO YYYY-MM-DD
- `GET /api/workbook/dashboard` → unified cockpit: activeWorkbook + latest biolog (canonical + derived) + nutrition summary for workbook phase + colony summary counts; reads 6 tables; workbook phase_rec is CANONICAL and never recomputed here

**Provenance contract**: All canonical routes return `_provenance.activeWorkbookSnapshotId` (integer or null), `tablesRead: string[]`, `source: "postgres"`.

## Route Priority
Canonical spine routes registered BEFORE `registerRoutes()` in `server/index.ts` so they take priority over legacy routes at the same paths.

## Frontend Contract
- `lib/workbook-types.ts` + `lib/workbook-api.ts` — WorkbookSnapshot shapes
- `lib/nutrition-types.ts` + `lib/nutrition-api.ts` — NutritionSummary shapes
- `lib/colony-types.ts` + `lib/colony-api.ts` — Colony/Drift/Threshold shapes
- `app/(tabs)/nutrition.tsx` — phase picker + meal templates + meal lines + provenance banner
- `app/(tabs)/colony.tsx` — colony coord + drift history + threshold lab + provenance banner
- `app/workbook.tsx` — horizontal version selector, sheet-count pills, 4 panels

## Proof Artifacts
- `docs/migration-logbook.md` — all pass receipts + 13/13 end-to-end proof test results (2026-03-17)
- `docs/workbook-proof-checklist.md` — state-by-state proof with snapshot switching + cascade delete verification
- `docs/biolog-header-map.md` — canonical biolog header map documentation
- `fixtures/logbook03162026.xlsx` — 7-sheet synthetic test fixture

## System Architecture
Expo Router frontend (file-based routing, 6-tab layout). Express backend on port 5000. Postgres via `pg` pool. AsyncStorage for user profiles + Intel recommendation cache.

Core engines:
- **Coaching Engine**: Calorie adjustments and ingredient suggestions
- **Erection/Oscillator Engine**: 3-layer convergent rhythm control; Acute Readiness (50%) + Tissue-Resource (30%) + Endocrine-Seasonal (20%) → composite score with 5 tiers. Route: `GET /api/oscillator`. IMPORTANT: `daily_log.day` is TEXT — use `day::date` in SQL; `sleep_midpoint_minutes` does not exist — compute from `sleep_start`/`sleep_end`; pool import: `import { pool } from "./db.js"` (named, not default)
- **Readiness Engine**: Readiness scores + training templates
- **Canonical Health**: Vendor-agnostic health data layer; idempotent upserts; HRV baseline; session strain scoring; HR oscillation bias detection
- **Vitals v1 Module** (`server/vitals/`): enums, interfaces, macro templates, API routes. `GET /api/vitals/dashboard`, `GET/PATCH /api/vitals/baseline`, `GET/PATCH /api/vitals/recommendation`. Column alias: `bf_morning_pct AS body_fat_pct`
- **Intel Vitals Integration**: Daily log Save Entry → `POST /api/intel/vitals/daily-log`. Intel response stored as `intel_recommendation_{userId}_{date}`
- **Workout Engine**: CBP drain model, phase state machine, RPE-adjusted set logging
- **Muscle Planner**: 17-muscle-group taxonomy, weekly volume tracking
- **Day Classifier**: LEAN_GAIN / CUT / RECOMP / DELOAD / SUPPRESSED states
- **Adherence Metrics**: Bedtime/wake drift, training adherence
- **Cardio + Lift Regulation**: 3x2 architecture (Schedule: alignment/consistency/recovery; Outcome: adequacy/efficiency/continuity)
- **Backup Module**: Versioned export/import with schema migration safety
- **Sleep Alignment**: 3-layer sleep model, TIB/TST, provenance tracking
- **Intervention Memory**: Case-based reasoning with weighted feature similarity
- **Context Lens**: Physiological impact classification around life context tags

UI: dark theme, teal #00D4AA, purple #8B5CF6, Rubik font. Dashboard CAPACITY chart: Readiness + 3 sleep disruption metrics. Regulation triads: horizontal fuel-gauge fill bars (green/amber/red).

## DB Critical Rules
- `daily_log.day` is TEXT type → use `day::date` in SQL for date comparisons
- `sleep_midpoint_minutes` does not exist → compute from `sleep_start`/`sleep_end`
- pool import: `import { pool } from "./db.js"` (named import only)
- `workbook_snapshot_id` is the sole operational authority for all workbook data
- `filename_date` is cosmetic only (display + sort) — never used as activation trigger

## External Dependencies
- **Postgres (Neon)**: Primary database
- **Fitbit API (OAuth 2.0)**: Health and activity data import
- **Expo React Native**: Frontend framework
- **Express.js**: Backend framework
- **pg**: Node.js PostgreSQL client
- **AsyncStorage**: Client-side storage
- **react-native-health**: Apple HealthKit integration
- **react-native-ble-plx**: Polar BLE device integration
