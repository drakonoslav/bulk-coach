# Conrad Coach v3

Adds body fat (handheld BIA) logging + lean mass calculations + lean gain ratio.

## What’s new in v3
1) **Body fat inputs**: enter 3 AM readings → script stores the average (optional PM readings too)
2) **Auto lean mass**: `lean_mass_lb = morning_weight * (1 - bf%/100)`
3) **Dashboard trend**: creates `outputs/conrad_lean_mass.png` if BF data exists
4) **Lean gain ratio (14d)**: estimates what fraction of weight change appears to be lean:

`lean_gain_ratio = Δ(lean_mass) / Δ(weight)`

Treat this as a **trend signal**, not truth (BIA is hydration-sensitive).

## Install
```bash
pip install pandas matplotlib
```

## Commands
### Daily checklist
```bash
python conrad_coach_v3.py checklist
```

### Log a day
```bash
python conrad_coach_v3.py log
```

### Weekly report (best after ~14 days)
```bash
python conrad_coach_v3.py report
```

### Dashboard (CSV + graphs)
```bash
python conrad_coach_v3.py dashboard
```

### Fitbit ingest (later)
```bash
python conrad_coach_v3.py fitbit_ingest path/to/fitbit_export.csv
```

## Notes on BIA usage (important)
- Prefer **morning** readings (post-bathroom, pre-food/water).
- Enter **3 readings** and let the script average them.
- Use **7-day averages** and **14-day deltas** for decisions.
