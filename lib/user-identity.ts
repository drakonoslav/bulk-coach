import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_ID_KEY = "tracker_user_id";

let _cached: string | null = null;

/**
 * Returns the persistent device-scoped user ID.
 * Set by createProfile() during onboarding. Falls back to "local_default"
 * only if nothing is stored (pre-profile legacy installs).
 */
export async function getDeviceUserId(): Promise<string> {
  if (_cached) return _cached;
  const stored = await AsyncStorage.getItem(USER_ID_KEY);
  _cached = stored ?? "local_default";
  return _cached;
}

/** Invalidate the in-memory cache (call after profile creation or reset). */
export function clearUserIdCache(): void {
  _cached = null;
}
