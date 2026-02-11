export type ReadinessDeltas = {
  sleep_pct: number | null;
  hrv_pct: number | null;
  rhr_bpm: number | null;
  proxy_pct: number | null;
  sleep_str: string;
  hrv_str: string;
  rhr_str: string;
  proxy_str: string;
};

const MIN_BASELINE_FOR_PCT = 1e-6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const round = (v: number, decimals = 0) => {
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
};

const safeNum = (v: number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pctDelta = (curr: number | null, base: number | null): number | null => {
  if (curr === null || base === null) return null;
  if (Math.abs(base) < MIN_BASELINE_FOR_PCT) return null;
  return ((curr - base) / base) * 100;
};

const absDelta = (curr: number | null, base: number | null): number | null => {
  if (curr === null || base === null) return null;
  return curr - base;
};

export const formatSigned = (
  value: number | null,
  opts: { suffix?: string; decimals?: number; clampLo?: number; clampHi?: number } = {}
): string => {
  if (value === null) return "\u2014";
  const decimals = opts.decimals ?? 0;
  let v = value;
  if (opts.clampLo !== undefined && opts.clampHi !== undefined) {
    v = clamp(v, opts.clampLo, opts.clampHi);
  }
  const r = round(v, decimals);
  const sign = r >= 0 ? "+" : "";
  const suffix = opts.suffix ? ` ${opts.suffix}` : "";
  return `${sign}${r}${suffix}`;
};

export const formatSignedPct = (value: number | null, decimals = 0): string => {
  const str = formatSigned(value, { decimals, suffix: "%" });
  return str === "\u2014" ? "\u2014" : str.replace(" %", "%");
};

export type ReadinessInputs = {
  sleepMin_7d?: number | null;
  hrvMs_7d?: number | null;
  rhrBpm_7d?: number | null;
  proxy_7d?: number | null;
  sleepMin_28d?: number | null;
  hrvMs_28d?: number | null;
  rhrBpm_28d?: number | null;
  proxy_28d?: number | null;
};

export function computeReadinessDeltas(inputs: ReadinessInputs): ReadinessDeltas {
  const sleep7 = safeNum(inputs.sleepMin_7d);
  const sleep28 = safeNum(inputs.sleepMin_28d);
  const hrv7 = safeNum(inputs.hrvMs_7d);
  const hrv28 = safeNum(inputs.hrvMs_28d);
  const rhr7 = safeNum(inputs.rhrBpm_7d);
  const rhr28 = safeNum(inputs.rhrBpm_28d);
  const proxy7 = safeNum(inputs.proxy_7d);
  const proxy28 = safeNum(inputs.proxy_28d);

  const sleep_pct_raw = pctDelta(sleep7, sleep28);
  const hrv_pct_raw = pctDelta(hrv7, hrv28);
  const proxy_pct_raw = pctDelta(proxy7, proxy28);
  const rhr_bpm_raw = absDelta(rhr7, rhr28);

  const sleep_pct = sleep_pct_raw === null ? null : clamp(sleep_pct_raw, -50, 50);
  const hrv_pct = hrv_pct_raw === null ? null : clamp(hrv_pct_raw, -50, 50);
  const proxy_pct = proxy_pct_raw === null ? null : clamp(proxy_pct_raw, -80, 80);
  const rhr_bpm = rhr_bpm_raw === null ? null : clamp(rhr_bpm_raw, -20, 20);

  return {
    sleep_pct,
    hrv_pct,
    rhr_bpm,
    proxy_pct,
    sleep_str: formatSignedPct(sleep_pct, 0),
    hrv_str: formatSignedPct(hrv_pct, 0),
    proxy_str: formatSignedPct(proxy_pct, 0),
    rhr_str: formatSigned(rhr_bpm, { decimals: 0, suffix: "bpm" }),
  };
}
