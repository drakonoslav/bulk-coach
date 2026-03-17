# Quarantined Server Files — Pass 3

These files are NOT deleted. They are quarantined: removed from the critical truth path.
They must not be registered, imported by new routes, or allowed to shadow workbook truth.

## Rules
- Do NOT import these files from any new route module
- Do NOT allow these to write to workbook_snapshots, workbook_sheet_rows, or biolog_rows
- Each file may be re-evaluated and graduated to a native engine lab in Pass 10

## Quarantined Engine Files

| File | Reason | Replacement target |
|------|--------|--------------------|
| server/erection-engine.ts | Derived computation, not workbook truth | Pass 10 engine lab |
| server/hpa-engine.ts | Advanced computation layer | Pass 10 engine lab |
| server/hpa-classifier.ts | Derived classification | Pass 10 engine lab |
| server/oscillator-engine.ts | Experimental composite scoring | Pass 10 engine lab |
| server/day-classifier.ts | Derived day state, not workbook truth | Pass 10 engine lab |
| server/readiness-engine.ts | Derived readiness scoring | Pass 10 engine lab |
| server/readiness-deltas.ts | Derived delta computation | Pass 10 engine lab |
| server/context-lens.ts | Interpretive/contextual layer | Pass 10 engine lab |
| server/cardio-regulation.ts | Behavior regulation layer | Pass 10 engine lab |
| server/lift-regulation.ts | Behavior regulation layer | Pass 10 engine lab |
| server/muscle-planner.ts | Training planning layer | Pass 10 engine lab |
| server/forecast-engine.ts | Prediction/forecast layer | Pass 10 engine lab |
| server/schedule-stability.ts | Derived schedule analysis | Pass 10 engine lab |
| server/sleep-alignment.ts | Derived sleep analysis | Pass 10 engine lab |

## Quarantined Import/Backup Files

| File | Reason | Replacement target |
|------|--------|--------------------|
| server/fitbit-import.ts | External device data path | Adapters phase (Pass 10+) |
| server/fitbit-takeout.ts | External device data path | Adapters phase (Pass 10+) |
| server/backup.ts | Parallel persistence path | Snapshot system replaces it |
| server/recompute.ts | Recomputation of non-workbook data | Pass 10 engine lab |
| server/canonical-health.ts | Shadow truth path for health data | Workbook snapshot replaces it |
| server/workout-persistence.ts | Legacy write path | Workbook-derived truth in Pass 7+ |

## Quarantined Persistence

| File | Reason | Replacement target |
|------|--------|--------------------|
| server/storage.ts | MemStorage DISABLED — in-memory is not a truth source | Postgres only |

## Status
These files remain on disk at their original paths. They are still imported by
server/routes.ts (the legacy monolith). That is acceptable during the migration —
routes.ts itself is a legacy path. New routes in server/routes/ do NOT import these.

The migration plan for routes.ts is Pass 9: split or disable the legacy monolith
once all screens that depended on it have been reconnected to workbook truth.

## Source of Truth After Pass 3
- NEW: workbook_snapshots + workbook_sheet_rows + biolog_rows (Postgres)
- LEGACY (frozen): workbook_versions, daily_log (Postgres, not growing)
- DISABLED: MemStorage (server/storage.ts)
- QUARANTINED: all engine files above (not on the new route path)
