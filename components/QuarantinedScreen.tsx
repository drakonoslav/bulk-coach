/**
 * components/QuarantinedScreen.tsx
 * Pass 3 / Pass 9 — shown on every screen that has been disconnected from its
 * legacy data source and is pending reconnection to workbook truth.
 *
 * Displays:
 * - which screen was quarantined
 * - what legacy source it was reading from
 * - what workbook-derived path will replace it
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  screenName: string;
  legacySource: string;
  replacementPath: string;
  tables?: string[];
  note?: string;
}

export function QuarantinedScreen({
  screenName,
  legacySource,
  replacementPath,
  tables = [],
  note,
}: Props) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.iconRow}>
        <Ionicons name="warning" size={32} color="#F59E0B" />
      </View>

      <Text style={styles.title}>Screen Quarantined</Text>
      <Text style={styles.subtitle}>{screenName}</Text>

      <View style={styles.card}>
        <Row label="STATUS" value="DISCONNECTED — migration in progress" valueColor="#EF4444" />
        <Row label="WAS READING" value={legacySource} valueColor="#F59E0B" />
        {tables.length > 0 && (
          <Row label="LEGACY TABLES" value={tables.join(", ")} valueColor="#F59E0B" />
        )}
        <Row label="REPLACEMENT" value={replacementPath} valueColor="#00D4AA" />
        <Row label="PASS" value="Pass 9 — legacy daily_log screens" valueColor="#94A3B8" />
        {note && <Row label="NOTE" value={note} valueColor="#94A3B8" />}
      </View>

      <View style={styles.ruleBox}>
        <Text style={styles.ruleTitle}>Why this screen is offline</Text>
        <Text style={styles.ruleText}>
          This screen was reading from a legacy source that may not match the
          active workbook snapshot. It has been disconnected to prevent the app
          from showing data from the wrong truth path.
        </Text>
        <Text style={styles.ruleText}>
          Once this screen is reconnected to workbook-derived API endpoints, it
          will be restored.
        </Text>
      </View>

      <Text style={styles.hint}>
        Upload a workbook in the Workbook tab to continue.
      </Text>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#0A0F1E",
    alignItems: "center",
    padding: 24,
    paddingTop: 64,
    paddingBottom: 100,
  },
  iconRow: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontFamily: "Rubik_700Bold",
    color: "#F59E0B",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: "#94A3B8",
    marginBottom: 24,
    letterSpacing: 0.3,
  },
  card: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E2D40",
    padding: 16,
    gap: 8,
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  rowLabel: {
    fontSize: 9,
    fontFamily: "Rubik_700Bold",
    color: "#475569",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    width: 90,
    paddingTop: 2,
  },
  rowValue: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    flex: 1,
    textAlign: "right",
    flexWrap: "wrap",
    lineHeight: 17,
  },
  ruleBox: {
    width: "100%",
    backgroundColor: "rgba(245,158,11,0.05)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.15)",
    padding: 16,
    gap: 10,
    marginBottom: 24,
  },
  ruleTitle: {
    fontSize: 12,
    fontFamily: "Rubik_700Bold",
    color: "#F59E0B",
    marginBottom: 4,
  },
  ruleText: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: "#94A3B8",
    lineHeight: 18,
  },
  hint: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: "#00D4AA",
    textAlign: "center",
  },
});
