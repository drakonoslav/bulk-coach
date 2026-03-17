/**
 * app/workbook.tsx
 * Workbook Host — canonical workbook snapshot management screen.
 *
 * State contract: WorkbookScreenState (lib/workbook-types.ts)
 * API contract:   lib/workbook-api.ts
 *
 * Data authority: workbook_snapshots (Postgres) via snapshot_id + is_active.
 * filename_date is display/sort convenience only — never used for activation.
 * No AsyncStorage fallback identity. No legacy workbook_versions reads.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import {
  activateSnapshot,
  deleteSnapshot,
  fetchActiveSnapshot,
  fetchSnapshots,
  uploadWorkbook,
} from "@/lib/workbook-api";
import type { ApiProvenance, WorkbookSnapshot } from "@/lib/workbook-types";

// ─── Theme ─────────────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0F1E",
  card: "#111827",
  card2: "#1A2235",
  border: "#1E2D40",
  primary: "#00D4AA",
  accent: "#8B5CF6",
  warn: "#F59E0B",
  danger: "#EF4444",
  text: "#F1F5F9",
  sec: "#94A3B8",
  muted: "#475569",
};

// ─── State contract ─────────────────────────────────────────────────────────
type WorkbookScreenState = {
  snapshots: WorkbookSnapshot[];
  activeSnapshotId: number | null;
  provenance: ApiProvenance | null;
  loading: boolean;
  refreshing: boolean;
  uploading: boolean;
  activatingSnapshotId: number | null;
  deletingSnapshotId: number | null;
  error: string | null;
};

const INIT: WorkbookScreenState = {
  snapshots: [],
  activeSnapshotId: null,
  provenance: null,
  loading: true,
  refreshing: false,
  uploading: false,
  activatingSnapshotId: null,
  deletingSnapshotId: null,
  error: null,
};

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function WorkbookScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<WorkbookScreenState>(INIT);

  const loadSnapshots = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      setState((prev) => ({
        ...prev,
        loading: mode === "initial" && prev.snapshots.length === 0,
        refreshing: mode === "refresh",
        error: null,
      }));

      try {
        const [snapshotsRes, activeRes] = await Promise.allSettled([
          fetchSnapshots(),
          fetchActiveSnapshot(),
        ]);

        let snapshots: WorkbookSnapshot[] = [];
        let provenance: ApiProvenance | null = null;
        let activeSnapshotId: number | null = null;
        let error: string | null = null;

        if (snapshotsRes.status === "fulfilled") {
          snapshots = snapshotsRes.value.snapshots;
          provenance = snapshotsRes.value._provenance;
        } else {
          error = snapshotsRes.reason?.message || "Failed to load snapshots";
        }

        if (activeRes.status === "fulfilled") {
          activeSnapshotId = activeRes.value.activeSnapshot.id;
          provenance = activeRes.value._provenance ?? provenance;
        } else {
          const msg: string = activeRes.reason?.message || "";
          if (!msg.toLowerCase().includes("no active workbook snapshot")) {
            error = error || msg || "Failed to load active workbook";
          }
        }

        setState((prev) => ({
          ...prev,
          snapshots,
          activeSnapshotId,
          provenance,
          loading: false,
          refreshing: false,
          error,
        }));
      } catch (err: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: err.message || "Failed to load workbook state",
        }));
      }
    },
    []
  );

  useEffect(() => {
    void loadSnapshots("initial");
  }, [loadSnapshots]);

  const handleUpload = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel.sheet.macroEnabled.12",
        ],
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      const file = result.assets?.[0];
      if (!file?.uri || !file?.name) {
        Alert.alert("Upload failed", "No workbook file selected.");
        return;
      }

      setState((prev) => ({ ...prev, uploading: true, error: null }));

      const uploadRes = await uploadWorkbook({
        fileUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType || undefined,
        versionTag: null,
      });

      setState((prev) => ({ ...prev, uploading: false }));

      const dateStr = uploadRes.filenameDate
        ? `\nDate parsed: ${uploadRes.filenameDate}`
        : "";
      Alert.alert(
        "Workbook uploaded",
        `Snapshot #${uploadRes.workbookSnapshotId} is now active.\n\n${uploadRes.filename}${dateStr}`
      );

      await loadSnapshots("initial");
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        uploading: false,
        error: err.message || "Failed to upload workbook",
      }));
      Alert.alert("Upload failed", err.message || "Failed to upload workbook");
    }
  }, [loadSnapshots]);

  const handleActivate = useCallback(
    async (snapshotId: number) => {
      setState((prev) => ({
        ...prev,
        activatingSnapshotId: snapshotId,
        error: null,
      }));
      try {
        await activateSnapshot(snapshotId);
        setState((prev) => ({ ...prev, activatingSnapshotId: null }));
        await loadSnapshots("initial");
      } catch (err: any) {
        setState((prev) => ({
          ...prev,
          activatingSnapshotId: null,
          error: err.message || "Failed to activate",
        }));
        Alert.alert("Activation failed", err.message || "Failed to activate");
      }
    },
    [loadSnapshots]
  );

  const handleDelete = useCallback(
    async (snapshotId: number, filename: string) => {
      Alert.alert(
        "Delete snapshot?",
        `This will permanently delete:\n${filename}\n\nAll parsed rows will be removed.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setState((prev) => ({
                ...prev,
                deletingSnapshotId: snapshotId,
                error: null,
              }));
              try {
                await deleteSnapshot(snapshotId);
                setState((prev) => ({ ...prev, deletingSnapshotId: null }));
                await loadSnapshots("initial");
              } catch (err: any) {
                setState((prev) => ({
                  ...prev,
                  deletingSnapshotId: null,
                  error: err.message || "Failed to delete",
                }));
                Alert.alert("Delete failed", err.message || "Failed to delete");
              }
            },
          },
        ]
      );
    },
    [loadSnapshots]
  );

  const activeSnapshot = useMemo(
    () => state.snapshots.find((s) => s.id === state.activeSnapshotId) ?? null,
    [state.snapshots, state.activeSnapshotId]
  );

  if (state.loading) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: "Workbooks", headerShown: true }} />
        <ActivityIndicator color={C.primary} />
        <Text style={s.muted}>Loading workbook snapshots…</Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "Workbooks", headerShown: true }} />

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <View style={s.headerRow}>
        <Text style={s.title}>Workbook Host</Text>
        <TouchableOpacity
          style={[s.uploadBtn, state.uploading && s.btnDisabled]}
          onPress={handleUpload}
          disabled={state.uploading}
          testID="upload-workbook-btn"
        >
          {state.uploading ? (
            <ActivityIndicator size="small" color={C.bg} />
          ) : (
            <Ionicons name="cloud-upload-outline" size={16} color={C.bg} />
          )}
          <Text style={s.uploadBtnText}>
            {state.uploading ? "Uploading…" : "Upload"}
          </Text>
        </TouchableOpacity>
      </View>

      {state.error ? (
        <View style={s.errorBox}>
          <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
          <Text style={s.errorText}>{state.error}</Text>
        </View>
      ) : null}

      {/* ── Active snapshot summary ─────────────────────────────────────────── */}
      <View
        style={[
          s.activeBox,
          activeSnapshot
            ? { borderColor: "rgba(0,212,170,0.35)" }
            : { borderColor: "rgba(245,158,11,0.3)" },
        ]}
      >
        <View style={s.activeBoxHeader}>
          <Ionicons
            name={activeSnapshot ? "checkmark-circle" : "warning-outline"}
            size={14}
            color={activeSnapshot ? C.primary : C.warn}
          />
          <Text
            style={[
              s.activeBoxLabel,
              { color: activeSnapshot ? C.primary : C.warn },
            ]}
          >
            {activeSnapshot ? "ACTIVE SNAPSHOT" : "NO ACTIVE SNAPSHOT"}
          </Text>
        </View>
        {activeSnapshot ? (
          <>
            <Text style={s.activeFilename}>{activeSnapshot.filename}</Text>
            <Text style={s.activeMeta}>
              snapshot_id = {activeSnapshot.id}
              {activeSnapshot.filenameDate
                ? `  •  date = ${activeSnapshot.filenameDate}`
                : ""}
            </Text>
            <Text style={s.activeMeta}>
              uploaded {new Date(activeSnapshot.uploadedAt).toLocaleString()}
            </Text>
            <View style={s.rowCountRow}>
              {Object.entries(activeSnapshot.rowCounts || {}).map(
                ([sheet, count]) => (
                  <View key={sheet} style={s.pill}>
                    <Text style={s.pillText}>
                      {sheet}: {count}
                    </Text>
                  </View>
                )
              )}
            </View>
          </>
        ) : (
          <Text style={s.muted}>
            Upload a workbook to activate. Activation is always explicit — no
            auto-select from filename.
          </Text>
        )}
      </View>

      {/* ── Snapshot list ──────────────────────────────────────────────────── */}
      <Text style={[s.sectionTitle, { marginBottom: 8 }]}>
        All Snapshots
        {state.snapshots.length > 0 ? ` (${state.snapshots.length})` : ""}
      </Text>

      <FlatList
        data={state.snapshots}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={() => void loadSnapshots("refresh")}
            tintColor={C.primary}
          />
        }
        ListEmptyComponent={
          <View style={s.emptyBox}>
            <Ionicons name="document-text-outline" size={36} color={C.muted} />
            <Text style={s.muted}>No workbook snapshots uploaded yet.</Text>
            <Text style={[s.muted, { fontSize: 11, marginTop: 4 }]}>
              Tap Upload to add a logbookMMDDYYYY.xlsx file.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isActive = item.id === state.activeSnapshotId;
          const isActivating = state.activatingSnapshotId === item.id;
          const isDeleting = state.deletingSnapshotId === item.id;

          return (
            <View
              style={[
                s.card,
                isActive && { borderColor: "rgba(0,212,170,0.35)" },
              ]}
            >
              {/* top row */}
              <View style={s.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardFilename}>{item.filename}</Text>
                  <Text style={s.cardMeta}>
                    #{item.id}
                    {item.filenameDate ? `  •  ${item.filenameDate}` : ""}
                  </Text>
                  <Text style={s.cardMeta}>
                    {new Date(item.uploadedAt).toLocaleString()}
                  </Text>
                </View>

                {isActive ? (
                  <View style={s.activeBadge}>
                    <Text style={s.activeBadgeText}>ACTIVE</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[s.activateBtn, isActivating && s.btnDisabled]}
                    onPress={() => void handleActivate(item.id)}
                    disabled={isActivating || isDeleting}
                    testID={`activate-btn-${item.id}`}
                  >
                    {isActivating ? (
                      <ActivityIndicator size="small" color={C.primary} />
                    ) : (
                      <Text style={s.activateBtnText}>Activate</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {/* row counts */}
              {Object.keys(item.rowCounts || {}).length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 8 }}
                >
                  <View style={s.rowCountRow}>
                    {Object.entries(item.rowCounts).map(([sheet, count]) => (
                      <View
                        key={sheet}
                        style={[
                          s.pill,
                          isActive && { borderColor: "rgba(0,212,170,0.3)" },
                        ]}
                      >
                        <Text style={s.pillText}>
                          {sheet}: {count}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              ) : null}

              {/* warnings */}
              {item.warnings?.length ? (
                <View style={s.warningBlock}>
                  {item.warnings.map((w, idx) => (
                    <Text key={idx} style={s.warningText}>
                      ⚠ {w}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* delete (only for non-active snapshots) */}
              {!isActive ? (
                <TouchableOpacity
                  style={s.deleteBtn}
                  onPress={() => void handleDelete(item.id, item.filename)}
                  disabled={isDeleting || isActivating}
                  testID={`delete-btn-${item.id}`}
                >
                  <Ionicons name="trash-outline" size={12} color={C.muted} />
                  <Text style={s.deleteBtnText}>
                    {isDeleting ? "Deleting…" : "Delete"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        }}
      />

      {/* ── Provenance panel ───────────────────────────────────────────────── */}
      <View style={s.provBox}>
        <Text style={s.provLabel}>PROVENANCE</Text>
        {state.provenance ? (
          <>
            <Text style={s.provLine}>
              db = {state.provenance.db?.database ?? "?"} @{" "}
              {state.provenance.db?.host ?? "?"}
            </Text>
            <Text style={s.provLine}>
              env = {state.provenance.db?.node_env ?? state.provenance.db?.nodeEnv ?? "?"}  •  source ={" "}
              {state.provenance.source}
            </Text>
            <Text style={s.provLine}>
              active_snapshot_id ={" "}
              {state.provenance.activeWorkbookSnapshotId ?? "none"}
            </Text>
            {state.provenance.tablesRead?.length ? (
              <Text style={s.provLine}>
                tables = {state.provenance.tablesRead.join(", ")}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={s.provLine}>No provenance loaded</Text>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 16,
    paddingBottom: 0,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.bg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  title: {
    fontFamily: "Rubik_700Bold",
    fontSize: 20,
    color: C.text,
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  uploadBtnText: {
    fontFamily: "Rubik_700Bold",
    fontSize: 13,
    color: C.bg,
  },
  btnDisabled: { opacity: 0.5 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  errorText: {
    flex: 1,
    fontFamily: "Rubik_400Regular",
    fontSize: 12,
    color: C.danger,
  },
  activeBox: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    gap: 5,
  },
  activeBoxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },
  activeBoxLabel: {
    fontFamily: "Rubik_700Bold",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  activeFilename: {
    fontFamily: "Rubik_700Bold",
    fontSize: 15,
    color: C.text,
  },
  activeMeta: {
    fontFamily: "Rubik_400Regular",
    fontSize: 11,
    color: C.sec,
  },
  sectionTitle: {
    fontFamily: "Rubik_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardFilename: {
    fontFamily: "Rubik_600SemiBold",
    fontSize: 13,
    color: C.text,
  },
  cardMeta: {
    fontFamily: "Rubik_400Regular",
    fontSize: 11,
    color: C.sec,
    marginTop: 1,
  },
  activeBadge: {
    backgroundColor: "rgba(0,212,170,0.18)",
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.5)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  activeBadgeText: {
    fontFamily: "Rubik_700Bold",
    fontSize: 10,
    color: C.primary,
    letterSpacing: 0.8,
  },
  activateBtn: {
    borderWidth: 1,
    borderColor: C.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 80,
    alignItems: "center",
  },
  activateBtnText: {
    fontFamily: "Rubik_600SemiBold",
    fontSize: 12,
    color: C.primary,
  },
  rowCountRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    backgroundColor: C.card2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: {
    fontFamily: "Rubik_400Regular",
    fontSize: 10,
    color: C.sec,
  },
  warningBlock: {
    marginTop: 8,
    gap: 3,
  },
  warningText: {
    fontFamily: "Rubik_400Regular",
    fontSize: 11,
    color: C.warn,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-end",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  deleteBtnText: {
    fontFamily: "Rubik_400Regular",
    fontSize: 11,
    color: C.muted,
  },
  emptyBox: {
    paddingVertical: 40,
    alignItems: "center",
    gap: 8,
  },
  muted: {
    fontFamily: "Rubik_400Regular",
    fontSize: 12,
    color: C.muted,
    textAlign: "center",
  },
  provBox: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 16,
    gap: 3,
  },
  provLabel: {
    fontFamily: "Rubik_700Bold",
    fontSize: 9,
    color: C.muted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  provLine: {
    fontFamily: "Rubik_400Regular",
    fontSize: 10,
    color: C.sec,
  },
});
