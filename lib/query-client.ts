import { fetch } from "expo/fetch";
import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

export function getApiUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + "/";
  }

  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }

  host = host.replace(/:5000$/, "");

  let url = new URL(`https://${host}`);

  return url.href;
}

let _cachedToken: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function getApiKey(): Promise<string> {
  const envKey = process.env.EXPO_PUBLIC_API_KEY;
  if (envKey) return envKey;

  if (_cachedToken) return _cachedToken;

  if (!_tokenPromise) {
    _tokenPromise = (async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await fetch(new URL("/api/auth/token", baseUrl).toString());
        if (res.ok) {
          const data = await res.json();
          _cachedToken = data.token || "";
          return _cachedToken!;
        }
      } catch (e) {}
      return "";
    })();
  }
  return _tokenPromise;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  const apiKey = await getApiKey();
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const headers: Record<string, string> = {};
    const apiKey = await getApiKey();
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(url.toString(), {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
