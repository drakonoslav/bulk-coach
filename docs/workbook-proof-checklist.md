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
PATCH /api/workbooks/5/activate (X-User-Id: test_user_workbook_host)
→ { "ok": true, "activatedSnapshotId": 5, "_provenance": { "activeWorkbookSnapshotId": 5 } }

GET /api/snapshots/active
→ { "activeSnapshot": { "id": 5, "isActive": true, "filename": "logbook03162026.xlsx", "filenameDate": "2026-03-16" } }
```
**Verified:** 2026-03-17 end-to-end proof run.

---

### ☑ Biolog reads active workbook
```
GET /api/biolog (X-User-Id: test_user_workbook_host, active: snapshot #5)
→ {
    "count": 3,
    "rows": [ { "phase": "base", "biolog_date": "2026-03-01T00:00:00.000Z", ... }, ... ],
    "_provenance": { "tablesRead": ["biolog_rows"], "activeWorkbookSnapshotId": "5" }
  }
```
**Verified:** 2026-03-17 end-to-end proof run.

---

### ☑ Nutrition reads active workbook
```
GET /api/nutrition/summary (X-User-Id: test_user_workbook_host, active: snapshot #5)
→ {
    "phases": [{"phase":"base","kcal":525,"protein":66,"carbs":42,"fat":7.7},
               {"phase":"peak","kcal":155,"protein":13,"carbs":1,"fat":11}],
    "provenance": { "tablesRead": ["workbook_snapshots","meal_template_rows"], "activeWorkbookSnapshotId": 5 }
  }

GET /api/nutrition?phase=base
→ { "rows": 2, "total": 2, "provenance": { "tablesRead": ["workbook_snapshots","meal_line_rows"] } }
```
**Verified:** 2026-03-17 end-to-end proof run.

---

### ☑ Colony reads active workbook
```
GET /api/colony (X-User-Id: test_user_workbook_host, active: snapshot #5)
→ {
    "colonyCoord": [
      { "metric": "branch_conflict_7d", "value": 4, "status": "unstable", "recommendation": "review arbitration weights" },
      { "metric": "sleep_adequacy_proxy", "value": 0.72, "status": "alert", "recommendation": "increase sleep window" }
    ],
    "driftHistory": [
      { "date": "2026-03-08", "driftType": "schedule_break", "weightedDriftScore": 4, "watchFlag": "review" },
      { "date": "2026-03-01", "driftType": "outcome_mismatch", "weightedDriftScore": 3, "watchFlag": "watch" }
    ],
    "thresholdLab": [
      { "thresholdName": "sleep_adequacy_threshold", "currentValue": 0.75, "suggestedValue": 0.78, "evidenceCount": 6 },
      { "thresholdName": "hrv_floor", "currentValue": 30, "suggestedValue": 32, "evidenceCount": 4 }
    ],
    "_provenance": {
      "tablesRead": ["workbook_snapshots","colony_metric_rows","drift_event_rows","threshold_lab_rows"],
      "activeWorkbookSnapshotId": 5,
      "source": "postgres",
      "activeWorkbookFilename": "logbook03162026.xlsx"
    }
  }
```
**Verified:** 2026-03-17 end-to-end proof run.

---

### ☑ Dashboard reads active workbook
```
GET /api/snapshots/active (X-User-Id: <device-user-id>)
→ { "activeSnapshot": { "id": 5, "filename": "logbook03162026.xlsx", ... } }
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
| DELETE /api/snapshots/:id | workbook_snapshots + all child tables (cascade) | No |
| GET /api/biolog | biolog_rows | Yes → 404 |
| GET /api/nutrition/summary | workbook_snapshots, meal_template_rows | Yes → 404 |
| GET /api/nutrition | workbook_snapshots, meal_line_rows | Yes → 404 |
| GET /api/colony | workbook_snapshots, colony_metric_rows, drift_event_rows, threshold_lab_rows | Yes → 404 |
| POST /api/upload-workbook | workbook_snapshots, snapshot_sheet_rows, biolog_rows, meal_line_rows, meal_template_rows, drift_event_rows, colony_metric_rows, threshold_lab_rows | N/A (creates) |

---

## Snapshot Switching Proof

Activating a different snapshot immediately changes truth across ALL domains:

| State | Colony coord rows | Drift rows | Threshold rows |
|-------|------------------|-----------|----------------|
| Snap 5 active | 2 | 2 | 2 |
| Snap 4 active (old-code upload, no colony rows) | 0 | 0 | 0 |
| Snap 5 re-activated | 2 | 2 | 2 |

**Verified:** 2026-03-17 — PATCH /api/workbooks/4/activate → colony snap shows 4 (no rows). PATCH /api/workbooks/5/activate → colony snap shows 5 (2+2+2 rows).

---

## Cascade Delete Proof

DELETE /api/snapshots/4 → HTTP 200 `{ "ok": true, "deletedId": 4 }`

Post-delete row counts for workbook_snapshot_id=4:

| Table | Count |
|-------|-------|
| workbook_snapshots | 0 |
| biolog_rows | 0 |
| meal_line_rows | 0 |
| meal_template_rows | 0 |
| drift_event_rows | 0 |
| colony_metric_rows | 0 |
| threshold_lab_rows | 0 |

**Verified:** 2026-03-17 — all 7 tables zeroed via FK `ON DELETE CASCADE`.

---

*Last updated: 2026-03-17 — All 13 proof tests PASS. Passes 1–9 complete. Pass 10 (native engine lab) pending parity verification.*
