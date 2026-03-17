/**
 * app/(tabs)/report.tsx
 * QUARANTINED — Pass 9
 *
 * This screen was reading from coaching-engine using BASELINE as calorie/macro
 * authority (R1 violation), suggestCalorieAdjustment / proposeMacroSafeAdjustment
 * (R1), diagnoseDietVsTraining (R2), and distributeDeltasToMeals (R4).
 *
 * It will be rebuilt on workbook-derived nutrition truth:
 *   meal_template_rows + meal_line_rows + biolog_rows (active workbook_snapshot_id)
 *
 * Legacy source: coaching-engine BASELINE, AsyncStorage loadDashboard/loadStrengthSets
 * Replacement:   GET /api/nutrition/summary + GET /api/biolog/phases
 * Tables:        meal_template_rows, meal_line_rows, biolog_rows
 */
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";
import { QuarantinedScreen } from "@/components/QuarantinedScreen";

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const top = Platform.OS === "web" ? 67 : insets.top;
  return (
    <View style={{ flex: 1, backgroundColor: "#0A0F1E", paddingTop: top }}>
      <QuarantinedScreen
        screenName="Report / Coaching Analysis"
        legacySource="coaching-engine BASELINE (R1), suggestCalorieAdjustment (R1), proposeMacroSafeAdjustment (R1), diagnoseDietVsTraining (R2), distributeDeltasToMeals (R4), loadDashboard / loadStrengthSets (AsyncStorage)"
        replacementPath="GET /api/nutrition/summary + GET /api/biolog/phases (active workbook snapshot)"
        tables={["meal_template_rows", "meal_line_rows", "biolog_rows", "workbook_snapshots"]}
        note="Will be rebuilt on workbook-derived nutrition truth. BASELINE and coaching-engine must not drive calorie/macro targets when a workbook is active (R1 decision)."
      />
    </View>
  );
}
