import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import type { AppConfig, InternalToolPolicy, MediaGenerationProviderConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { getAgentWorkspacePath, resolveSandboxPath } from "../runtime/workspace.js";
import { reviewActionPermission, type PermissionApprover } from "../safety/permission-policy.js";

export interface MediaGenerationToolOptions {
  config: AppConfig;
  paths: RuntimePaths;
  env?: Record<string, string>;
  approver?: PermissionApprover;
  fetchImpl?: typeof fetch;
}

export interface GeneratedMediaAsset {
  path: string;
  mimeType: string;
  bytes: number;
  sourceUrl?: string;
  revisedPrompt?: string;
}

export interface MediaGenerationResult {
  allowed: boolean;
  reason: string;
  provider?: string;
  model?: string;
  prompt?: string;
  assets: GeneratedMediaAsset[];
}

type MediaKind = "image" | "video";

const DEFAULT_MEDIA_GENERATION_TIMEOUT_MS = 120_000;
const MAX_GENERATION_PROMPT_BYTES = 16 * 1024;
const MAX_GENERATED_ASSET_BYTES = 100 * 1024 * 1024;

export async function imageGenerateTool(options: MediaGenerationToolOptions & { prompt: string; size?: string; quality?: string; style?: string; count?: number; outputPath?: string }): Promise<MediaGenerationResult> {
  const provider = options.config.generation?.image;
  if (!provider) {
    return { allowed: false, reason: "generation.image is not configured.", assets: [] };
  }

  return generateMedia({
    kind: "image",
    provider,
    options,
    request: {
      prompt: options.prompt,
      ...(options.size === undefined ? {} : { size: options.size }),
      ...(options.quality === undefined ? {} : { quality: options.quality }),
      ...(options.style === undefined ? {} : { style: options.style }),
      n: normalizeCount(options.count),
      response_format: "b64_json",
    },
    outputPath: options.outputPath,
  });
}

export async function videoGenerateTool(options: MediaGenerationToolOptions & { prompt: string; durationSeconds?: number; aspectRatio?: string; size?: string; count?: number; outputPath?: string }): Promise<MediaGenerationResult> {
  const provider = options.config.generation?.video;
  if (!provider) {
    return { allowed: false, reason: "generation.video is not configured.", assets: [] };
  }

  return generateMedia({
    kind: "video",
    provider,
    options,
    request: {
      prompt: options.prompt,
      ...(options.durationSeconds === undefined ? {} : { duration: options.durationSeconds }),
      ...(options.aspectRatio === undefined ? {} : { aspect_ratio: options.aspectRatio }),
      ...(options.size === undefined ? {} : { size: options.size }),
      n: normalizeCount(options.count),
      response_format: "b64_json",
    },
    outputPath: options.outputPath,
  });
}

async function generateMedia(input: { kind: MediaKind; provider: MediaGenerationProviderConfig; options: MediaGenerationToolOptions; request: Record<string, unknown>; outputPath?: string }): Promise<MediaGenerationResult> {
  const prompt = typeof input.request.prompt === "string" ? input.request.prompt.trim() : "";
  if (!prompt) {
    return { allowed: false, reason: `internal.${input.kind}_generate requires arguments.prompt.`, assets: [] };
  }
  if (Buffer.byteLength(prompt, "utf8") > MAX_GENERATION_PROMPT_BYTES) {
    return { allowed: false, reason: `Generation prompt exceeds ${MAX_GENERATION_PROMPT_BYTES} bytes.`, assets: [] };
  }

  const permission = await reviewGenerationPermission(input.kind, input.options, prompt, input.request);
  if (!permission.allowed) {
    return { ...permission, assets: [] };
  }

  const apiKey = resolveApiKey(input.provider, input.options.env ?? {});
  if (!apiKey) {
    return { allowed: false, reason: `${input.kind} generation API key env ${input.provider.apiKeyEnv} is missing.`, provider: input.provider.provider, model: input.provider.model, prompt, assets: [] };
  }

  const fetchImpl = input.options.fetchImpl ?? fetch;
  const endpoint = buildProviderEndpoint(input.provider, input.kind);
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ ...input.request, model: input.provider.model }),
    }, input.provider.timeoutMs ?? DEFAULT_MEDIA_GENERATION_TIMEOUT_MS);
  } catch (error) {
    return { allowed: false, reason: `${input.kind} generation provider request failed: ${formatUnknownError(error)}`, provider: input.provider.provider, model: input.provider.model, prompt, assets: [] };
  }

  if (!response.ok) {
    return { allowed: false, reason: `${input.kind} generation provider failed: ${await formatProviderError(response)}`, provider: input.provider.provider, model: input.provider.model, prompt, assets: [] };
  }

  const payload = await response.json().catch(() => undefined) as unknown;
  const items = extractGeneratedMediaItems(payload);
  if (items.length === 0) {
    return { allowed: false, reason: `${input.kind} generation provider returned no downloadable media.`, provider: input.provider.provider, model: input.provider.model, prompt, assets: [] };
  }

  const assets: GeneratedMediaAsset[] = [];
  try {
    for (const [index, item] of items.entries()) {
      const asset = await materializeGeneratedMediaItem({ item, index, total: items.length, kind: input.kind, outputPath: input.outputPath, options: input.options, fetchImpl });
      assets.push(asset);
    }
  } catch (error) {
    return { allowed: false, reason: `${input.kind} generation output could not be saved: ${formatUnknownError(error)}`, provider: input.provider.provider, model: input.provider.model, prompt, assets };
  }

  return { allowed: true, reason: `${input.kind} generation completed.`, provider: input.provider.provider, model: input.provider.model, prompt, assets };
}

async function materializeGeneratedMediaItem(input: { item: GeneratedMediaItem; index: number; total: number; kind: MediaKind; outputPath?: string; options: MediaGenerationToolOptions; fetchImpl: typeof fetch }): Promise<GeneratedMediaAsset> {
  const downloaded = input.item.b64Json
    ? { bytes: Buffer.from(input.item.b64Json, "base64"), mimeType: input.item.mimeType ?? defaultMimeType(input.kind), sourceUrl: undefined }
    : await downloadGeneratedMedia(input.fetchImpl, input.item.url ?? "", input.kind);

  if (downloaded.bytes.length > MAX_GENERATED_ASSET_BYTES) {
    throw new Error(`Generated ${input.kind} exceeds ${MAX_GENERATED_ASSET_BYTES} bytes.`);
  }

  const path = await resolveGeneratedMediaPath(input.options, input.kind, downloaded.mimeType, input.outputPath, input.index, input.total);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, downloaded.bytes, { mode: 0o600 });
  return { path, mimeType: downloaded.mimeType, bytes: downloaded.bytes.length, ...(downloaded.sourceUrl === undefined ? {} : { sourceUrl: downloaded.sourceUrl }), ...(input.item.revisedPrompt === undefined ? {} : { revisedPrompt: input.item.revisedPrompt }) };
}

async function downloadGeneratedMedia(fetchImpl: typeof fetch, url: string, kind: MediaKind): Promise<{ bytes: Buffer; mimeType: string; sourceUrl: string }> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Generated ${kind} item did not include b64_json or an HTTP(S) URL.`);
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Generated ${kind} URL download failed: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, mimeType: response.headers.get("content-type") ?? defaultMimeType(kind), sourceUrl: url };
}

interface GeneratedMediaItem {
  b64Json?: string;
  url?: string;
  mimeType?: string;
  revisedPrompt?: string;
}

function extractGeneratedMediaItems(payload: unknown): GeneratedMediaItem[] {
  const rawItems = isRecord(payload) && Array.isArray(payload.data) ? payload.data : isRecord(payload) && Array.isArray(payload.output) ? payload.output : isRecord(payload) ? [payload] : [];
  return rawItems.flatMap((item) => {
    if (!isRecord(item)) return [];
    const b64Json = stringField(item, "b64_json") ?? stringField(item, "b64Json");
    const url = stringField(item, "url") ?? (isRecord(item.video) ? stringField(item.video, "url") : undefined) ?? (isRecord(item.image) ? stringField(item.image, "url") : undefined);
    if (!b64Json && !url) return [];
    return [{ ...(b64Json === undefined ? {} : { b64Json }), ...(url === undefined ? {} : { url }), ...(stringField(item, "mime_type") ?? stringField(item, "mimeType") ? { mimeType: stringField(item, "mime_type") ?? stringField(item, "mimeType") } : {}), ...(stringField(item, "revised_prompt") ? { revisedPrompt: stringField(item, "revised_prompt") } : {}) }];
  });
}

async function reviewGenerationPermission(kind: MediaKind, options: MediaGenerationToolOptions, prompt: string, payload: Record<string, unknown>): Promise<{ allowed: boolean; reason: string }> {
  const toolName = `internal.${kind}_generate`;
  const configured = getInternalToolPolicy(options.config, toolName);
  if (configured === "deny") {
    return { allowed: false, reason: `${toolName} is denied by config.` };
  }
  if (configured === "allow") {
    return { allowed: true, reason: `${toolName} is allowed by config.` };
  }

  const permission = await reviewActionPermission(
    { category: "external_write", action: toolName, target: `${kind} generation provider`, reason: `Generate ${kind} media from a model prompt.`, trusted: false, payloadJson: JSON.stringify({ tool: toolName, arguments: payloadWithBoundedPrompt(payload, prompt) }) },
    { paths: options.paths, approver: options.approver, policy: { allowTrustedRead: false, allowLocalWrite: false } },
  );
  return { allowed: permission.decision === "allow", reason: permission.reason };
}

function payloadWithBoundedPrompt(payload: Record<string, unknown>, prompt: string): Record<string, unknown> {
  return { ...payload, prompt: prompt.length > 500 ? `${prompt.slice(0, 500)}...` : prompt };
}

function getInternalToolPolicy(config: AppConfig, toolName: string): InternalToolPolicy {
  return config.internalTools?.policies?.[toolName] ?? "ask";
}

function resolveApiKey(provider: MediaGenerationProviderConfig, env: Record<string, string>): string | undefined {
  return process.env[provider.apiKeyEnv] ?? env[provider.apiKeyEnv];
}

function buildProviderEndpoint(provider: MediaGenerationProviderConfig, kind: MediaKind): string {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const endpointPath = (provider.endpointPath ?? (kind === "image" ? "/images/generations" : "/videos/generations")).replace(/^\/?/, "/");
  return `${baseUrl}${endpointPath}`;
}

async function resolveGeneratedMediaPath(options: MediaGenerationToolOptions, kind: MediaKind, mimeType: string, outputPath: string | undefined, index: number, total: number): Promise<string> {
  const extension = extensionForMimeType(mimeType, kind);
  if (outputPath) {
    const indexedPath = total > 1 ? appendIndexBeforeExtension(outputPath, index + 1) : outputPath;
    return ensureExtension(await resolveSandboxPath({ config: options.config, paths: options.paths, inputPath: indexedPath, defaultBase: "workspace", access: "write" }), extension);
  }

  return resolve(getAgentWorkspacePath(options.config, options.paths), "media", "generated", kind === "image" ? "images" : "videos", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}${extension}`);
}

function appendIndexBeforeExtension(path: string, index: number): string {
  const extension = extname(path);
  return extension ? `${path.slice(0, -extension.length)}-${index}${extension}` : `${path}-${index}`;
}

function ensureExtension(path: string, extension: string): string {
  return extname(path) ? path : `${path}${extension}`;
}

function extensionForMimeType(mimeType: string, kind: MediaKind): string {
  if (/png/i.test(mimeType)) return ".png";
  if (/jpe?g/i.test(mimeType)) return ".jpg";
  if (/webp/i.test(mimeType)) return ".webp";
  if (/gif/i.test(mimeType)) return ".gif";
  if (/webm/i.test(mimeType)) return ".webm";
  if (/quicktime|mov/i.test(mimeType)) return ".mov";
  if (/mp4|mpeg4/i.test(mimeType)) return ".mp4";
  return kind === "image" ? ".png" : ".mp4";
}

function defaultMimeType(kind: MediaKind): string {
  return kind === "image" ? "image/png" : "video/mp4";
}

function normalizeCount(value: number | undefined): number {
  return Math.min(Math.max(value ?? 1, 1), 4);
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function formatProviderError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `${response.status} ${response.statusText}${body ? `: ${body.slice(0, 500)}` : ""}`;
}

function stringField(value: Record<string, unknown>, field: string): string | undefined {
  return typeof value[field] === "string" && value[field].trim().length > 0 ? value[field] : undefined;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
