# Bulk Coach - Recomp Monitor App

## Overview
A mobile fitness tracking app built with Expo React Native that implements a feedback-controlled bulk/recomp system. Users log daily metrics (weight, waist, sleep, activity, adherence) and receive weekly coaching recommendations for calorie adjustments based on their locked meal plan.

## Recent Changes
- 2026-02-10: Initial build - Dashboard, Daily Log, Weekly Report screens
- 2026-02-10: Coaching engine with rolling averages, calorie adjustment, ingredient tweaks, diagnosis
- 2026-02-10: v2 features - Daily Checklist tab, Deload Week flag, Cardio Fuel Guardrail

## Architecture
- **Frontend**: Expo Router with file-based routing, 4-tab layout (Dashboard, Log, Plan, Report)
- **Storage**: AsyncStorage for local data persistence
- **Engine**: `lib/coaching-engine.ts` - all coaching logic (rolling averages, calorie suggestions, macro-safe adjustments, diet vs training diagnosis, cardio fuel notes, deload week handling)
- **Data**: `lib/entry-storage.ts` - AsyncStorage CRUD for daily entries
- **Design**: Dark theme with teal primary (#00D4AA), Rubik font family

## Key Features
- Daily logging: weight, waist, sleep, water, steps, cardio, lift, deload week, adherence, notes
- Daily Checklist (Plan tab): locked shake-time template with all 12 meal/activity anchors
- 7-day rolling averages and weight trend visualization
- Weekly calorie adjustment recommendations (+0.25-0.5 lb/week target)
- Ingredient-level adjustment suggestions (MCT first, whey last)
- Diet vs Training diagnosis heuristics with deload week suppression
- Cardio fuel guardrail: >45min cardio triggers +25g carb suggestion (dextrin preferred)

## Baseline Plan (locked)
- 2695 kcal | P173.9g C330.9g F54.4g
- Adjustment priority: MCT > Dextrin > Oats > Bananas > Eggs > Flax > Whey > Yogurt
- Cardio fuel: threshold 45min, +25g carbs via dextrin
