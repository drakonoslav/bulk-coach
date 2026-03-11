// ═══════════════════════════════════════════════════════════════════════════════
// BulkCoach Vitals — Utility Functions (v1 Build Packet)
// ═══════════════════════════════════════════════════════════════════════════════

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 0): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function safeRatio(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

export function avg(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

export function normalizeFivePoint(value: number | null): number | null {
  if (value == null) return null;
  return clamp(((value - 1) / 4) * 10, 0, 10);
}

export function normalizeThreePointZeroBased(value: number | null): number | null {
  if (value == null) return null;
  return clamp((value / 3) * 10, 0, 10);
}

export function reverseFivePoint(value: number | null): number | null {
  if (value == null) return null;
  return clamp(((5 - value) / 4) * 10, 0, 10);
}

export function trendSlope(vals: (number | null)[]): number | null {
  const pts = vals
    .map((v, i) => v != null ? { x: i, y: v } : null)
    .filter((p): p is { x: number; y: number } => p !== null);
  if (pts.length < 3) return null;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sx2 - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  return (n * sxy - sx * sy) / denom;
}

export function mean(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
}
