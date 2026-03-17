/**
 * app/(tabs)/tracker.tsx — QUARANTINED (Pass 3)
 *
 * LEGACY SOURCE: daily_log table (Postgres) + AsyncStorage history cache
 * LEGACY TABLES: daily_log, dashboard_cache
 * REPLACEMENT PATH: /api/biolog (workbook_snapshot_id → biolog_rows)
 * PASS TO RESTORE: Pass 9
 *
 * Disconnected to prevent split-brain reads from daily_log while workbook
 * truth path is being established.
 */
import React from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { QuarantinedScreen } from "@/components/QuarantinedScreen";

export default function TrackerScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <QuarantinedScreen
        screenName="Logbook / Tracker"
        legacySource="daily_log (Postgres) + AsyncStorage history cache"
        tables={["daily_log", "dashboard_cache"]}
        replacementPath="/api/biolog — workbook_snapshot → biolog_rows"
        note="Will be restored in Pass 9 pointing at GET /api/biolog."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0F1E" },
});
