import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

// Shared with tracker.tsx — same key, same UUID, same identity everywhere
const USER_ID_KEY = "tracker_user_id";

let _cached: string | null = null;

/**
 * Returns the persistent device-scoped user ID.
 * Generated once on first call, cached in memory for the session.
 * Used as the X-User-Id header on every API request so the backend
 * segregates all DB data per device automatically.
 */
export async function getDeviceUserId(): Promise<string> {
  if (_cached) return _cached;

  let stored = await AsyncStorage.getItem(USER_ID_KEY);
  if (!stored) {
    stored = "usr_" + (await Crypto.randomUUID()).replace(/-/g, "").slice(0, 16);
    await AsyncStorage.setItem(USER_ID_KEY, stored);
  }

  _cached = stored;
  return stored;
}
