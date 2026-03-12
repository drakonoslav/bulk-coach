import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import Colors from "@/constants/colors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "chart.line.uptrend.xyaxis", selected: "chart.line.uptrend.xyaxis" }} />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tracker">
        <Icon sf={{ default: "square.and.pencil", selected: "square.and.pencil.fill" }} />
        <Label>Logbook</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="checklist">
        <Icon sf={{ default: "list.bullet.clipboard", selected: "list.bullet.clipboard.fill" }} />
        <Label>Plan</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="report">
        <Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} />
        <Label>Report</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vitals">
        <Icon sf={{ default: "waveform.path.ecg", selected: "waveform.path.ecg" }} />
        <Label>Vitals</Label>
      </NativeTabs.Trigger>
      {/* Old log tab intentionally omitted from tab bar — still routable at /log */}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.light.tabIconDefault,
        tabBarStyle: {
          position: "absolute" as const,
          backgroundColor: isIOS ? "transparent" : Colors.tabBar,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: Colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.tabBar }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tracker"
        options={{
          title: "Logbook",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pencil-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="checklist"
        options={{
          title: "Plan",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: "Report",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="vitals"
        options={{
          title: "Vitals",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="pulse" size={size} color={color} />
          ),
        }}
      />
      {/* Old log tab — hidden from tab bar, still accessible at /log */}
      <Tabs.Screen
        name="log"
        options={{
          title: "Log",
          tabBarButton: () => null,
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
