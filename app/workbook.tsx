import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetch as expoFetch } from "expo/fetch";
import { getApiUrl } from "@/lib/query-client";
import { makeApiHeaders } from "@/lib/api-headers";

// ─── Theme ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#0A0F1E",
  cardBg: "#111827",
  cardBg2: "#1A2235",
  border: "#1E2D40",
  primary: "#00D4AA",
  accent: "#8B5CF6",
  warn: "#F59E0B",
  danger: "#EF4444",
  text: "#F1F5F9",
  textSec: "#94A3B8",
  textMuted: "#475569",
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface WorkbookVersion {
  id: number;
  filename: string;
  version_tag: string | null;
  uploaded_at: string;
  sheets_found: string[];
  row_counts: Record<string, number>;
}

interface WorkbookSummary {
  workbook: WorkbookVersion;
  currentPhase: Record<string, any> | null;
  biolog: Record<string, any>[];
  ingredients: Record<string, any>[];
  mealLines: Record<string, any>[];
  mealTemplates: Record<string, any>[];
  driftHistory: Record<string, any>[];
  colonies: Record<string, any>[];
  thresholds: Record<string, any>[];
}

type Panel = "phase" | "nutrition" | "drift" | "colonies";

const PANELS: { key: Panel; label: string; icon: string }[] = [
  { key: "phase", label: "Phase", icon: "pulse" },
  { key: "nutrition", label: "Nutrition", icon: "nutrition" },
  { key: "drift", label: "Drift", icon: "trending-up" },
  { key: "colonies", label: "Colonies", icon: "grid" },
];

// ─── API helpers ──────────────────────────────────────────────────────────────
// makeApiHeaders sends both Authorization: Bearer <token> and X-User-Id
const makeHeaders = makeApiHeaders;

async function fetchVersions(): Promise<WorkbookVersion[]> {
  const base = getApiUrl();
  const url = new URL("/api/workbooks", base).toString();
  const headers = await makeHeaders();
  const res = await expoFetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  const body = await res.json() as any;
  // Handle both old flat-array shape and new { versions, _provenance } shape
  return Array.isArray(body) ? body : (body.versions ?? []);
}

async function fetchSummary(id: number): Promise<WorkbookSummary> {
  const base = getApiUrl();
  const url = new URL(`/api/workbooks/${id}/summary`, base).toString();
  const headers = await makeHeaders();
  const res = await expoFetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<WorkbookSummary>;
}

async function deleteVersion(id: number): Promise<void> {
  const base = getApiUrl();
  const url = new URL(`/api/workbooks/${id}`, base).toString();
  const headers = await makeHeaders();
  const res = await expoFetch(url, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`${res.status}`);
}

// ─── Small components ─────────────────────────────────────────────────────────
function KeyValueRow({ label, value }: { label: string; value: any }) {
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return (
    <View style={kv.row}>
      <Text style={kv.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={kv.value} selectable>
        {display}
      </Text>
    </View>
  );
}

const kv = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  value: {
    flex: 2,
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: C.text,
    flexWrap: "wrap",
  },
});

function DataCard({
  row,
  index,
}: {
  row: Record<string, any>;
  index: number;
}) {
  const keys = Object.keys(row);
  return (
    <View style={styles.dataCard}>
      <Text style={styles.dataCardIndex}>#{index + 1}</Text>
      {keys.map((k) => (
        <KeyValueRow key={k} label={k} value={row[k]} />
      ))}
    </View>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <View style={styles.emptyPanel}>
      <Ionicons name="document-outline" size={36} color={C.textMuted} />
      <Text style={styles.emptyPanelText}>{message}</Text>
    </View>
  );
}

// ─── Panel contents ───────────────────────────────────────────────────────────
function PhasePanel({ summary }: { summary: WorkbookSummary }) {
  const { currentPhase, biolog } = summary;

  return (
    <ScrollView
      contentContainerStyle={styles.panelScroll}
      showsVerticalScrollIndicator={false}
    >
      {currentPhase ? (
        <>
          <View style={styles.phaseHero}>
            <Ionicons name="pulse" size={24} color={C.primary} />
            <Text style={styles.phaseHeroTitle}>Current Phase</Text>
          </View>
          <View style={styles.dataCard}>
            {Object.keys(currentPhase).map((k) => (
              <KeyValueRow key={k} label={k} value={currentPhase[k]} />
            ))}
          </View>
        </>
      ) : (
        <EmptyPanel message='No phase data found. Ensure the "biolog" sheet has a column containing "phase".' />
      )}

      {biolog.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Biolog — {biolog.length} rows
          </Text>
          {biolog.slice(0, 20).map((row, i) => (
            <DataCard key={i} row={row} index={i} />
          ))}
          {biolog.length > 20 && (
            <Text style={styles.truncNote}>
              Showing 20 of {biolog.length} rows
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

function NutritionPanel({ summary }: { summary: WorkbookSummary }) {
  const { mealTemplates, mealLines, ingredients, thresholds } = summary;

  return (
    <ScrollView
      contentContainerStyle={styles.panelScroll}
      showsVerticalScrollIndicator={false}
    >
      {mealTemplates.length === 0 &&
      mealLines.length === 0 &&
      ingredients.length === 0 ? (
        <EmptyPanel message='No nutrition data found. Check "meal_templates", "meal_lines", and "ingredients" sheets.' />
      ) : null}

      {mealTemplates.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Meal Templates — {mealTemplates.length} rows
          </Text>
          {mealTemplates.map((row, i) => (
            <DataCard key={i} row={row} index={i} />
          ))}
        </>
      )}

      {mealLines.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Meal Lines — {mealLines.length} rows
          </Text>
          {mealLines.slice(0, 30).map((row, i) => (
            <DataCard key={i} row={row} index={i} />
          ))}
          {mealLines.length > 30 && (
            <Text style={styles.truncNote}>
              Showing 30 of {mealLines.length} rows
            </Text>
          )}
        </>
      )}

      {ingredients.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Ingredients — {ingredients.length} rows
          </Text>
          {ingredients.slice(0, 30).map((row, i) => (
            <DataCard key={i} row={row} index={i} />
          ))}
          {ingredients.length > 30 && (
            <Text style={styles.truncNote}>
              Showing 30 of {ingredients.length} rows
            </Text>
          )}
        </>
      )}

      {thresholds.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Threshold Lab — {thresholds.length} rows
          </Text>
          {thresholds.map((row, i) => (
            <DataCard key={i} row={row} index={i} />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function DriftPanel({ summary }: { summary: WorkbookSummary }) {
  const { driftHistory } = summary;

  if (driftHistory.length === 0) {
    return (
      <View style={styles.panelScroll}>
        <EmptyPanel message='No drift events found in "drift_history" sheet.' />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.panelScroll}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sectionTitle}>
        Drift History — {driftHistory.length} events
      </Text>
      {driftHistory.map((row, i) => (
        <DataCard key={i} row={row} index={i} />
      ))}
    </ScrollView>
  );
}

function ColoniesPanel({ summary }: { summary: WorkbookSummary }) {
  const { colonies } = summary;

  if (colonies.length === 0) {
    return (
      <View style={styles.panelScroll}>
        <EmptyPanel message='No colony data found in "colony_coord" sheet.' />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.panelScroll}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sectionTitle}>
        Colony Coordinates — {colonies.length} entries
      </Text>
      {colonies.map((row, i) => (
        <DataCard key={i} row={row} index={i} />
      ))}
    </ScrollView>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function WorkbookScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [versions, setVersions] = useState<WorkbookVersion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [summary, setSummary] = useState<WorkbookSummary | null>(null);
  const [activePanel, setActivePanel] = useState<Panel>("phase");
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadVersions = useCallback(async () => {
    try {
      const data = await fetchVersions();
      setVersions(data);
      if (data.length && selectedId === null) {
        setSelectedId(data[0].id);
        loadSummaryFor(data[0].id);
      }
    } catch (e) {
      console.error("loadVersions", e);
    } finally {
      setLoadingVersions(false);
      setRefreshing(false);
    }
  }, [selectedId]);

  // Load on mount
  React.useEffect(() => {
    loadVersions();
  }, []);

  const loadSummaryFor = async (id: number) => {
    setLoadingSummary(true);
    setSummary(null);
    try {
      const data = await fetchSummary(id);
      setSummary(data);
    } catch (e) {
      Alert.alert("Error", "Could not load workbook summary.");
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleSelectVersion = (id: number) => {
    if (id === selectedId) return;
    setSelectedId(id);
    loadSummaryFor(id);
  };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === "web"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (
        !asset.name.endsWith(".xlsx") &&
        !asset.mimeType?.includes("spreadsheet")
      ) {
        Alert.alert("Invalid file", "Please select an .xlsx Excel workbook.");
        return;
      }

      setUploading(true);

      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type:
          asset.mimeType ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      } as any);

      const base = getApiUrl();
      const url = new URL("/api/workbooks/upload", base).toString();
      const headers = await makeHeaders();

      const res = await expoFetch(url, {
        method: "POST",
        headers,
        body: formData,
      });

      const body = await res.json() as any;
      if (!res.ok) {
        Alert.alert("Upload failed", body.error || "Unknown error");
        return;
      }

      const warnings = body.warnings as string[] | undefined;
      const msg =
        warnings?.length
          ? `Uploaded successfully.\n\nWarnings:\n${warnings.join("\n")}`
          : "Workbook uploaded and parsed successfully.";

      Alert.alert("Success", msg);
      await loadVersions();
      handleSelectVersion(body.workbookId);
    } catch (e: any) {
      Alert.alert("Upload error", e?.message || "Something went wrong.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (ver: WorkbookVersion) => {
    Alert.alert(
      "Delete version",
      `Remove "${ver.filename}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteVersion(ver.id);
              const next = versions.filter((v) => v.id !== ver.id);
              setVersions(next);
              if (selectedId === ver.id) {
                const nextSel = next[0] ?? null;
                setSelectedId(nextSel?.id ?? null);
                setSummary(null);
                if (nextSel) loadSummaryFor(nextSel.id);
              }
            } catch {
              Alert.alert("Error", "Could not delete version.");
            }
          },
        },
      ]
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadVersions();
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const totalRows = (rc: Record<string, number>) =>
    Object.values(rc).reduce((a, b) => a + b, 0);

  // ─── Render version card ─────────────────────────────────────────────────
  const renderVersion = ({ item }: { item: WorkbookVersion }) => {
    const isSelected = item.id === selectedId;
    return (
      <TouchableOpacity
        style={[styles.versionCard, isSelected && styles.versionCardSelected]}
        onPress={() => handleSelectVersion(item.id)}
        onLongPress={() => handleDelete(item)}
        activeOpacity={0.75}
      >
        <View style={styles.versionCardTop}>
          <Ionicons
            name="document-text"
            size={16}
            color={isSelected ? C.primary : C.textMuted}
          />
          <Text
            style={[
              styles.versionFilename,
              isSelected && { color: C.primary },
            ]}
            numberOfLines={1}
          >
            {item.version_tag || item.filename}
          </Text>
        </View>
        <Text style={styles.versionDate}>{formatDate(item.uploaded_at)}</Text>
        <Text style={styles.versionMeta}>
          {item.sheets_found?.length ?? 0} sheets · {totalRows(item.row_counts ?? {})} rows
        </Text>
      </TouchableOpacity>
    );
  };

  // ─── Sheet count pills ───────────────────────────────────────────────────
  const renderSheetPills = (rc: Record<string, number>) => {
    const entries = Object.entries(rc);
    if (!entries.length) return null;
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillsRow}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      >
        {entries.map(([sheet, count]) => (
          <View key={sheet} style={styles.pill}>
            <Text style={styles.pillSheet}>{sheet}</Text>
            <Text style={styles.pillCount}>{count}</Text>
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Workbooks",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.text,
          headerTitleStyle: {
            fontFamily: "Rubik_600SemiBold",
            color: C.text,
          },
          headerRight: () => (
            <TouchableOpacity
              style={styles.uploadBtn}
              onPress={handleUpload}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color={C.primary} />
                  <Text style={styles.uploadBtnText}>Upload</Text>
                </>
              )}
            </TouchableOpacity>
          ),
        }}
      />

      <View
        style={[
          styles.container,
          { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) },
        ]}
      >
        {/* Version list */}
        {loadingVersions ? (
          <ActivityIndicator
            color={C.primary}
            style={{ marginVertical: 24 }}
          />
        ) : versions.length === 0 ? (
          <TouchableOpacity
            style={styles.emptyUpload}
            onPress={handleUpload}
            disabled={uploading}
          >
            <Ionicons name="cloud-upload-outline" size={40} color={C.primary} />
            <Text style={styles.emptyUploadTitle}>Upload a Workbook</Text>
            <Text style={styles.emptyUploadSub}>
              Select an .xlsx file containing biolog, ingredients, meal_lines,
              meal_templates, drift_history, colony_coord, or threshold_lab
              sheets.
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <FlatList
              data={versions}
              keyExtractor={(v) => String(v.id)}
              renderItem={renderVersion}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.versionList}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingVertical: 12,
                gap: 10,
              }}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={C.primary}
                />
              }
            />

            {/* Sheet row counts for selected workbook */}
            {summary && renderSheetPills(summary.workbook.row_counts ?? {})}

            {/* Panel tabs */}
            <View style={styles.panelTabs}>
              {PANELS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.panelTab,
                    activePanel === p.key && styles.panelTabActive,
                  ]}
                  onPress={() => setActivePanel(p.key)}
                >
                  <Ionicons
                    name={p.icon as any}
                    size={14}
                    color={activePanel === p.key ? C.primary : C.textMuted}
                  />
                  <Text
                    style={[
                      styles.panelTabText,
                      activePanel === p.key && styles.panelTabTextActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Panel content */}
            {loadingSummary ? (
              <ActivityIndicator
                color={C.primary}
                style={{ flex: 1, marginTop: 40 }}
              />
            ) : summary ? (
              <View style={{ flex: 1 }}>
                {activePanel === "phase" && <PhasePanel summary={summary} />}
                {activePanel === "nutrition" && (
                  <NutritionPanel summary={summary} />
                )}
                {activePanel === "drift" && <DriftPanel summary={summary} />}
                {activePanel === "colonies" && (
                  <ColoniesPanel summary={summary} />
                )}
              </View>
            ) : (
              <EmptyPanel message="Select a workbook version above to view its data." />
            )}
          </>
        )}
      </View>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  uploadBtnText: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: C.primary,
  },
  emptyUpload: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 14,
  },
  emptyUploadTitle: {
    fontSize: 20,
    fontFamily: "Rubik_700Bold",
    color: C.text,
    textAlign: "center",
  },
  emptyUploadSub: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: C.textSec,
    textAlign: "center",
    lineHeight: 21,
  },
  versionList: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  versionCard: {
    width: 200,
    backgroundColor: C.cardBg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 4,
  },
  versionCardSelected: {
    borderColor: C.primary,
    backgroundColor: C.cardBg2,
  },
  versionCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  versionFilename: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: C.text,
  },
  versionDate: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: C.textMuted,
  },
  versionMeta: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: C.textSec,
  },
  pillsRow: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 10,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.cardBg,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  pillSheet: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: C.textSec,
  },
  pillCount: {
    fontSize: 11,
    fontFamily: "Rubik_700Bold",
    color: C.primary,
  },
  panelTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  panelTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 12,
  },
  panelTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: C.primary,
  },
  panelTabText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: C.textMuted,
  },
  panelTabTextActive: {
    color: C.primary,
    fontFamily: "Rubik_600SemiBold",
  },
  panelScroll: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  phaseHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  phaseHeroTitle: {
    fontSize: 17,
    fontFamily: "Rubik_700Bold",
    color: C.text,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: C.textSec,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
  },
  dataCard: {
    backgroundColor: C.cardBg,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 2,
  },
  dataCardIndex: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: C.textMuted,
    marginBottom: 6,
  },
  truncNote: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: C.textMuted,
    textAlign: "center",
    marginTop: 4,
  },
  emptyPanel: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyPanelText: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 21,
  },
});
