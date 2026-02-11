import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { fetch as expoFetch } from "expo/fetch";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

interface SessionRow {
  date: string;
  nocturnalErections: number | null;
  nocturnalDurationSeconds: number | null;
  isImputed: boolean;
  imputedMethod: string | null;
  multiNightCombined: boolean;
}

interface ProxyRow {
  date: string;
  proxyScore: number | null;
  proxy7dAvg: number | null;
}

interface SnapshotRow {
  id: string;
  sessionDate: string;
  totalNights: number;
  totalNocturnalErections: number;
  totalNocturnalDurationSeconds: number;
}

interface ConfidenceWindow {
  window: string;
  days: number;
  measured: number;
  imputed: number;
  multiNight: number;
  grade: "High" | "Med" | "Low" | "None";
}

const ACCENT = "#8B5CF6";
const ACCENT_MUTED = "rgba(139, 92, 246, 0.15)";
const MEASURED_COLOR = "#34D399";
const IMPUTED_COLOR = "#FBBF24";

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ProxyChart({ data }: { data: ProxyRow[] }) {
  if (data.length < 2) return null;
  const scores = data.map(d => d.proxy7dAvg ?? d.proxyScore ?? 0);
  const min = Math.min(...scores) - 0.3;
  const max = Math.max(...scores) + 0.3;
  const range = max - min || 1;
  const height = 120;
  const width = 300;
  const step = width / (scores.length - 1);

  const points = scores.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * height,
  }));

  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartYAxis}>
        <Text style={styles.chartAxisLabel}>{max.toFixed(1)}</Text>
        <Text style={styles.chartAxisLabel}>{((max + min) / 2).toFixed(1)}</Text>
        <Text style={styles.chartAxisLabel}>{min.toFixed(1)}</Text>
      </View>
      <View style={{ width, height, position: "relative" }}>
        {[0, 0.5, 1].map(pct => (
          <View
            key={pct}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: pct * height,
              height: 1,
              backgroundColor: Colors.border,
            }}
          />
        ))}
        {points.map((p, i) => {
          if (i === 0) return null;
          const prev = points[i - 1];
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: prev.x,
                top: prev.y,
                width: len,
                height: 2.5,
                backgroundColor: ACCENT,
                borderRadius: 1,
                transform: [{ rotate: `${angle}deg` }],
                transformOrigin: "left center",
              }}
            />
          );
        })}
        {points.map((p, i) => (
          <View
            key={`dot-${i}`}
            style={{
              position: "absolute",
              left: p.x - 3,
              top: p.y - 3,
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === points.length - 1 ? ACCENT : Colors.cardBgElevated,
              borderWidth: 1.5,
              borderColor: ACCENT,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export default function VitalsScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [proxyData, setProxyData] = useState<ProxyRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [confidence, setConfidence] = useState<ConfidenceWindow[]>([]);
  const [includeImputed, setIncludeImputed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessionDate, setSessionDate] = useState(todayStr());
  const [refreshing, setRefreshing] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupImporting, setBackupImporting] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();

      const [sessRes, proxyRes, snapRes, confRes] = await Promise.all([
        expoFetch(new URL("/api/erection/sessions", baseUrl).toString(), { credentials: "include" }),
        expoFetch(new URL(`/api/erection/proxy?include_imputed=${includeImputed}`, baseUrl).toString(), { credentials: "include" }),
        expoFetch(new URL("/api/erection/snapshots", baseUrl).toString(), { credentials: "include" }),
        expoFetch(new URL("/api/erection/confidence", baseUrl).toString(), { credentials: "include" }),
      ]);

      if (sessRes.ok) {
        const rows = await sessRes.json();
        setSessions(rows.map((r: any) => ({
          date: r.date,
          nocturnalErections: r.nocturnalErections != null ? Number(r.nocturnalErections) : null,
          nocturnalDurationSeconds: r.nocturnalDurationSeconds != null ? Number(r.nocturnalDurationSeconds) : null,
          isImputed: !!r.isImputed,
          imputedMethod: r.imputedMethod ?? null,
          multiNightCombined: !!r.multiNightCombined,
        })));
      }

      if (proxyRes.ok) {
        const rows = await proxyRes.json();
        setProxyData(rows.map((r: any) => ({
          date: r.date,
          proxyScore: r.proxyScore != null ? Number(r.proxyScore) : null,
          proxy7dAvg: r.proxy7DAvg != null ? Number(r.proxy7DAvg) : null,
        })));
      }

      if (snapRes.ok) {
        const rows = await snapRes.json();
        setSnapshots(rows.map((r: any) => ({
          id: r.id,
          sessionDate: r.session_date,
          totalNights: Number(r.total_nights),
          totalNocturnalErections: Number(r.total_nocturnal_erections),
          totalNocturnalDurationSeconds: Number(r.total_nocturnal_duration_seconds),
        })));
      }

      if (confRes.ok) {
        const rows = await confRes.json();
        setConfidence(rows);
      }
    } catch (err) {
      console.error("vitals load error:", err);
    }
  }, [includeImputed]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleBackupExport = async () => {
    try {
      setBackupExporting(true);
      setBackupStatus(null);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const baseUrl = getApiUrl();
      const url = new URL("/api/backup/export", baseUrl).toString();
      const resp = await expoFetch(url, { credentials: "include" });
      if (!resp.ok) {
        setBackupStatus("Export failed");
        return;
      }

      const json = await resp.json();
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `bulk-coach-backup-${dateStr}.json`;

      if (Platform.OS === "web") {
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        setBackupStatus("Backup downloaded");
      } else {
        const path = FileSystem.documentDirectory + filename;
        await FileSystem.writeAsStringAsync(path, JSON.stringify(json, null, 2));
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: "Save Backup" });
          setBackupStatus("Backup exported");
        } else {
          setBackupStatus(`Saved to ${path}`);
        }
      }
    } catch (err) {
      console.error("backup export error:", err);
      setBackupStatus("Export failed");
    } finally {
      setBackupExporting(false);
    }
  };

  const handleBackupImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      setBackupImporting(true);
      setBackupStatus(null);

      const baseUrl = getApiUrl();

      const dryRunForm = new FormData();
      if (Platform.OS === "web") {
        const resp = await globalThis.fetch(asset.uri);
        const blob = await resp.blob();
        dryRunForm.append("file", blob, asset.name || "backup.json");
      } else {
        const file = new File(asset.uri);
        dryRunForm.append("file", file as any);
      }
      dryRunForm.append("mode", "merge");
      dryRunForm.append("dry_run", "true");

      const dryRes = await expoFetch(
        new URL("/api/backup/import", baseUrl).toString(),
        { method: "POST", body: dryRunForm, credentials: "include" },
      );
      const dryJson = await dryRes.json();

      if (!dryRes.ok) {
        setBackupStatus(dryJson.error || "Invalid backup file");
        setBackupImporting(false);
        return;
      }

      const wi = dryJson.would_insert || {};
      const wu = dryJson.would_update || {};
      const summary = Object.entries(wi)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => `${k}: +${v}`)
        .concat(
          Object.entries(wu)
            .filter(([, v]) => (v as number) > 0)
            .map(([k, v]) => `${k}: ~${v}`)
        )
        .join("\n");

      const msg = summary || "No new data to import";

      Alert.alert(
        "Import Preview",
        `Dry run result:\n${msg}\n\nProceed with import?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => setBackupImporting(false) },
          {
            text: "Import",
            style: "default",
            onPress: async () => {
              try {
                const importForm = new FormData();
                if (Platform.OS === "web") {
                  const resp2 = await globalThis.fetch(asset.uri);
                  const blob2 = await resp2.blob();
                  importForm.append("file", blob2, asset.name || "backup.json");
                } else {
                  const file2 = new File(asset.uri);
                  importForm.append("file", file2 as any);
                }
                importForm.append("mode", "merge");
                importForm.append("dry_run", "false");

                const importRes = await expoFetch(
                  new URL("/api/backup/import", baseUrl).toString(),
                  { method: "POST", body: importForm, credentials: "include" },
                );
                const importJson = await importRes.json();

                if (importRes.ok && importJson.status === "ok") {
                  const counts = importJson.imported || {};
                  const total = Object.values(counts).reduce((s: number, v: unknown) => s + (v as number), 0);
                  setBackupStatus(`Restored ${total} rows${importJson.recomputed ? " (recomputed)" : ""}`);
                  loadData();
                } else {
                  setBackupStatus(importJson.error || "Import failed");
                }
              } catch (err2) {
                console.error("backup import error:", err2);
                setBackupStatus("Import failed");
              } finally {
                setBackupImporting(false);
              }
            },
          },
        ],
      );
    } catch (err) {
      console.error("backup import error:", err);
      setBackupStatus("Import failed");
      setBackupImporting(false);
    }
  };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      setUploading(true);
      setUploadResult(null);

      const baseUrl = getApiUrl();
      const url = new URL("/api/erection/upload", baseUrl).toString();

      const formData = new FormData();

      if (Platform.OS === "web") {
        const resp = await globalThis.fetch(asset.uri);
        const blob = await resp.blob();
        formData.append("file", blob, asset.name || "snapshot.csv");
      } else {
        const file = new File(asset.uri);
        formData.append("file", file as any);
      }
      formData.append("session_date", sessionDate);

      const uploadRes = await expoFetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const json = await uploadRes.json();

      if (!uploadRes.ok) {
        setUploadResult(json.error || "Upload failed");
        return;
      }

      if (json.note === "duplicate_snapshot") {
        setUploadResult("Already imported (duplicate file)");
      } else if (json.note === "baseline_stored") {
        setUploadResult("Baseline snapshot stored (first upload, no session yet)");
      } else if (json.derived) {
        const d = json.derived;
        setUploadResult(
          `Imported: ${d.deltaNoctErections} erections, ${formatDur(d.deltaNoctDur)}${d.multiNightCombined ? " (multi-night combined)" : ""}${json.gapsFilled > 0 ? ` | ${json.gapsFilled} gap days filled` : ""}`
        );
      } else {
        setUploadResult(json.note || "Done");
      }

      await loadData();
    } catch (err) {
      console.error("upload error:", err);
      setUploadResult(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const latestProxy = proxyData.length > 0 ? proxyData[proxyData.length - 1] : null;
  const measuredCount = sessions.filter(s => !s.isImputed).length;
  const imputedCount = sessions.filter(s => s.isImputed).length;
  const recentSessions = [...sessions].reverse().slice(0, 14);

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="pulse" size={22} color={ACCENT} />
        <Text style={styles.headerTitle}>Vitals</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 100 + bottomInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={ACCENT} />
        }
      >
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="cloud-upload-outline" size={18} color={ACCENT} />
            <Text style={styles.cardTitle}>Upload Snapshot</Text>
          </View>

          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Session Date</Text>
            <TextInput
              style={styles.dateInput}
              value={sessionDate}
              onChangeText={setSessionDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textTertiary}
              keyboardAppearance="dark"
            />
          </View>

          <Pressable
            style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
            onPress={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={Colors.text} />
            ) : (
              <>
                <Feather name="upload" size={18} color={Colors.text} />
                <Text style={styles.uploadBtnText}>Select CSV File</Text>
              </>
            )}
          </Pressable>

          {uploadResult && (
            <View style={[styles.resultBanner, uploadResult.includes("fail") || uploadResult.includes("error") ? styles.resultError : styles.resultSuccess]}>
              <Text style={styles.resultText}>{uploadResult}</Text>
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: ACCENT }]}>
            <Text style={styles.statValue}>
              {latestProxy?.proxy7dAvg?.toFixed(1) ?? latestProxy?.proxyScore?.toFixed(1) ?? "--"}
            </Text>
            <Text style={styles.statLabel}>7d Proxy Avg</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: MEASURED_COLOR }]}>
            <Text style={styles.statValue}>{measuredCount}</Text>
            <Text style={styles.statLabel}>Measured</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: IMPUTED_COLOR }]}>
            <Text style={styles.statValue}>{imputedCount}</Text>
            <Text style={styles.statLabel}>Imputed</Text>
          </View>
        </View>

        {confidence.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="shield-checkmark-outline" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Data Confidence</Text>
            </View>
            <View style={styles.confGrid}>
              {confidence.map((c) => {
                const gradeColor = c.grade === "High" ? MEASURED_COLOR : c.grade === "Med" ? IMPUTED_COLOR : c.grade === "Low" ? "#EF4444" : Colors.textTertiary;
                return (
                  <View key={c.window} style={styles.confCell}>
                    <Text style={styles.confWindow}>{c.window}</Text>
                    <View style={[styles.confGradeBadge, { backgroundColor: gradeColor + "20", borderColor: gradeColor + "40" }]}>
                      <Text style={[styles.confGradeText, { color: gradeColor }]}>{c.grade}</Text>
                    </View>
                    <View style={styles.confCounts}>
                      <Text style={[styles.confCountText, { color: MEASURED_COLOR }]}>{c.measured}M</Text>
                      <Text style={[styles.confCountText, { color: IMPUTED_COLOR }]}>{c.imputed}I</Text>
                      {c.multiNight > 0 && <Text style={[styles.confCountText, { color: Colors.textTertiary }]}>{c.multiNight}C</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {proxyData.length >= 2 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="chart-line" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Androgen Proxy (7d Avg)</Text>
            </View>
            <ProxyChart data={proxyData} />
            <Pressable
              style={styles.toggleRow}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIncludeImputed(!includeImputed);
              }}
            >
              <Ionicons
                name={includeImputed ? "checkbox" : "square-outline"}
                size={20}
                color={includeImputed ? IMPUTED_COLOR : Colors.textTertiary}
              />
              <Text style={[styles.toggleLabel, includeImputed && { color: IMPUTED_COLOR }]}>
                Include imputed data
              </Text>
            </Pressable>
          </View>
        )}

        {snapshots.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="layers-outline" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Snapshots ({snapshots.length})</Text>
            </View>
            {snapshots.map((snap, idx) => (
              <View key={snap.id} style={[styles.snapRow, idx > 0 && styles.snapRowBorder]}>
                <View style={styles.snapLeft}>
                  <Text style={styles.snapRecCount}>#{snap.totalNights}</Text>
                  <Text style={styles.snapDate}>{snap.sessionDate}</Text>
                </View>
                <View style={styles.snapRight}>
                  <Text style={styles.snapVal}>{snap.totalNocturnalErections} erections</Text>
                  <Text style={styles.snapVal}>{formatDur(snap.totalNocturnalDurationSeconds)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="list-outline" size={18} color={ACCENT} />
            <Text style={styles.cardTitle}>Recent Sessions</Text>
          </View>
          {recentSessions.length === 0 ? (
            <Text style={styles.emptyText}>No session data yet. Upload a snapshot to get started.</Text>
          ) : (
            recentSessions.map((s, idx) => (
              <View key={s.date} style={[styles.sessionRow, idx > 0 && styles.sessionRowBorder]}>
                <View style={styles.sessionLeft}>
                  <View style={styles.sessionDateRow}>
                    <Text style={styles.sessionDate}>{s.date}</Text>
                    <View style={[styles.badge, s.isImputed ? styles.badgeImputed : styles.badgeMeasured]}>
                      <Text style={[styles.badgeText, s.isImputed ? styles.badgeTextImputed : styles.badgeTextMeasured]}>
                        {s.isImputed ? "Imputed" : "Measured"}
                      </Text>
                    </View>
                    {s.multiNightCombined && (
                      <View style={[styles.badge, styles.badgeWarning]}>
                        <Text style={[styles.badgeText, styles.badgeTextWarning]}>Combined</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.sessionRight}>
                  <Text style={styles.sessionVal}>
                    {s.nocturnalErections ?? 0} erections
                  </Text>
                  <Text style={styles.sessionDur}>
                    {formatDur(s.nocturnalDurationSeconds ?? 0)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={[styles.card, { borderColor: "#374151" }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="cloud-download-outline" size={18} color="#60A5FA" />
            <Text style={styles.cardTitle}>Backup & Restore</Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
            <Pressable
              style={[styles.backupBtn, { backgroundColor: "rgba(96, 165, 250, 0.15)", flex: 1 }, backupExporting && styles.uploadBtnDisabled]}
              onPress={handleBackupExport}
              disabled={backupExporting || backupImporting}
            >
              {backupExporting ? (
                <ActivityIndicator size="small" color="#60A5FA" />
              ) : (
                <Feather name="download" size={16} color="#60A5FA" />
              )}
              <Text style={[styles.backupBtnText, { color: "#60A5FA" }]}>Export</Text>
            </Pressable>

            <Pressable
              style={[styles.backupBtn, { backgroundColor: "rgba(251, 191, 36, 0.15)", flex: 1 }, backupImporting && styles.uploadBtnDisabled]}
              onPress={handleBackupImport}
              disabled={backupExporting || backupImporting}
            >
              {backupImporting ? (
                <ActivityIndicator size="small" color={IMPUTED_COLOR} />
              ) : (
                <Feather name="upload" size={16} color={IMPUTED_COLOR} />
              )}
              <Text style={[styles.backupBtnText, { color: IMPUTED_COLOR }]}>Restore</Text>
            </Pressable>
          </View>

          {backupStatus && (
            <Text style={{ fontSize: 13, color: MEASURED_COLOR, textAlign: "center", marginBottom: 4 }}>{backupStatus}</Text>
          )}

          <Text style={styles.backupHint}>
            Export saves all logs, snapshots, sessions, and caches. Restore merges data without duplicating.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: -0.5,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  dateLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  dateInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "500",
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 140,
    textAlign: "center",
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 13,
  },
  uploadBtnDisabled: {
    opacity: 0.5,
  },
  uploadBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
  },
  resultBanner: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  resultSuccess: {
    backgroundColor: "rgba(52, 211, 153, 0.12)",
  },
  resultError: {
    backgroundColor: "rgba(255, 107, 107, 0.12)",
  },
  resultText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chartContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 8,
  },
  chartYAxis: {
    justifyContent: "space-between",
    height: 120,
    width: 32,
  },
  chartAxisLabel: {
    fontSize: 9,
    color: Colors.textTertiary,
    textAlign: "right",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  toggleLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  snapRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  snapRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  snapLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  snapRecCount: {
    fontSize: 14,
    fontWeight: "700",
    color: ACCENT,
    minWidth: 28,
  },
  snapDate: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  snapRight: {
    alignItems: "flex-end",
  },
  snapVal: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  sessionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  sessionLeft: {
    flex: 1,
  },
  sessionDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  sessionDate: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.text,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeMeasured: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
  },
  badgeImputed: {
    backgroundColor: "rgba(251, 191, 36, 0.15)",
  },
  badgeWarning: {
    backgroundColor: "rgba(255, 107, 107, 0.15)",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  badgeTextMeasured: {
    color: MEASURED_COLOR,
  },
  badgeTextImputed: {
    color: IMPUTED_COLOR,
  },
  badgeTextWarning: {
    color: Colors.danger,
  },
  sessionRight: {
    alignItems: "flex-end",
  },
  sessionVal: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
  },
  sessionDur: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textTertiary,
    textAlign: "center",
    paddingVertical: 20,
  },
  confGrid: {
    flexDirection: "row",
    gap: 10,
  },
  confCell: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  confWindow: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.text,
    letterSpacing: 0.5,
  },
  confGradeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  confGradeText: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  confCounts: {
    flexDirection: "row",
    gap: 6,
  },
  confCountText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  backupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
  },
  backupBtnText: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  backupHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: "center" as const,
    marginTop: 6,
    lineHeight: 16,
  },
});
