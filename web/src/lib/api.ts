export type JsonRecord = Record<string, unknown>;

export async function fetchJson<T = JsonRecord>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json()) as JsonRecord;
  if (!response.ok) throw new Error(readText(data.error) || `Request failed: ${response.status}`);
  return data as T;
}

export function readRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function readText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  return readText(value) || "-";
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
