# Conrad Coach v3.1

This is v3 plus a rolling lean gain ratio series in the dashboard.

## New in v3.1
- Dashboard CSV includes:
  - `lean_gain_ratio_14d` (single snapshot over the most recent ~14 days with BF data)
  - `lean_gain_ratio_14d_roll` (rolling 14-day ratio per day, clamped to [-1.0, 2.0] for readability)

## Commands
```bash
python conrad_coach_v3_1.py log
python conrad_coach_v3_1.py report
python conrad_coach_v3_1.py dashboard
python conrad_coach_v3_1.py fitbit_ingest path/to/fitbit_export.csv
```

## Notes
- The rolling ratio only computes on days where it has at least 2 lean-mass points inside the 14-day window.
- Treat the ratio as a trend signal; hydration swings can move BIA estimates.
