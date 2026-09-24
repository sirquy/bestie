import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Browser, BrowserContext, Page, chromium as PlaywrightChromium } from "playwright";

import type { AppConfig, InternalToolPolicy } from "../runtime/config.js";
import type { RuntimePaths } from "../runtime/paths.js";
import { getAgentWorkspacePath } from "../runtime/workspace.js";
import { appendLog } from "../runtime/logger.js";
import { reviewActionPermission, type ActionCategory, type PermissionApprover } from "../safety/permission-policy.js";

export type BrowserActionRisk = "read" | "external_write" | "public_action" | "destructive" | "money";

export interface BrowserToolOptions {
  config: AppConfig;
  paths: RuntimePaths;
  approver?: PermissionApprover;
  pageIndex?: number;
}

export interface BrowserToolResult {
  allowed: boolean;
  reason: string;
  url?: string;
  title?: string;
  screenshotPath?: string;
  text?: string;
  elements?: BrowserElementSummary[];
  pages?: BrowserPageSummary[];
}

export interface BrowserPageSummary {
  index: number;
  url: string;
  title: string;
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
const BROWSER_ALLOWED_REASON = "Browser action is allowed by policy.";
function extractBrowserElements(limit: number): BrowserElementSummary[] {
  return Array.from(document.querySelectorAll("a,button,input,textarea,select")).slice(0, limit).map((element) => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "a") {
      const anchor = element as HTMLAnchorElement;
      return { kind: "link", text: anchor.innerText.trim() || anchor.getAttribute("aria-label") || undefined, href: anchor.href || undefined };
    }
    if (tagName === "button") {
      const button = element as HTMLButtonElement;
      return { kind: "button", text: button.innerText.trim() || button.getAttribute("aria-label") || undefined, type: button.type || undefined };
    }
    if (tagName === "input") {
      const input = element as HTMLInputElement;
      return { kind: "input", name: input.name || undefined, placeholder: input.placeholder || undefined, type: input.type || undefined };
    }
    if (tagName === "textarea") {
      const textarea = element as HTMLTextAreaElement;
      return { kind: "textarea", name: textarea.name || undefined, placeholder: textarea.placeholder || undefined };
    }
    const select = element as HTMLSelectElement;
    return { kind: "select", name: select.name || undefined };
  });
}

export async function openBrowserPageTool(options: BrowserToolOptions & { url: string; width?: number; height?: number; pageIndex?: number; timeoutMs?: number }): Promise<BrowserToolResult> {
  const url = parseHttpUrl(options.url);
  if (!url) return { allowed: false, reason: "internal.browser_open requires an http or https URL." };

  const permission = await reviewBrowserToolPermission(options, "internal.browser_open", "read", url.toString(), "Open a web page in the isolated browser requested by the agent.", { url: url.toString(), width: options.width, height: options.height, pageIndex: options.pageIndex, timeoutMs: options.timeoutMs });
  if (!permission.allowed) return permission;

  return withBrowserPage(options, async (page) => {
    await page.setViewportSize({ width: clampInteger(options.width, 320, 2400, 1280), height: clampInteger(options.height, 320, 1800, 900) });
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: browserTimeout(options.timeoutMs) });
    await waitForSettledPage(page, options.timeoutMs);
    const result = await pageSummary(page, options, "open");
    await logBrowserCall(options, "internal.browser_open", url.toString(), true, result.screenshotPath);
    return { allowed: true, reason: permission.reason, ...result };
  });
}

export async function snapshotBrowserPageTool(options: BrowserToolOptions & { pageIndex?: number; timeoutMs?: number }): Promise<BrowserToolResult> {
  const permission = await reviewBrowserToolPermission(options, "internal.browser_snapshot", "read", "browser page", "Read the current browser page requested by the agent.", { pageIndex: options.pageIndex, timeoutMs: options.timeoutMs });
  if (!permission.allowed) return permission;

  return withBrowserPage(options, async (page) => {
    const currentUrl = parseHttpUrl(page.url());
    if (!currentUrl) return { allowed: false, reason: "No current browser page is open." };
    await waitForSettledPage(page, options.timeoutMs);
    const result = await pageSummary(page, options, "snapshot");
    await logBrowserCall(options, "internal.browser_snapshot", currentUrl.toString(), true, result.screenshotPath);
    return { allowed: true, reason: permission.reason, ...result };
  });
}

export async function clickBrowserPageTool(options: BrowserToolOptions & { selector?: string; text?: string; role?: "button" | "link" | "textbox" | "checkbox" | "menuitem"; index?: number; pageIndex?: number; risk?: BrowserActionRisk; reason?: string; timeoutMs?: number }): Promise<BrowserToolResult> {
  const target = options.selector ?? options.text ?? options.role ?? "browser element";
  const category: ActionCategory = options.risk ?? "external_write";
  const permission = await reviewBrowserToolPermission(options, "internal.browser_click", category, target, options.reason ?? "Click a browser control requested by the agent.", { selector: options.selector, text: options.text, role: options.role, index: options.index, pageIndex: options.pageIndex, risk: options.risk, reason: options.reason, timeoutMs: options.timeoutMs });
  if (!permission.allowed) return permission;

  return withBrowserPage(options, async (page) => {
    const currentUrl = parseHttpUrl(page.url());
    if (!currentUrl) return { allowed: false, reason: "No current browser page is open." };

    const locator = buildLocator(page, options);
    if (!locator) return { allowed: false, reason: "internal.browser_click requires arguments.selector, arguments.text, or arguments.role." };
    await locator.nth(Math.max((options.index ?? 0), 0)).click({ timeout: browserTimeout(options.timeoutMs) });
    await waitForSettledPage(page, options.timeoutMs);
    const result = await pageSummary(page, options, "click");
    await logBrowserCall(options, "internal.browser_click", page.url(), true, result.screenshotPath);
    return { allowed: true, reason: permission.reason, ...result };
  });
}

export async function typeBrowserPageTool(options: BrowserToolOptions & { selector?: string; text: string; clear?: boolean; submit?: boolean; sensitive?: boolean; reason?: string; pageIndex?: number; timeoutMs?: number }): Promise<BrowserToolResult> {
  const target = options.selector ?? "browser field";
  const permission = await reviewBrowserToolPermission(options, "internal.browser_type", "external_write", target, options.reason ?? "Type into a browser form requested by the agent.", { selector: options.selector, text: options.sensitive ? "[redacted]" : options.text, clear: options.clear, submit: options.submit, sensitive: options.sensitive, pageIndex: options.pageIndex, timeoutMs: options.timeoutMs });
  if (!permission.allowed) return permission;

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
    return { allowed: true, reason: permission.reason, ...result };
  });
}

export async function screenshotBrowserPageTool(options: BrowserToolOptions & { pageIndex?: number; timeoutMs?: number }): Promise<BrowserToolResult> {
  const permission = await reviewBrowserToolPermission(options, "internal.browser_screenshot", "read", "browser page", "Capture browser evidence requested by the agent.", { pageIndex: options.pageIndex, timeoutMs: options.timeoutMs });
  if (!permission.allowed) return permission;

  return withBrowserPage(options, async (page) => {
    const currentUrl = parseHttpUrl(page.url());
    if (!currentUrl) return { allowed: false, reason: "No current browser page is open." };
    const screenshotPath = await saveScreenshot(page, options, "manual");
    await logBrowserCall(options, "internal.browser_screenshot", currentUrl.toString(), true, screenshotPath);
    return { allowed: true, reason: permission.reason, url: currentUrl.toString(), title: await page.title(), screenshotPath };
  });
}

export async function resetBrowserSessionTool(options: BrowserToolOptions): Promise<BrowserToolResult> {
  const permission = await reviewBrowserToolPermission(options, "internal.browser_reset", "local_write", "browser session", "Clear the isolated browser session requested by the agent.", {});
  if (!permission.allowed) return permission;
  if (browserCdpEndpoint(options)) {
    await logBrowserCall(options, "internal.browser_reset", "configured CDP browser", true);
    return { allowed: true, reason: "Configured CDP browser remains unchanged; close tabs or clear data in that browser directly." };
  }
  await rm(browserSessionDir(options), { recursive: true, force: true });
  await logBrowserCall(options, "internal.browser_reset", "isolated browser session", true);
  return { allowed: true, reason: permission.reason };
}

export async function listBrowserPagesTool(options: BrowserToolOptions): Promise<BrowserToolResult> {
  const permission = await reviewBrowserToolPermission(options, "internal.browser_list_pages", "read", "browser pages", "List open browser pages requested by the agent.", {});
  if (!permission.allowed) return permission;

  return withBrowserContext(options, async (context) => {
    const pages = await Promise.all(context.pages().map(async (page, index) => ({ index, url: page.url(), title: await page.title().catch(() => "") })));
    await logBrowserCall(options, "internal.browser_list_pages", browserCdpEndpoint(options) ? "configured CDP browser" : "isolated browser session", true);
    return { allowed: true, reason: permission.reason, pages };
  });
}


async function reviewBrowserToolPermission(
  options: BrowserToolOptions,
  toolName: string,
  category: ActionCategory,
  target: string,
  reason: string,
  argumentsValue: Record<string, unknown>,
): Promise<BrowserToolResult> {
  const configured = getBrowserToolPolicy(options.config, toolName, category);
  if (configured === "deny") return { allowed: false, reason: `${toolName} is denied by config.` };
  if (configured === "allow") return { allowed: true, reason: `${toolName} is allowed by config.` };

  const permission = await reviewActionPermission(
    { category, action: toolName, target, reason, trusted: category === "read", payloadJson: JSON.stringify({ tool: toolName, arguments: argumentsValue }) },
    { paths: options.paths, approver: options.approver, policy: { allowTrustedRead: false, allowLocalWrite: false } },
  );
  return { allowed: permission.decision === "allow", reason: permission.reason };
}

function getBrowserToolPolicy(config: AppConfig, toolName: string, category: ActionCategory): InternalToolPolicy {
  const configured = config.internalTools?.policies?.[toolName];
  if (configured) return configured;
  return category === "read" ? "allow" : "ask";
}

async function withBrowserPage(options: BrowserToolOptions, run: (page: Page) => Promise<BrowserToolResult>): Promise<BrowserToolResult> {
  return withBrowserContext(options, async (context) => {
    const page = selectBrowserPage(context, options.pageIndex);
    if (options.pageIndex !== undefined && !page) throw new Error(`Browser page index ${options.pageIndex} does not exist.`);
    return run(page ?? await context.newPage());
  });
}

async function withBrowserContext(options: BrowserToolOptions, run: (context: BrowserContext) => Promise<BrowserToolResult>): Promise<BrowserToolResult> {
  let context: BrowserContext | undefined;
  let browser: Browser | undefined;
  try {
    const chromium = await loadChromium();
    const cdpEndpoint = browserCdpEndpoint(options);
    if (cdpEndpoint) {
      browser = await chromium.connectOverCDP(cdpEndpoint);
      context = browser.contexts()[0];
      if (!context) throw new Error("Configured CDP browser has no browser context.");
    } else {
      const userDataDir = browserSessionDir(options);
      await mkdir(userDataDir, { recursive: true });
      context = await chromium.launchPersistentContext(userDataDir, { headless: true, viewport: { width: 1280, height: 900 } });
    }
    return await run(context);
  } catch (error) {
    await logBrowserCall(options, "internal.browser_runtime", browserCdpEndpoint(options) ? "configured CDP browser" : "isolated browser", false);
    return { allowed: false, reason: formatBrowserRuntimeError(error) };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    else await context?.close().catch(() => undefined);
  }
}

function formatBrowserRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|executable doesn't exist|Please run the following command|Failed to launch|spawn (UNKNOWN|ENOENT|EACCES)/i.test(message)) {
    return `Browser tool failed: Chromium is not installed for Playwright. Run "npx playwright install chromium". Details: ${message}`;
  }
  if (/connectOverCDP|ECONNREFUSED|WebSocket/i.test(message)) {
    return `Browser tool failed: could not connect to the configured browser (CDP). Check internalTools.browser.cdpEndpoint and that the browser is running. Details: ${message}`;
  }
  return `Browser tool failed: ${message}`;
}

function selectBrowserPage(context: BrowserContext, pageIndex: number | undefined): Page | undefined {
  const pages = context.pages();
  if (pageIndex !== undefined) return pages[pageIndex];
  return pages.find((page) => page.url() !== "about:blank") ?? pages[0];
}

function browserCdpEndpoint(options: BrowserToolOptions): string | undefined {
  return options.config.internalTools?.browser?.cdpEndpoint;
}

async function loadChromium(): Promise<Chromium> {
  try {
    const playwright = await import("playwright");
    return playwright.chromium as Chromium;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingPlaywrightModule(error)) {
      throw new Error("Playwright runtime package is unavailable. Reinstall Bestie dependencies (npm install) and retry.", { cause: error });
    }
    throw new Error(`Playwright could not be loaded: ${message}`, { cause: error });
  }
}

function isMissingPlaywrightModule(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND";
}

async function pageSummary(page: Page, options: BrowserToolOptions & { timeoutMs?: number }, label: string): Promise<Omit<BrowserToolResult, "allowed" | "reason">> {
  const title = await page.title();
  const text = await readPageText(page, options);
  const elements = await summarizeElements(page);
  const screenshotPath = await saveScreenshot(page, options, label);
  return { url: page.url(), title, text: truncateChars(text, MAX_SNAPSHOT_TEXT_CHARS), elements, screenshotPath };
}

async function readPageText(page: Page, options: BrowserToolOptions & { timeoutMs?: number }): Promise<string> {
  const timeout = browserTimeout(options.timeoutMs);
  const text = await page.locator("body").innerText({ timeout }).catch(() => "");
  if (text.trim()) return text;

  return page.locator("body").textContent({ timeout }).then((content) => content ?? "").catch(() => "");
}

async function summarizeElements(page: Page): Promise<BrowserElementSummary[]> {
  return page.evaluate(extractBrowserElements, MAX_ELEMENTS);
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
