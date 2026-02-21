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
import { useFocusEffect, router } from "expo-router";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch } from "@/lib/query-client";

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
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [dataSources, setDataSources] = useState<Array<{
    id: string; name: string; status: string;
    workouts?: number; vitals?: number; sleep?: number; lastSync?: string | null;
  }>>([]);

  interface LensArchive { id: number; tag: string; startDay: string; endDay: string; label: string | null; summaryJson: any; }
  interface ActiveLensEpisode { id: number; tag: string; startDay: string; intensity: number; label: string | null; }
  const [lensArchives, setLensArchives] = useState<LensArchive[]>([]);
  const [activeLenses, setActiveLenses] = useState<ActiveLensEpisode[]>([]);
  const CONTEXT_TAG_COLORS: Record<string, string> = {
    travel: "#60A5FA", schedule_shift: "#FBBF24", work_stress: "#F87171",
    social_load: "#A78BFA", illness_symptoms: "#34D399", injury_pain: "#FB923C",
    supplement_change: "#22D3EE", med_change: "#F472B6", early_dating: "#E879F9",
  };

  const loadData = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();

      const [sessRes, proxyRes, snapRes, confRes, srcRes] = await Promise.all([
        authFetch(new URL("/api/erection/sessions", baseUrl).toString()),
        authFetch(new URL(`/api/erection/proxy?include_imputed=${includeImputed}`, baseUrl).toString()),
        authFetch(new URL("/api/erection/snapshots", baseUrl).toString()),
        authFetch(new URL("/api/erection/confidence", baseUrl).toString()),
        authFetch(new URL("/api/data-sources", baseUrl).toString()),
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

      if (srcRes.ok) {
        const json = await srcRes.json();
        if (json.sources) setDataSources(json.sources);
      }

      const [activeRes, archiveRes] = await Promise.all([
        authFetch(new URL("/api/context-lens/episodes/active", baseUrl).toString()),
        authFetch(new URL("/api/context-lens/archives", baseUrl).toString()),
      ]);
      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveLenses(data.episodes || []);
      }
      if (archiveRes.ok) {
        const data = await archiveRes.json();
        setLensArchives(data.archives || []);
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
      const resp = await authFetch(url);
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
        const path = LegacyFS.documentDirectory + filename;
        await LegacyFS.writeAsStringAsync(path, JSON.stringify(json, null, 2));
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

      const dryRes = await authFetch(
        new URL("/api/backup/import", baseUrl).toString(),
        { method: "POST", body: dryRunForm },
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

                const importRes = await authFetch(
                  new URL("/api/backup/import", baseUrl).toString(),
                  { method: "POST", body: importForm },
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

  const handleResetDatabase = async () => {
    Alert.alert(
      "Reset All Data",
      "This will permanently delete ALL daily logs, Fitbit uploads, vitals, sleep data, workout sessions, readiness scores, and cached data.\n\nSettings and meal plan presets will be kept.\n\nThis cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset Everything",
          style: "destructive",
          onPress: async () => {
            try {
              setResetting(true);
              setResetStatus(null);
              const baseUrl = getApiUrl();
              const res = await authFetch(new URL("/api/reset-database", baseUrl).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm: "RESET_ALL_DATA" }),
              });
              const json = await res.json();
              if (res.ok && json.status === "ok") {
                if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setResetStatus(`Cleared ${json.totalDeleted} rows`);
                loadData();
              } else {
                setResetStatus(json.error || "Reset failed");
              }
            } catch (err) {
              console.error("reset error:", err);
              setResetStatus("Reset failed");
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
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

      const uploadRes = await authFetch(url, {
        method: "POST",
        body: formData,
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
                  <Text style={styles.snapVal}>{isNaN(snap.totalNocturnalErections) ? "--" : snap.totalNocturnalErections} erections</Text>
                  <Text style={styles.snapVal}>{isNaN(snap.totalNocturnalDurationSeconds) ? "--" : formatDur(snap.totalNocturnalDurationSeconds)}</Text>
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

        {dataSources.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="link-outline" size={18} color={ACCENT} />
              <Text style={styles.cardTitle}>Data Sources</Text>
            </View>
            {dataSources.map((src, idx) => {
              const isConnected = src.status === "connected";
              const needsBuild = src.status === "requires_build";
              const statusColor = isConnected ? MEASURED_COLOR : needsBuild ? Colors.textTertiary : Colors.warning;
              const statusLabel = isConnected ? "Active" : needsBuild ? "Dev Build" : "Setup";
              const totalRecords = (src.workouts ?? 0) + (src.vitals ?? 0) + (src.sleep ?? 0);
              const iconName = src.id === "fitbit" ? "watch-outline" as const
                : src.id === "healthkit" ? "heart-outline" as const
                : src.id === "polar" ? "bluetooth-outline" as const
                : "create-outline" as const;
              const isNavigable = src.id === "healthkit" || src.id === "polar";
              const handleSourcePress = () => {
                if (src.id === "healthkit") router.push("/healthkit");
                else if (src.id === "polar") router.push("/polar");
              };
              return (
                <Pressable
                  key={src.id}
                  style={[srcStyles.sourceRow, idx > 0 && srcStyles.sourceRowBorder]}
                  onPress={isNavigable ? handleSourcePress : undefined}
                  disabled={!isNavigable}
                >
                  <View style={[srcStyles.sourceIcon, { backgroundColor: statusColor + "18" }]}>
                    <Ionicons name={iconName} size={20} color={statusColor} />
                  </View>
                  <View style={srcStyles.sourceInfo}>
                    <Text style={srcStyles.sourceName}>{src.name}</Text>
                    {isConnected && totalRecords > 0 ? (
                      <Text style={srcStyles.sourceDetail}>
                        {[
                          src.workouts ? `${src.workouts} workouts` : null,
                          src.vitals ? `${src.vitals} vitals` : null,
                          src.sleep ? `${src.sleep} sleep` : null,
                        ].filter(Boolean).join(" / ")}
                      </Text>
                    ) : needsBuild ? (
                      <Text style={srcStyles.sourceDetail}>Tap to configure</Text>
                    ) : (
                      <Text style={srcStyles.sourceDetail}>No data yet</Text>
                    )}
                  </View>
                  {isNavigable ? (
                    <Ionicons name="chevron-forward" size={18} color={statusColor} />
                  ) : (
                    <View style={[srcStyles.statusBadge, { backgroundColor: statusColor + "20", borderColor: statusColor + "40" }]}>
                      <Text style={[srcStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable
          style={[styles.card, { borderColor: Colors.primary + "40" }]}
          onPress={() => router.push("/workout")}
        >
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="sword-cross" size={18} color={Colors.primary} />
            <Text style={styles.cardTitle}>Workout Game Guide</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} style={{ marginLeft: "auto" }} />
          </View>
          <Text style={{ fontSize: 13, fontFamily: "Rubik_400Regular", color: Colors.textSecondary }}>
            CBP-driven training with phase transitions and muscle targeting
          </Text>
        </Pressable>

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

        <View style={[styles.card, { borderColor: "#7F1D1D" }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
            <Text style={[styles.cardTitle, { color: "#EF4444" }]}>Reset Database</Text>
          </View>

          <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 }}>
            Wipe all daily logs, Fitbit uploads, vitals, sleep data, workout sessions, readiness scores, and caches. Settings and meal presets are preserved.
          </Text>

          <Pressable
            style={[styles.backupBtn, { backgroundColor: "rgba(239, 68, 68, 0.12)", flex: 0 }, resetting && styles.uploadBtnDisabled]}
            onPress={handleResetDatabase}
            disabled={resetting}
          >
            {resetting ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Ionicons name="nuclear-outline" size={16} color="#EF4444" />
            )}
            <Text style={[styles.backupBtnText, { color: "#EF4444" }]}>
              {resetting ? "Resetting..." : "Reset All Data"}
            </Text>
          </Pressable>

          {resetStatus && (
            <Text style={{ fontSize: 13, color: "#EF4444", textAlign: "center", marginTop: 8 }}>{resetStatus}</Text>
          )}
        </View>

        {(activeLenses.length > 0 || lensArchives.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Context Lenses</Text>

            {activeLenses.length > 0 && (
              <>
                <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 8 }}>Active</Text>
                {activeLenses.map((ep) => {
                  const tagColor = CONTEXT_TAG_COLORS[ep.tag] || "#8B5CF6";
                  const dayCount = Math.max(1, Math.round((Date.now() - new Date(ep.startDay + "T00:00:00Z").getTime()) / 86400000) + 1);
                  return (
                    <View key={ep.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tagColor, marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: tagColor }}>
                          {ep.tag.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                          Since {ep.startDay} {ep.label ? `\u00B7 ${ep.label}` : ""}
                        </Text>
                      </View>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: tagColor + "20" }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_600SemiBold", color: tagColor }}>Day {dayCount}</Text>
                      </View>
                    </View>
                  );
                })}
                <View style={{ height: 16 }} />
              </>
            )}

            {lensArchives.length > 0 && (
              <>
                <Text style={{ fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 8 }}>Archived</Text>
                {lensArchives.map((ar) => {
                  const tagColor = CONTEXT_TAG_COLORS[ar.tag] || "#8B5CF6";
                  const duration = ar.summaryJson?.durationDays || "?";
                  const phase = ar.summaryJson?.phase?.replace(/_/g, " ")?.toLowerCase() || "";
                  const distScore = ar.summaryJson?.disturbanceScore;
                  return (
                    <View key={ar.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tagColor + "60", marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>
                          {ar.tag.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                          {ar.startDay} \u2192 {ar.endDay} \u00B7 {duration}d {ar.label ? `\u00B7 ${ar.label}` : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        {distScore != null && (
                          <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: distScore >= 62 ? "#F87171" : distScore >= 56 ? "#FBBF24" : "#34D399" }}>
                            {distScore.toFixed(0)}
                          </Text>
                        )}
                        {phase && (
                          <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                            {phase}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        )}

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

const srcStyles = StyleSheet.create({
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  sourceRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceInfo: {
    flex: 1,
    gap: 2,
  },
  sourceName: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.text,
  },
  sourceDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
});
