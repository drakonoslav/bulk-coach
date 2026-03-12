import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_ID_KEY = "tracker_user_id";

let _cached: string | null = null;

/**
 * Returns the persistent device-scoped user ID.
 * Devices that had no UUID stored (all existing installs) receive "local_default",
 * which matches every row already in the database.
 * The value is written to AsyncStorage on first call so subsequent launches
 * return the same identity even without a network round-trip.
 */
export async function getDeviceUserId(): Promise<string> {
  if (_cached) return _cached;

  let stored = await AsyncStorage.getItem(USER_ID_KEY);
  if (!stored) {
    // Preserve all existing data: new installs default to "local_default".
    stored = "local_default";
    await AsyncStorage.setItem(USER_ID_KEY, stored);
  }

  _cached = stored;
  return stored;
}
