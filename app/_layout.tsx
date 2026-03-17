import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import {
  useFonts,
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
} from "@expo-google-fonts/rubik";
import { StatusBar } from "expo-status-bar";
import { getProfile } from "@/lib/profile";
import { ProvenanceBanner } from "@/components/ProvenanceBanner";

SplashScreen.preventAutoHideAsync();

function ProfileGuard() {
  const router   = useRouter();
  const segments = useSegments();

  useEffect(() => {
    (async () => {
      const profile = await getProfile();
      const inOnboarding = (segments as string[]).includes("onboarding");
      if (!profile && !inOnboarding) {
        router.replace("/onboarding");
      }
    })();
  // Run once on mount — segments intentionally excluded to avoid re-runs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function RootLayoutNav() {
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <ProfileGuard />
      <Stack screenOptions={{ headerBackTitle: "Back" }}>
        <Stack.Screen name="(tabs)"      options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"  options={{ headerShown: false }} />
        <Stack.Screen name="healthkit"   options={{ headerShown: true }} />
        <Stack.Screen name="polar"       options={{ headerShown: true }} />
        <Stack.Screen name="workout"     options={{ headerShown: true }} />
        <Stack.Screen name="training"    options={{ headerShown: false }} />
        <Stack.Screen name="workbook"    options={{ headerShown: false }} />
      </Stack>
      <ProvenanceBanner />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Rubik_400Regular,
    Rubik_500Medium,
    Rubik_600SemiBold,
    Rubik_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView>
          <KeyboardProvider>
            <RootLayoutNav />
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
