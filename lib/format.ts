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

export function fmtRaw(x: number | null | undefined, decimals: number = 2): string {
  if (x == null) return "—";
  return x.toFixed(decimals);
}

export function fmtDelta(x: number | null | undefined, decimals: number = 2, suffix: string = ""): string {
  if (x == null) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(decimals)}${suffix}`;
}

export function fmtVal(x: number | null | undefined, decimals: number = 1, fallback: string = "--"): string {
  if (x == null) return fallback;
  return x.toFixed(decimals);
}

export function fmtInt(x: number | null | undefined, fallback: string = "—"): string {
  if (x == null || !Number.isFinite(x)) return fallback;
  return String(Math.round(x));
}

export function fmtPctInt(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${x.toFixed(0)}%`;
}

export function fmtPctVal(x: number | null | undefined, decimals: number = 1): string {
  if (x == null) return "--";
  return `${x.toFixed(decimals)}%`;
}

export function fmtFracToPctInt(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${(x * 100).toFixed(0)}%`;
}

export function scoreColor(v: number | null | undefined, thresholds?: { good?: number; warn?: number }): string {
  const good = thresholds?.good ?? 90;
  const warn = thresholds?.warn ?? 70;
  if (v == null) return "#6B7280";
  return v >= good ? "#34D399" : v >= warn ? "#FBBF24" : "#EF4444";
}
