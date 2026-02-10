# Conrad Coach v2

A small local CLI tool to log your daily anchors + generate weekly dashboards and adjustment recommendations.

## What it creates
- `conrad_log.json` (your data store)
- `outputs/conrad_dashboard.csv`
- `outputs/conrad_weight.png`
- `outputs/conrad_waist.png` (if waist data exists)
- `outputs/conrad_activity.png` (if steps/cardio/Fitbit activity exists)

## Install
Python 3.10+ recommended.

```bash
pip install pandas matplotlib
```

## Commands

### 1) Show the locked daily checklist
```bash
python conrad_coach_v2.py checklist
```

### 2) Log a day
```bash
python conrad_coach_v2.py log
```

### 3) Weekly report (best after ~14 days)
```bash
python conrad_coach_v2.py report
```

### 4) Weekly dashboard (CSV + graphs)
```bash
python conrad_coach_v2.py dashboard
```

### 5) Fitbit Charge 6 ingest (CSV export)
```bash
python conrad_coach_v2.py fitbit_ingest path/to/fitbit_export.csv
```

The ingester attempts to map common columns (Steps, Calories Burned, Minutes Asleep, Sleep Score, active minutes).
If your CSV uses different column names, tell me the headers and we’ll add a mapping.

## Cardio fuel logic
Baseline includes:

- If `cardio_min > 45` → suggest **+25g carbs** that day (default: dextrin).

Edit in the script:
- `BASELINE["cardio_fuel"]["threshold_min"]` (X)
- `BASELINE["cardio_fuel"]["add_carbs_g"]` (Y)
- `BASELINE["cardio_fuel"]["preferred_source"]` ("dextrin_g" or "oats_g")

## Deload week flag
When logging a day you can mark `deload_week = y`.
If any of the last 14 days are marked deload, the diagnosis logic avoids blaming training for reduced performance.

## Ingredient-adjust priorities
Edit:
`BASELINE["adjust_priority"]`

Current order (least disruptive first):
MCT → Dextrin → Oats → Bananas → Eggs → Flax → Whey → Yogurt
