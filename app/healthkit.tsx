import React from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useHealthKit, type HealthKitStatus } from "@/hooks/useHealthKit";

const ACCENT = "#FF375F";

function StatusBadge({ status }: { status: HealthKitStatus }) {
  const map: Record<HealthKitStatus, { label: string; color: string }> = {
    unavailable: { label: "Not Available", color: Colors.textTertiary },
    idle: { label: "Ready", color: Colors.primary },
    requesting_permissions: { label: "Requesting...", color: Colors.warning },
    syncing: { label: "Syncing...", color: Colors.warning },
    done: { label: "Sync Complete", color: Colors.success },
    error: { label: "Error", color: Colors.danger },
  };
  const { label, color } = map[status];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function CountCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <View style={styles.countCard}>
      <MaterialCommunityIcons name={icon as any} size={22} color={Colors.primary} />
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

export default function HealthKitScreen() {
  const insets = useSafeAreaInsets();
  const { status, error, counts, progress, requestPermissions, syncDays, debugInfo } = useHealthKit();

  const handleSync = async (days: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await requestPermissions();
    if (ok) {
      syncDays(days);
    }
  };

  const isUnavailable = status === "unavailable";
  const isBusy = status === "requesting_permissions" || status === "syncing";

  return (
    <>
      <Stack.Screen
        options={{
          title: "Apple Health",
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <Ionicons name="heart" size={36} color={ACCENT} />
          </View>
          <Text style={styles.title}>Apple Health</Text>
          <Text style={styles.subtitle}>
            Import sleep, vitals, and workout data from HealthKit
          </Text>
          <StatusBadge status={status} />
        </View>

        <View style={styles.debugBox}>
          <Text style={styles.debugTitle}>Runtime Debug</Text>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>Runtime:</Text>
            <Text style={[
              styles.debugValue,
              { color: debugInfo.runtime === "Dev Client" ? Colors.primary : Colors.warning },
            ]}>
              {debugInfo.runtime}
            </Text>
          </View>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>HealthKit module loaded:</Text>
            <Text style={[
              styles.debugValue,
              { color: debugInfo.moduleLoaded ? Colors.success : Colors.danger },
            ]}>
              {debugInfo.moduleLoaded ? "yes" : "no"}
            </Text>
          </View>
        </View>

        {isUnavailable && debugInfo.runtime === "Expo Go" && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color={Colors.warning} />
            <Text style={styles.infoText}>
              HealthKit requires a native dev build (not Expo Go). Build and install
              a dev client via EAS to enable HealthKit on your iPhone.
              See IOS_DEV_BUILD_STEPS.md for instructions.
            </Text>
          </View>
        )}

        {isUnavailable && debugInfo.runtime === "Dev Client" && !debugInfo.moduleLoaded && (
          <View style={[styles.infoBox, { borderColor: Colors.danger }]}>
            <Ionicons name="alert-circle" size={20} color={Colors.danger} />
            <Text style={[styles.infoText, { color: Colors.danger }]}>
              Dev Client detected but HealthKit native module failed to load.
              Ensure react-native-health is linked and the app was rebuilt with
              the HealthKit entitlement.
            </Text>
          </View>
        )}

        {isUnavailable && debugInfo.runtime === "Non-iOS" && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color={Colors.textTertiary} />
            <Text style={styles.infoText}>
              HealthKit is only available on iOS devices.
            </Text>
          </View>
        )}

        {error && (
          <View style={[styles.infoBox, { borderColor: Colors.danger }]}>
            <Ionicons name="alert-circle" size={20} color={Colors.danger} />
            <Text style={[styles.infoText, { color: Colors.danger }]}>{error}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sync Data</Text>
          <Pressable
            style={[styles.syncButton, isBusy && styles.syncButtonDisabled]}
            onPress={() => handleSync(7)}
            disabled={isBusy || isUnavailable}
          >
            <Ionicons name="sync" size={20} color="#fff" />
            <Text style={styles.syncButtonText}>Sync last 7 days</Text>
          </Pressable>
          <Pressable
            style={[styles.syncButton, styles.syncButton30, isBusy && styles.syncButtonDisabled]}
            onPress={() => handleSync(30)}
            disabled={isBusy || isUnavailable}
          >
            <Ionicons name="sync" size={20} color="#fff" />
            <Text style={styles.syncButtonText}>Sync last 30 days</Text>
          </Pressable>
        </View>

        {isBusy && (
          <View style={styles.progressBox}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.progressText}>{progress || "Working..."}</Text>
          </View>
        )}

        {(status === "done" || counts.sleep_upserts > 0 || counts.vitals_upserts > 0 || counts.sessions_upserts > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Import Results</Text>
            <View style={styles.countsRow}>
              <CountCard label="Sleep" value={counts.sleep_upserts} icon="sleep" />
              <CountCard label="Vitals" value={counts.vitals_upserts} icon="heart-pulse" />
              <CountCard label="Workouts" value={counts.sessions_upserts} icon="dumbbell" />
            </View>
            {counts.hr_samples_points > 0 && (
              <Text style={styles.hrNote}>
                {counts.hr_samples_points} HR samples imported across workouts
              </Text>
            )}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data Types</Text>
          {[
            { icon: "sleep", label: "Sleep Analysis", desc: "Stages, duration, efficiency" },
            { icon: "heart-pulse", label: "Heart Rate", desc: "Resting HR, workout HR samples" },
            { icon: "chart-timeline-variant", label: "HRV", desc: "SDNN variability measurements" },
            { icon: "shoe-sneaker", label: "Steps & Activity", desc: "Daily steps, active energy" },
            { icon: "dumbbell", label: "Workouts", desc: "Type, duration, calories burned" },
          ].map((item) => (
            <View key={item.label} style={styles.dataTypeRow}>
              <MaterialCommunityIcons name={item.icon as any} size={20} color={Colors.primary} />
              <View style={styles.dataTypeInfo}>
                <Text style={styles.dataTypeLabel}>{item.label}</Text>
                <Text style={styles.dataTypeDesc}>{item.desc}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  hero: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255, 55, 95, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: 16,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  badgeText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
  },
  debugBox: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  debugTitle: {
    fontSize: 12,
    fontFamily: "Rubik_700Bold",
    color: Colors.textTertiary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  debugRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  debugLabel: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  debugValue: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textSecondary,
    marginBottom: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
  },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  syncButton30: {
    backgroundColor: Colors.cardBgElevated,
  },
  syncButtonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: "#fff",
  },
  progressBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 14,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
  },
  progressText: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  countsRow: {
    flexDirection: "row",
    gap: 10,
  },
  countCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
  },
  countValue: {
    fontSize: 28,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  countLabel: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  hrNote: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: 8,
  },
  dataTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.cardBg,
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  dataTypeInfo: {
    flex: 1,
  },
  dataTypeLabel: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.text,
  },
  dataTypeDesc: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
});
