import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Platform,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { DAILY_CHECKLIST, BASELINE } from "@/lib/coaching-engine";
import { getApiUrl, authFetch } from "@/lib/query-client";
import { fmtScore100, fmtScore110, fmtPct, fmtRaw, scoreColor } from "@/lib/format";

function getTimeCategory(time: string): { icon: string; color: string } {
  const h = parseInt(time.split(":")[0], 10);
  if (h < 6) return { icon: "moon-outline", color: "#818CF8" };
  if (h < 9) return { icon: "sunny-outline", color: Colors.secondary };
  if (h < 12) return { icon: "cafe-outline", color: Colors.primary };
  if (h < 16) return { icon: "barbell-outline", color: "#60A5FA" };
  if (h < 20) return { icon: "flash-outline", color: Colors.success };
  return { icon: "moon-outline", color: "#818CF8" };
}

function ChecklistRow({ time, label, detail, isLast }: { time: string; label: string; detail: string; isLast: boolean }) {
  const cat = getTimeCategory(time);

  return (
    <View style={styles.rowContainer}>
      <View style={styles.timelineCol}>
        <View style={[styles.timelineDot, { backgroundColor: cat.color + "30", borderColor: cat.color }]}>
          <Ionicons name={cat.icon as any} size={14} color={cat.color} />
        </View>
        {!isLast && <View style={[styles.timelineLine, { backgroundColor: cat.color + "20" }]} />}
      </View>
      <View style={[styles.rowCard, !isLast && { marginBottom: 4 }]}>
        <Text style={styles.rowTime}>{time}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
    </View>
  );
}

interface ImportHistoryItem {
  id: string;
  uploadedAt: string;
  originalFilename: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  rowsImported: number;
  rowsUpserted: number;
  rowsSkipped: number;
}

export default function ChecklistScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const [uploading, setUploading] = useState(false);
  const [uploadingTakeout, setUploadingTakeout] = useState(false);
  const [takeoutProgress, setTakeoutProgress] = useState("");
  const [lastResult, setLastResult] = useState<{
    status: string;
    rowsImported: number;
    rowsUpserted: number;
    rowsSkipped: number;
    dateRange: { start: string; end: string } | null;
  } | null>(null);
  const [lastTakeoutResult, setLastTakeoutResult] = useState<{
    status: string;
    daysAffected: number;
    rowsUpserted: number;
    rowsSkipped: number;
    filesProcessed: number;
    dateRange: { start: string; end: string } | null;
    parseDetails: Record<string, number>;
  } | null>(null);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [takeoutHistory, setTakeoutHistory] = useState<Array<{
    id: string;
    uploadedAt: string;
    originalFilename: string;
    dateRangeStart: string;
    dateRangeEnd: string;
    daysAffected: number;
    rowsUpserted: number;
    timezone: string;
  }>>([]);
  const [debugSleepExpanded, setDebugSleepExpanded] = useState(false);
  const [debugSchedExpanded, setDebugSchedExpanded] = useState(false);
  const [debugCardioSchedExpanded, setDebugCardioSchedExpanded] = useState(false);
  const [debugCardioOutcomeExpanded, setDebugCardioOutcomeExpanded] = useState(false);
  const [debugLiftSchedExpanded, setDebugLiftSchedExpanded] = useState(false);
  const [debugLiftOutcomeExpanded, setDebugLiftOutcomeExpanded] = useState(false);
  const [readiness, setReadiness] = useState<{
    readinessScore: number;
    readinessTier: string;
    confidenceGrade: string;
    typeLean: number;
    exerciseBias: number;
    cortisolFlag: boolean;
    drivers: string[];
    gate?: string;
    daysInWindow?: number;
    deltas?: {
      sleep_pct: number | null;
      hrv_pct: number | null;
      rhr_bpm: number | null;
      proxy_pct: number | null;
      sleep_str: string;
      hrv_str: string;
      rhr_str: string;
      proxy_str: string;
    };
    confidenceBreakdown?: {
      grade: string;
      measured_7d: number;
      imputed_7d: number;
      combined_7d: number;
    };
    adherence?: {
      alignmentScore: number | null;
      bedDevMin: number | null;
      wakeDevMin: number | null;
      bedtimeDriftLateNights7d: number;
      wakeDriftEarlyNights7d: number;
      measuredNights7d: number;
      bedtimeDriftNote: string | null;
      wakeDriftNote: string | null;
    };
    primaryDriver?: {
      driver: string;
      severity: number;
      recommendation: string;
    } | null;
    placeholders?: {
      mealTimingTracked: boolean;
    };
    sleepBlock?: any;
    sleepTrending?: any;
  } | null>(null);
  const [dataSuff, setDataSuff] = useState<{
    analysisStartDate: string;
    daysWithData: number;
    totalDaysInRange: number;
    gate7: boolean;
    gate14: boolean;
    gate30: boolean;
    gateLabel: string | null;
    signals: { hrv: number; rhr: number; sleep: number; steps: number; proxy: number };
  } | null>(null);
  const [hpaData, setHpaData] = useState<{ hpaScore: number | null; suppressionFlag: boolean; drivers: any; hpaBucket: string | null; stateLabel: string | null; stateTooltipText: string | null } | null>(null);
  const [rebaselining, setRebaselining] = useState(false);
  const [picking, setPicking] = useState(false);
  const [templates, setTemplates] = useState<Array<{
    id: number;
    templateType: string;
    sessions: Array<{ name: string; highLabel: string; medLabel: string; lowLabel: string }>;
  }>>([]);

  const loadHistory = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const [csvRes, takeoutRes] = await Promise.all([
        authFetch(new URL("/api/import/history", baseUrl).toString()),
        authFetch(new URL("/api/import/takeout_history", baseUrl).toString()),
      ]);
      if (csvRes.ok) setImportHistory(await csvRes.json());
      if (takeoutRes.ok) setTakeoutHistory(await takeoutRes.json());
    } catch {}
  }, []);

  const deleteImportRecord = useCallback(async (type: "csv" | "takeout", id: string) => {
    const baseUrl = getApiUrl();
    const endpoint = type === "csv" ? `/api/import/history/${id}` : `/api/import/takeout_history/${id}`;
    try {
      const res = await authFetch(new URL(endpoint, baseUrl).toString(), {
        method: "DELETE",
      });
      if (res.ok) {
        if (type === "csv") {
          setImportHistory((prev) => prev.filter((i) => i.id !== id));
        } else {
          setTakeoutHistory((prev) => prev.filter((i) => i.id !== id));
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {}
  }, []);

  const loadReadinessAndTemplate = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const today = new Date().toISOString().slice(0, 10);
      const [rRes, tRes, dsRes, hpaRes] = await Promise.all([
        authFetch(new URL(`/api/readiness?date=${today}`, baseUrl).toString()),
        authFetch(new URL("/api/training/template", baseUrl).toString()),
        authFetch(new URL("/api/data-sufficiency", baseUrl).toString()),
        authFetch(new URL(`/api/hpa?date=${today}`, baseUrl).toString()),
      ]);
      if (rRes.ok) setReadiness(await rRes.json());
      if (hpaRes.ok) setHpaData(await hpaRes.json());
      if (tRes.ok) {
        const tData = await tRes.json();
        if (Array.isArray(tData)) {
          setTemplates(tData);
        } else if (tData && typeof tData === "object") {
          const arr = Object.values(tData).filter((v: any) => v && v.sessions);
          setTemplates(arr as any);
        }
      }
      if (dsRes.ok) setDataSuff(await dsRes.json());
    } catch {}
  }, []);

  const handleRebaseline = useCallback(async () => {
    setRebaselining(true);
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/settings/rebaseline", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 60 }),
      });
      if (res.ok) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await loadReadinessAndTemplate();
      }
    } catch {}
    setRebaselining(false);
  }, [loadReadinessAndTemplate]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
      loadReadinessAndTemplate();
    }, [])
  );

  const handleImport = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setUploading(true);
      setLastResult(null);

      const baseUrl = getApiUrl();
      const url = new URL("/api/import/fitbit", baseUrl);

      const formData = new FormData();

      if (Platform.OS === "web") {
        const response = await globalThis.fetch(asset.uri);
        const blob = await response.blob();
        formData.append("file", blob, asset.name || "import.csv");

        const uploadRes = await authFetch(url.toString(), {
          method: "POST",
          body: formData,
        });
        const data = await uploadRes.json();
        setLastResult(data);
        if (data.status === "duplicate") {
          Alert.alert("Duplicate File", "This file has already been imported.");
        }
      } else {
        formData.append("file", {
          uri: asset.uri,
          name: asset.name || "import.csv",
          type: asset.mimeType || "text/csv",
        } as any);

        const uploadRes = await authFetch(url.toString(), {
          method: "POST",
          body: formData,
        });
        const data = await uploadRes.json();
        setLastResult(data);
        if (data.status === "duplicate") {
          Alert.alert("Duplicate File", "This file has already been imported.");
        }
      }

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadHistory();
    } catch (err: any) {
      console.error("Import error:", err);
      const msg = err?.message || "Unknown error";
      Alert.alert("Import Error", `Upload failed: ${msg}`);
    } finally {
      setUploading(false);
      setPicking(false);
    }
  };

  const handleTakeoutForceReimport = async (fileUri: string, fileName: string, fileSize: number, webBuf: ArrayBuffer | null) => {
    setUploadingTakeout(true);
    setTakeoutProgress("Reimporting with force...");
    try {
      const baseUrl = getApiUrl();
      const CHUNK_SIZE = 5 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
      const initRes = await authFetch(
        new URL("/api/import/takeout_chunk_init", baseUrl).toString(),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: fileName, totalChunks, fileSize }) }
      );
      if (!initRes.ok) throw new Error("Failed to start upload");
      const { uploadId } = await initRes.json();

      if (Platform.OS === "web") {
        const arrayBuf = webBuf || await (await globalThis.fetch(fileUri)).arrayBuffer();
        for (let i = 0; i < totalChunks; i++) {
          setTakeoutProgress(`Uploading chunk ${i + 1}/${totalChunks}...`);
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, fileSize);
          const chunkBlob = new Blob([arrayBuf.slice(start, end)]);
          const fd = new FormData();
          fd.append("chunk", chunkBlob, `chunk_${i}`);
          fd.append("uploadId", uploadId);
          fd.append("chunkIndex", String(i));
          await authFetch(new URL("/api/import/takeout_chunk_upload", baseUrl).toString(), { method: "POST", body: fd });
        }
      } else {
        const cacheDir = FileSystem.cacheDirectory || "";
        for (let i = 0; i < totalChunks; i++) {
          setTakeoutProgress(`Uploading chunk ${i + 1}/${totalChunks}...`);
          const start = i * CHUNK_SIZE;
          const length = Math.min(CHUNK_SIZE, fileSize - start);
          const base64Chunk = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64, position: start, length });
          const chunkUri = cacheDir + `chunk_${uploadId}_${i}.bin`;
          await FileSystem.writeAsStringAsync(chunkUri, base64Chunk, { encoding: FileSystem.EncodingType.Base64 });
          await FileSystem.uploadAsync(new URL("/api/import/takeout_chunk_upload", baseUrl).toString(), chunkUri, {
            httpMethod: "POST", uploadType: FileSystem.FileSystemUploadType.MULTIPART, fieldName: "chunk", parameters: { uploadId, chunkIndex: String(i) },
          });
          await FileSystem.deleteAsync(chunkUri, { idempotent: true });
        }
      }

      setTakeoutProgress("Processing ZIP (force reimport)...");
      const finalRes = await authFetch(
        new URL("/api/import/takeout_chunk_finalize", baseUrl).toString(),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, overwrite_fields: "false", timezone: "America/New_York", force: "true" }) }
      );
      if (!finalRes.ok) throw new Error("Server error during reimport");
      const finalData = await finalRes.json();

      if (finalData.jobId) {
        let attempts = 0;
        while (attempts < 120) {
          await new Promise((r) => setTimeout(r, 3000));
          attempts++;
          setTakeoutProgress(`Processing ZIP (${attempts * 3}s elapsed)...`);
          try {
            const pollRes = await authFetch(new URL(`/api/import/takeout_job/${finalData.jobId}`, baseUrl).toString());
            if (!pollRes.ok) continue;
            const job = await pollRes.json();
            if (job.status === "processing") continue;
            if (job.status === "done") { setLastTakeoutResult(job.result); break; }
            if (job.status === "error") { Alert.alert("Import Error", job.error || "Processing failed"); return; }
          } catch {}
        }
      } else {
        setLastTakeoutResult(finalData);
      }

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadHistory();
      await loadReadinessAndTemplate();
    } catch (err: any) {
      Alert.alert("Import Error", err?.message || "Reimport failed");
    } finally {
      setUploadingTakeout(false);
      setTakeoutProgress("");
      setPicking(false);
    }
  };

  const handleTakeoutImport = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed", "application/x-zip", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setUploadingTakeout(true);
      setLastTakeoutResult(null);
      setTakeoutProgress("Preparing file...");

      const baseUrl = getApiUrl();

      const doChunkedUpload = async (fileUri: string, fileName: string, fileSize: number, preloadedBuf?: ArrayBuffer | null) => {
        const CHUNK_SIZE = 5 * 1024 * 1024;
        const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

        setTakeoutProgress(`Initializing upload (${Math.round(fileSize / 1024 / 1024)}MB)...`);
        const initRes = await authFetch(
          new URL("/api/import/takeout_chunk_init", baseUrl).toString(),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: fileName, totalChunks, fileSize }),
          }
        );
        if (!initRes.ok) {
          const j = await initRes.json().catch(() => ({}));
          throw new Error((j as any).error || "Failed to start upload");
        }
        const { uploadId } = await initRes.json();

        if (Platform.OS === "web") {
          const arrayBuf = preloadedBuf || await (await globalThis.fetch(fileUri)).arrayBuffer();
          for (let i = 0; i < totalChunks; i++) {
            setTakeoutProgress(`Uploading chunk ${i + 1}/${totalChunks}...`);
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, fileSize);
            const chunkBlob = new Blob([arrayBuf.slice(start, end)]);
            const fd = new FormData();
            fd.append("chunk", chunkBlob, `chunk_${i}`);
            fd.append("uploadId", uploadId);
            fd.append("chunkIndex", String(i));
            const chunkRes = await authFetch(
              new URL("/api/import/takeout_chunk_upload", baseUrl).toString(),
              { method: "POST", body: fd }
            );
            if (!chunkRes.ok) {
              const j = await chunkRes.json().catch(() => ({}));
              throw new Error((j as any).error || `Chunk ${i + 1} upload failed`);
            }
          }
        } else {
          const cacheDir = FileSystem.cacheDirectory || "";
          for (let i = 0; i < totalChunks; i++) {
            setTakeoutProgress(`Uploading chunk ${i + 1}/${totalChunks}...`);
            const start = i * CHUNK_SIZE;
            const length = Math.min(CHUNK_SIZE, fileSize - start);
            const base64Chunk = await FileSystem.readAsStringAsync(fileUri, {
              encoding: FileSystem.EncodingType.Base64,
              position: start,
              length,
            });
            const chunkUri = cacheDir + `chunk_${uploadId}_${i}.bin`;
            await FileSystem.writeAsStringAsync(chunkUri, base64Chunk, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const uploadResult = await FileSystem.uploadAsync(
              new URL("/api/import/takeout_chunk_upload", baseUrl).toString(),
              chunkUri,
              {
                httpMethod: "POST",
                uploadType: FileSystem.FileSystemUploadType.MULTIPART,
                fieldName: "chunk",
                parameters: { uploadId, chunkIndex: String(i) },
              }
            );
            await FileSystem.deleteAsync(chunkUri, { idempotent: true });
            if (uploadResult.status !== 200) {
              let errMsg = `Chunk ${i + 1} upload failed`;
              try { const j = JSON.parse(uploadResult.body); errMsg = j.error || errMsg; } catch {}
              throw new Error(errMsg);
            }
          }
        }

        setTakeoutProgress("Processing ZIP (this may take 1\u20132 minutes)...");
        const finalRes = await authFetch(
          new URL("/api/import/takeout_chunk_finalize", baseUrl).toString(),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId, overwrite_fields: "false", timezone: "America/New_York", force: "true" }),
          }
        );
        if (!finalRes.ok) {
          const j = await finalRes.json().catch(() => ({}));
          throw new Error((j as any).error || `Server error ${finalRes.status}`);
        }
        const finalData = await finalRes.json();
        return finalData;
      };

      let fileSize = 0;
      let webArrayBuf: ArrayBuffer | null = null;
      if (Platform.OS === "web") {
        const headRes = await globalThis.fetch(asset.uri);
        webArrayBuf = await headRes.arrayBuffer();
        fileSize = webArrayBuf.byteLength;
      } else {
        const fileInfo = await FileSystem.getInfoAsync(asset.uri);
        fileSize = (fileInfo as any).size || 0;
      }

      const finalData = await doChunkedUpload(asset.uri, asset.name || "takeout.zip", fileSize, webArrayBuf);

      if (!finalData.jobId) {
        setLastTakeoutResult(finalData);
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await loadHistory();
        return;
      }

      const jobId = finalData.jobId;
      let attempts = 0;
      const maxAttempts = 120;
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 3000));
        attempts++;
        const elapsed = attempts * 3;
        setTakeoutProgress(`Processing ZIP (${elapsed}s elapsed)...`);
        try {
          const pollRes = await authFetch(
            new URL(`/api/import/takeout_job/${jobId}`, baseUrl).toString()
          );
          if (!pollRes.ok) continue;
          const job = await pollRes.json();
          if (job.status === "processing") continue;
          if (job.status === "done") {
            setLastTakeoutResult(job.result);
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await loadHistory();
            return;
          }
          if (job.status === "error") {
            Alert.alert("Import Error", job.error || "Processing failed");
            return;
          }
        } catch {}
      }
      Alert.alert("Import Error", "Processing timed out. Please try again.");
    } catch (err: any) {
      console.error("Takeout import error:", err);
      const msg = err?.message || "Unknown error";
      Alert.alert("Import Error", `Upload failed: ${msg}`);
    } finally {
      setUploadingTakeout(false);
      setTakeoutProgress("");
      setPicking(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: topInset + 16,
            paddingBottom: Platform.OS === "web" ? 84 + 34 : insets.bottom + 100,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Daily Checklist</Text>
          <Text style={styles.subtitle}>Locked meal template</Text>
        </View>

        <View style={styles.macroSummary}>
          <View style={styles.macroItem}>
            <Text style={styles.macroValue}>{BASELINE.calories.toFixed(0)}</Text>
            <Text style={styles.macroLabel}>kcal</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={[styles.macroValue, { color: Colors.primary }]}>{BASELINE.proteinG}g</Text>
            <Text style={styles.macroLabel}>protein</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={[styles.macroValue, { color: Colors.secondary }]}>{BASELINE.carbsG}g</Text>
            <Text style={styles.macroLabel}>carbs</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={[styles.macroValue, { color: Colors.danger }]}>{BASELINE.fatG}g</Text>
            <Text style={styles.macroLabel}>fat</Text>
          </View>
        </View>

        {dataSuff && (
          <View style={styles.sufficiencyCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <View style={[styles.readinessIcon, { backgroundColor: dataSuff.gate30 ? "#34D39918" : dataSuff.gate14 ? "#FBBF2418" : "#60A5FA18" }]}>
                <Ionicons
                  name={dataSuff.gate30 ? "checkmark-circle" : "time"}
                  size={18}
                  color={dataSuff.gate30 ? "#34D399" : dataSuff.gate14 ? "#FBBF24" : "#60A5FA"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.readinessTitle}>Analysis Window</Text>
                <Text style={{ fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>
                  Since {dataSuff.analysisStartDate}
                </Text>
              </View>
              <Pressable
                onPress={handleRebaseline}
                disabled={rebaselining}
                style={({ pressed }) => [styles.rebaselineBtn, pressed && { opacity: 0.7 }]}
              >
                {rebaselining ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={14} color={Colors.primary} />
                    <Text style={styles.rebaselineBtnText}>Rebaseline</Text>
                  </>
                )}
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
              <View style={styles.suffGate}>
                <Ionicons name={dataSuff.gate7 ? "checkmark-circle" : "ellipse-outline"} size={14} color={dataSuff.gate7 ? "#34D399" : Colors.textTertiary} />
                <Text style={[styles.suffGateText, dataSuff.gate7 && { color: "#34D399" }]}>7d</Text>
              </View>
              <View style={styles.suffGate}>
                <Ionicons name={dataSuff.gate14 ? "checkmark-circle" : "ellipse-outline"} size={14} color={dataSuff.gate14 ? "#34D399" : Colors.textTertiary} />
                <Text style={[styles.suffGateText, dataSuff.gate14 && { color: "#34D399" }]}>14d</Text>
              </View>
              <View style={styles.suffGate}>
                <Ionicons name={dataSuff.gate30 ? "checkmark-circle" : "ellipse-outline"} size={14} color={dataSuff.gate30 ? "#34D399" : Colors.textTertiary} />
                <Text style={[styles.suffGateText, dataSuff.gate30 && { color: "#34D399" }]}>30d</Text>
              </View>
              <View style={styles.suffGate}>
                <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: Colors.primary }}>{dataSuff.daysWithData}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>days</Text>
              </View>
            </View>

            {dataSuff.gateLabel && (
              <View style={{ backgroundColor: "#FBBF2410", borderRadius: 8, padding: 8 }}>
                <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#FBBF24" }}>
                  {dataSuff.gateLabel}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {[
                { label: "HRV", count: dataSuff.signals.hrv },
                { label: "RHR", count: dataSuff.signals.rhr },
                { label: "Sleep", count: dataSuff.signals.sleep },
                { label: "Steps", count: dataSuff.signals.steps },
                { label: "Proxy", count: dataSuff.signals.proxy },
              ].map((s) => (
                <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>{s.label}</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: s.count > 0 ? Colors.primary : Colors.textTertiary }}>{s.count}d</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {readiness && templates.length > 0 && (() => {
          if (readiness.gate === "NONE") {
            return (
              <View style={styles.readinessCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#60A5FA20", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="time" size={20} color="#60A5FA" />
                  </View>
                  <View>
                    <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
                      Training Readiness
                    </Text>
                    <Text style={{ fontSize: 20, fontFamily: "Rubik_600SemiBold", color: "#60A5FA" }}>
                      Baseline Building...
                    </Text>
                  </View>
                </View>
                <Text style={{ fontSize: 14, fontFamily: "Rubik_400Regular", color: Colors.textSecondary }}>
                  Need at least 7 days of data in the analysis window to compute readiness. Currently {readiness.daysInWindow ?? 0} days.
                </Text>
              </View>
            );
          }
          const tier = readiness.readinessTier ?? "BLUE";
          const tierColor = tier === "GREEN" ? "#34D399" : tier === "BLUE" ? "#60A5FA" : "#FBBF24";
          const tierIcon = tier === "GREEN" ? "flash" : tier === "BLUE" ? "snow" : "pause-circle";
          const score = readiness.readinessScore ?? 0;
          const typeLeanVal = readiness.typeLean ?? 0;
          const exerciseBiasVal = readiness.exerciseBias ?? 0;
          const activeTemplate = templates[0];
          return (
            <View style={styles.readinessCard}>
              <View style={styles.readinessHeader}>
                <View style={[styles.readinessIcon, { backgroundColor: tierColor + "18" }]}>
                  <Ionicons name={tierIcon as any} size={18} color={tierColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.readinessTitle}>Training Readiness</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[styles.readinessScore, { color: tierColor }]}>
                      {score === 0 ? "—" : (readiness.gate === "NONE" || (readiness.daysInWindow ?? 0) < 7) ? "—" : score}
                    </Text>
                    <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 2 }}>
                      {score === 0 ? "No data — start logging to build your baseline" : (readiness.gate === "NONE" || (readiness.daysInWindow ?? 0) < 7) ? "Provisional floor — need 7+ days" : (readiness.daysInWindow ?? 0) < 28 ? "Partial baseline — score may shift" : "Estimates recovery permissiveness"}
                    </Text>
                    <View style={[styles.readinessTierBadge, { backgroundColor: tierColor + "18" }]}>
                      <Text style={[styles.readinessTierText, { color: tierColor }]}>
                        {tier}
                      </Text>
                    </View>
                    {(readiness.confidenceGrade === "Low" || readiness.confidenceGrade === "None") && (
                      <Text style={styles.readinessLowConf}>LOW CONF</Text>
                    )}
                  </View>
                </View>
              </View>

              <View style={styles.readinessBar}>
                <View style={[styles.readinessBarFill, {
                  width: `${score}%`,
                  backgroundColor: tierColor,
                }]} />
              </View>

              {readiness.cortisolFlag && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EF444418", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <Ionicons name="warning" size={16} color="#EF4444" />
                  <Text style={{ fontSize: 12, fontFamily: "Rubik_600SemiBold", color: "#EF4444", flex: 1 }}>
                    Cortisol Suppression - multiple signals degraded, capping intensity
                  </Text>
                </View>
              )}

              <View style={{ gap: 10, marginBottom: 12 }}>
                <View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>Type Lean</Text>
                    <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: tierColor }}>
                      {typeLeanVal > 0 ? "+" : ""}{typeLeanVal.toFixed(2)}
                    </Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: Colors.surface, overflow: "hidden" as const }}>
                    <View style={{
                      position: "absolute",
                      left: `${((typeLeanVal + 1) / 2) * 100}%`,
                      top: 0, width: 3, height: 6, borderRadius: 1.5,
                      backgroundColor: tierColor,
                      marginLeft: -1.5,
                    }} />
                    <View style={{
                      position: "absolute", left: "50%", top: 0, width: 1, height: 6,
                      backgroundColor: Colors.textTertiary + "40",
                    }} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Hypertrophy</Text>
                    <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Strength</Text>
                  </View>
                </View>

                <View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>Exercise Bias</Text>
                    <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: tierColor }}>
                      {exerciseBiasVal > 0 ? "+" : ""}{exerciseBiasVal.toFixed(2)}
                    </Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: Colors.surface, overflow: "hidden" as const }}>
                    <View style={{
                      position: "absolute",
                      left: `${((exerciseBiasVal + 1) / 2) * 100}%`,
                      top: 0, width: 3, height: 6, borderRadius: 1.5,
                      backgroundColor: tierColor,
                      marginLeft: -1.5,
                    }} />
                    <View style={{
                      position: "absolute", left: "50%", top: 0, width: 1, height: 6,
                      backgroundColor: Colors.textTertiary + "40",
                    }} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Isolation</Text>
                    <Text style={{ fontSize: 9, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>Compound</Text>
                  </View>
                </View>
              </View>

              <View style={styles.readinessSessions}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.readinessSessionsLabel}>
                    {tier === "GREEN" ? "Go Heavy" : tier === "BLUE" ? "Deload / Pump" : "Normal Training"}
                  </Text>
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary }}>
                    {activeTemplate.templateType}
                  </Text>
                </View>
                {activeTemplate.sessions.map((s, i) => {
                  const label = tier === "GREEN" ? s.highLabel : tier === "BLUE" ? s.lowLabel : s.medLabel;
                  return (
                    <View key={i} style={styles.readinessSessionRow}>
                      <View style={[styles.readinessSessionDot, { backgroundColor: tierColor }]} />
                      <Text style={styles.readinessSessionName}>{s.name}</Text>
                      <Text style={styles.readinessSessionLabel}>{label}</Text>
                    </View>
                  );
                })}
              </View>

              {(readiness.drivers ?? []).length > 0 && (
                <View style={styles.readinessDrivers}>
                  {(readiness.drivers ?? []).slice(0, 3).map((d, i) => (
                    <Text key={i} style={styles.readinessDriverText}>{d}</Text>
                  ))}
                </View>
              )}
            </View>
          );
        })()}

        {readiness && readiness.gate !== "NONE" && (() => {
          const insufficientData = (readiness.daysInWindow ?? 0) < 7;
          const needsMoreFor28d = (readiness.daysInWindow ?? 0) < 28;
          const sb = readiness.sleepBlock;
          const sa = sb?.sleepAlignment;
          const adh = readiness.adherence;
          const pd = readiness.primaryDriver;
          const hasAlignment = sa?.alignmentScore != null;
          const hasAdequacy = sb?.sleepAdequacyScore != null;
          const shortfallStr = sa?.shortfallMin != null && sa.shortfallMin > 0 ? ` (+${sa.shortfallMin}m)` : "";
          const confGradeVal = readiness.confidenceBreakdown?.grade ?? readiness.confidenceGrade ?? "None";

          const sigRow = (label: string, valueEl: React.ReactNode, last = false) => (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: Colors.border }) }}>
              <Text style={{ fontSize: 13, fontFamily: "Rubik_500Medium", color: Colors.textSecondary }}>{label}</Text>
              {valueEl}
            </View>
          );

          const sigText = (val: string, color: string) => (
            <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color }}>{val}</Text>
          );

          const sectionHeader = (title: string, icon: string, color: string) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, marginBottom: 6 }}>
              <Ionicons name={icon as any} size={14} color={color} />
              <Text style={{ fontSize: 10, fontFamily: "Rubik_700Bold", color, textTransform: "uppercase" as const, letterSpacing: 1 }}>{title}</Text>
            </View>
          );

          return (
            <View style={[styles.readinessCard, { marginTop: 0 }]}>
              <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 }}>
                Signal Breakdown
              </Text>

              {pd && (
                <View style={{ backgroundColor: "#FBBF2410", borderRadius: 10, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Ionicons name="alert-circle" size={18} color="#FBBF24" style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Rubik_700Bold", color: "#FBBF24", textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
                      Primary Driver: {pd.driver}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, marginTop: 2 }}>
                      {pd.recommendation}
                    </Text>
                  </View>
                </View>
              )}

              {insufficientData && (
                <View style={{ backgroundColor: "#60A5FA12", borderRadius: 8, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="information-circle" size={16} color="#60A5FA" />
                  <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: "#60A5FA", flex: 1 }}>
                    Not enough data to compute deltas (need 7d rolling + 28d baseline)
                  </Text>
                </View>
              )}
              {!insufficientData && needsMoreFor28d && (
                <View style={{ backgroundColor: "#FBBF2412", borderRadius: 8, padding: 10, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="information-circle" size={16} color="#FBBF24" />
                  <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: "#FBBF24", flex: 1 }}>
                    Partial baselines ({readiness.daysInWindow ?? 0}d / 28d) - deltas may shift
                  </Text>
                </View>
              )}

              {sectionHeader("Discipline / Adherence", "checkbox-outline", "#818CF8")}

              {sigRow("Bedtime drift",
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: (adh?.bedtimeDriftLateNights7d ?? 0) >= 3 ? "#EF4444" : Colors.textSecondary }}>
                    {adh?.bedtimeDriftLateNights7d ?? 0} late / 7d
                  </Text>
                  {(adh?.bedtimeDriftLateNights7d ?? 0) >= 3 && (
                    <View style={{ backgroundColor: "#EF444420", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Rubik_700Bold", color: "#EF4444" }}>DRIFT</Text>
                    </View>
                  )}
                </View>
              )}

              {sigRow("Wake drift",
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color: (adh?.wakeDriftEarlyNights7d ?? 0) >= 3 ? "#EF4444" : Colors.textSecondary }}>
                    {adh?.wakeDriftEarlyNights7d ?? 0} early / 7d
                  </Text>
                  {(adh?.wakeDriftEarlyNights7d ?? 0) >= 3 && (
                    <View style={{ backgroundColor: "#EF444420", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Rubik_700Bold", color: "#EF4444" }}>EARLY</Text>
                    </View>
                  )}
                </View>
              )}

              {sectionHeader("Schedule Stability", "calendar-outline", "#60A5FA")}

              {sigRow("Alignment", sigText(
                hasAlignment ? fmtScore100(sa!.alignmentScore!) : "\u2014 no observed times",
                hasAlignment ? scoreColor(sa!.alignmentScore!, { good: 80, warn: 50 }) : Colors.textTertiary,
              ))}

              {(() => {
                const ss = readiness.scheduleStability;
                const cs = ss?.scheduleConsistencyScore;
                if (cs == null) return sigRow("Consistency", <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {sigText("\u2014", Colors.textTertiary)}
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>need \u22654 valid days</Text>
                </View>);
                return sigRow("Consistency", <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {sigText(fmtScore100(cs), scoreColor(cs, { good: 70, warn: 40 }))}
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>(SD {ss!.scheduleConsistencySdMin?.toFixed(1)}m, n={ss!.scheduleConsistencyNSamples})</Text>
                </View>);
              })()}

              {(() => {
                const ss = readiness.scheduleStability;
                const rs = ss?.scheduleRecoveryScore;
                if (rs == null) return sigRow("Recovery", sigText("\u2014", Colors.textTertiary));
                const secText = !ss!.recoveryEventFound
                  ? "no drift event in last 14d"
                  : `event ${ss!.recoveryEventDriftMag0?.toFixed(0)}m \u2192 next avg ${ss!.recoveryFollowAvgDriftMag?.toFixed(0)}m (k=${ss!.recoveryFollowDaysK})`;
                const conf = ss!.recoveryConfidence;
                return sigRow("Recovery", <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {sigText(fmtScore100(rs), scoreColor(rs, { good: 70, warn: 40 }))}
                  <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>{secText}</Text>
                  {conf === "low" && <Text style={{ fontSize: 9, fontFamily: "Rubik_500Medium", color: "#FBBF24" }}>low conf</Text>}
                </View>);
              })()}

              {(() => {
                const ss = readiness.scheduleStability;
                const saD = sb?.sleepAlignment;
                return (
                  <View>
                    <Pressable onPress={() => setDebugSchedExpanded(v => !v)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#60A5FA" }}>Debug: Schedule Stability Inputs</Text>
                      <Ionicons name={debugSchedExpanded ? "chevron-up" : "chevron-down"} size={14} color="#60A5FA" />
                    </Pressable>
                    {debugSchedExpanded && (
                      <View style={{ backgroundColor: "#60A5FA08", borderRadius: 6, padding: 8, marginTop: 4, marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Scoring Inputs</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`planBed = ${sb?.sources?.planBed?.value ?? "—"} [${sb?.sources?.planBed?.source ?? "?"}]\nplanWake = ${sb?.sources?.planWake?.value ?? "—"} [${sb?.sources?.planWake?.source ?? "?"}]\nactualBed = ${sb?.sources?.actualBed?.value ?? "—"} [${sb?.sources?.actualBed?.source ?? "?"}]\nactualWake = ${sb?.sources?.actualWake?.value ?? "—"} [${sb?.sources?.actualWake?.source ?? "?"}]\ndataDay = ${sb?.sources?.dataDay ?? "—"}\nplannedSleepMin = ${sb?.plannedSleepMin ?? "—"}\nTIB = ${sb?.sources?.tib?.valueMin ?? "—"} [${sb?.sources?.tib?.method ?? "?"}]\nTST = ${sb?.sources?.tst?.valueMin ?? "—"} [${sb?.sources?.tst?.method ?? "?"}]\ncontinuityDenominator = TIB`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Alignment</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`bedDevMin = ${saD?.bedDeviationMin?.toFixed(2) ?? "—"}\nwakeDevMin = ${saD?.wakeDeviationMin?.toFixed(2) ?? "—"}\nbedPenaltyMin = abs(bedDev) = ${saD?.bedPenaltyMin?.toFixed(2) ?? "—"}\nwakePenaltyMin = abs(wakeDev) = ${saD?.wakePenaltyMin?.toFixed(2) ?? "—"}\ntotalPenaltyMin = clamp(bed+wake, 0, 180) = ${saD?.totalPenaltyMin?.toFixed(2) ?? "—"}\nalignmentScore = ${saD?.alignmentScore?.toFixed(2) ?? "—"}`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Consistency</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`sdMin = ${ss?.scheduleConsistencySdMin?.toFixed(2) ?? "—"}\nnDays = ${ss?.scheduleConsistencyNSamples ?? 0}\ndriftMags7d = [${(ss?.debugDriftMags7d ?? []).map((v: number) => v.toFixed(2)).join(", ")}]\nconsistencyScore = ${ss?.scheduleConsistencyScore?.toFixed(2) ?? "—"}`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Recovery</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`eventFound = ${ss?.recoveryEventFound ?? false}\neventSizeMin = ${ss?.recoveryEventDriftMag0?.toFixed(2) ?? "—"}\nkDaysUsed = min(4, available) = ${ss?.recoveryFollowDaysK ?? "—"}\npostEventAvgDevMin = ${ss?.recoveryFollowAvgDriftMag?.toFixed(2) ?? "—"}\nrecoveryScore = ${ss?.scheduleRecoveryScore?.toFixed(2) ?? "—"}\nconfidence = ${ss?.recoveryConfidence ?? "—"}`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {sectionHeader("Cardio Schedule", "heart-outline", "#F87171")}

              {(() => {
                const cs = readiness.cardioBlock?.scheduleStability;
                return (
                  <View>
                    {sigRow("Alignment", sigText(
                      fmtScore100(cs?.alignmentScore),
                      scoreColor(cs?.alignmentScore),
                    ))}
                    {sigRow("Consistency", sigText(
                      cs?.consistencyScore != null ? fmtScore100(cs.consistencyScore) : cs?.consistencyNSessions != null && cs.consistencyNSessions < 4 ? `— (${cs.consistencyNSessions}/4 sessions)` : "—",
                      scoreColor(cs?.consistencyScore),
                    ))}
                    {sigRow("Recovery", sigText(
                      fmtScore100(cs?.recoveryScore),
                      scoreColor(cs?.recoveryScore),
                    ))}
                    <Pressable onPress={() => setDebugCardioSchedExpanded(v => !v)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#F87171" }}>Debug: Cardio Schedule</Text>
                      <Ionicons name={debugCardioSchedExpanded ? "chevron-up" : "chevron-down"} size={14} color="#F87171" />
                    </Pressable>
                    {debugCardioSchedExpanded && (
                      <View style={{ backgroundColor: "#F8717108", borderRadius: 6, padding: 8, marginTop: 4, marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Alignment</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`planned = ${cs?.plannedStart ?? "—"}\nactual = ${cs?.actualStart ?? "—"}\npenalty = abs(circDelta) = ${cs?.alignmentPenaltyMin?.toFixed(2) ?? "—"} min\nalignment = clamp(100 − penalty×100/180, 0, 100) = ${cs?.alignmentScore?.toFixed(2) ?? "—"}`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Consistency</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`nSessions = ${cs?.consistencyNSessions ?? 0}\nsdMin = ${cs?.consistencySdMin?.toFixed(2) ?? "—"}\ndriftMags = [${(cs?.debugDriftMags ?? []).map((v: number) => v.toFixed(2)).join(", ")}]\nconsistency = clamp(100×(1−sd/60), 0, 100) = ${cs?.consistencyScore?.toFixed(2) ?? "—"}`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Recovery</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`eventFound = ${cs?.recoveryEventFound ?? false}\neventSize = ${cs?.recoveryEventDriftMag0?.toFixed(2) ?? "—"} min\nkDays = ${cs?.recoveryFollowDaysK ?? "—"}\npostEventAvg = ${cs?.recoveryFollowAvgDriftMag?.toFixed(2) ?? "—"}\nrecovery = ${cs?.recoveryScore?.toFixed(2) ?? "—"}\nconfidence = ${cs?.recoveryConfidence ?? "—"}`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {sectionHeader("Cardio Outcome", "heart-outline", "#F87171")}

              {(() => {
                const co = readiness.cardioBlock?.outcome;
                return (
                  <View>
                    {sigRow("Adequacy", sigText(
                      co?.adequacyScore != null ? fmtScore110(co.adequacyScore) : "— not logged",
                      scoreColor(co?.adequacyScore),
                    ))}
                    {sigRow("Efficiency", sigText(
                      co?.efficiencyScore != null ? fmtPct(co.efficiencyScore) : "— no zone data",
                      scoreColor(co?.efficiencyScore),
                    ))}
                    {sigRow("Continuity", sigText(
                      co?.continuityScore != null ? fmtPct(co.continuityScore) : "— no zone data",
                      scoreColor(co?.continuityScore),
                    ))}
                    <Pressable onPress={() => setDebugCardioOutcomeExpanded(v => !v)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#F87171" }}>Debug: Cardio Outcome</Text>
                      <Ionicons name={debugCardioOutcomeExpanded ? "chevron-up" : "chevron-down"} size={14} color="#F87171" />
                    </Pressable>
                    {debugCardioOutcomeExpanded && (
                      <View style={{ backgroundColor: "#F8717108", borderRadius: 6, padding: 8, marginTop: 4, marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`plannedMin = ${co?.plannedDurationMin ?? "—"}\ncardioTotalMin = ${co?.cardioTotalMin ?? "—"} [totalSource=${co?.cardioTotalSource ?? "none"}]\nz1=${co?.z1Min ?? "—"} z2=${co?.z2Min ?? "—"} z3=${co?.z3Min ?? "—"} z4=${co?.z4Min ?? "—"} z5=${co?.z5Min ?? "—"}\nproductiveMin = z2+z3 = ${co?.productiveMin ?? "—"} [productiveSource=${co?.productiveMinSource ?? "none"}]`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`adequacyRaw = 100×productive/planned = ${co?.adequacyScore?.toFixed(6) ?? "—"}\nadequacyUI = ${fmtScore110(co?.adequacyScore)}\n\nefficiencyRaw = 100×productive/total = ${co?.efficiencyScore?.toFixed(6) ?? "—"}\nefficiencyUI = ${fmtPct(co?.efficiencyScore)}\n\ncontinuityRaw = 100×(1−z1/total) = ${co?.continuityScore?.toFixed(6) ?? "—"}\ncontinuityUI = ${fmtPct(co?.continuityScore)}\ncontinuityDenominator = ${co?.continuityDenominator ?? "—"}`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {sectionHeader("Lift Schedule", "barbell-outline", "#F59E0B")}

              {(() => {
                const ls = readiness.liftBlock?.scheduleStability;
                return (
                  <View>
                    {sigRow("Alignment", sigText(
                      fmtScore100(ls?.alignmentScore),
                      scoreColor(ls?.alignmentScore),
                    ))}
                    {sigRow("Consistency", sigText(
                      ls?.consistencyScore != null ? fmtScore100(ls.consistencyScore) : ls?.consistencyNSamples != null && ls.consistencyNSamples < 4 ? `— (${ls.consistencyNSamples}/4 sessions)` : "—",
                      scoreColor(ls?.consistencyScore),
                    ))}
                    {sigRow("Recovery", sigText(
                      fmtScore100(ls?.recoveryScore),
                      scoreColor(ls?.recoveryScore),
                    ))}
                    <Pressable onPress={() => setDebugLiftSchedExpanded(v => !v)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#F59E0B" }}>Debug: Lift Schedule</Text>
                      <Ionicons name={debugLiftSchedExpanded ? "chevron-up" : "chevron-down"} size={14} color="#F59E0B" />
                    </Pressable>
                    {debugLiftSchedExpanded && (
                      <View style={{ backgroundColor: "#F59E0B08", borderRadius: 6, padding: 8, marginTop: 4, marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Alignment</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`planned = ${ls?.plannedStart ?? "—"}\nactual = ${ls?.actualStart ?? "—"}\npenalty = abs(circDelta) = ${ls?.alignmentPenalty?.toFixed(2) ?? "—"} min\nalignment = clamp(100 − penalty×100/180, 0, 100) = ${ls?.alignmentScore?.toFixed(2) ?? "—"}`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Consistency</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`nSessions = ${ls?.consistencyNSamples ?? 0}\nsdMin = ${ls?.consistencySdMin?.toFixed(2) ?? "—"}\nstartMins7d = [${(ls?.debugStartMins7d ?? []).map((v: number) => v.toFixed(2)).join(", ")}]\nconsistency = clamp(100×(1−sd/60), 0, 100) = ${ls?.consistencyScore?.toFixed(2) ?? "—"}`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, marginBottom: 4 }}>Recovery</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`eventFound = ${ls?.recoveryEventFound ?? false}\neventSize = ${ls?.recoveryEventDriftMag0?.toFixed(2) ?? "—"} min\nkDays = ${ls?.recoveryFollowDaysK ?? "—"}\npostEventAvg = ${ls?.recoveryFollowAvgDriftMag?.toFixed(2) ?? "—"}\nrecovery = ${ls?.recoveryScore?.toFixed(2) ?? "—"}\nconfidence = ${ls?.recoveryConfidence ?? "—"}`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {sectionHeader("Lift Outcome", "barbell-outline", "#F59E0B")}

              {(() => {
                const lo = readiness.liftBlock?.outcome;
                return (
                  <View>
                    {sigRow("Adequacy", sigText(
                      lo?.adequacyScore != null ? fmtScore110(lo.adequacyScore) : "— not logged",
                      scoreColor(lo?.adequacyScore),
                    ))}
                    {sigRow("Efficiency", sigText(
                      lo?.efficiencyScore != null ? fmtPct(lo.efficiencyScore) : "— not available",
                      scoreColor(lo?.efficiencyScore),
                    ))}
                    {sigRow("Continuity", sigText(
                      lo?.continuityScore != null ? fmtPct(lo.continuityScore) : "— not available",
                      scoreColor(lo?.continuityScore),
                    ))}
                    <Pressable onPress={() => setDebugLiftOutcomeExpanded(v => !v)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#F59E0B" }}>Debug: Lift Outcome</Text>
                      <Ionicons name={debugLiftOutcomeExpanded ? "chevron-up" : "chevron-down"} size={14} color="#F59E0B" />
                    </Pressable>
                    {debugLiftOutcomeExpanded && (
                      <View style={{ backgroundColor: "#F59E0B08", borderRadius: 6, padding: 8, marginTop: 4, marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`plannedMin = ${lo?.plannedMin ?? "—"}\nactualMin = ${lo?.actualMin ?? "—"} [actualSource=${lo?.actualSource ?? "none"}]\nworkingMin = ${lo?.workingMin ?? "—"} [workingSource=${lo?.workingSource ?? "none"}]\nidleMin = ${lo?.idleMin ?? "—"}`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`adequacyRaw = 100×actual/planned = ${lo?.adequacyScore?.toFixed(6) ?? "—"}\nadequacyUI = ${fmtScore110(lo?.adequacyScore)}\n\nefficiencyRaw = 100×working/actual = ${lo?.efficiencyScore?.toFixed(6) ?? "— (workingMin null)"}\nefficiencyUI = ${fmtPct(lo?.efficiencyScore)}\n\ncontinuityRaw = 100×(1−idle/actual) = ${lo?.continuityScore?.toFixed(6) ?? "— (workingMin null)"}\ncontinuityUI = ${fmtPct(lo?.continuityScore)}\ncontinuityDenominator = ${lo?.continuityDenominator ?? "—"}`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {sigRow("Meal timing",
                sigText(
                  readiness.placeholders?.mealTimingTracked ? "Tracked" : "Not tracked",
                  Colors.textTertiary,
                ),
                true,
              )}

              {sectionHeader("Sleep Outcome", "moon-outline", "#60A5FA")}

              {sigRow("Adequacy", sigText(
                hasAdequacy ? `${fmtScore100(sb!.sleepAdequacyScore!)}${shortfallStr}` : "\u2014 no sleep data",
                hasAdequacy ? scoreColor(sb!.sleepAdequacyScore!) : Colors.textTertiary,
              ))}

              {sigRow("Sleep delta", sigText(
                insufficientData ? "\u2014" : (readiness.deltas?.sleep_str ?? "\u2014"),
                insufficientData ? "#6B7280" : ((readiness.deltas?.sleep_pct ?? 0) >= 0 ? "#34D399" : "#EF4444"),
              ))}

              {(() => {
                const eff = sb?.sleepEfficiencyPct ?? null;
                return eff != null ? sigRow("Efficiency", sigText(
                  `${fmtPct(eff)}${sb?.fitbitVsReportedDeltaMin != null ? ` (Fitbit ${sb!.fitbitVsReportedDeltaMin! > 0 ? "+" : ""}${sb!.fitbitVsReportedDeltaMin}m)` : ""}`,
                  scoreColor(eff, { good: 85, warn: 70 }),
                ), sb?.awakeInBedMin == null) : null;
              })()}

              {(() => {
                const cont = sb?.sleepContinuityPct ?? null;
                return cont != null ? sigRow("Continuity", sigText(
                  fmtPct(cont),
                  scoreColor(cont, { good: 85, warn: 70 }),
                )) : null;
              })()}

              {sb?.awakeInBedMin != null && sigRow("Awake in bed", sigText(
                `${sb.awakeInBedMin}m`,
                sb.awakeInBedMin <= 30 ? "#34D399" : sb.awakeInBedMin <= 60 ? "#FBBF24" : "#EF4444",
              ))}

              {sb?.remMin != null && sigRow("REM", sigText(
                `${sb.remMin}m${sb.remDeltaMin != null ? ` (${sb.remDeltaMin >= 0 ? "+" : ""}${Math.round(sb.remDeltaMin)}m)` : ""}`,
                sb.remDeltaMin == null ? "#9CA3AF" : sb.remDeltaMin >= -5 ? "#34D399" : sb.remDeltaMin >= -15 ? "#FBBF24" : "#EF4444",
              ))}

              {sb?.deepMin != null && sigRow("Deep", sigText(
                `${sb.deepMin}m${sb.deepDeltaMin != null ? ` (${sb.deepDeltaMin >= 0 ? "+" : ""}${Math.round(sb.deepDeltaMin)}m)` : ""}`,
                sb.deepDeltaMin == null ? "#9CA3AF" : sb.deepDeltaMin >= -5 ? "#34D399" : sb.deepDeltaMin >= -15 ? "#FBBF24" : "#EF4444",
              ))}

              {sb != null && (() => {
                const planned = sb.plannedSleepMin ?? 0;
                const tib = sb.timeInBedMin ?? 0;
                const tst = sb.estimatedSleepMin ?? 0;
                const awake = sb.awakeInBedMin ?? 0;
                const latency = sb.latencyMin ?? 0;
                const waso = sb.wasoMin ?? 0;
                return (
                  <View>
                    <Pressable onPress={() => setDebugSleepExpanded(v => !v)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                      <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#60A5FA" }}>Debug: Sleep Outcome Inputs</Text>
                      <Ionicons name={debugSleepExpanded ? "chevron-up" : "chevron-down"} size={14} color="#60A5FA" />
                    </Pressable>
                    {debugSleepExpanded && (
                      <View style={{ backgroundColor: "#60A5FA08", borderRadius: 6, padding: 8, marginTop: 4, marginBottom: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`plannedSleepMin = ${planned}\ntimeInBedMin (TIB) = ${tib}\ntimeAsleepMin (TST) = ${tst}\nawakeInBedMin = ${awake}\nlatencyMin = ${latency}\nwasoMin = ${waso}\ncontinuityDenominator = TIB`}
                        </Text>
                        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />
                        <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: Colors.textTertiary, lineHeight: 16 }}>
                          {`adequacyRaw = 100 × TST/planned = 100 × ${tst}/${planned} = ${sb.sleepAdequacyScore?.toFixed(6) ?? "—"}\nadequacyUI = ${fmtScore100(sb.sleepAdequacyScore)}\n\nefficiencyFrac = ${sb.sleepEfficiencyFrac?.toFixed(6) ?? "—"}\nefficiencyPct = ${sb.sleepEfficiencyPct?.toFixed(6) ?? "—"}\nefficiencyUI = ${fmtPct(sb.sleepEfficiencyPct)}\n✓ pct == frac×100: ${sb.sleepEfficiencyFrac != null && sb.sleepEfficiencyPct != null ? (Math.abs(sb.sleepEfficiencyPct - sb.sleepEfficiencyFrac * 100) < 0.01 ? "PASS" : "FAIL") : "n/a"} (Δ=${sb.sleepEfficiencyFrac != null && sb.sleepEfficiencyPct != null ? Math.abs(sb.sleepEfficiencyPct - sb.sleepEfficiencyFrac * 100).toFixed(6) : "—"})\n\ncontinuityFrac = ${sb.sleepContinuityFrac?.toFixed(6) ?? "—"}\ncontinuityPct = ${sb.sleepContinuityPct?.toFixed(6) ?? "—"}\ncontinuityUI = ${fmtPct(sb.sleepContinuityPct)}\n✓ pct == frac×100: ${sb.sleepContinuityFrac != null && sb.sleepContinuityPct != null ? (Math.abs(sb.sleepContinuityPct - sb.sleepContinuityFrac * 100) < 0.01 ? "PASS" : "FAIL") : "n/a"} (Δ=${sb.sleepContinuityFrac != null && sb.sleepContinuityPct != null ? Math.abs(sb.sleepContinuityPct - sb.sleepContinuityFrac * 100).toFixed(6) : "—"})\ncontinuityDenominator = TIB`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {sectionHeader("System State", "pulse-outline", "#34D399")}

              {sigRow("HRV", sigText(
                insufficientData ? "\u2014" : `${readiness.deltas?.hrv_str ?? "\u2014"} vs baseline`,
                insufficientData ? "#6B7280" : ((readiness.deltas?.hrv_pct ?? 0) >= 0 ? "#34D399" : "#EF4444"),
              ))}

              {sigRow("RHR", sigText(
                insufficientData ? "\u2014" : `${readiness.deltas?.rhr_str ?? "\u2014"} vs baseline`,
                insufficientData ? "#6B7280" : ((readiness.deltas?.rhr_bpm ?? 0) <= 0 ? "#34D399" : "#EF4444"),
              ))}

              {sigRow("Proxy", sigText(
                insufficientData ? "\u2014" : `${readiness.deltas?.proxy_str ?? "\u2014"} vs baseline`,
                insufficientData ? "#6B7280" : ((readiness.deltas?.proxy_pct ?? 0) >= 0 ? "#34D399" : "#EF4444"),
              ))}

              {sigRow("HPA", (() => {
                const score = hpaData?.hpaScore;
                if (score == null) return sigText("\u2014", "#6B7280");
                const bucket = hpaData?.hpaBucket ?? "—";
                const color = score >= 80 ? "#DC2626" : score >= 60 ? "#F87171" : score >= 40 ? "#F59E0B" : score >= 20 ? "#34D399" : Colors.textSecondary;
                return (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color }}>{score.toFixed(2)}</Text>
                    <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>/ 100.00</Text>
                    <View style={{ backgroundColor: color + "20", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Rubik_700Bold", color }}>{bucket}</Text>
                    </View>
                    {hpaData?.suppressionFlag && (
                      <View style={{ backgroundColor: "#F8717125", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 8, fontFamily: "Rubik_700Bold", color: "#F87171" }}>SUPP</Text>
                      </View>
                    )}
                  </View>
                );
              })())}

              {hpaData?.stateLabel && sigRow("State", (() => {
                return (
                  <Text style={{ fontSize: 11, fontFamily: "Rubik_500Medium", color: "#8B5CF6" }}>
                    {hpaData.stateLabel}
                  </Text>
                );
              })())}

              {sigRow("Pain", (() => {
                const pain = hpaData?.drivers?.pain?.current;
                if (pain == null) return sigText("\u2014", "#6B7280");
                const color = pain >= 7 ? "#F87171" : pain >= 4 ? "#F59E0B" : Colors.textSecondary;
                return (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Rubik_600SemiBold", color }}>{pain}</Text>
                    <Text style={{ fontSize: 10, fontFamily: "Rubik_400Regular", color: Colors.textTertiary }}>/ 10</Text>
                  </View>
                );
              })())}

              {sigRow("Confidence", sigText(
                `${confGradeVal} (${readiness.confidenceBreakdown?.measured_7d ?? 0} / 7d)`,
                confGradeVal === "High" ? "#34D399" : confGradeVal === "Med" ? "#FBBF24" : "#EF4444",
              ), true)}
            </View>
          );
        })()}

        {readiness && readiness.gate !== "NONE" && (() => {
          const score = readiness.readinessScore ?? 0;
          const confGrade = readiness.confidenceBreakdown?.grade ?? readiness.confidenceGrade ?? "None";
          const confOk = confGrade === "High" || confGrade === "Med";
          let ruleTitle = "Pump / Technique";
          let ruleDesc = "Isolation focus / easy volume / skill work";
          let ruleColor = "#60A5FA";
          let ruleIcon: "snow" | "pause-circle" | "flash" = "snow";
          if (score >= 65 && confOk) {
            ruleTitle = "High Neural Day";
            ruleDesc = "Heavy compounds / lower reps / longer rest";
            ruleColor = "#34D399";
            ruleIcon = "flash";
          } else if (score >= 45) {
            ruleTitle = "Moderate";
            ruleDesc = "Controlled compounds + machines / moderate reps";
            ruleColor = "#FBBF24";
            ruleIcon = "pause-circle";
          }
          return (
            <View style={[styles.readinessCard, { marginTop: 0, borderColor: ruleColor + "30" }]}>
              <Text style={{ fontSize: 11, fontFamily: "Rubik_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 10 }}>
                Today's Training Rule
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: ruleColor + "20", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={ruleIcon} size={18} color={ruleColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontFamily: "Rubik_700Bold", color: ruleColor }}>{ruleTitle}</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, marginTop: 2 }}>{ruleDesc}</Text>
                </View>
              </View>
            </View>
          );
        })()}

        <View style={styles.timeline}>
          {DAILY_CHECKLIST.map((item, i) => (
            <ChecklistRow
              key={`${item.time}-${item.label}`}
              time={item.time}
              label={item.label}
              detail={item.detail}
              isLast={i === DAILY_CHECKLIST.length - 1}
            />
          ))}
        </View>

        <View style={styles.fuelNote}>
          <View style={styles.fuelNoteHeader}>
            <Feather name="zap" size={16} color={Colors.secondary} />
            <Text style={styles.fuelNoteTitle}>Cardio Fuel Guardrail</Text>
          </View>
          <Text style={styles.fuelNoteText}>
            If cardio exceeds {BASELINE.cardioFuel.thresholdMin} min, add +{BASELINE.cardioFuel.addCarbsG}g carbs via{" "}
            {BASELINE.cardioFuel.preferredSource === "dextrin_g" ? "dextrin" : "oats"}.
          </Text>
        </View>

        <View style={styles.ingredientCard}>
          <Text style={styles.ingredientTitle}>Ingredient Amounts</Text>
          {Object.entries(BASELINE.items).map(([key, amount]) => {
            const labels: Record<string, string> = {
              oats_g: "Oats", dextrin_g: "Dextrin", whey_g: "Whey",
              mct_g: "MCT Powder", flax_g: "Flaxseed", yogurt_cups: "Greek Yogurt",
              eggs: "Eggs", bananas: "Bananas",
            };
            const units: Record<string, string> = {
              oats_g: "g", dextrin_g: "g", whey_g: "g", mct_g: "g",
              flax_g: "g", yogurt_cups: "cup", eggs: "", bananas: "",
            };
            return (
              <View key={key} style={styles.ingredientRow}>
                <Text style={styles.ingredientName}>{labels[key] || key}</Text>
                <Text style={styles.ingredientAmount}>{amount}{units[key] ? ` ${units[key]}` : ""}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.importSection}>
          <View style={styles.importHeader}>
            <Ionicons name="cloud-upload-outline" size={20} color={Colors.primary} />
            <Text style={styles.importTitle}>Import Fitbit Data</Text>
          </View>
          <Text style={styles.importDesc}>
            Upload a CSV with daily aggregates (steps, cardio, sleep, heart rate, HRV). Existing manual entries are preserved.
          </Text>

          <Pressable
            onPress={handleImport}
            disabled={uploading}
            style={({ pressed }) => [
              styles.importBtn,
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              uploading && { opacity: 0.6 },
            ]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="document-attach-outline" size={18} color="#fff" />
            )}
            <Text style={styles.importBtnText}>
              {uploading ? "Importing..." : "Select CSV File"}
            </Text>
          </Pressable>

          {lastResult && (
            <View style={[
              styles.importResult,
              lastResult.status === "duplicate" && { borderColor: Colors.warning + "60", backgroundColor: Colors.warning + "10" },
              lastResult.status === "ok" && { borderColor: Colors.success + "60", backgroundColor: Colors.success + "10" },
            ]}>
              {lastResult.status === "ok" ? (
                <>
                  <View style={styles.importResultRow}>
                    <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                    <Text style={[styles.importResultText, { color: Colors.success }]}>
                      Import complete
                    </Text>
                  </View>
                  <Text style={styles.importResultDetail}>
                    {lastResult.rowsImported} rows imported, {lastResult.rowsUpserted} upserted
                    {lastResult.rowsSkipped > 0 ? `, ${lastResult.rowsSkipped} skipped` : ""}
                  </Text>
                  {lastResult.dateRange && (
                    <Text style={styles.importResultDetail}>
                      Range: {lastResult.dateRange.start} to {lastResult.dateRange.end}
                    </Text>
                  )}
                </>
              ) : lastResult.status === "duplicate" ? (
                <View style={styles.importResultRow}>
                  <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                  <Text style={[styles.importResultText, { color: Colors.warning }]}>
                    File already imported
                  </Text>
                </View>
              ) : (
                <View style={styles.importResultRow}>
                  <Ionicons name="close-circle" size={16} color={Colors.danger} />
                  <Text style={[styles.importResultText, { color: Colors.danger }]}>
                    Import failed
                  </Text>
                </View>
              )}
            </View>
          )}

          {importHistory.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.historyTitle}>Recent CSV Imports</Text>
              {importHistory.slice(0, 3).map((item) => (
                <View key={item.id} style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyFilename} numberOfLines={1}>
                      {item.originalFilename || "Unknown file"}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {item.rowsImported} rows
                      {item.dateRangeStart && item.dateRangeEnd
                        ? ` | ${item.dateRangeStart} to ${item.dateRangeEnd}`
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.historyDate}>
                    {new Date(item.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </Text>
                  <Pressable
                    onPress={() => deleteImportRecord("csv", item.id)}
                    hitSlop={8}
                    style={{ marginLeft: 8 }}
                  >
                    <Ionicons name="trash-outline" size={16} color={Colors.textSecondary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.importSection}>
          <View style={styles.importHeader}>
            <Ionicons name="archive-outline" size={20} color="#8B5CF6" />
            <Text style={[styles.importTitle, { color: "#8B5CF6" }]}>Import Google Takeout ZIP</Text>
          </View>
          <Text style={styles.importDesc}>
            Upload your Google Takeout ZIP containing Fitbit data. Auto-detects steps, calories, heart rate zones, resting HR, and sleep. Fitbit directory is found dynamically.
          </Text>

          <Pressable
            onPress={handleTakeoutImport}
            disabled={uploadingTakeout}
            style={({ pressed }) => [
              styles.importBtn,
              { backgroundColor: "#8B5CF6" },
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              uploadingTakeout && { opacity: 0.6 },
            ]}
          >
            {uploadingTakeout ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="folder-open-outline" size={18} color="#fff" />
            )}
            <Text style={styles.importBtnText}>
              {uploadingTakeout ? (takeoutProgress || "Importing ZIP...") : "Select Takeout ZIP"}
            </Text>
          </Pressable>

          {lastTakeoutResult && (
            <View style={[
              styles.importResult,
              lastTakeoutResult.status === "duplicate" && { borderColor: Colors.warning + "60", backgroundColor: Colors.warning + "10" },
              lastTakeoutResult.status === "ok" && { borderColor: Colors.success + "60", backgroundColor: Colors.success + "10" },
              lastTakeoutResult.status === "no_data" && { borderColor: Colors.warning + "60", backgroundColor: Colors.warning + "10" },
            ]}>
              {lastTakeoutResult.status === "ok" ? (
                <>
                  <View style={styles.importResultRow}>
                    <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                    <Text style={[styles.importResultText, { color: Colors.success }]}>
                      Takeout import complete
                    </Text>
                  </View>
                  <Text style={styles.importResultDetail}>
                    {lastTakeoutResult.daysAffected} days, {lastTakeoutResult.rowsUpserted} upserted, {lastTakeoutResult.filesProcessed} files parsed
                  </Text>
                  {lastTakeoutResult.dateRange && (
                    <Text style={styles.importResultDetail}>
                      Range: {lastTakeoutResult.dateRange.start} to {lastTakeoutResult.dateRange.end}
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {Object.entries(lastTakeoutResult.parseDetails || {}).map(([key, val]) => (
                      val > 0 ? (
                        <View key={key} style={{ backgroundColor: "#8B5CF610", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 10, fontFamily: "Rubik_500Medium", color: "#8B5CF6" }}>
                            {key}: {val}
                          </Text>
                        </View>
                      ) : null
                    ))}
                  </View>
                </>
              ) : lastTakeoutResult.status === "duplicate" ? (
                <View style={styles.importResultRow}>
                  <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                  <Text style={[styles.importResultText, { color: Colors.warning }]}>
                    ZIP already imported
                  </Text>
                </View>
              ) : lastTakeoutResult.status === "no_data" ? (
                <View style={styles.importResultRow}>
                  <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                  <Text style={[styles.importResultText, { color: Colors.warning }]}>
                    No Fitbit data found in ZIP
                  </Text>
                </View>
              ) : (
                <View style={styles.importResultRow}>
                  <Ionicons name="close-circle" size={16} color={Colors.danger} />
                  <Text style={[styles.importResultText, { color: Colors.danger }]}>
                    Import failed
                  </Text>
                </View>
              )}
            </View>
          )}

          {takeoutHistory.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.historyTitle}>Recent Takeout Imports</Text>
              {takeoutHistory.slice(0, 3).map((item) => (
                <View key={item.id} style={styles.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyFilename} numberOfLines={1}>
                      {item.originalFilename || "Unknown file"}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {item.daysAffected} days, {item.rowsUpserted} upserted
                      {item.dateRangeStart && item.dateRangeEnd
                        ? ` | ${item.dateRangeStart} to ${item.dateRangeEnd}`
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.historyDate}>
                    {new Date(item.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </Text>
                  <Pressable
                    onPress={() => deleteImportRecord("takeout", item.id)}
                    hitSlop={8}
                    style={{ marginLeft: 8 }}
                  >
                    <Ionicons name="trash-outline" size={16} color={Colors.textSecondary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  macroSummary: {
    flexDirection: "row",
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "space-around",
    alignItems: "center",
  },
  macroItem: {
    alignItems: "center",
  },
  macroValue: {
    fontSize: 18,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  macroLabel: {
    fontSize: 10,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  macroDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.border,
  },
  timeline: {
    marginBottom: 20,
  },
  rowContainer: {
    flexDirection: "row",
  },
  timelineCol: {
    width: 40,
    alignItems: "center",
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 12,
  },
  rowCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    marginLeft: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowTime: {
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.primary,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginBottom: 3,
  },
  rowDetail: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  fuelNote: {
    backgroundColor: Colors.secondaryMuted,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.secondary + "30",
  },
  fuelNoteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  fuelNoteTitle: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.secondary,
  },
  fuelNoteText: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  ingredientCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  ingredientTitle: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginBottom: 12,
  },
  ingredientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ingredientName: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  ingredientAmount: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  importSection: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  importHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  importTitle: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  importDesc: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  importBtnText: {
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
    color: "#fff",
  },
  importResult: {
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  importResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  importResultText: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  importResultDetail: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    marginTop: 4,
    marginLeft: 22,
  },
  historySection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  historyTitle: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  historyFilename: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
  },
  historyMeta: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginTop: 2,
  },
  historyDate: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    marginLeft: 8,
  },
  sufficiencyCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  rebaselineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary + "14",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rebaselineBtnText: {
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.primary,
  },
  suffGate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  suffGateText: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textTertiary,
  },
  readinessCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  readinessHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  readinessIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  readinessTitle: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  readinessScore: {
    fontSize: 24,
    fontFamily: "Rubik_700Bold",
  },
  readinessTierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  readinessTierText: {
    fontSize: 11,
    fontFamily: "Rubik_700Bold",
    letterSpacing: 0.5,
  },
  readinessLowConf: {
    fontSize: 9,
    fontFamily: "Rubik_500Medium",
    color: Colors.textTertiary,
    letterSpacing: 0.3,
  },
  readinessBar: {
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.surface,
    marginBottom: 14,
    overflow: "hidden" as const,
  },
  readinessBarFill: {
    height: 5,
    borderRadius: 3,
  },
  readinessSessions: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  readinessSessionsLabel: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  readinessSessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
  },
  readinessSessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  readinessSessionName: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    width: 44,
  },
  readinessSessionLabel: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    flex: 1,
  },
  readinessDrivers: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
    gap: 3,
  },
  readinessDriverText: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
});
