import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { BrowserContext, Page, chromium as PlaywrightChromium } from "playwright";

import type { AppConfig } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { getAgentWorkspacePath } from "../runtime/workspace.js";
import { appendLog } from "../runtime/logger.js";
import type { PermissionApprover } from "../safety/permission-policy.js";

export type BrowserActionRisk = "read" | "external_write" | "public_action" | "destructive" | "money";

export interface BrowserToolOptions {
  config: AppConfig;
  paths: RuntimePaths;
  approver?: PermissionApprover;
}

export interface BrowserToolResult {
  allowed: boolean;
  reason: string;
  url?: string;
  title?: string;
  screenshotPath?: string;
  text?: string;
  elements?: BrowserElementSummary[];
}

export interface BrowserElementSummary {
  kind: "link" | "button" | "input" | "textarea" | "select";
  text?: string;
  href?: string;
  name?: string;
  placeholder?: string;
  type?: string;
}

type Chromium = typeof PlaywrightChromium;

const DEFAULT_BROWSER_TIMEOUT_MS = 15_000;
const MAX_BROWSER_TIMEOUT_MS = 45_000;
const MAX_SNAPSHOT_TEXT_CHARS = 12_000;
const MAX_ELEMENTS = 80;
const BROWSER_ALLOWED_REASON = "Browser tools are allowed without approval.";

export async function openBrowserPageTool(options: BrowserToolOptions & { url: string; width?: number; height?: number; timeoutMs?: number }): Promise<BrowserToolResult> {
  const url = parseHttpUrl(options.url);
  if (!url) return { allowed: false, reason: "internal.browser_open requires an http or https URL." };

  return withBrowserPage(options, async (page) => {
    await page.setViewportSize({ width: clampInteger(options.width, 320, 2400, 1280), height: clampInteger(options.height, 320, 1800, 900) });
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: browserTimeout(options.timeoutMs) });
    await waitForSettledPage(page, options.timeoutMs);
    const result = await pageSummary(page, options, "open");
    await logBrowserCall(options, "internal.browser_open", url.toString(), true, result.screenshotPath);
    return { allowed: true, reason: BROWSER_ALLOWED_REASON, ...result };
  });
}

export async function snapshotBrowserPageTool(options: BrowserToolOptions & { timeoutMs?: number }): Promise<BrowserToolResult> {
  return withBrowserPage(options, async (page) => {
    const currentUrl = parseHttpUrl(page.url());
    if (!currentUrl) return { allowed: false, reason: "No current browser page is open." };
    await waitForSettledPage(page, options.timeoutMs);
    const result = await pageSummary(page, options, "snapshot");
    await logBrowserCall(options, "internal.browser_snapshot", currentUrl.toString(), true, result.screenshotPath);
    return { allowed: true, reason: BROWSER_ALLOWED_REASON, ...result };
  });
}

export async function clickBrowserPageTool(options: BrowserToolOptions & { selector?: string; text?: string; role?: "button" | "link" | "textbox" | "checkbox" | "menuitem"; index?: number; risk?: BrowserActionRisk; reason?: string; timeoutMs?: number }): Promise<BrowserToolResult> {
  return withBrowserPage(options, async (page) => {
    const currentUrl = parseHttpUrl(page.url());
    if (!currentUrl) return { allowed: false, reason: "No current browser page is open." };

    const locator = buildLocator(page, options);
    if (!locator) return { allowed: false, reason: "internal.browser_click requires arguments.selector, arguments.text, or arguments.role." };
    await locator.nth(Math.max((options.index ?? 0), 0)).click({ timeout: browserTimeout(options.timeoutMs) });
    await waitForSettledPage(page, options.timeoutMs);
    const result = await pageSummary(page, options, "click");
    await logBrowserCall(options, "internal.browser_click", page.url(), true, result.screenshotPath);
    return { allowed: true, reason: BROWSER_ALLOWED_REASON, ...result };
  });
}

export async function typeBrowserPageTool(options: BrowserToolOptions & { selector?: string; text: string; clear?: boolean; submit?: boolean; sensitive?: boolean; reason?: string; timeoutMs?: number }): Promise<BrowserToolResult> {
  return withBrowserPage(options, async (page) => {
    const currentUrl = parseHttpUrl(page.url());
    if (!currentUrl) return { allowed: false, reason: "No current browser page is open." };
    if (!options.selector) return { allowed: false, reason: "internal.browser_type requires arguments.selector." };

    const locator = page.locator(options.selector).first();
    if (options.clear) await locator.fill("", { timeout: browserTimeout(options.timeoutMs) });
    await locator.fill(options.text, { timeout: browserTimeout(options.timeoutMs) });
    if (options.submit) await locator.press("Enter", { timeout: browserTimeout(options.timeoutMs) });
    await waitForSettledPage(page, options.timeoutMs);
    const result = await pageSummary(page, options, "type");
    await logBrowserCall(options, "internal.browser_type", page.url(), true, result.screenshotPath);
    return { allowed: true, reason: BROWSER_ALLOWED_REASON, ...result };
  });
}

export async function screenshotBrowserPageTool(options: BrowserToolOptions & { timeoutMs?: number }): Promise<BrowserToolResult> {
  return withBrowserPage(options, async (page) => {
    const currentUrl = parseHttpUrl(page.url());
    if (!currentUrl) return { allowed: false, reason: "No current browser page is open." };
    const screenshotPath = await saveScreenshot(page, options, "manual");
    await logBrowserCall(options, "internal.browser_screenshot", currentUrl.toString(), true, screenshotPath);
    return { allowed: true, reason: BROWSER_ALLOWED_REASON, url: currentUrl.toString(), title: await page.title(), screenshotPath };
  });
}

export async function resetBrowserSessionTool(options: BrowserToolOptions): Promise<BrowserToolResult> {
  await rm(browserSessionDir(options), { recursive: true, force: true });
  await logBrowserCall(options, "internal.browser_reset", "isolated browser session", true);
  return { allowed: true, reason: BROWSER_ALLOWED_REASON };
}

async function withBrowserPage(options: BrowserToolOptions, run: (page: Page) => Promise<BrowserToolResult>): Promise<BrowserToolResult> {
  let context: BrowserContext | undefined;
  try {
    const chromium = await loadChromium();
    const userDataDir = browserSessionDir(options);
    await mkdir(userDataDir, { recursive: true });
    context = await chromium.launchPersistentContext(userDataDir, { headless: true, viewport: { width: 1280, height: 900 } });
    const page = context.pages()[0] ?? await context.newPage();
    return await run(page);
  } catch (error) {
    await logBrowserCall(options, "internal.browser_runtime", "browser", false);
    return { allowed: false, reason: `Browser tool failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function loadChromium(): Promise<Chromium> {
  try {
    const playwright = await import("playwright");
    return playwright.chromium as Chromium;
  } catch {
    throw new Error("Playwright is not installed. Install project dependencies before using browser tools.");
  }
}

async function pageSummary(page: Page, options: BrowserToolOptions, label: string): Promise<Omit<BrowserToolResult, "allowed" | "reason">> {
  const [title, text, elements, screenshotPath] = await Promise.all([
    page.title(),
    page.locator("body").innerText({ timeout: 2_000 }).catch(() => ""),
    summarizeElements(page),
    saveScreenshot(page, options, label),
  ]);
  return { url: page.url(), title, text: truncateChars(text, MAX_SNAPSHOT_TEXT_CHARS), elements, screenshotPath };
}

async function summarizeElements(page: Page): Promise<BrowserElementSummary[]> {
  return page.evaluate((limit) => {
    const values: BrowserElementSummary[] = [];
    const push = (entry: BrowserElementSummary) => {
      if (values.length < limit) values.push(entry);
    };
    document.querySelectorAll("a,button,input,textarea,select").forEach((element) => {
      if (element instanceof HTMLAnchorElement) push({ kind: "link", text: element.innerText.trim() || element.getAttribute("aria-label") || undefined, href: element.href || undefined });
      else if (element instanceof HTMLButtonElement) push({ kind: "button", text: element.innerText.trim() || element.getAttribute("aria-label") || undefined, type: element.type || undefined });
      else if (element instanceof HTMLInputElement) push({ kind: "input", name: element.name || undefined, placeholder: element.placeholder || undefined, type: element.type || undefined });
      else if (element instanceof HTMLTextAreaElement) push({ kind: "textarea", name: element.name || undefined, placeholder: element.placeholder || undefined });
      else if (element instanceof HTMLSelectElement) push({ kind: "select", name: element.name || undefined });
    });
    return values;
  }, MAX_ELEMENTS).catch(() => []);
}

function buildLocator(page: Page, options: { selector?: string; text?: string; role?: "button" | "link" | "textbox" | "checkbox" | "menuitem" }) {
  if (options.selector) return page.locator(options.selector);
  if (options.role && options.text) return page.getByRole(options.role, { name: options.text });
  if (options.role) return page.getByRole(options.role);
  if (options.text) return page.getByText(options.text);
  return undefined;
}

async function saveScreenshot(page: Page, options: BrowserToolOptions, label: string): Promise<string> {
  const path = resolve(browserEvidenceDir(options), `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function waitForSettledPage(page: Page, timeoutMs: number | undefined): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: Math.min(browserTimeout(timeoutMs), 5_000) }).catch(() => undefined);
}

function browserSessionDir(options: BrowserToolOptions): string {
  return resolve(getAgentWorkspacePath(options.config, options.paths), "browser", "session");
}

function browserEvidenceDir(options: BrowserToolOptions): string {
  return resolve(getAgentWorkspacePath(options.config, options.paths), "browser", "evidence");
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function browserTimeout(value: number | undefined): number {
  return clampInteger(value, 1, MAX_BROWSER_TIMEOUT_MS, DEFAULT_BROWSER_TIMEOUT_MS);
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value as number, min), max);
}

function truncateChars(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`;
}

async function logBrowserCall(options: BrowserToolOptions, tool: string, target: string, ok: boolean, screenshotPath?: string): Promise<void> {
  await appendLog({ event: "browser_tool_call", detail: { tool, target, ok, screenshotPath } }, { paths: options.paths });
}
