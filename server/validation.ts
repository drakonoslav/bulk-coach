const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function parseStrictISO(ts: string): Date | null {
  if (typeof ts !== 'string') return null;
  if (!ISO_REGEX.test(ts)) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function isValidDateString(date: string): boolean {
  if (typeof date !== 'string') return false;
  if (!DATE_REGEX.test(date)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

export function validateHrBpm(val: number): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= 25 && val <= 250;
}

export function validateRrMs(val: number): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= 300 && val <= 2000;
}

export function validateSleepMinutes(val: number): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1000;
}

export function validateRestingHr(val: number | null | undefined): boolean {
  if (val == null) return true;
  return typeof val === 'number' && Number.isFinite(val) && val >= 25 && val <= 250;
}

export function toUTCDateString(ts: string, timezone?: string | null): string {
  if (timezone) {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts.slice(0, 10);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d);
      const y = parts.find(p => p.type === 'year')?.value;
      const m = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      if (y && m && day) return `${y}-${m}-${day}`;
    } catch {
    }
  }
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function ensureUTCTimestamp(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toISOString();
}

export function validateHrSamples(samples: any[]): ValidationResult {
  const errors: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s.ts || !parseStrictISO(s.ts)) {
      errors.push(`samples[${i}].ts: invalid ISO timestamp "${s.ts}"`);
    }
    if (!validateHrBpm(s.hr_bpm)) {
      errors.push(`samples[${i}].hr_bpm: out of range [25-250], got ${s.hr_bpm}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateRrIntervals(intervals: any[]): ValidationResult {
  const errors: string[] = [];
  for (let i = 0; i < intervals.length; i++) {
    const r = intervals[i];
    if (!r.ts || !parseStrictISO(r.ts)) {
      errors.push(`intervals[${i}].ts: invalid ISO timestamp "${r.ts}"`);
    }
    if (!validateRrMs(r.rr_ms)) {
      errors.push(`intervals[${i}].rr_ms: out of range [300-2000], got ${r.rr_ms}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateSleepSummaryInput(s: any): ValidationResult {
  const errors: string[] = [];
  if (!s.date || !isValidDateString(s.date)) {
    errors.push(`date: invalid date string "${s.date}"`);
  }
  if (s.total_sleep_minutes != null && !validateSleepMinutes(s.total_sleep_minutes)) {
    errors.push(`total_sleep_minutes: out of range [0-1000], got ${s.total_sleep_minutes}`);
  }
  if (s.sleep_start && !parseStrictISO(s.sleep_start)) {
    errors.push(`sleep_start: invalid ISO timestamp "${s.sleep_start}"`);
  }
  if (s.sleep_end && !parseStrictISO(s.sleep_end)) {
    errors.push(`sleep_end: invalid ISO timestamp "${s.sleep_end}"`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateVitalsDailyInput(v: any): ValidationResult {
  const errors: string[] = [];
  if (!v.date || !isValidDateString(v.date)) {
    errors.push(`date: invalid date string "${v.date}"`);
  }
  if (!validateRestingHr(v.resting_hr_bpm)) {
    errors.push(`resting_hr_bpm: out of range [25-250], got ${v.resting_hr_bpm}`);
  }
  if (v.hrv_rmssd_ms != null && (typeof v.hrv_rmssd_ms !== 'number' || v.hrv_rmssd_ms < 0 || v.hrv_rmssd_ms > 500)) {
    errors.push(`hrv_rmssd_ms: out of range [0-500], got ${v.hrv_rmssd_ms}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateWorkoutSessionInput(w: any): ValidationResult {
  const errors: string[] = [];
  if (!w.session_id) {
    errors.push('session_id is required');
  }
  if (!w.start_ts || !parseStrictISO(w.start_ts)) {
    errors.push(`start_ts: invalid ISO timestamp "${w.start_ts}"`);
  }
  if (w.end_ts && !parseStrictISO(w.end_ts)) {
    errors.push(`end_ts: invalid ISO timestamp "${w.end_ts}"`);
  }
  const validTypes = ['strength', 'cardio', 'hiit', 'flexibility', 'other'];
  if (!validTypes.includes(w.workout_type)) {
    errors.push(`workout_type: must be one of ${validTypes.join(', ')}, got "${w.workout_type}"`);
  }
  return { ok: errors.length === 0, errors };
}

export const SOURCE_PRIORITY: Record<string, number> = {
  healthkit: 1,
  polar: 2,
  fitbit: 3,
  manual: 4,
  unknown: 5,
};

export function hasHigherSourcePriority(newSource: string, existingSource: string): boolean {
  const newP = SOURCE_PRIORITY[newSource] ?? 99;
  const existingP = SOURCE_PRIORITY[existingSource] ?? 99;
  return newP <= existingP;
}
