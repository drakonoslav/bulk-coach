/**
 * lib/workbook-api.ts
 * Canonical fetch helpers for workbook snapshot endpoints.
 *
 * CONTRACT:
 *   GET  /api/snapshots          → WorkbookSnapshotsResponse
 *   GET  /api/snapshots/active   → ActiveWorkbookResponse
 *   PATCH /api/workbooks/:id/activate → ActivateWorkbookResponse
 *   POST  /api/upload-workbook   → UploadWorkbookResponse
 *
 * Rules:
 *   - makeApiHeaders() on every call (Auth + X-User-Id)
 *   - No AsyncStorage fallback identity
 *   - No hardcoded base URL — use getApiUrl()
 *   - Throw on non-ok responses with the backend error message
 */

import { Platform } from "react-native";
import { getApiUrl } from "./query-client";
import { makeApiHeaders } from "./api-headers";
import type {
  ActiveWorkbookResponse,
  ActivateWorkbookResponse,
  ApiErrorResponse,
  UploadWorkbookResponse,
  WorkbookSnapshotsResponse,
} from "./workbook-types";

function base(): string {
  return getApiUrl().replace(/\/$/, "");
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json() as T | ApiErrorResponse;
  if (!res.ok) {
    const errBody = data as ApiErrorResponse;
    throw new Error(errBody.error || `Request failed — HTTP ${res.status}`);
  }
  return data as T;
}

export async function fetchSnapshots(): Promise<WorkbookSnapshotsResponse> {
  const headers = await makeApiHeaders();
  const res = await fetch(`${base()}/api/snapshots`, { method: "GET", headers });
  return parseJsonOrThrow<WorkbookSnapshotsResponse>(res);
}

export async function fetchActiveSnapshot(): Promise<ActiveWorkbookResponse> {
  const headers = await makeApiHeaders();
  const res = await fetch(`${base()}/api/snapshots/active`, { method: "GET", headers });
  return parseJsonOrThrow<ActiveWorkbookResponse>(res);
}

export async function activateSnapshot(
  snapshotId: number
): Promise<ActivateWorkbookResponse> {
  const headers = await makeApiHeaders();
  const res = await fetch(`${base()}/api/workbooks/${snapshotId}/activate`, {
    method: "PATCH",
    headers,
  });
  return parseJsonOrThrow<ActivateWorkbookResponse>(res);
}

export async function deleteSnapshot(snapshotId: number): Promise<void> {
  const headers = await makeApiHeaders();
  const res = await fetch(`${base()}/api/snapshots/${snapshotId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const body = await res.json() as ApiErrorResponse;
    throw new Error(body.error || `Delete failed — HTTP ${res.status}`);
  }
}

export async function uploadWorkbook(params: {
  fileUri: string;
  fileName: string;
  mimeType?: string;
  versionTag?: string | null;
}): Promise<UploadWorkbookResponse> {
  const headers = await makeApiHeaders();

  const mime =
    params.mimeType ||
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const formData = new FormData();
  if (Platform.OS === "web") {
    const resp = await fetch(params.fileUri);
    const blob = await resp.blob();
    formData.append("file", new File([blob], params.fileName, { type: mime }));
  } else {
    formData.append("file", {
      uri: params.fileUri,
      name: params.fileName,
      type: mime,
    } as any);
  }

  if (params.versionTag?.trim()) {
    formData.append("versionTag", params.versionTag.trim());
  }

  const multipartHeaders = { ...headers } as Record<string, string>;
  delete multipartHeaders["Content-Type"];

  const res = await fetch(`${base()}/api/upload-workbook`, {
    method: "POST",
    headers: multipartHeaders,
    body: formData,
  });

  return parseJsonOrThrow<UploadWorkbookResponse>(res);
}
