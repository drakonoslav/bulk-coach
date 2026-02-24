export function fmtScore100(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${x.toFixed(2)} / 100.00`;
}

export function fmtScore110(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${x.toFixed(2)} / 110.00`;
}

export function fmtPctFromFrac(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${(x * 100).toFixed(2)}%`;
}

export function fmtPct(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${x.toFixed(2)}%`;
}

export function fmtMin(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${Math.round(x)}m`;
}

export function fmtMin2(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${x.toFixed(2)}m`;
}

export function fmtRaw(x: number | null | undefined): string {
  if (x == null) return "—";
  return x.toFixed(2);
}

export function scoreColor(v: number | null | undefined, thresholds?: { good?: number; warn?: number }): string {
  const good = thresholds?.good ?? 90;
  const warn = thresholds?.warn ?? 70;
  if (v == null) return "#6B7280";
  return v >= good ? "#34D399" : v >= warn ? "#FBBF24" : "#EF4444";
}
