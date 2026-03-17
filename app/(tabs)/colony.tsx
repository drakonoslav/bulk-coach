import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchColony } from "../../lib/colony-api";
import type {
  ColonyCoordRow,
  DriftHistoryRow,
  ThresholdLabRow,
} from "../../lib/colony-types";
import type { ApiProvenance } from "../../lib/workbook-types";

type ColonyScreenState = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;

  colonyCoord: ColonyCoordRow[];
  driftHistory: DriftHistoryRow[];
  thresholdLab: ThresholdLabRow[];

  provenance: ApiProvenance | null;
};

const initialState: ColonyScreenState = {
  loading: true,
  refreshing: false,
  error: null,
  colonyCoord: [],
  driftHistory: [],
  thresholdLab: [],
  provenance: null,
};

function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function normalizeStatus(status: string | null) {
  if (!status) return "unknown";
  return status.toLowerCase();
}

export default function ColonyScreen() {
  const [state, setState] = useState<ColonyScreenState>(initialState);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    setState((prev) => ({
      ...prev,
      loading: mode === "initial",
      refreshing: mode === "refresh",
      error: null,
    }));

    try {
      const res = await fetchColony();

      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: null,
        colonyCoord: res.colonyCoord,
        driftHistory: res.driftHistory,
        thresholdLab: res.thresholdLab,
        provenance: res._provenance,
      }));
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: err.message || "Failed to load colony state",
      }));
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const recentDrift = useMemo(() => {
    return state.driftHistory.slice(0, 10);
  }, [state.driftHistory]);

  const watchCount = useMemo(() => {
    return state.driftHistory.filter((row) => {
      const flag = (row.watchFlag || "").toLowerCase();
      return (
        flag.includes("watch") ||
        flag.includes("review") ||
        flag === "1" ||
        flag === "true"
      );
    }).length;
  }, [state.driftHistory]);

  if (state.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading colony organism…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={state.refreshing}
          onRefresh={() => void load("refresh")}
        />
      }
    >
      <Text style={styles.title}>Colony</Text>

      {state.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{state.error}</Text>
        </View>
      ) : null}

      <View style={styles.summaryBox}>
        <Text style={styles.sectionTitle}>Colony summary</Text>
        <Text style={styles.muted}>colony metrics: {state.colonyCoord.length}</Text>
        <Text style={styles.muted}>drift events: {state.driftHistory.length}</Text>
        <Text style={styles.muted}>watch flags: {watchCount}</Text>
        <Text style={styles.muted}>threshold lab rows: {state.thresholdLab.length}</Text>
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Colony coordinator</Text>
        {state.colonyCoord.length === 0 ? (
          <Text style={styles.muted}>No colony coordinator rows found.</Text>
        ) : (
          state.colonyCoord.map((row) => {
            const status = normalizeStatus(row.status);
            return (
              <View
                key={`coord-${row.rowIndex}-${row.metric}`}
                style={styles.card}
              >
                <Text style={styles.cardTitle}>{fmt(row.metric)}</Text>
                <Text style={styles.metaText}>
                  value {fmt(row.value)} • threshold {fmt(row.threshold)}
                </Text>
                <Text
                  style={[
                    styles.statusText,
                    status === "ok" && styles.statusOk,
                    status === "unstable" && styles.statusWarn,
                    status === "alert" && styles.statusAlert,
                  ]}
                >
                  status: {fmt(row.status)}
                </Text>
                {row.recommendation ? (
                  <Text style={styles.recommendationText}>
                    recommendation: {row.recommendation}
                  </Text>
                ) : null}
                {row.confidence ? (
                  <Text style={styles.metaText}>confidence: {row.confidence}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Recent drift history</Text>
        {recentDrift.length === 0 ? (
          <Text style={styles.muted}>No drift history rows found.</Text>
        ) : (
          recentDrift.map((row) => (
            <View key={`drift-${row.rowIndex}`} style={styles.card}>
              <Text style={styles.cardTitle}>
                {fmt(row.date)} • {fmt(row.phase)}
              </Text>
              <Text style={styles.metaText}>
                type {fmt(row.driftType)} • source {fmt(row.driftSource)}
              </Text>
              <Text style={styles.metaText}>
                confidence {fmt(row.confidence)} • weighted score{" "}
                {fmt(row.weightedDriftScore)}
              </Text>
              {row.watchFlag ? (
                <Text style={styles.recommendationText}>
                  watch: {row.watchFlag}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Threshold lab</Text>
        {state.thresholdLab.length === 0 ? (
          <Text style={styles.muted}>No threshold lab rows found.</Text>
        ) : (
          state.thresholdLab.map((row) => (
            <View
              key={`lab-${row.rowIndex}-${row.thresholdName}`}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{fmt(row.thresholdName)}</Text>
              <Text style={styles.metaText}>
                current {fmt(row.currentValue)} • suggested {fmt(row.suggestedValue)}
              </Text>
              <Text style={styles.metaText}>
                evidence count {fmt(row.evidenceCount)}
              </Text>
              {row.notes ? (
                <Text style={styles.recommendationText}>{row.notes}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.provenanceBox}>
        <Text style={styles.sectionTitle}>Provenance</Text>
        {state.provenance ? (
          <>
            <Text style={styles.muted}>
              db={state.provenance.db.database} @ {state.provenance.db.host}
            </Text>
            <Text style={styles.muted}>
              env={state.provenance.db.nodeEnv} • source={state.provenance.source}
            </Text>
            <Text style={styles.muted}>
              active_snapshot={state.provenance.activeWorkbookSnapshotId ?? "none"}
            </Text>
            <Text style={styles.muted}>
              tables={state.provenance.tablesRead?.join(", ") || "unknown"}
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>No provenance loaded</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  muted: {
    color: "#666",
  },
  errorBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff0f0",
  },
  errorText: {
    color: "#8a0000",
    fontWeight: "600",
  },
  summaryBox: {
    backgroundColor: "#f6f6f6",
    padding: 12,
    borderRadius: 12,
    gap: 4,
  },
  sectionBlock: {
    gap: 10,
  },
  card: {
    backgroundColor: "#f8f8f8",
    padding: 12,
    borderRadius: 12,
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  metaText: {
    color: "#444",
  },
  statusText: {
    marginTop: 2,
    fontWeight: "700",
  },
  statusOk: {
    color: "#0a7a22",
  },
  statusWarn: {
    color: "#8a5a00",
  },
  statusAlert: {
    color: "#a10000",
  },
  recommendationText: {
    marginTop: 2,
    color: "#222",
    fontStyle: "italic",
  },
  provenanceBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#f6f6f6",
    gap: 4,
  },
});
