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
import * as Haptics from "expo-haptics";
import { File } from "expo-file-system/next";
import { fetch } from "expo/fetch";
import Colors from "@/constants/colors";
import { DAILY_CHECKLIST, BASELINE } from "@/lib/coaching-engine";
import { getApiUrl } from "@/lib/query-client";

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
  const [lastResult, setLastResult] = useState<{
    status: string;
    rowsImported: number;
    rowsUpserted: number;
    rowsSkipped: number;
    dateRange: { start: string; end: string } | null;
  } | null>(null);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/import/history", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setImportHistory(data);
      }
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  const handleImport = async () => {
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

        const uploadRes = await globalThis.fetch(url.toString(), {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = await uploadRes.json();
        setLastResult(data);
        if (data.status === "duplicate") {
          Alert.alert("Duplicate File", "This file has already been imported.");
        }
      } else {
        const file = new File(asset.uri);
        formData.append("file", file as any, asset.name || "import.csv");

        const uploadRes = await fetch(url.toString(), {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = await uploadRes.json();
        setLastResult(data);
        if (data.status === "duplicate") {
          Alert.alert("Duplicate File", "This file has already been imported.");
        }
      }

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadHistory();
    } catch (err) {
      console.error("Import error:", err);
      Alert.alert("Import Error", "Something went wrong. Make sure you selected a valid CSV file.");
    } finally {
      setUploading(false);
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
              <Text style={styles.historyTitle}>Recent Imports</Text>
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
});
