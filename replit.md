# Bulk Coach - Recomp Monitor App

## Overview
A mobile fitness tracking app built with Expo React Native that implements a feedback-controlled bulk/recomp system. Users log daily metrics (weight, waist, sleep, activity, adherence) and receive weekly coaching recommendations for calorie adjustments based on their locked meal plan.

## Recent Changes
- 2026-02-10: Initial build - Dashboard, Daily Log, Weekly Report screens
- 2026-02-10: Coaching engine with rolling averages, calorie adjustment, ingredient tweaks, diagnosis

## Architecture
- **Frontend**: Expo Router with file-based routing, 3-tab layout (Dashboard, Log, Report)
- **Storage**: AsyncStorage for local data persistence
- **Engine**: `lib/coaching-engine.ts` - all coaching logic (rolling averages, calorie suggestions, macro-safe adjustments, diet vs training diagnosis)
- **Data**: `lib/entry-storage.ts` - AsyncStorage CRUD for daily entries
- **Design**: Dark theme with teal primary (#00D4AA), Rubik font family

## Key Features
- Daily logging: weight, waist, sleep, water, steps, cardio, lift, adherence, notes
- 7-day rolling averages and weight trend visualization
- Weekly calorie adjustment recommendations (+0.25-0.5 lb/week target)
- Ingredient-level adjustment suggestions (MCT first, whey last)
- Diet vs Training diagnosis heuristics

## Baseline Plan (locked)
- 2695 kcal | P173.9g C330.9g F54.4g
- Adjustment priority: MCT > Dextrin > Oats > Bananas > Eggs > Flax > Whey > Yogurt
