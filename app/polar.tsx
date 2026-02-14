import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  ActivityIndicator,
  ScrollView,
  FlatList,
} from "react-native";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { usePolarH10, type PolarStatus, type PolarDevice } from "@/hooks/usePolarH10";

const POLAR_BLUE = "#D32027";

function StatusBadge({ status }: { status: PolarStatus }) {
  const map: Record<PolarStatus, { label: string; color: string }> = {
    unavailable: { label: "Not Available", color: Colors.textTertiary },
    idle: { label: "Ready", color: Colors.textSecondary },
    scanning: { label: "Scanning...", color: Colors.warning },
    connecting: { label: "Connecting...", color: Colors.warning },
    connected: { label: "Connected", color: Colors.success },
    baseline: { label: "Baseline Capture", color: "#8B5CF6" },
    streaming: { label: "Live Streaming", color: Colors.primary },
    analyzing: { label: "Analyzing...", color: Colors.warning },
    done: { label: "Session Complete", color: Colors.success },
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

function DeviceRow({ device, onPress }: { device: PolarDevice; onPress: () => void }) {
  const signalBars = device.rssi > -60 ? 3 : device.rssi > -80 ? 2 : 1;
  return (
    <Pressable style={styles.deviceRow} onPress={onPress}>
      <MaterialCommunityIcons name="bluetooth" size={22} color={POLAR_BLUE} />
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{device.name}</Text>
        <Text style={styles.deviceRssi}>Signal: {"|||".slice(0, signalBars)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
    </Pressable>
  );
}

function LiveDisplay({
  hr,
  baselineLeft,
  elapsed,
  hrCount,
  rrCount,
}: {
  hr: number;
  baselineLeft: number;
  elapsed: number;
  hrCount: number;
  rrCount: number;
}) {
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const isBaseline = baselineLeft > 0;

  return (
    <View style={styles.liveContainer}>
      <View style={styles.hrCircle}>
        <MaterialCommunityIcons name="heart-pulse" size={24} color={POLAR_BLUE} />
        <Text style={styles.hrValue}>{hr > 0 ? hr : "--"}</Text>
        <Text style={styles.hrUnit}>BPM</Text>
      </View>

      {isBaseline && (
        <View style={styles.baselineBox}>
          <Text style={styles.baselineLabel}>Baseline Capture</Text>
          <Text style={styles.baselineTimer}>{baselineLeft}s remaining</Text>
          <View style={styles.baselineBar}>
            <View
              style={[
                styles.baselineFill,
                { width: `${((120 - baselineLeft) / 120) * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.baselineHint}>Stay still for accurate baseline HRV</Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{`${minutes}:${seconds.toString().padStart(2, "0")}`}</Text>
          <Text style={styles.statLabel}>Elapsed</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{hrCount}</Text>
          <Text style={styles.statLabel}>HR Samples</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{rrCount}</Text>
          <Text style={styles.statLabel}>RR Intervals</Text>
        </View>
      </View>
    </View>
  );
}

function AnalysisDisplay({ analysis }: { analysis: any }) {
  const items = [
    { label: "Pre-session RMSSD", value: analysis.pre_session_rmssd != null ? `${analysis.pre_session_rmssd.toFixed(1)} ms` : "N/A" },
    { label: "Min RMSSD", value: analysis.min_session_rmssd != null ? `${analysis.min_session_rmssd.toFixed(1)} ms` : "N/A" },
    { label: "Post RMSSD", value: analysis.post_session_rmssd != null ? `${analysis.post_session_rmssd.toFixed(1)} ms` : "N/A" },
    { label: "HRV Suppression", value: analysis.hrv_suppression_pct != null ? `${analysis.hrv_suppression_pct.toFixed(1)}%` : "N/A" },
    { label: "HRV Rebound", value: analysis.hrv_rebound_pct != null ? `${analysis.hrv_rebound_pct.toFixed(1)}%` : "N/A" },
    { label: "Response", value: analysis.hrv_response_flag || "N/A" },
    { label: "Recovery Time", value: analysis.time_to_recovery_sec != null ? `${Math.round(analysis.time_to_recovery_sec)}s` : "N/A" },
  ];

  const flagColor =
    analysis.hrv_response_flag === "suppressed" ? Colors.warning :
    analysis.hrv_response_flag === "increased" ? Colors.success :
    analysis.hrv_response_flag === "flat" ? Colors.textSecondary :
    Colors.textTertiary;

  return (
    <View style={styles.analysisContainer}>
      <View style={[styles.flagBadge, { borderColor: flagColor }]}>
        <Text style={[styles.flagText, { color: flagColor }]}>
          {(analysis.hrv_response_flag || "insufficient").toUpperCase()}
        </Text>
      </View>
      {items.map(item => (
        <View key={item.label} style={styles.analysisRow}>
          <Text style={styles.analysisLabel}>{item.label}</Text>
          <Text style={styles.analysisValue}>{item.value}</Text>
        </View>
      ))}
      <View style={styles.biasRow}>
        <View style={[styles.biasBar, { flex: analysis.strength_bias || 0.5 }]}>
          <Text style={styles.biasText}>Strength {Math.round((analysis.strength_bias || 0.5) * 100)}%</Text>
        </View>
        <View style={[styles.biasBar, styles.cardioBar, { flex: analysis.cardio_bias || 0.5 }]}>
          <Text style={styles.biasText}>Cardio {Math.round((analysis.cardio_bias || 0.5) * 100)}%</Text>
        </View>
      </View>
    </View>
  );
}

export default function PolarScreen() {
  const insets = useSafeAreaInsets();
  const [readinessInput, setReadinessInput] = useState(75);
  const polar = usePolarH10();

  const handleScan = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    polar.scan();
  };

  const handleConnect = (device: PolarDevice) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    polar.connect(device.id);
  };

  const handleStartSession = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    polar.startSession(readinessInput);
  };

  const handleEndSession = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    polar.endSession();
  };

  const isStreaming = polar.status === "baseline" || polar.status === "streaming";
  const showDevices = polar.status === "idle" && polar.devices.length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Polar H10",
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
            <MaterialCommunityIcons name="heart-flash" size={36} color={POLAR_BLUE} />
          </View>
          <Text style={styles.title}>Polar H10</Text>
          <Text style={styles.subtitle}>
            Real-time heart rate and HRV monitoring via Bluetooth
          </Text>
          <StatusBadge status={polar.status} />
        </View>

        {polar.status === "unavailable" && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color={Colors.warning} />
            <Text style={styles.infoText}>
              BLE requires a native dev build with react-native-ble-plx.
              This screen will become functional when running on a device
              with Bluetooth support.
            </Text>
          </View>
        )}

        {polar.error && (
          <View style={[styles.infoBox, { borderColor: Colors.danger }]}>
            <Ionicons name="alert-circle" size={20} color={Colors.danger} />
            <Text style={[styles.infoText, { color: Colors.danger }]}>{polar.error}</Text>
          </View>
        )}

        {polar.status === "idle" && !polar.connectedDevice && (
          <View style={styles.section}>
            <Pressable
              style={styles.scanButton}
              onPress={handleScan}
              disabled={polar.status !== "idle"}
            >
              <MaterialCommunityIcons name="bluetooth-connect" size={20} color="#fff" />
              <Text style={styles.scanButtonText}>Scan for Devices</Text>
            </Pressable>
          </View>
        )}

        {polar.status === "scanning" && (
          <View style={styles.progressBox}>
            <ActivityIndicator size="small" color={POLAR_BLUE} />
            <Text style={styles.progressText}>Scanning for Polar devices...</Text>
          </View>
        )}

        {showDevices && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Found Devices</Text>
            {polar.devices.map(device => (
              <DeviceRow
                key={device.id}
                device={device}
                onPress={() => handleConnect(device)}
              />
            ))}
          </View>
        )}

        {polar.status === "connecting" && (
          <View style={styles.progressBox}>
            <ActivityIndicator size="small" color={POLAR_BLUE} />
            <Text style={styles.progressText}>Connecting...</Text>
          </View>
        )}

        {polar.connectedDevice && polar.status === "connected" && (
          <View style={styles.section}>
            <View style={styles.connectedCard}>
              <MaterialCommunityIcons name="bluetooth-connect" size={24} color={Colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.connectedName}>{polar.connectedDevice.name}</Text>
                <Text style={styles.connectedStatus}>Connected and ready</Text>
              </View>
            </View>

            <View style={styles.readinessRow}>
              <Text style={styles.readinessLabel}>Readiness Score</Text>
              <View style={styles.readinessSlider}>
                {[50, 60, 70, 75, 80, 90, 100].map(v => (
                  <Pressable
                    key={v}
                    style={[styles.readinessChip, readinessInput === v && styles.readinessChipActive]}
                    onPress={() => setReadinessInput(v)}
                  >
                    <Text style={[styles.readinessChipText, readinessInput === v && styles.readinessChipTextActive]}>
                      {v}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Pressable style={styles.startButton} onPress={handleStartSession}>
              <Ionicons name="play" size={22} color="#fff" />
              <Text style={styles.startButtonText}>Start Workout Session</Text>
            </Pressable>

            <Pressable style={styles.disconnectButton} onPress={polar.disconnect}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </Pressable>
          </View>
        )}

        {isStreaming && (
          <View style={styles.section}>
            <LiveDisplay
              hr={polar.liveStats.hr}
              baselineLeft={polar.liveStats.baselineSecondsLeft}
              elapsed={polar.liveStats.elapsedSec}
              hrCount={polar.liveStats.hrCount}
              rrCount={polar.liveStats.rrCount}
            />

            {polar.liveStats.baselineSecondsLeft === 0 && (
              <Pressable style={styles.goToGameButton} onPress={() => {
                if (polar.sessionId) {
                  router.push({
                    pathname: "/workout",
                    params: {
                      sessionId: polar.sessionId,
                      readiness: readinessInput.toString(),
                      polarConnected: "true",
                    },
                  });
                }
              }}>
                <MaterialCommunityIcons name="dumbbell" size={20} color="#fff" />
                <Text style={styles.goToGameText}>Open Game Guide</Text>
              </Pressable>
            )}

            <Pressable style={styles.endButton} onPress={handleEndSession}>
              <Ionicons name="stop" size={20} color="#fff" />
              <Text style={styles.endButtonText}>End Session</Text>
            </Pressable>
          </View>
        )}

        {polar.status === "analyzing" && (
          <View style={styles.progressBox}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.progressText}>Analyzing HRV data...</Text>
          </View>
        )}

        {polar.status === "done" && polar.analysis && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>HRV Analysis</Text>
            <AnalysisDisplay analysis={polar.analysis} />
            <Pressable style={styles.resetButton} onPress={polar.reset}>
              <Text style={styles.resetText}>New Session</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: "center", paddingTop: 24, paddingBottom: 20, paddingHorizontal: 24 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(211, 32, 39, 0.12)",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  title: { fontSize: 24, fontFamily: "Rubik_700Bold", color: Colors.text, marginBottom: 6 },
  subtitle: {
    fontSize: 14, fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary, textAlign: "center", marginBottom: 16,
  },
  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  badgeDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  badgeText: { fontSize: 13, fontFamily: "Rubik_500Medium" },
  infoBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginHorizontal: 20, marginBottom: 16, padding: 14,
    backgroundColor: Colors.cardBg, borderRadius: 12, borderWidth: 1, borderColor: Colors.warning,
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Rubik_400Regular", color: Colors.textSecondary, lineHeight: 18 },
  section: { marginHorizontal: 20, marginBottom: 24 },
  sectionTitle: {
    fontSize: 15, fontFamily: "Rubik_600SemiBold", color: Colors.textSecondary,
    marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.8,
  },
  scanButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: POLAR_BLUE, paddingVertical: 14, borderRadius: 12,
  },
  scanButtonText: { fontSize: 16, fontFamily: "Rubik_600SemiBold", color: "#fff" },
  progressBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 20, marginBottom: 20, padding: 14,
    backgroundColor: Colors.cardBg, borderRadius: 12,
  },
  progressText: { fontSize: 14, fontFamily: "Rubik_400Regular", color: Colors.textSecondary },
  deviceRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: Colors.cardBg, padding: 16, borderRadius: 12, marginBottom: 8,
  },
  deviceInfo: { flex: 1 },
  deviceName: { fontSize: 16, fontFamily: "Rubik_600SemiBold", color: Colors.text },
  deviceRssi: { fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textTertiary },
  connectedCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: Colors.cardBg, padding: 16, borderRadius: 12, marginBottom: 16,
  },
  connectedName: { fontSize: 16, fontFamily: "Rubik_600SemiBold", color: Colors.text },
  connectedStatus: { fontSize: 13, fontFamily: "Rubik_400Regular", color: Colors.success },
  readinessRow: { marginBottom: 16 },
  readinessLabel: { fontSize: 14, fontFamily: "Rubik_500Medium", color: Colors.textSecondary, marginBottom: 8 },
  readinessSlider: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  readinessChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.cardBg, borderWidth: 1, borderColor: Colors.border,
  },
  readinessChipActive: { backgroundColor: Colors.primaryMuted, borderColor: Colors.primary },
  readinessChipText: { fontSize: 14, fontFamily: "Rubik_500Medium", color: Colors.textSecondary },
  readinessChipTextActive: { color: Colors.primary },
  startButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12, marginBottom: 10,
  },
  startButtonText: { fontSize: 16, fontFamily: "Rubik_600SemiBold", color: "#fff" },
  disconnectButton: {
    alignItems: "center", paddingVertical: 10,
  },
  disconnectText: { fontSize: 14, fontFamily: "Rubik_500Medium", color: Colors.textTertiary },
  liveContainer: { alignItems: "center", marginBottom: 20 },
  hrCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(211, 32, 39, 0.08)", borderWidth: 2, borderColor: POLAR_BLUE,
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  hrValue: { fontSize: 36, fontFamily: "Rubik_700Bold", color: Colors.text },
  hrUnit: { fontSize: 12, fontFamily: "Rubik_500Medium", color: Colors.textTertiary },
  baselineBox: {
    width: "100%", backgroundColor: "rgba(139, 92, 246, 0.08)",
    borderRadius: 12, padding: 16, marginBottom: 16, alignItems: "center",
    borderWidth: 1, borderColor: "rgba(139, 92, 246, 0.3)",
  },
  baselineLabel: { fontSize: 14, fontFamily: "Rubik_600SemiBold", color: "#8B5CF6", marginBottom: 4 },
  baselineTimer: { fontSize: 24, fontFamily: "Rubik_700Bold", color: Colors.text, marginBottom: 8 },
  baselineBar: {
    width: "100%", height: 6, backgroundColor: Colors.surface, borderRadius: 3, marginBottom: 8,
  },
  baselineFill: { height: 6, backgroundColor: "#8B5CF6", borderRadius: 3 },
  baselineHint: { fontSize: 12, fontFamily: "Rubik_400Regular", color: Colors.textTertiary },
  statsRow: { flexDirection: "row", gap: 12, width: "100%" },
  statItem: { flex: 1, backgroundColor: Colors.cardBg, borderRadius: 10, padding: 12, alignItems: "center" },
  statValue: { fontSize: 18, fontFamily: "Rubik_700Bold", color: Colors.text },
  statLabel: { fontSize: 11, fontFamily: "Rubik_400Regular", color: Colors.textTertiary, marginTop: 2 },
  goToGameButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12, marginBottom: 10,
  },
  goToGameText: { fontSize: 16, fontFamily: "Rubik_600SemiBold", color: "#fff" },
  endButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.danger, paddingVertical: 12, borderRadius: 12,
  },
  endButtonText: { fontSize: 15, fontFamily: "Rubik_600SemiBold", color: "#fff" },
  analysisContainer: {
    backgroundColor: Colors.cardBg, borderRadius: 14, padding: 18,
  },
  flagBadge: {
    alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, marginBottom: 16,
  },
  flagText: { fontSize: 14, fontFamily: "Rubik_700Bold", letterSpacing: 1 },
  analysisRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  analysisLabel: { fontSize: 14, fontFamily: "Rubik_400Regular", color: Colors.textSecondary },
  analysisValue: { fontSize: 14, fontFamily: "Rubik_600SemiBold", color: Colors.text },
  biasRow: { flexDirection: "row", marginTop: 14, borderRadius: 8, overflow: "hidden" },
  biasBar: {
    paddingVertical: 8, alignItems: "center",
    backgroundColor: "rgba(0, 212, 170, 0.15)",
  },
  cardioBar: { backgroundColor: "rgba(139, 92, 246, 0.15)" },
  biasText: { fontSize: 12, fontFamily: "Rubik_600SemiBold", color: Colors.text },
  resetButton: {
    alignItems: "center", paddingVertical: 14,
    backgroundColor: Colors.cardBgElevated, borderRadius: 12, marginTop: 16,
  },
  resetText: { fontSize: 15, fontFamily: "Rubik_600SemiBold", color: Colors.primary },
});
