#!/usr/bin/env python3
"""
Conrad Coach v3
Adds:
1) Body fat inputs (handheld BIA) with 3-reading average (AM; optional PM)
2) Auto-calculated lean mass + fat mass
3) Lean mass trend line in dashboard
4) "Lean gain ratio" indicator (what % of weight change appears to be lean)

Core features retained from v2:
- Daily checklist (locked shake-time template + anchors)
- Daily logging: sleep, water, weights, waist, training, cardio, deload flag
- Optional Fitbit Charge 6 CSV ingest
- Weekly report + dashboard CSV + graphs
- Cardio fuel guardrail: if cardio minutes > X then suggest +Y carbs (note)
"""

from __future__ import annotations
import json
import os
import sys
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

import pandas as pd
import matplotlib.pyplot as plt

DATA_PATH = os.path.join(os.path.dirname(__file__), "conrad_log.json")
OUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUT_DIR, exist_ok=True)

# -------------------------
# Locked baseline plan
# -------------------------
BASELINE = {
    "calories": 2695.2,
    "protein_g": 173.9,
    "carbs_g": 330.9,
    "fat_g": 54.4,
    "items_g": {
        "oats_g": 244,
        "dextrin_g": 120,
        "whey_g": 90,
        "mct_g": 30,
        "flax_g": 60,
        "yogurt_cups": 1,
        "eggs": 2,
        "bananas": 2,
    },
    # What to change first when adjusting calories (least disruptive first)
    "adjust_priority": [
        "mct_g", "dextrin_g", "oats_g", "bananas", "eggs", "flax_g", "whey_g", "yogurt_cups"
    ],
    # Cardio fuel guardrail:
    "cardio_fuel": {
        "threshold_min": 45,   # X
        "add_carbs_g": 25,     # Y (grams carbs)
        "preferred_source": "dextrin_g",  # or "oats_g"
    },
}

# Calorie density assumptions (tuned to your logged brands)
KCAL_PER_UNIT = {
    "oats_g": 4.0,
    "dextrin_g": 3.87,
    "whey_g": 3.76,
    "mct_g": 7.0,
    "flax_g": 3.24,
    "bananas": 104.0,
    "eggs": 77.5,
    "yogurt_cups": 149.5,
}

# Daily checklist template (your exact timing + grams)
DAILY_CHECKLIST = [
    ("05:30", "Wake", "Water + electrolytes"),
    ("05:30", "Pre-cardio", "1 banana + water + pinch salt"),
    ("06:00–06:40", "Zone 2 rebounder", "Steady Zone 2"),
    ("06:45", "Post-cardio shake", "Oats 120g + Whey 25g + MCT 10g"),
    ("07:00–15:00", "Work", "Anchor block"),
    ("10:30", "Mid-morning shake", "Greek yogurt 1 cup + Flax 30g + Whey 15g"),
    ("14:45", "Pre-lift shake", "Dextrin 80g + Whey 20g"),
    ("15:45–17:00", "Lift", "Push/Pull"),
    ("17:10", "Post-lift shake", "Dextrin 40g + Whey 30g"),
    ("20:00", "Evening recovery meal", "Oats 124g + Flax 30g + MCT 20g + Eggs 2 + Banana 1"),
    ("21:30", "Wind down", "Evening protein + downshift"),
    ("21:45", "Sleep", "Lights out"),
]

# -------------------------
# Data model
# -------------------------
@dataclass
class DailyEntry:
    day: str  # YYYY-MM-DD
    morning_weight_lb: float
    evening_weight_lb: Optional[float] = None
    waist_in: Optional[float] = None

    # Handheld BIA body fat inputs
    bf_morning_pct: Optional[float] = None
    bf_morning_r1: Optional[float] = None
    bf_morning_r2: Optional[float] = None
    bf_morning_r3: Optional[float] = None

    bf_evening_pct: Optional[float] = None
    bf_evening_r1: Optional[float] = None
    bf_evening_r2: Optional[float] = None
    bf_evening_r3: Optional[float] = None

    sleep_start: Optional[str] = None  # HH:MM
    sleep_end: Optional[str] = None    # HH:MM
    sleep_quality_1to5: Optional[int] = None

    water_liters_extra: Optional[float] = None  # outside shakes
    steps: Optional[int] = None
    cardio_min: Optional[int] = None
    lift_done: Optional[bool] = None
    deload_week: Optional[bool] = None

    performance_note: Optional[str] = None
    adherence_0to1: float = 1.0
    notes: Optional[str] = None

# -------------------------
# Storage
# -------------------------
def load_data() -> Dict:
    if not os.path.exists(DATA_PATH):
        return {"baseline": BASELINE, "entries": [], "fitbit": []}
    with open(DATA_PATH, "r") as f:
        data = json.load(f)
    data.setdefault("baseline", BASELINE)
    data.setdefault("entries", [])
    data.setdefault("fitbit", [])
    return data

def save_data(data: Dict) -> None:
    with open(DATA_PATH, "w") as f:
        json.dump(data, f, indent=2)

def today_str() -> str:
    return date.today().strftime("%Y-%m-%d")

def input_float(prompt: str, allow_blank: bool = False) -> Optional[float]:
    while True:
        s = input(prompt).strip()
        if allow_blank and s == "":
            return None
        try:
            return float(s)
        except ValueError:
            print("Enter a number.")

def input_int(prompt: str, allow_blank: bool = False) -> Optional[int]:
    while True:
        s = input(prompt).strip()
        if allow_blank and s == "":
            return None
        try:
            return int(s)
        except ValueError:
            print("Enter an integer.")

def input_bool(prompt: str, allow_blank: bool = False) -> Optional[bool]:
    while True:
        s = input(prompt + " [y/n]: ").strip().lower()
        if allow_blank and s == "":
            return None
        if s in ("y", "yes"):
            return True
        if s in ("n", "no"):
            return False
        print("Enter y or n.")

def avg3(a: Optional[float], b: Optional[float], c: Optional[float]) -> Optional[float]:
    vals = [v for v in (a, b, c) if v is not None]
    if len(vals) != 3:
        return None
    return sum(vals) / 3.0

# -------------------------
# Checklist
# -------------------------
def show_checklist() -> None:
    print("\n=== Daily Checklist (Locked Template) ===")
    for t, label, detail in DAILY_CHECKLIST:
        print(f"- {t} | {label}: {detail}")
    print("========================================\n")

# -------------------------
# Logging
# -------------------------
def log_entry() -> None:
    data = load_data()
    show_checklist()

    day = input(f"Date (YYYY-MM-DD) [{today_str()}]: ").strip() or today_str()

    morning_weight = float(input_float("Morning weight (lb): "))
    evening_weight = input_float("Evening weight (lb) [blank ok]: ", allow_blank=True)
    waist_in = input_float("Waist at navel (in) [blank ok]: ", allow_blank=True)

    print("\nHandheld BF (BIA) — Morning (3 readings). Leave blank to skip.")
    bf_m1 = input_float("  BF% AM reading 1 [blank ok]: ", allow_blank=True)
    bf_m2 = input_float("  BF% AM reading 2 [blank ok]: ", allow_blank=True)
    bf_m3 = input_float("  BF% AM reading 3 [blank ok]: ", allow_blank=True)
    bf_m_avg = avg3(bf_m1, bf_m2, bf_m3)

    print("\nHandheld BF (BIA) — Evening (optional; 3 readings). Leave blank to skip.")
    bf_e1 = input_float("  BF% PM reading 1 [blank ok]: ", allow_blank=True)
    bf_e2 = input_float("  BF% PM reading 2 [blank ok]: ", allow_blank=True)
    bf_e3 = input_float("  BF% PM reading 3 [blank ok]: ", allow_blank=True)
    bf_e_avg = avg3(bf_e1, bf_e2, bf_e3)

    entry = DailyEntry(
        day=day,
        morning_weight_lb=morning_weight,
        evening_weight_lb=evening_weight,
        waist_in=waist_in,

        bf_morning_pct=bf_m_avg,
        bf_morning_r1=bf_m1, bf_morning_r2=bf_m2, bf_morning_r3=bf_m3,

        bf_evening_pct=bf_e_avg,
        bf_evening_r1=bf_e1, bf_evening_r2=bf_e2, bf_evening_r3=bf_e3,

        sleep_start=(input("\nSleep start HH:MM [blank ok]: ").strip() or None),
        sleep_end=(input("Sleep end HH:MM [blank ok]: ").strip() or None),
        sleep_quality_1to5=input_int("Sleep quality 1–5 [blank ok]: ", allow_blank=True),

        water_liters_extra=input_float("Water liters outside shakes [blank ok]: ", allow_blank=True),
        steps=input_int("Steps [blank ok]: ", allow_blank=True),
        cardio_min=input_int("Cardio minutes [blank ok]: ", allow_blank=True),
        lift_done=input_bool("Lift done", allow_blank=True),
        deload_week=input_bool("Deload week (planned)?", allow_blank=True),

        performance_note=(input("Performance note (optional): ").strip() or None),
        adherence_0to1=float(input_float("Adherence 0–1 (1=hit plan) [default 1]: ", allow_blank=True) or 1.0),
        notes=(input("Notes (optional): ").strip() or None),
    )

    # Replace existing day
    entries = [e for e in data["entries"] if e["day"] != day]
    entries.append(asdict(entry))
    entries.sort(key=lambda e: e["day"])
    data["entries"] = entries
    save_data(data)
    print(f"Saved entry for {day} -> {DATA_PATH}")

# -------------------------
# Fitbit ingest (CSV)
# -------------------------
def ingest_fitbit_csv(csv_path: str) -> None:
    """
    Fitbit exports differ by report type. This tries to map common columns.
    If columns are missing, it still stores what it can.
    """
    data = load_data()
    df = pd.read_csv(csv_path)

    # Find date column
    date_col = None
    for c in df.columns:
        if c.lower() in ("date", "day", "activity date", "sleep date"):
            date_col = c
            break
    if date_col is None:
        raise ValueError("Could not find a date column in the Fitbit CSV.")

    df[date_col] = pd.to_datetime(df[date_col]).dt.date.astype(str)

    mapping = {
        "steps_fitbit": ["steps", "step count"],
        "calories_burned": ["calories burned", "calories", "activity calories"],
        "minutes_asleep": ["minutes asleep", "sleep minutes"],
        "sleep_score": ["sleep score"],
        "very_active_min": ["minutes very active", "very active minutes"],
        "fairly_active_min": ["minutes fairly active", "fairly active minutes"],
        "lightly_active_min": ["minutes lightly active", "lightly active minutes"],
        "sedentary_min": ["minutes sedentary", "sedentary minutes"],
        "distance": ["distance", "distance (km)", "distance (mi)"],
    }

    def find_col(aliases):
        lower = {c.lower(): c for c in df.columns}
        for a in aliases:
            if a in lower:
                return lower[a]
        return None

    records = []
    for _, row in df.iterrows():
        rec = {"day": row[date_col]}
        for key, aliases in mapping.items():
            col = find_col(aliases)
            if col is not None:
                val = row[col]
                if pd.isna(val):
                    continue
                rec[key] = val
        records.append(rec)

    # Merge by day
    fb = {r["day"]: r for r in data.get("fitbit", []) if "day" in r}
    for r in records:
        d = r["day"]
        fb.setdefault(d, {"day": d})
        fb[d].update(r)

    data["fitbit"] = sorted(list(fb.values()), key=lambda r: r["day"])
    save_data(data)
    print(f"Ingested Fitbit CSV into {DATA_PATH} ({len(records)} rows)")

# -------------------------
# Analytics + Dashboard
# -------------------------
def df_entries(data: Dict) -> pd.DataFrame:
    e = pd.DataFrame(data["entries"])
    if e.empty:
        return e
    e["day"] = pd.to_datetime(e["day"])
    e = e.sort_values("day")

    # Derived fields: lean mass + fat mass (morning-based BF% only)
    if "bf_morning_pct" in e.columns:
        e["lean_mass_lb"] = e.apply(
            lambda r: r["morning_weight_lb"] * (1 - (r["bf_morning_pct"] / 100.0))
            if pd.notna(r.get("bf_morning_pct")) else pd.NA,
            axis=1
        )
        e["fat_mass_lb"] = e.apply(
            lambda r: r["morning_weight_lb"] * (r["bf_morning_pct"] / 100.0)
            if pd.notna(r.get("bf_morning_pct")) else pd.NA,
            axis=1
        )
    return e

def df_fitbit(data: Dict) -> pd.DataFrame:
    f = pd.DataFrame(data.get("fitbit", []))
    if f.empty:
        return f
    f["day"] = pd.to_datetime(f["day"])
    f = f.sort_values("day")
    return f

def weekly_delta_7day_avg(series: pd.Series) -> Optional[float]:
    if len(series) < 14:
        return None
    w7 = series.rolling(7, min_periods=7).mean()
    last = w7.iloc[-1]
    prev = w7.iloc[-8]
    if pd.isna(last) or pd.isna(prev):
        return None
    return float(last - prev)

def suggest_calorie_adjustment(wk_gain_lb: float) -> int:
    if wk_gain_lb < 0.10:
        return +100
    if 0.10 <= wk_gain_lb < 0.25:
        return +75
    if 0.25 <= wk_gain_lb <= 0.50:
        return 0
    if 0.50 < wk_gain_lb <= 0.75:
        return -50
    return -100

def grams_for_kcal(item_key: str, kcal: int) -> int:
    k = KCAL_PER_UNIT[item_key]
    if item_key in ("bananas", "eggs", "yogurt_cups"):
        return int(round(kcal / k))
    grams = int(round(kcal / k))
    if item_key in ("mct_g", "dextrin_g"):
        return int(round(grams / 5) * 5)
    return int(round(grams / 10) * 10)

def propose_adjustment(kcal_change: int, baseline: Dict) -> List[Tuple[str, int, int]]:
    if kcal_change == 0:
        return []
    remaining = kcal_change
    plan = []
    for item in baseline["adjust_priority"]:
        if abs(remaining) <= 25:
            break
        # avoid protein levers unless needed
        if item in ("whey_g", "yogurt_cups") and abs(remaining) <= 150:
            continue
        delta = grams_for_kcal(item, remaining)
        if delta == 0:
            delta = 10 if item.endswith("_g") else 1
            if remaining < 0:
                delta *= -1
        achieved = int(round(delta * KCAL_PER_UNIT[item]))
        plan.append((item, delta, achieved))
        remaining -= achieved
    return plan

def cardio_fuel_note(cardio_min: Optional[float], baseline: Dict) -> Optional[str]:
    if cardio_min is None or pd.isna(cardio_min):
        return None
    cf = baseline["cardio_fuel"]
    try:
        cm = int(cardio_min)
    except Exception:
        return None
    if cm > int(cf["threshold_min"]):
        add = int(cf["add_carbs_g"])
        src = cf["preferred_source"]
        if src == "oats_g":
            oats_g = int(round((add/0.67)/10)*10)
            return f"Cardio {cm}min > {cf['threshold_min']} → add ~{add}g carbs: +{oats_g}g oats (or +{add}g dextrin)."
        return f"Cardio {cm}min > {cf['threshold_min']} → add +{add}g carbs: +{add}g dextrin."
    return None

def lean_gain_ratio_14d(e: pd.DataFrame) -> Optional[float]:
    """
    Ratio = delta(lean_mass) / delta(weight) over ~14 days, using first/last available lean_mass.
    Returns:
      - None if insufficient data
      - Value can be >1 or negative due to BIA noise; treat as trend, clamp for display.
    """
    if "lean_mass_lb" not in e.columns:
        return None
    recent = e.tail(14).dropna(subset=["lean_mass_lb"])
    if len(recent) < 2:
        return None
    w0 = float(recent["morning_weight_lb"].iloc[0])
    w1 = float(recent["morning_weight_lb"].iloc[-1])
    lm0 = float(recent["lean_mass_lb"].iloc[0])
    lm1 = float(recent["lean_mass_lb"].iloc[-1])
    dw = w1 - w0
    dlm = lm1 - lm0
    if abs(dw) < 0.1:
        return None
    return dlm / dw

def build_dashboard() -> None:
    data = load_data()
    baseline = data["baseline"]
    e = df_entries(data)
    if e.empty:
        print("No entries logged yet. Run: python conrad_coach_v3.py log")
        return
    f = df_fitbit(data)

    e2 = e.copy()
    e2["day_str"] = e2["day"].dt.strftime("%Y-%m-%d")
    merged = e2.set_index("day_str")

    if not f.empty:
        f2 = f.copy()
        f2["day_str"] = f2["day"].dt.strftime("%Y-%m-%d")
        f2 = f2.set_index("day_str").drop(columns=["day"], errors="ignore")
        merged = merged.join(f2, how="left")

    # Rolling averages
    merged["weight_7d_avg"] = merged["morning_weight_lb"].rolling(7, min_periods=7).mean()
    if "waist_in" in merged.columns:
        merged["waist_7d_avg"] = merged["waist_in"].rolling(7, min_periods=7).mean()
    if "lean_mass_lb" in merged.columns:
        merged["lean_mass_7d_avg"] = merged["lean_mass_lb"].rolling(7, min_periods=7).mean()

    merged["cardio_fuel_note"] = merged["cardio_min"].apply(lambda x: cardio_fuel_note(x, baseline))

    # Lean gain ratio (repeat per-row for convenience; dashboard users can filter last row)
    ratio = lean_gain_ratio_14d(e)
    merged["lean_gain_ratio_14d"] = ratio

    csv_out = os.path.join(OUT_DIR, "conrad_dashboard.csv")
    merged.reset_index(drop=False).rename(columns={"day_str": "day"}).to_csv(csv_out, index=False)

    # Weight graph
    plt.figure()
    plt.plot(merged.index, merged["morning_weight_lb"], label="Morning weight")
    if merged["weight_7d_avg"].notna().any():
        plt.plot(merged.index, merged["weight_7d_avg"], label="7-day avg")
    plt.xticks(rotation=45, ha="right")
    plt.ylabel("lb")
    plt.title("Weight Trend")
    plt.legend()
    plt.tight_layout()
    w_png = os.path.join(OUT_DIR, "conrad_weight.png")
    plt.savefig(w_png)
    plt.close()

    # Lean mass graph
    if "lean_mass_lb" in merged.columns and merged["lean_mass_lb"].notna().any():
        plt.figure()
        plt.plot(merged.index, merged["lean_mass_lb"], label="Lean mass (est.)")
        if "lean_mass_7d_avg" in merged.columns and merged["lean_mass_7d_avg"].notna().any():
            plt.plot(merged.index, merged["lean_mass_7d_avg"], label="7-day avg")
        plt.xticks(rotation=45, ha="right")
        plt.ylabel("lb")
        plt.title("Lean Mass Trend (BIA-estimated)")
        plt.legend()
        plt.tight_layout()
        lm_png = os.path.join(OUT_DIR, "conrad_lean_mass.png")
        plt.savefig(lm_png)
        plt.close()

    # Waist graph
    if "waist_in" in merged.columns and merged["waist_in"].notna().any():
        plt.figure()
        plt.plot(merged.index, merged["waist_in"], label="Waist (navel)")
        if "waist_7d_avg" in merged.columns and merged["waist_7d_avg"].notna().any():
            plt.plot(merged.index, merged["waist_7d_avg"], label="7-day avg")
        plt.xticks(rotation=45, ha="right")
        plt.ylabel("in")
        plt.title("Waist Trend")
        plt.legend()
        plt.tight_layout()
        waist_png = os.path.join(OUT_DIR, "conrad_waist.png")
        plt.savefig(waist_png)
        plt.close()

    # Activity graph (steps/cardio + fitbit steps if present)
    activity_cols = []
    for c in ["steps", "cardio_min", "steps_fitbit", "very_active_min"]:
        if c in merged.columns and merged[c].notna().any():
            activity_cols.append(c)
    if activity_cols:
        plt.figure()
        for c in activity_cols[:4]:
            plt.plot(merged.index, merged[c], label=c)
        plt.xticks(rotation=45, ha="right")
        plt.title("Activity Signals")
        plt.legend()
        plt.tight_layout()
        a_png = os.path.join(OUT_DIR, "conrad_activity.png")
        plt.savefig(a_png)
        plt.close()

    print("Dashboard written to:")
    print(f"- {csv_out}")
    print(f"- {w_png}")
    if os.path.exists(os.path.join(OUT_DIR, "conrad_lean_mass.png")):
        print(f"- {os.path.join(OUT_DIR, 'conrad_lean_mass.png')}")
    print(f"- {OUT_DIR} (other graphs if data available)")

def diagnose(e: pd.DataFrame) -> str:
    if len(e) < 14:
        return "Need at least ~14 days to diagnose trend vs noise."

    wk_gain = weekly_delta_7day_avg(e["morning_weight_lb"])
    if wk_gain is None:
        return "Need enough data for 7-day rolling averages."

    recent = e.tail(14)
    avg_adh = recent["adherence_0to1"].fillna(1.0).mean()
    deload = bool(recent.get("deload_week", False).fillna(False).any()) if "deload_week" in recent.columns else False

    # Waist change over 14 days (if available)
    waist_change = None
    if "waist_in" in recent.columns and recent["waist_in"].notna().sum() >= 2:
        waist_change = float(recent["waist_in"].dropna().iloc[-1] - recent["waist_in"].dropna().iloc[0])

    # Lean mass change over 14 days (if available)
    lean_change = None
    if "lean_mass_lb" in recent.columns and recent["lean_mass_lb"].notna().sum() >= 2:
        lean_change = float(recent["lean_mass_lb"].dropna().iloc[-1] - recent["lean_mass_lb"].dropna().iloc[0])

    # Performance notes heuristic (ignore during deload)
    perf_notes = [str(x).lower() for x in recent.get("performance_note", pd.Series(dtype=str)).dropna().tolist()]
    bad_words = ("flat", "tired", "stalled", "no progress", "weak")
    perf_flat = sum(1 for n in perf_notes if any(b in n for b in bad_words)) >= 2

    if avg_adh < 0.9:
        return "Likely adherence/data-quality issue first (plan not executed consistently)."

    if deload:
        if wk_gain < 0.10:
            return "Deload flagged. Weight not moving is acceptable; hold diet steady and reassess after deload."
        return "Deload flagged. Avoid training conclusions; reassess next week."

    if wk_gain > 0.75 and (waist_change is not None and waist_change > 0.25):
        return "Likely diet overshoot (gain too fast + waist rising). Reduce calories slightly."

    if wk_gain < 0.10 and perf_flat:
        return "Likely diet/recovery undershoot (not gaining + performance flat). Add calories or reduce cardio/stress."

    if 0.25 <= wk_gain <= 0.50 and perf_flat:
        return "Diet likely adequate (weight trending right). Look at training variables and sleep."

    # Extra hint if lean mass is flat/negative while weight rises
    if lean_change is not None and wk_gain > 0.25 and lean_change < 0:
        return "Weight up but estimated lean mass down (likely BIA noise or glycogen/hydration swing). Check hydration consistency + use 7-day averages."

    return "No clear red flags. Keep running the plan; watch 7-day averages."

def report() -> None:
    data = load_data()
    baseline = data["baseline"]
    e = df_entries(data)
    if e.empty or len(e) < 7:
        print("Not enough entries yet (need at least 7 days logged).")
        return

    wk_gain = weekly_delta_7day_avg(e["morning_weight_lb"])
    if wk_gain is None:
        print("Need ~14 days to compute weekly delta from 7-day averages.")
        return

    kcal_adj = suggest_calorie_adjustment(wk_gain)
    adj_plan = propose_adjustment(kcal_adj, baseline)
    diag = diagnose(e)

    ratio = lean_gain_ratio_14d(e)
    ratio_disp = None
    if ratio is not None:
        # clamp for display to avoid silly numbers due to device noise
        ratio_disp = max(-1.0, min(2.0, ratio))

    print("\n=== Conrad Weekly Report ===")
    print(f"Baseline: {baseline['calories']} kcal | P{baseline['protein_g']} C{baseline['carbs_g']} F{baseline['fat_g']}")
    print(f"7-day avg weekly weight change: {wk_gain:+.2f} lb/week")
    if ratio_disp is not None:
        print(f"Lean gain ratio (14d, est.): {ratio_disp:+.2f}  (≈ {ratio_disp*100:+.0f}% of weight change looks lean)")

    print(f"Recommendation: calorie adjust {kcal_adj:+d} kcal/day")

    if kcal_adj == 0:
        print("→ Hold steady.")
    else:
        print("Proposed ingredient tweaks (minimal disruption):")
        for item, delta_amt, achieved in adj_plan:
            unit = "g" if item.endswith("_g") else "unit"
            sign = "+" if delta_amt > 0 else ""
            print(f"  - {item}: {sign}{delta_amt} {unit}  (~{achieved:+d} kcal/day)")

    print("\nDiagnosis:", diag)

    # Cardio fuel notes (last 7 days)
    cf = baseline["cardio_fuel"]
    last7 = e.tail(7)
    over = last7[last7["cardio_min"].fillna(0) > cf["threshold_min"]]
    if not over.empty:
        print("\nCardio fuel guardrail triggered on:")
        for _, r in over.iterrows():
            note = cardio_fuel_note(r["cardio_min"], baseline)
            if note:
                print(" -", r["day"].strftime("%Y-%m-%d"), "|", note)
    print("")

# -------------------------
# CLI
# -------------------------
def main():
    if len(sys.argv) < 2:
        print("Usage: python conrad_coach_v3.py [checklist|log|report|dashboard|fitbit_ingest <csv_path>]")
        sys.exit(1)

    cmd = sys.argv[1].lower()

    if cmd == "checklist":
        show_checklist()
    elif cmd == "log":
        log_entry()
    elif cmd == "report":
        report()
    elif cmd == "dashboard":
        build_dashboard()
    elif cmd == "fitbit_ingest":
        if len(sys.argv) < 3:
            print("Usage: python conrad_coach_v3.py fitbit_ingest <path_to_fitbit_export.csv>")
            sys.exit(1)
        ingest_fitbit_csv(sys.argv[2])
    else:
        print("Unknown command.")
        sys.exit(1)

if __name__ == "__main__":
    main()
