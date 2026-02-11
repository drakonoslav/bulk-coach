# Bulk Coach - Recomp Monitor App

## Overview
A mobile fitness tracking app built with Expo React Native that implements a feedback-controlled bulk/recomp system. Users log daily metrics (weight, waist, sleep, activity, adherence) and receive weekly coaching recommendations for calorie adjustments based on their locked meal plan.

## Recent Changes
- 2026-02-10: Initial build - Dashboard, Daily Log, Weekly Report screens
- 2026-02-10: Coaching engine with rolling averages, calorie adjustment, ingredient tweaks, diagnosis
- 2026-02-10: v2 features - Daily Checklist tab, Deload Week flag, Cardio Fuel Guardrail
- 2026-02-10: v3 body composition - BF% inputs (3 AM + optional 3 PM readings with auto-averaging), lean mass/fat mass auto-calculation, lean gain ratio (14d), BIA noise detection in diagnosis
- 2026-02-10: v3.1 rolling lean gain ratio - rolling 14-day lean gain ratio series with color-coded trend chart in Report
- 2026-02-11: v4 erection session tracking - Vitals tab with cumulative snapshot uploads, delta computation, gap-fill imputation (linear interpolation), androgen proxy calculation with 7d rolling averages, badges on Log screen, proxy chart on Report tab with imputed toggle
- 2026-02-11: v4.1 data confidence - confidence endpoint with 7d/14d/30d rolling windows, grading (High/Med/Low/None), measured/imputed/multi-night counts; confidence strips on Vitals and Report tabs; snapshot cleanup on invalid delta; measured-only defaults audited
- 2026-02-11: v4.2 chain recompute - when a snapshot N is inserted between existing snapshots, the next snapshot's derived session is re-derived using the new delta, gap-fill is re-run for the range, and proxy scores are recomputed; applies to all paths (baseline, baseline_seed, mid-chain)

## Architecture
- **Frontend**: Expo Router with file-based routing, 5-tab layout (Dashboard, Log, Plan, Report, Vitals)
- **Backend**: Express server on port 5000 with Postgres (Neon) via pg pool
- **Storage**: Postgres for all data persistence, AsyncStorage for baseline only
- **Engine**: `lib/coaching-engine.ts` - coaching logic; `server/erection-engine.ts` - snapshot parsing, delta computation, gap-fill imputation, androgen proxy calculation
- **Data**: `lib/entry-storage.ts` - API-backed CRUD for daily entries
- **Design**: Dark theme with teal primary (#00D4AA), purple accent (#8B5CF6) for vitals, Rubik font family

## Key Features
- Date navigation on Log screen: prev/next day arrows, "Today"/"Yesterday" labels, "Logged" badge, "Jump to Today" chip, edit past entries
- Daily logging: weight, waist, body fat %, sleep, water, steps, cardio, lift, deload week, adherence, notes
- Body fat tracking: 3 AM readings + optional 3 PM readings, auto-averaged per session
- Lean mass/fat mass auto-calculated from weight and BF%
- Lean gain ratio (14d): delta lean mass / delta weight, clamped -1.0 to 2.0
- Dashboard: lean mass trend card (purple #A78BFA), BF% stat card (pink #F472B6), BF% pills on entries
- Report: lean gain analysis section with color-coded ratio gauge, rolling ratio trend chart, and lean mass trend chart
- Daily Checklist (Plan tab): locked shake-time template with all 12 meal/activity anchors
- 7-day rolling averages and weight trend visualization
- Weekly calorie adjustment recommendations (+0.25-0.5 lb/week target)
- Ingredient-level adjustment suggestions (MCT first, whey last)
- Diet vs Training diagnosis heuristics with deload week suppression and BIA noise detection
- Cardio fuel guardrail: >45min cardio triggers +25g carb suggestion (dextrin preferred)

## Baseline Plan (locked)
- 2695 kcal | P173.9g C330.9g F54.4g
- Adjustment priority: MCT > Dextrin > Oats > Bananas > Eggs > Flax > Whey > Yogurt
- Cardio fuel: threshold 45min, +25g carbs via dextrin
