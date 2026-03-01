import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import Colors from "@/constants/colors";
import { BODY_ROWS, RowDef, MuscleState, MuscleKey } from "@/lib/muscle_map_layout";

interface Props {
  muscles: MuscleState[];
  date: string;
  loading?: boolean;
  error?: string | null;
  doseMode: "total" | "direct";
  onDoseModeChange: (mode: "total" | "direct") => void;
}

function getDose(ms: MuscleState | undefined, mode: "total" | "direct"): number {
  if (!ms) return 0;
  return mode === "total" ? ms.total_dose : ms.direct_dose;
}

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

function Cell({ label, dose, maxDose, flex, onPress }: {
  label: string; dose: number; maxDose: number; flex: number; onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.cell, {
        flex,
        backgroundColor: intensityColor(dose, maxDose),
        opacity: intensityOpacity(dose, maxDose),
      }]}
    >
      <Text style={styles.cellLabel} numberOfLines={1}>{label}</Text>
      {dose > 0 && <Text style={styles.cellValue}>{dose.toFixed(0)}</Text>}
    </Pressable>
  );
}

export default function MuscleMapCard({ muscles, date, loading, error, doseMode, onDoseModeChange }: Props) {
  const [selected, setSelected] = useState<MuscleState | null>(null);

  const stateMap = new Map<MuscleKey, MuscleState>();
  for (const m of muscles) stateMap.set(m.key, m);

  const maxDose = Math.max(
    ...muscles.map(m => doseMode === "total" ? m.total_dose : m.direct_dose),
    1
  );

  const selectMuscle = (key: MuscleKey) => {
    const ms = stateMap.get(key);
    if (ms) setSelected(ms);
  };

  const renderFlatRow = (row: Extract<RowDef, { type: "flat" }>, idx: number) => (
    <View key={idx} style={styles.gridRow}>
      {row.cells.map((c) => (
        <Cell
          key={c.key + idx}
          label={c.label}
          dose={getDose(stateMap.get(c.key), doseMode)}
          maxDose={maxDose}
          flex={c.flex}
          onPress={() => selectMuscle(c.key)}
        />
      ))}
    </View>
  );

  const renderSplitRow = (row: Extract<RowDef, { type: "split" }>, idx: number) => {
    return (
      <View key={idx} style={styles.gridRow}>
        {row.left && (
          <Cell
            key={row.left.key}
            label={row.left.label}
            dose={getDose(stateMap.get(row.left.key), doseMode)}
            maxDose={maxDose}
            flex={row.left.flex}
            onPress={() => selectMuscle(row.left!.key)}
          />
        )}
        <View style={{ flex: 1, gap: 3 }}>
          {row.midRows.map((subRow, si) => (
            <View key={si} style={styles.gridRow}>
              {subRow.map((c) => (
                <Cell
                  key={c.key + si}
                  label={c.label}
                  dose={getDose(stateMap.get(c.key), doseMode)}
                  maxDose={maxDose}
                  flex={1}
                  onPress={() => selectMuscle(c.key)}
                />
              ))}
            </View>
          ))}
        </View>
        {row.right && (
          <Cell
            key={row.right.key}
            label={row.right.label}
            dose={getDose(stateMap.get(row.right.key), doseMode)}
            maxDose={maxDose}
            flex={row.right.flex}
            onPress={() => selectMuscle(row.right!.key)}
          />
        )}
        <View style={{ flex: 1, gap: 3 }}>
          {row.farRight.map((c, fi) => (
            <Cell
              key={c.key + fi}
              label={c.label}
              dose={getDose(stateMap.get(c.key), doseMode)}
              maxDose={maxDose}
              flex={1}
              onPress={() => selectMuscle(c.key)}
            />
          ))}
        </View>
      </View>
    );
  };

  const renderQuadRow = (row: Extract<RowDef, { type: "quad" }>, idx: number) => {
    const tallCol = row.tall?.col ?? -1;
    const tallKey = row.tall?.key;
    const tallLabel = row.tall?.label ?? "";
    const tallDose = tallKey ? getDose(stateMap.get(tallKey), doseMode) : 0;

    return (
      <View key={idx} style={styles.gridRow}>
        {[0, 1, 2, 3].map((col) => {
          if (col === tallCol && tallKey) {
            return (
              <View key={`tall-${col}`} style={{ flex: 1 }}>
                <Pressable
                  onPress={() => selectMuscle(tallKey)}
                  style={[styles.cell, {
                    flex: 1,
                    backgroundColor: intensityColor(tallDose, maxDose),
                    opacity: intensityOpacity(tallDose, maxDose),
                  }]}
                >
                  <Text style={styles.cellLabel} numberOfLines={1}>{tallLabel}</Text>
                  {tallDose > 0 && <Text style={styles.cellValue}>{tallDose.toFixed(0)}</Text>}
                </Pressable>
              </View>
            );
          }
          return (
            <View key={`col-${col}`} style={{ flex: 1, gap: 3 }}>
              {row.subRows.map((sr, si) => {
                const c = sr[col];
                if (!c || (col === tallCol)) return null;
                return (
                  <Cell
                    key={c.key + si}
                    label={c.label}
                    dose={getDose(stateMap.get(c.key), doseMode)}
                    maxDose={maxDose}
                    flex={1}
                    onPress={() => selectMuscle(c.key)}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
    );
  };

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
          {BODY_ROWS.map((row, idx) =>
            row.type === "flat" ? renderFlatRow(row, idx) : row.type === "split" ? renderSplitRow(row, idx) : renderQuadRow(row, idx)
          )}
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
                {selected.derived_from && (
                  <View style={styles.modalDerived}>
                    <Text style={styles.modalDerivedText}>
                      Derived from {selected.derived_from} {selected.derived_scale != null ? `×${selected.derived_scale}` : ""}
                    </Text>
                  </View>
                )}
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
                    {(() => {
                      const v = doseMode === "total" ? selected.load_7d_total : selected.load_7d_direct;
                      return v != null && v > 0 ? v.toFixed(1) : "—";
                    })()}
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
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
  },
  cellLabel: {
    fontSize: 8,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
    textAlign: "center",
  },
  cellValue: {
    fontSize: 9,
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
  modalDerived: {
    backgroundColor: "#8B5CF620",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 12,
    alignItems: "center",
  },
  modalDerivedText: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: "#8B5CF6",
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
