/**
 * Shared helper that builds the full set of required API request headers:
 *   Authorization: Bearer <token>   (fetched from /api/auth/token or EXPO_PUBLIC_API_KEY)
 *   X-User-Id: <device-uuid>
 *
 * Every fetch that goes to a protected /api/* endpoint must include these.
 */
import { fetch as expoFetch } from "expo/fetch";
import { getApiUrl } from "./query-client";
import { getDeviceUserId } from "./user-identity";

let _cachedToken: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function getBearerToken(): Promise<string> {
  const envKey = (process.env as any).EXPO_PUBLIC_API_KEY as string | undefined;
  if (envKey) return envKey;
  if (_cachedToken) return _cachedToken;
  if (!_tokenPromise) {
    _tokenPromise = (async () => {
      try {
        const base = getApiUrl();
        const url = new URL("/api/auth/token", base).toString();
        const res = await expoFetch(url);
        if (res.ok) {
          const data = await res.json() as any;
          _cachedToken = data.token || "";
          return _cachedToken!;
        }
      } catch {}
      return "";
    })();
  }
  return _tokenPromise;
}

export async function makeApiHeaders(): Promise<Record<string, string>> {
  const [token, userId] = await Promise.all([getBearerToken(), getDeviceUserId()]);
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (userId) headers["X-User-Id"] = userId;
  return headers;
}
