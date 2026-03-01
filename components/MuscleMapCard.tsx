import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Platform } from "react-native";
import Colors from "@/constants/colors";
import { MUSCLE_MAP_GRID, GridCell, MuscleState, MuscleKey } from "@/lib/muscle_map_layout";

interface Props {
  muscles: MuscleState[];
  date: string;
  loading?: boolean;
  error?: string | null;
  doseMode: "total" | "direct";
  onDoseModeChange: (mode: "total" | "direct") => void;
}

const ROWS = 10;

function intensityColor(dose: number, maxDose: number): string {
  if (dose <= 0) return Colors.surface;
  const pct = Math.min(dose / (maxDose || 1), 1);
  if (pct >= 0.8) return "#22C55E";
  if (pct >= 0.6) return "#84CC16";
  if (pct >= 0.4) return "#EAB308";
  if (pct >= 0.2) return "#F97316";
  return "#EF4444";
}

function intensityOpacity(dose: number, maxDose: number): number {
  if (dose <= 0) return 0.15;
  const pct = Math.min(dose / (maxDose || 1), 1);
  return 0.35 + 0.65 * pct;
}

export default function MuscleMapCard({ muscles, date, loading, error, doseMode, onDoseModeChange }: Props) {
  const [selected, setSelected] = useState<MuscleState | null>(null);

  const stateMap = new Map<MuscleKey, MuscleState>();
  for (const m of muscles) stateMap.set(m.key, m);

  const maxDose = Math.max(
    ...muscles.map(m => doseMode === "total" ? m.total_dose : m.direct_dose),
    1
  );

  const rows: GridCell[][] = [];
  for (const cell of MUSCLE_MAP_GRID) {
    if (!rows[cell.row]) rows[cell.row] = [];
    rows[cell.row].push(cell);
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Muscle Map (Intel)</Text>
        <Text style={styles.dateLabel}>{date}</Text>
      </View>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleBtn, doseMode === "total" && styles.toggleBtnActive]}
          onPress={() => onDoseModeChange("total")}
        >
          <Text style={[styles.toggleText, doseMode === "total" && styles.toggleTextActive]}>Total</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, doseMode === "direct" && styles.toggleBtnActive]}
          onPress={() => onDoseModeChange("direct")}
        >
          <Text style={[styles.toggleText, doseMode === "direct" && styles.toggleTextActive]}>Direct</Text>
        </Pressable>
      </View>

      {loading && <Text style={styles.loading}>Loading…</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
      {!loading && !error && muscles.length === 0 && (
        <Text style={styles.empty}>No muscle data available for this date</Text>
      )}

      {!loading && muscles.length > 0 && (
        <View style={styles.grid}>
          {Array.from({ length: ROWS }, (_, rowIdx) => {
            const cellsInRow = rows[rowIdx] || [];
            if (cellsInRow.length === 0) return null;
            return (
              <View key={rowIdx} style={styles.gridRow}>
                {cellsInRow.map((cell) => {
                  const ms = stateMap.get(cell.key);
                  const dose = ms ? (doseMode === "total" ? ms.total_dose : ms.direct_dose) : 0;
                  const color = intensityColor(dose, maxDose);
                  const opacity = intensityOpacity(dose, maxDose);
                  const span = cell.colSpan || 1;
                  return (
                    <Pressable
                      key={cell.key}
                      onPress={() => ms && setSelected(ms)}
                      style={[
                        styles.cell,
                        {
                          flex: span,
                          backgroundColor: color,
                          opacity,
                        },
                      ]}
                    >
                      <Text style={styles.cellLabel} numberOfLines={1}>{cell.label}</Text>
                      {dose > 0 && <Text style={styles.cellValue}>{dose.toFixed(1)}</Text>}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border }]} />
          <Text style={styles.legendText}>0</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#EF4444" }]} />
          <Text style={styles.legendText}>Low</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#EAB308" }]} />
          <Text style={styles.legendText}>Med</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#22C55E" }]} />
          <Text style={styles.legendText}>High</Text>
        </View>
      </View>

      <Modal
        visible={selected != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}>
          <View style={styles.modalContent}>
            {selected && (
              <>
                <Text style={styles.modalTitle}>{selected.key.replace(/_/g, " ").toUpperCase()}</Text>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Total Dose</Text>
                  <Text style={styles.modalValue}>{selected.total_dose.toFixed(2)}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Direct Dose</Text>
                  <Text style={styles.modalValue}>{selected.direct_dose.toFixed(2)}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Load (7d)</Text>
                  <Text style={[styles.modalValue, { color: Colors.textSecondary }]}>
                    {selected.load_7d > 0 ? selected.load_7d.toFixed(1) : "—"}
                  </Text>
                </View>
                {selected.last_hit && (
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Last Hit</Text>
                    <Text style={styles.modalValue}>{selected.last_hit}</Text>
                  </View>
                )}
                <Pressable style={styles.modalClose} onPress={() => setSelected(null)}>
                  <Text style={styles.modalCloseText}>Close</Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  dateLabel: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 10,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleBtnActive: {
    backgroundColor: Colors.primary + "20",
    borderColor: Colors.primary,
  },
  toggleText: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  toggleTextActive: {
    color: Colors.primary,
  },
  loading: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Rubik_400Regular",
    textAlign: "center",
    paddingVertical: 20,
  },
  error: {
    fontSize: 13,
    color: Colors.danger,
    fontFamily: "Rubik_400Regular",
    textAlign: "center",
    paddingVertical: 20,
  },
  empty: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: "Rubik_400Regular",
    textAlign: "center",
    paddingVertical: 20,
  },
  grid: {
    gap: 3,
  },
  gridRow: {
    flexDirection: "row",
    gap: 3,
  },
  cell: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
  },
  cellLabel: {
    fontSize: 9,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
    textAlign: "center",
  },
  cellValue: {
    fontSize: 10,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginTop: 1,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 9,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: 260,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginBottom: 16,
    textAlign: "center",
  },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalLabel: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  modalValue: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  modalClose: {
    marginTop: 16,
    backgroundColor: Colors.primary + "20",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  modalCloseText: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.primary,
  },
});
