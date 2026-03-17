/**
 * app/(tabs)/metrics.tsx — QUARANTINED (Pass 3)
 *
 * LEGACY SOURCE: daily_log table (Postgres) direct writes from UI
 * LEGACY TABLES: daily_log
 * REPLACEMENT PATH: /api/biolog + /api/nutrition (workbook_snapshot truth)
 * PASS TO RESTORE: Pass 9
 *
 * Disconnected: this screen was writing directly to daily_log from the UI,
 * creating a shadow truth path outside workbook snapshots.
 */
import React from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { QuarantinedScreen } from "@/components/QuarantinedScreen";

export default function MetricsScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <QuarantinedScreen
        screenName="Metrics"
        legacySource="daily_log direct UI writes (Postgres)"
        tables={["daily_log"]}
        replacementPath="/api/biolog + /api/nutrition — workbook_snapshot truth"
        note="Will be restored in Pass 9 once the workbook serves as the write-back target."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0F1E" },
});
