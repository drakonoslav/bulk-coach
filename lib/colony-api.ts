import { getApiUrl } from "./query-client";
import { makeApiHeaders } from "./api-headers";
import type { ColonyResponse } from "./colony-types";
import type { ApiErrorResponse } from "./workbook-types";

function base(): string {
  return getApiUrl().replace(/\/$/, "");
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T | ApiErrorResponse;
  if (!res.ok) {
    const err = data as ApiErrorResponse;
    throw new Error(err.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export async function fetchColony(): Promise<ColonyResponse> {
  const headers = await makeApiHeaders();
  const res = await fetch(`${base()}/api/colony`, { method: "GET", headers });
  return parseJsonOrThrow<ColonyResponse>(res);
}
