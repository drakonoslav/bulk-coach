/**
 * app/(tabs)/checklist.tsx — QUARANTINED (Pass 3)
 *
 * LEGACY SOURCE: AsyncStorage meal_checklist + daily_log (Postgres)
 * LEGACY TABLES: daily_log
 * REPLACEMENT PATH: /api/nutrition/meal-templates (workbook_snapshot → workbook_sheet_rows)
 * PASS TO RESTORE: Pass 9
 *
 * Disconnected: reading from AsyncStorage meal_checklist is a hidden memory
 * path that shadows workbook truth.
 */
import React from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { QuarantinedScreen } from "@/components/QuarantinedScreen";

export default function ChecklistScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <QuarantinedScreen
        screenName="Plan / Checklist"
        legacySource="AsyncStorage meal_checklist + daily_log (Postgres)"
        tables={["daily_log"]}
        replacementPath="/api/nutrition/meal-templates — workbook_snapshot → workbook_sheet_rows"
        note="Will be restored in Pass 9 using meal_templates sheet from active snapshot."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0F1E" },
});
