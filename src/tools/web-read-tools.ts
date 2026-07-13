import type { AppConfig, InternalToolPolicy } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { reviewActionPermission, type PermissionApprover } from "../safety/permission-policy.js";

export interface WebReadToolOptions {
  config: AppConfig;
  paths: RuntimePaths;
  approver?: PermissionApprover;
}

export interface ReadUrlResult {
  allowed: boolean;
  reason: string;
  url: string;
  statusCode?: number;
  contentType?: string;
  content?: string;
  truncated: boolean;
}

const MAX_READ_URL_BYTES = 128 * 1024;
const MAX_READ_URL_TIMEOUT_MS = 15_000;

export async function readUrlTool(options: WebReadToolOptions & { url: string; maxBytes?: number; timeoutMs?: number }): Promise<ReadUrlResult> {
  const url = parseHttpUrl(options.url);
  if (!url) {
    return { allowed: false, reason: "internal.read_url requires an http or https URL.", url: options.url, truncated: false };
  }

  const permission = await reviewWebToolPermission(options, "internal.read_url", url.toString(), "Read a web page requested by the agent.");
  if (!permission.allowed) return { ...permission, url: url.toString(), truncated: false };

  const maxBytes = Math.min(Math.max(options.maxBytes ?? MAX_READ_URL_BYTES, 1), MAX_READ_URL_BYTES);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 10_000, 1), MAX_READ_URL_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "bestie/0.1 read_url" },
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    const text = await response.text();
    const { content, truncated } = truncateUtf8(text, maxBytes);

    return {
      allowed: true,
      reason: permission.reason,
      url: response.url,
      statusCode: response.status,
      contentType,
      content,
      truncated,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "URL read timed out." : error instanceof Error ? error.message : "Unknown URL read error.";
    return { allowed: false, reason: message, url: url.toString(), truncated: false };
  } finally {
    clearTimeout(timer);
  }
}

async function reviewWebToolPermission(options: WebReadToolOptions, toolName: string, target: string, reason: string): Promise<{ allowed: boolean; reason: string }> {
  const configured = getInternalToolPolicy(options.config, toolName);
  if (configured === "deny") {
    return { allowed: false, reason: `${toolName} is denied by config.` };
  }
  if (configured === "allow") {
    return { allowed: true, reason: `${toolName} is allowed by config.` };
  }

  const permission = await reviewActionPermission(
    { category: "read", action: toolName, target, reason, trusted: false, payloadJson: JSON.stringify({ tool: toolName, arguments: { url: target } }) },
    { paths: options.paths, approver: options.approver, policy: { allowTrustedRead: false, allowLocalWrite: false } },
  );

  return { allowed: permission.decision === "allow", reason: permission.reason };
}

function getInternalToolPolicy(config: AppConfig, toolName: string): InternalToolPolicy {
  return config.internalTools?.policies?.[toolName] ?? "ask";
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function truncateUtf8(value: string, maxBytes: number): { content: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return { content: value, truncated: false };
  }
  return { content: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}
