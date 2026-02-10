# Bulk Coach - Recomp Monitor App

## Overview
A mobile fitness tracking app built with Expo React Native that implements a feedback-controlled bulk/recomp system. Users log daily metrics (weight, waist, sleep, activity, adherence) and receive weekly coaching recommendations for calorie adjustments based on their locked meal plan.

## Recent Changes
- 2026-02-10: Initial build - Dashboard, Daily Log, Weekly Report screens
- 2026-02-10: Coaching engine with rolling averages, calorie adjustment, ingredient tweaks, diagnosis
- 2026-02-10: v2 features - Daily Checklist tab, Deload Week flag, Cardio Fuel Guardrail
- 2026-02-10: v3 body composition - BF% inputs (3 AM + optional 3 PM readings with auto-averaging), lean mass/fat mass auto-calculation, lean gain ratio (14d), BIA noise detection in diagnosis
- 2026-02-10: v3.1 rolling lean gain ratio - rolling 14-day lean gain ratio series with color-coded trend chart in Report

## Architecture
- **Frontend**: Expo Router with file-based routing, 4-tab layout (Dashboard, Log, Plan, Report)
- **Storage**: AsyncStorage for local data persistence
- **Engine**: `lib/coaching-engine.ts` - all coaching logic (rolling averages, calorie suggestions, macro-safe adjustments, diet vs training diagnosis, cardio fuel notes, deload week handling)
- **Data**: `lib/entry-storage.ts` - AsyncStorage CRUD for daily entries
- **Design**: Dark theme with teal primary (#00D4AA), Rubik font family

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
