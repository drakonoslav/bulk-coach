import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const PROFILE_KEY = "user_profile";
const USER_ID_KEY = "tracker_user_id";

export interface UserProfile {
  userId: string;
  username: string;
  birthday: string;   // YYYY-MM-DD
  createdAt: string;  // ISO
}

export async function getProfile(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function clearProfile(): Promise<void> {
  await AsyncStorage.multiRemove([PROFILE_KEY, USER_ID_KEY]);
}

export async function createProfile(username: string, birthday: string): Promise<UserProfile> {
  const userId = "usr_" + (await Crypto.randomUUID()).replace(/-/g, "").slice(0, 16);
  const profile: UserProfile = {
    userId,
    username: username.trim(),
    birthday,
    createdAt: new Date().toISOString(),
  };
  await saveProfile(profile);
  await AsyncStorage.setItem(USER_ID_KEY, userId);
  return profile;
}

export function getAge(birthday: string): number {
  const today = new Date();
  const birth = new Date(birthday + "T00:00:00");
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function getDaysSince(isoDate: string): number {
  const start = new Date(isoDate);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

export function formatBirthdayDisplay(birthday: string): string {
  const [y, m, d] = birthday.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}
