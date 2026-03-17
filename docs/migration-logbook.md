# BulkCoach Migration Logbook

Every pass in the "safe gut renovation" produces a receipt-level log.
Entries follow the forensic format: endpoint called, headers, response, tables, provenance.

---

## Pass 1 — Inventory
**Status:** COMPLETE  
**Date:** 2026-03-17  
**Files changed:** *(none — read-only audit)*  
**Source of truth after pass:** Legacy (`daily_log`, `workbook_versions`, AsyncStorage)  
**Steps:** Mapped all persistence paths (daily_log, MemStorage, workbook_versions, AsyncStorage).  
**Results:** MemStorage confirmed used in 3 routes. `workbook_versions` was legacy non-canonical. `local_default` fallback found in 6+ routes.  
**Unresolved risks:** All — full system on legacy.

---

## Pass 2 — Source-of-Truth Matrix (R1–R5)
**Status:** COMPLETE  
**Authority decisions locked:**
- R1: `workbook_snapshots.meal_templates` overrides `BASELINE` + AsyncStorage cache for nutrition targets
- R2: `workbook_snapshots.biolog` phase overrides `day_classifier`
- R3: `workbook_snapshots.ingredients` is canonical ingredient source
- R4: `workbook_snapshots.meal_lines`/`meal_templates` override `macro-templates.ts`
- R5: `workbook_snapshots.colony_coord`/`drift_history`/`threshold_lab` override runtime colony state

---

## Pass 3 — Freeze Unsafe Writes
**Status:** COMPLETE  
**Files changed:** MemStorage gutted, tracker/checklist/metrics quarantined.  
**Quarantined:** `app/(tabs)/tracker.tsx`, `app/(tabs)/checklist.tsx`, `app/(tabs)/metrics.tsx` → `<QuarantinedScreen />`  
**Source of truth after pass:** Postgres `daily_log` + emerging `workbook_snapshots`

---

## Pass 4 — Clean Postgres Schema
**Status:** COMPLETE  
**Migrations applied:**
- `036`: `workbook_snapshots`, `biolog_rows`
- `002`: `meal_line_rows`, `meal_template_rows`
- `003`: `workbook_snapshots.filename_date DATE` + index `(user_id, filename_date DESC)`
- `003b`: `snapshot_sheet_rows (workbook_snapshot_id, sheet_name, row_index, raw_json)` — canonical raw storage (NOT legacy `workbook_sheet_rows` which references `workbook_versions`)

**Tables created:**

| Table | FK | Purpose |
|-------|-----|---------|
| `workbook_snapshots` | — | Snapshot metadata, `is_active`, `filename`, `filename_date` |
| `snapshot_sheet_rows` | `workbook_snapshots(id)` | All raw sheet rows (new canonical) |
| `biolog_rows` | `workbook_snapshots(id)` | Normalized biolog data |
| `meal_line_rows` | `workbook_snapshots(id)` | Normalized meal line data |
| `meal_template_rows` | `workbook_snapshots(id)` | Normalized meal template data |

**IMPORTANT:** `workbook_sheet_rows` references `workbook_versions(id)` — legacy, do not use.

---

## Pass 5 — Rebuild Upload/Parsing Spine
**Status:** COMPLETE  
**Files changed:** `server/routes/upload.ts`, `server/services/workbookParser.ts`

**POST /api/upload-workbook — receipts:**

```
Request:
  POST http://localhost:5000/api/upload-workbook
  Authorization: Bearer 68351486835148
  X-User-Id: proof-test-001
  Content-Type: multipart/form-data
  file: logbook03162026.xlsx (fixture, 7 sheets)

Response (HTTP 201):
  {
    "ok": true,
    "workbookSnapshotId": 2,
    "filename": "logbook03162026.xlsx",
    "filenameDate": "2026-03-16",
    "filenameMatchedLogbookPattern": true,
    "_provenance": {
      "userId": "proof-test-001",
      "activeWorkbookSnapshotId": 2,
      "tablesWritten": ["workbook_snapshots","snapshot_sheet_rows","biolog_rows","meal_line_rows","meal_template_rows"],
      "source": "uploaded_workbook",
      "filenameMatchedLogbookPattern": true
    },
    "rowCounts": {
      "biolog": 3,
      "ingredients": 3,
      "meal_lines": 3,
      "meal_templates": 2,
      "drift_history": 2,
      "colony_coord": 2,
      "threshold_lab": 2
    },
    "warnings": []
  }

DB verify:
  workbook_snapshots:    id=2, filename_date=2026-03-16, is_active=true
  snapshot_sheet_rows:   7 sheet_name groups (3+3+3+2+2+2+2 rows)
  biolog_rows:           3 rows (workbook_snapshot_id=2)
```

---

## Pass 6 — Active Snapshot Selection
**Status:** COMPLETE  
**Routes:**

```
PATCH /api/workbooks/:id/activate  (canonical frontend contract)
PATCH /api/snapshots/:id/activate  (backward-compat alias)
```

**Test — Step 7 (deactivate via SQL, re-activate via API):**

```
1. SQL: UPDATE workbook_snapshots SET is_active=FALSE WHERE id=2;
2. GET /api/snapshots/active → 404 "No active workbook snapshot..."
3. PATCH /api/workbooks/2/activate →
   { "ok": true, "activatedSnapshotId": 2, "_provenance": { "activeWorkbookSnapshotId": 2 } }
4. GET /api/snapshots/active →
   { "activeSnapshot": { "id": 2, "isActive": true, ... } }
```

**CONFIRMED:** Activation is always explicit. No auto-select from filename.

---

## Pass 7 — Reconnect Screens to Workbook Truth
**Status:** COMPLETE

**GET /api/biolog — receipts:**
```
X-User-Id: proof-test-001  → active snapshot 2
Response: { count: 3, rows: [{ phase: "base", biolog_date: "2026-03-01" }, ...], _provenance: { tablesRead: ["biolog_rows"] } }
```

**GET /api/nutrition — receipts:**
```
Response: { mealTemplates: { count: 2 }, mealLines: { count: 3 }, ingredients: { count: 3 },
  _provenance: { tablesRead: ["meal_template_rows","meal_line_rows","snapshot_sheet_rows"] } }
```

**GET /api/colony — receipts:**
```
Response: { coords: { count: 2, rows: [{ colony_id: "C1", x: "0.5", ... }] },
            drift: { count: 2 }, thresholds: { count: 2 },
  _provenance: { tablesRead: ["snapshot_sheet_rows"], workbookSnapshotId: 2 } }
```

**GET /api/snapshots (list) — receipts:**
```
Response: {
  snapshots: [{ id: 2, filename: "logbook03162026.xlsx", filenameDate: "2026-03-16",
                isActive: true, rowCounts: { biolog:3, ... } }],
  _provenance: { activeWorkbookSnapshotId: 2 }
}
```

---

## Pass 8 — Provenance Display
**Status:** COMPLETE  
**ProvenanceBanner** rendered on every API response.  
Every response includes `_provenance.db`, `_provenance.userId`, `_provenance.activeWorkbookSnapshotId`, `_provenance.tablesRead`.

---

## Pass 9 — Legacy Screen Disconnection
**Status:** COMPLETE

| Screen | Action | R-matrix violation |
|--------|--------|-------------------|
| `report.tsx` | QUARANTINED | R1/R2/R4 (coaching-engine BASELINE) |
| `index.tsx` (Dashboard) | BASELINE behind `[LEGACY FALLBACK]` amber badge when no workbook; replaced by `[WORKBOOK ACTIVE]` green card when snapshot active | R1 |
| `vitals.tsx` | Oscillator macro prescription labeled `[ADVISORY]` | R1 |
| `tracker.tsx` | QUARANTINED (Pass 3) | — |
| `checklist.tsx` | QUARANTINED (Pass 3) | — |
| `metrics.tsx` | QUARANTINED (Pass 3) | — |

---

## Filename Date Support (Pass 5b)
**Status:** COMPLETE

**Utility:** `server/services/workbookFilename.ts`  
**Pattern:** `^logbook(\d{2})(\d{2})(\d{4})\.(xlsx|xlsm)$` (case-insensitive)  
**Result:** `logbook03162026.xlsx` → `filenameDate: "2026-03-16"` ✓  
**Non-match:** any other filename → `filenameDate: null`, no failure.  
**Authority rule:** `filename_date` is cosmetic only. `snapshot_id` + `is_active` = operational truth.

---

## X-User-Id Enforcement (Step 8)
**All canonical routes return HTTP 400 without X-User-Id:**

| Route | Without X-User-Id |
|-------|-------------------|
| GET /api/snapshots | 400 ✓ |
| GET /api/snapshots/active | 400 ✓ |
| GET /api/biolog | 400 ✓ |
| GET /api/nutrition | 400 ✓ |
| GET /api/colony | 400 ✓ |

---

## Pass 10 — Native Engine Lab
**Status:** PENDING (after parity)

---

## Fixture Used for Proof

**File:** `fixtures/logbook03162026.xlsx`  
**Generated by:** `node --input-type=module` inline script using `xlsx` package  
**Sheets (7):** biolog (3 rows), ingredients (3), meal_lines (3), meal_templates (2), drift_history (2), colony_coord (2), threshold_lab (2)  
**Purpose:** Proves upload→activate→read mechanism without hardcoding real workbook contents.  
**Marker:** All rows contain `"note": "FIXTURE-TEST"` to distinguish from real data.

---

## End-to-End Proof Run — 2026-03-17 (Passes 5-9 Complete)

**Status:** ALL 13 TESTS PASS  
**User:** `test_user_workbook_host`  
**Active Snapshot for Proof:** id=5, `logbook03162026.xlsx`, filenameDate=2026-03-16

### Tables Populated (snapshot 5)
| Table | Rows |
|-------|------|
| workbook_snapshots | 1 |
| biolog_rows | 3 |
| meal_line_rows | 3 |
| meal_template_rows | 2 |
| drift_event_rows | 2 |
| colony_metric_rows | 2 |
| threshold_lab_rows | 2 |

### Test Results
| Test | Description | Result |
|------|-------------|--------|
| T0 | No X-User-Id → 400 | PASS |
| T1 | No active snapshot → 404 | PASS |
| T2 | Upload → 201 + 8 tables written | PASS |
| T3 | Snapshot list shows uploaded workbook | PASS |
| T4 | Activate via PATCH /workbooks/:id | PASS |
| T5 | GET /snapshots/active returns correct | PASS |
| T6 | GET /biolog from active snapshot (3 rows) | PASS |
| T7 | GET /nutrition/* from active snapshot (phases + lines) | PASS |
| T8 | GET /colony from active snapshot (coord:2 drift:2 threshold:2) | PASS |
| T9 | _provenance on every response (activeWorkbookSnapshotId=5 on all) | PASS |
| T10 | Snapshot switch: activate snap 4 → colony 0 rows | PASS |
| T11 | Re-activate snap 5 → colony 2+2+2 rows restored | PASS |
| T12 | DELETE /api/snapshots/4 → cascade: all 7 tables zeroed | PASS |
| T13 | ghost_user_no_snaps → 404 "No active workbook snapshot" | PASS |

### Provenance Snapshot (at T9)
| Route | activeWorkbookSnapshotId | tablesRead |
|-------|-------------------------|------------|
| GET /api/snapshots | 5 | workbook_snapshots |
| GET /api/snapshots/active | 5 | workbook_snapshots |
| GET /api/biolog | 5 | biolog_rows |
| GET /api/nutrition/summary | 5 | workbook_snapshots, meal_template_rows |
| GET /api/nutrition?phase=base | 5 | workbook_snapshots, meal_line_rows |
| GET /api/colony | 5 | workbook_snapshots, colony_metric_rows, drift_event_rows, threshold_lab_rows |
