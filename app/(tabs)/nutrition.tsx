import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  fetchNutritionMealLines,
  fetchNutritionSummaryAllPhases,
  fetchNutritionSummaryForPhase,
} from "../../lib/nutrition-api";
import type {
  NutritionMealLineRow,
  NutritionTemplateRow,
  NutritionPhaseTotals,
} from "../../lib/nutrition-types";
import type { ApiProvenance } from "../../lib/workbook-types";

type NutritionScreenState = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;

  availablePhases: string[];
  selectedPhase: string | null;

  phaseTotals: NutritionPhaseTotals | null;
  templateRows: NutritionTemplateRow[];
  mealLines: NutritionMealLineRow[];

  provenance: ApiProvenance | null;
};

const initialState: NutritionScreenState = {
  loading: true,
  refreshing: false,
  error: null,

  availablePhases: [],
  selectedPhase: null,

  phaseTotals: null,
  templateRows: [],
  mealLines: [],

  provenance: null,
};

function prettyPhase(phase: string | null) {
  if (!phase) return "unknown";
  return phase;
}

function fmtNum(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return String(Math.round(value * 100) / 100);
}

export default function NutritionScreen() {
  const [state, setState] = useState<NutritionScreenState>(initialState);

  const loadInitial = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      setState((prev) => ({
        ...prev,
        loading: mode === "initial",
        refreshing: mode === "refresh",
        error: null,
      }));

      try {
        const phasesRes = await fetchNutritionSummaryAllPhases();

        const phaseNames = phasesRes.phases
          .map((p) => p.phase)
          .filter((p): p is string => !!p);

        const preferredPhase =
          state.selectedPhase || phaseNames[0] || null;

        if (!preferredPhase) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            availablePhases: [],
            selectedPhase: null,
            phaseTotals: null,
            templateRows: [],
            mealLines: [],
            provenance: phasesRes.provenance,
            error: null,
          }));
          return;
        }

        const [summaryRes, linesRes] = await Promise.all([
          fetchNutritionSummaryForPhase(preferredPhase),
          fetchNutritionMealLines({ phase: preferredPhase, limit: 1000 }),
        ]);

        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: null,
          availablePhases: phaseNames,
          selectedPhase: preferredPhase,
          phaseTotals: summaryRes.totals,
          templateRows: summaryRes.templateRows,
          mealLines: linesRes.rows,
          provenance:
            summaryRes.provenance || linesRes.provenance || phasesRes.provenance,
        }));
      } catch (err: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: err.message || "Failed to load nutrition data",
        }));
      }
    },
    [state.selectedPhase]
  );

  const loadPhase = useCallback(async (phase: string) => {
    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      selectedPhase: phase,
    }));

    try {
      const [summaryRes, linesRes, allRes] = await Promise.all([
        fetchNutritionSummaryForPhase(phase),
        fetchNutritionMealLines({ phase, limit: 1000 }),
        fetchNutritionSummaryAllPhases(),
      ]);

      const phaseNames = allRes.phases
        .map((p) => p.phase)
        .filter((p): p is string => !!p);

      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: null,
        availablePhases: phaseNames,
        selectedPhase: phase,
        phaseTotals: summaryRes.totals,
        templateRows: summaryRes.templateRows,
        mealLines: linesRes.rows,
        provenance:
          summaryRes.provenance || linesRes.provenance || allRes.provenance,
      }));
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: err.message || "Failed to load selected nutrition phase",
      }));
    }
  }, []);

  useEffect(() => {
    void loadInitial("initial");
  }, []);

  const linesByMealTemplate = useMemo(() => {
    const grouped: Record<string, NutritionMealLineRow[]> = {};
    for (const row of state.mealLines) {
      const key = row.mealTemplateId || "unknown";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    return grouped;
  }, [state.mealLines]);

  if (state.loading && !state.selectedPhase) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading nutrition organism…</Text>
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
          onRefresh={() => void loadInitial("refresh")}
        />
      }
    >
      <Text style={styles.title}>Nutrition</Text>

      {state.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{state.error}</Text>
        </View>
      ) : null}

      <View style={styles.phasePickerBox}>
        <Text style={styles.sectionTitle}>Available phases</Text>
        <View style={styles.phaseRow}>
          {state.availablePhases.map((phase) => {
            const selected = phase === state.selectedPhase;
            return (
              <TouchableOpacity
                key={phase}
                style={[styles.phaseChip, selected && styles.phaseChipSelected]}
                onPress={() => void loadPhase(phase)}
              >
                <Text
                  style={[
                    styles.phaseChipText,
                    selected && styles.phaseChipTextSelected,
                  ]}
                >
                  {phase}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.sectionTitle}>
          Selected phase: {prettyPhase(state.selectedPhase)}
        </Text>
        {state.phaseTotals ? (
          <View style={styles.totalsGrid}>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>kcal</Text>
              <Text style={styles.totalValue}>{fmtNum(state.phaseTotals.kcal)}</Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>protein</Text>
              <Text style={styles.totalValue}>{fmtNum(state.phaseTotals.protein)}</Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>carbs</Text>
              <Text style={styles.totalValue}>{fmtNum(state.phaseTotals.carbs)}</Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>fat</Text>
              <Text style={styles.totalValue}>{fmtNum(state.phaseTotals.fat)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.muted}>No phase totals loaded</Text>
        )}
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Meal template totals</Text>
        {state.templateRows.length === 0 ? (
          <Text style={styles.muted}>No meal template rows for this phase.</Text>
        ) : (
          state.templateRows.map((row) => (
            <View key={`${row.rowIndex}-${row.mealTemplateId}`} style={styles.card}>
              <Text style={styles.cardTitle}>{row.mealTemplateId || "unknown_meal"}</Text>
              <Text style={styles.metaText}>
                kcal {fmtNum(row.kcalSum)} • protein {fmtNum(row.proteinSum)} • carbs{" "}
                {fmtNum(row.carbsSum)} • fat {fmtNum(row.fatSum)}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Meal lines</Text>
        {Object.keys(linesByMealTemplate).length === 0 ? (
          <Text style={styles.muted}>No meal lines for this phase.</Text>
        ) : (
          Object.entries(linesByMealTemplate).map(([mealTemplateId, rows]) => (
            <View key={mealTemplateId} style={styles.groupBox}>
              <Text style={styles.groupTitle}>{mealTemplateId}</Text>
              {rows
                .slice()
                .sort((a, b) => (a.lineNo ?? 9999) - (b.lineNo ?? 9999))
                .map((row) => (
                  <View
                    key={`${row.rowIndex}-${row.ingredientId}-${row.lineNo}`}
                    style={styles.lineRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineTitle}>
                        {row.lineNo ?? "?"}. {row.ingredientId || "unknown_ingredient"}
                      </Text>
                      <Text style={styles.lineMeta}>
                        amount {fmtNum(row.amountUnit)}
                      </Text>
                    </View>
                    <View style={styles.lineMacroBox}>
                      <Text style={styles.lineMacro}>k {fmtNum(row.kcalLine)}</Text>
                      <Text style={styles.lineMacro}>p {fmtNum(row.proteinLine)}</Text>
                      <Text style={styles.lineMacro}>c {fmtNum(row.carbsLine)}</Text>
                      <Text style={styles.lineMacro}>f {fmtNum(row.fatLine)}</Text>
                    </View>
                  </View>
                ))}
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
  phasePickerBox: {
    backgroundColor: "#f6f6f6",
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  phaseRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  phaseChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#ececec",
  },
  phaseChipSelected: {
    backgroundColor: "#111",
  },
  phaseChipText: {
    color: "#111",
    fontWeight: "600",
  },
  phaseChipTextSelected: {
    color: "#fff",
  },
  summaryBox: {
    backgroundColor: "#f6f6f6",
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  totalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  totalCard: {
    minWidth: 90,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  totalLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    color: "#666",
    fontWeight: "700",
  },
  totalValue: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  sectionBlock: {
    gap: 10,
  },
  card: {
    backgroundColor: "#f8f8f8",
    padding: 12,
    borderRadius: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  metaText: {
    color: "#444",
    marginTop: 4,
  },
  groupBox: {
    backgroundColor: "#f8f8f8",
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  groupTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  lineRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ddd",
  },
  lineTitle: {
    fontWeight: "600",
  },
  lineMeta: {
    color: "#666",
    marginTop: 2,
  },
  lineMacroBox: {
    alignItems: "flex-end",
    gap: 2,
  },
  lineMacro: {
    color: "#444",
    fontSize: 12,
  },
  provenanceBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#f6f6f6",
    gap: 4,
  },
});
