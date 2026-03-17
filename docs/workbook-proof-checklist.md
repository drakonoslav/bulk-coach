# Workbook Proof Checklist

Each state must be demonstrable. Check = API receipt exists in migration-logbook.md.

---

## States to Prove

### ☑ No workbook uploaded
```
GET /api/snapshots (X-User-Id: proof-test-001)
→ { "snapshots": [], "_provenance": { "activeWorkbookSnapshotId": null } }

GET /api/snapshots/active (X-User-Id: proof-test-001)
→ 404 "No active workbook snapshot. Upload and activate a workbook first."
```
**Verified:** Step 0 in logbook.

---

### ☑ Workbook uploaded but not active
*(Tested by SQL deactivation, then calling API)*
```
SQL: UPDATE workbook_snapshots SET is_active=FALSE WHERE id=2;

GET /api/snapshots/active
→ 404 "No active workbook snapshot. Upload and activate a workbook first."

GET /api/biolog  →  404 "No active workbook snapshot."
GET /api/nutrition → 404 "No active workbook snapshot."
GET /api/colony  →  404 "No active workbook snapshot."
```
**Verified:** Step 7 deactivation phase in logbook.

---

### ☑ Workbook active
```
PATCH /api/workbooks/2/activate (X-User-Id: proof-test-001)
→ { "ok": true, "activatedSnapshotId": 2, "_provenance": { "activeWorkbookSnapshotId": 2 } }

GET /api/snapshots/active
→ { "activeSnapshot": { "id": 2, "isActive": true, "filename": "logbook03162026.xlsx", "filenameDate": "2026-03-16" } }
```
**Verified:** Step 7 re-activation in logbook.

---

### ☑ Biolog reads active workbook
```
GET /api/biolog (X-User-Id: proof-test-001, active: snapshot #2)
→ {
    "count": 3,
    "rows": [ { "phase": "base", "biolog_date": "2026-03-01", ... }, ... ],
    "_provenance": { "tablesRead": ["biolog_rows"], "activeWorkbookSnapshotId": 2 }
  }
```
**Verified:** Step 4 in logbook. Rows come from `biolog_rows` keyed to `workbook_snapshot_id=2`.

---

### ☑ Nutrition reads active workbook
```
GET /api/nutrition (X-User-Id: proof-test-001, active: snapshot #2)
→ {
    "mealTemplates": { "count": 2, ... },
    "mealLines": { "count": 3, ... },
    "ingredients": { "count": 3, ... },
    "_provenance": { "tablesRead": ["meal_template_rows","meal_line_rows","snapshot_sheet_rows"] }
  }
```
**Verified:** Step 5 in logbook. Tables are `meal_template_rows` + `meal_line_rows` + `snapshot_sheet_rows`.

---

### ☑ Colony reads active workbook
```
GET /api/colony (X-User-Id: proof-test-001, active: snapshot #2)
→ {
    "coords": { "count": 2, "rows": [{ "colony_id": "C1", "x": "0.5", "y": "0.3" }, ...] },
    "drift": { "count": 2 },
    "thresholds": { "count": 2 },
    "_provenance": { "tablesRead": ["snapshot_sheet_rows"], "workbookSnapshotId": 2 }
  }
```
**Verified:** Step 6 in logbook.

---

### ☑ Dashboard reads active workbook
```
GET /api/snapshots/active (X-User-Id: <device-user-id>)
→ { "activeSnapshot": { "id": 2, "filename": "logbook03162026.xlsx", ... } }
```
Dashboard's `fetchActiveSnapshot()` (useFocusEffect) gates the BASELINE macro display:
- No active snapshot → `[LEGACY FALLBACK]` amber badge shown
- Active snapshot → `[WORKBOOK ACTIVE]` green card, nutrition tab referenced

---

### ☑ Legacy paths disabled or visibly quarantined

| Screen | Status |
|--------|--------|
| `report.tsx` | QUARANTINED → `<QuarantinedScreen />` |
| `tracker.tsx` | QUARANTINED → `<QuarantinedScreen />` |
| `checklist.tsx` | QUARANTINED → `<QuarantinedScreen />` |
| `metrics.tsx` | QUARANTINED → `<QuarantinedScreen />` |
| Dashboard BASELINE | Conditional: shown as `[LEGACY FALLBACK]` only when no workbook active |
| Vitals oscillator macros | Labeled `[ADVISORY — Intel-derived macros]` |
| `/api/workbooks` (legacy) | Returns 404 (legacy handler) for any ID that doesn't exist in `workbook_versions` |

---

## Anti-Haunting Proof

| Check | Result |
|-------|--------|
| No workbook → loud failure on canonical routes | ✓ 404 with provenance |
| Missing X-User-Id → loud failure | ✓ 400 on all 5 canonical routes |
| No silent fallback to legacy truth | ✓ No `local_default`, no AsyncStorage fallback in canonical routes |
| No silent fallback to dev dataset | ✓ Routes return 404 if no snapshot, not mock data |
| No screen claiming workbook mode while reading legacy | ✓ Dashboard conditionally shows BASELINE only when no snapshot |

---

## Filename Date Proof

| Input | filenameDate | matched |
|-------|-------------|---------|
| `logbook03162026.xlsx` | `2026-03-16` | true |
| `logbook12312025.xlsm` | `2025-12-31` | true |
| `myworkbook.xlsx` | null | false |
| `logbook99992026.xlsx` | null | false (invalid date) |
| `logbook00002026.xlsx` | null | false (month 0 invalid) |

**Authority rule (NON-NEGOTIABLE):**
> `filename_date` is for display and sorting convenience only.
> `snapshot_id` + explicit `is_active` flag remain the sole operational authority.
> The system will NEVER auto-activate a snapshot based on filename alone.

---

## Tables Read by Each Endpoint (Canonical)

| Route | Tables read | Requires active snapshot |
|-------|-------------|--------------------------|
| GET /api/snapshots | workbook_snapshots | No |
| GET /api/snapshots/active | workbook_snapshots | N/A (checks) |
| PATCH /api/workbooks/:id/activate | workbook_snapshots | No |
| GET /api/biolog | biolog_rows | Yes → 404 |
| GET /api/nutrition | meal_template_rows, meal_line_rows, snapshot_sheet_rows | Yes → 404 |
| GET /api/colony | snapshot_sheet_rows | Yes → 404 |
| POST /api/upload-workbook | workbook_snapshots, snapshot_sheet_rows, biolog_rows, meal_line_rows, meal_template_rows | N/A (creates) |

---

*Last updated: 2026-03-17 — Migration Passes 1–9 + filename_date complete. Pass 10 pending.*
