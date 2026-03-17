# Biolog Header Map

**Translation layer only.** Maps raw Excel workbook column headers → canonical internal field names.

## Authority Rule

```
Excel header names
  → canonical parser field names (this document)
  → Postgres biolog_rows.raw_json + canonical fields
  → API payloads

NOT:
  legacy app logic → guessed header meaning → silent fallback to daily_log
```

This map is **parser metadata only**. It does NOT:
- trigger fallback to `daily_log` or any legacy source
- recompute or replace `phase_rec` from the workbook
- merge multiple data sources
- infer missing fields

---

## Canonical Field Table

| Workbook Header | Canonical Field | Type | Notes |
|----------------|----------------|------|-------|
| `date` | `biolog_date` | date | Primary row key |
| `phaserec` | `phase_rec` | text | Workbook phase output — canonical, never overridden |
| `bodytemp` | `body_temp` | number | Temperature (°F) |
| `actualbedtime` | `actual_bedtime` | time/text | Actual sleep start |
| `rem_hhmm` | `rem_sleep` | duration | REM sleep duration (HH:MM) |
| `core_hhmm` | `core_sleep` | duration | Core/light sleep duration |
| `deep_hhmm` | `deep_sleep` | duration | Deep sleep duration |
| `awake_hhmm` | `awake_sleep` | duration | Awake-in-bed time |
| `rhr` | `resting_hr` | number | Resting heart rate |
| `hrv` | `hrv` | number | HRV |
| `schedulebedtime` | `scheduled_bedtime` | time/text | Planned sleep target |
| `schedulewaketime` | `scheduled_waketime` | time/text | Planned wake target |
| `bodyweight_lb` | `bodyweight_lb` | number | Body weight (lbs) |
| `bodyfat_pct` | `bodyfat_pct` | number | Body fat % |
| `skeletal_mass_pct` | `skeletal_mass_pct` | number | Skeletal muscle mass % |
| `ffm_lb` | `ffm_lb` | number | Fat-free mass (lbs) from device |
| `waist_in` | `waist_in` | number | Waist circumference (in) |
| `navel_waist_in` | `navel_waist_in` | number | Navel waist circumference (in) |
| `chest_in` | `chest_in` | number | Chest circumference (in) |
| `hips_in` | `hips_in` | number | Hips circumference (in) |
| `neck_in` | `neck_in` | number | Neck circumference (in) |
| `arm_left_in` | `arm_left_in` | number | Left arm circumference (in) |
| `arm_right_in` | `arm_right_in` | number | Right arm circumference (in) |
| `thigh_in` | `thigh_in` | number | Thigh circumference (in); aliases: thigh_left_in, thigh_right_in |

---

## Alias Support

Historical workbooks may have minor naming variations. All aliases resolve to the same canonical field.

| Canonical Field | Accepted Aliases |
|----------------|-----------------|
| `biolog_date` | `date`, `log_date`, `entry_date` |
| `phase_rec` | `phaserec`, `phase_rec`, `phase` |
| `body_temp` | `bodytemp`, `body_temp` |
| `actual_bedtime` | `actualbedtime`, `actual_bedtime` |
| `rem_sleep` | `rem_hhmm`, `rem` |
| `core_sleep` | `core_hhmm`, `core` |
| `deep_sleep` | `deep_hhmm`, `deep` |
| `awake_sleep` | `awake_hhmm`, `awake` |
| `resting_hr` | `rhr` |
| `hrv` | `hrv` |
| `scheduled_bedtime` | `schedulebedtime`, `scheduled_bedtime` |
| `scheduled_waketime` | `schedulewaketime`, `scheduled_waketime` |
| `bodyweight_lb` | `bodyweight_lb`, `weight_lb` |
| `bodyfat_pct` | `bodyfat_pct`, `bodyfat` |
| `ffm_lb` | `ffm_lb`, `ffm` |
| `navel_waist_in` | `navel_waist_in`, `navel_waist` |
| `arm_left_in` | `arm_left_in`, `left_arm` |
| `arm_right_in` | `arm_right_in`, `right_arm` |
| `thigh_in` | `thigh_in`, `thigh_left_in`, `thigh_right_in` |

---

## Normalization Rule

Before matching, all headers are normalized:

```typescript
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/g, "").replace(/_/g, "").trim();
}
```

This means `"Body Temp"`, `"body_temp"`, `"bodytemp"`, and `"BODYTEMP"` all resolve to `"body_temp"`.

---

## Row Storage Contract

Every biolog row parsed from the workbook stores:

1. **Canonical fields** — extracted via this header map
2. **`raw_json`** — the original unmodified workbook row object

No sacred data is lost. The raw_json is the audit trail; canonical fields are for querying.

---

## Derived Metrics Layer

Built on top of canonical fields (see `server/services/biologDerived.ts`):

| Derived Field | Formula |
|--------------|---------|
| `rem_min` | `parseDurationToMinutes(rem_sleep)` |
| `core_min` | `parseDurationToMinutes(core_sleep)` |
| `deep_min` | `parseDurationToMinutes(deep_sleep)` |
| `awake_min` | `parseDurationToMinutes(awake_sleep)` |
| `total_sleep_min` | `rem_min + core_min + deep_min` |
| `total_in_bed_min` | `total_sleep_min + awake_min` |
| `sleep_efficiency_pct` | `total_sleep_min / total_in_bed_min × 100` |
| `rem_pct_of_sleep` | `rem_min / total_sleep_min × 100` |
| `bedtime_deviation_min` | `actual_bedtime_min - scheduled_bedtime_min` (overnight-safe) |
| `fat_mass_lb` | `bodyweight_lb × (bodyfat_pct / 100)` |
| `ffm_calc_lb` | `bodyweight_lb - fat_mass_lb` |
| `ffm_gap_lb` | `ffm_lb - ffm_calc_lb` (device vs. calculated delta) |
| `arm_avg_in` | `(arm_left_in + arm_right_in) / 2` |
| `arm_asymmetry_in` | `abs(arm_left_in - arm_right_in)` |

**Boundary rule:** Derived layer never overrides `phase_rec`. Workbook phase remains canonical.

---

## API Endpoints

| Route | Truth | Returns |
|-------|-------|---------|
| `GET /api/biolog` | `biolog_rows` | Raw canonical rows (biolog_date, phase, raw_json) |
| `GET /api/biolog/derived` | `biolog_rows` | Canonical + derived metrics per row |
| `GET /api/workbook/dashboard` | All 6 tables | Unified cockpit: biolog + nutrition + colony |

---

*Last updated: 2026-03-17 — Passes 1–9b complete. Header map implemented in `server/services/biologCanonical.ts`.*
