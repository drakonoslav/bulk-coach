import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Platform } from "react-native";
import Colors from "@/constants/colors";
import { MUSCLE_MAP_GRID, GridCell, MuscleState, MuscleKey } from "@/lib/muscle_map_layout";

interface Props {
  muscles: MuscleState[];
  date: string;
  loading?: boolean;
  error?: string | null;
}

const COLS = 3;
const ROWS = 10;

function readinessColor(r: number | undefined): string {
  if (r == null) return Colors.surface;
  if (r >= 80) return "#22C55E";
  if (r >= 60) return "#84CC16";
  if (r >= 40) return "#EAB308";
  if (r >= 20) return "#F97316";
  return "#EF4444";
}

function readinessOpacity(r: number | undefined): number {
  if (r == null) return 0.15;
  return 0.3 + 0.7 * (r / 100);
}

export default function MuscleMapCard({ muscles, date, loading, error }: Props) {
  const [selected, setSelected] = useState<MuscleState | null>(null);

  const stateMap = new Map<MuscleKey, MuscleState>();
  for (const m of muscles) stateMap.set(m.key, m);

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
                  const color = readinessColor(ms?.readiness);
                  const opacity = readinessOpacity(ms?.readiness);
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
                      {ms && <Text style={styles.cellValue}>{Math.round(ms.readiness)}</Text>}
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
          <View style={[styles.legendDot, { backgroundColor: "#EF4444" }]} />
          <Text style={styles.legendText}>0–20</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#F97316" }]} />
          <Text style={styles.legendText}>20–40</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#EAB308" }]} />
          <Text style={styles.legendText}>40–60</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#84CC16" }]} />
          <Text style={styles.legendText}>60–80</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#22C55E" }]} />
          <Text style={styles.legendText}>80+</Text>
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
                  <Text style={styles.modalLabel}>Readiness</Text>
                  <Text style={[styles.modalValue, { color: readinessColor(selected.readiness) }]}>
                    {selected.readiness.toFixed(1)}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Load (7d)</Text>
                  <Text style={styles.modalValue}>{selected.load_7d.toFixed(1)}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Fatigue</Text>
                  <Text style={styles.modalValue}>{selected.fatigue.toFixed(1)}</Text>
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
    marginBottom: 12,
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
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginTop: 1,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
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
