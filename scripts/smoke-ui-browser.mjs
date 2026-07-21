import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { chromium } from "playwright";

import { startUiServer } from "../dist/ui/server.js";
import { createUiSmokeRuntimePaths, seedUiSmokeRuntime } from "./smoke-ui-fixture.mjs";

const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-browser-smoke-"));
const previousHome = process.env.HOME;
process.env.HOME = homeDir;

const server = await startUiServer({ port: 0 });
let browser;
try {
  await seedUiSmokeRuntime(createUiSmokeRuntimePaths(homeDir));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await assertPanel(page, `${server.url}/#provider-panel`, "#provider-panel", "openai/test-model via openai-compatible", ["ChatGPT", "Gemini", "Set primary"]);
  await assertMemoryPanel(page, `${server.url}/#memory-panel`);
  await assertChannelPanel(page, `${server.url}/#channel-panel`);
  await assertApprovalsPanel(page, `${server.url}/#approvals-panel`);
  await assertMcpPanel(page, `${server.url}/#mcp-panel`);
  await assertToolsPanel(page, `${server.url}/#tools-panel`);
  await assertVisualLayouts(page, server.url, homeDir);

  if (pageErrors.length > 0) {
    throw new Error(`Browser UI emitted errors: ${pageErrors.join(" | ")}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, service: "bestie-ui-browser" })}\n`);
} finally {
  await browser?.close();
  await server.close();
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  await rm(homeDir, { recursive: true, force: true });
}

async function assertVisualLayouts(page, baseUrl, outputDir) {
  const panels = ["provider-panel", "channel-panel", "approvals-panel", "mcp-panel", "tools-panel"];
  const viewports = [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const panelId of panels) {
      await page.goto(`${baseUrl}/#${panelId}`, { waitUntil: "networkidle" });
      await page.waitForSelector(`#${panelId}.active`);
      await page.waitForFunction((panelId) => document.querySelector(`#${panelId} .panel-body`)?.children.length > 0, panelId);
      await assertLayoutGeometry(page, panelId, viewport.name);
      await assertScreenshot(page, resolve(outputDir, `${viewport.name}-${panelId}.png`));
    }
  }
}

async function assertMemoryPanel(page, url) {
  await assertPanel(page, url, "#memory-panel", "Active 2 / Pending 1", ["User prefers concise replies.", "Pending", "Search"]);
  await page.click('#memory-panel [data-segment-target="memory-pending"]');
  await page.waitForSelector("#memory-pending.active");
  await page.waitForSelector("text=Review this memory before saving.");
  await page.click('#memory-panel [data-segment-target="memory-search-view"]');
  await page.fill("#memory-search", "concise");
  await page.click("#memory-search-run");
  await page.waitForSelector("#memory-search-view.active");
  await page.waitForSelector("text=Search results for \"concise\"");
}

async function assertChannelPanel(page, url) {
  await assertPanel(page, url, "#channel-panel", "Channels 1 / Cron 1", ["Telegram", "Zalo", "Cron"]);
  await page.click('#channel-panel [data-segment-target="channel-cron"]');
  await page.waitForSelector("#channel-cron.active");
  await page.waitForSelector("#channel-cron.active >> text=Daily check");
  await page.waitForSelector("#channel-cron.active >> text=Disable");
}

async function assertApprovalsPanel(page, url) {
  await assertPanel(page, url, "#approvals-panel", "Pending 1", ["internal.write_file", "Approve", "History"]);
  await page.click('#approvals-panel [data-segment-target="approvals-history"]');
  await page.waitForSelector("#approvals-history.active");
  await page.waitForSelector("#approvals-history.active >> text=Approval history is not stored");
}

async function assertMcpPanel(page, url) {
  await assertPanel(page, url, "#mcp-panel", "Servers 1/2 / Tools 2", ["fs", "remote-oauth", "Tools", "Auth"]);
  await page.click('#mcp-panel [data-segment-target="mcp-tools"]');
  await page.waitForSelector("#mcp-tools.active");
  await page.waitForSelector("#mcp-tools.active >> text=public_action");
  await page.click('#mcp-panel [data-segment-target="mcp-auth"]');
  await page.waitForSelector("#mcp-auth.active");
  await page.waitForSelector("#mcp-auth.active >> text=REMOTE_MCP_TOKEN");
}

async function assertToolsPanel(page, url) {
  await assertPanel(page, url, "#tools-panel", "Policies 3 / External paths 2", ["internal.write_file", "Workspace", "Execution"]);
  await page.click('#tools-panel [data-segment-target="tools-workspace"]');
  await page.waitForSelector("#tools-workspace.active");
  await page.waitForSelector("#tools-workspace.active >> text=../shared");
  await page.locator("#tools-workspace.active").getByText("/tmp/bestie-ui-shared").waitFor();
  await page.click('#tools-panel [data-segment-target="tools-execution"]');
  await page.waitForSelector("#tools-execution.active");
  await page.waitForSelector("#tools-execution.active >> text=Execution limits");
}

async function assertLayoutGeometry(page, panelId, viewportName) {
  const result = await page.evaluate((panelId) => {
    const viewportWidth = document.documentElement.clientWidth;
    const activePanel = document.querySelector(`#${panelId}`);
    const nav = document.querySelector("nav");
    const hero = document.querySelector(".hero");
    const buttons = Array.from(document.querySelectorAll("button"));
    const overflowingButtons = buttons
      .filter((button) => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1)
      .map((button) => button.textContent?.trim() || "button");
    const visibleElements = [activePanel, nav, hero].filter(Boolean);
    const offscreenElements = visibleElements
      .map((element) => ({ text: element.textContent?.trim().slice(0, 40), rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width <= 0 || rect.height <= 0 || rect.left < -2 || rect.right > viewportWidth + 2);
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth,
      overflowingButtons,
      offscreenElements,
    };
  }, panelId);
  if (result.bodyWidth > result.viewportWidth + 2) {
    throw new Error(`Visual smoke ${viewportName}/${panelId} has horizontal overflow: ${result.bodyWidth} > ${result.viewportWidth}`);
  }
  if (result.overflowingButtons.length > 0) {
    throw new Error(`Visual smoke ${viewportName}/${panelId} has overflowing buttons: ${result.overflowingButtons.join(", ")}`);
  }
  if (result.offscreenElements.length > 0) {
    throw new Error(`Visual smoke ${viewportName}/${panelId} has offscreen core elements: ${JSON.stringify(result.offscreenElements)}`);
  }
}

async function assertScreenshot(page, path) {
  await page.screenshot({ path, fullPage: true });
  const file = await stat(path);
  if (file.size < 12_000) {
    throw new Error(`Visual smoke screenshot looks empty or truncated: ${path} (${file.size} bytes)`);
  }
}

async function assertPanel(page, url, panelSelector, expectedValue, expectedTexts) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(`${panelSelector}.active`);
  await page.waitForFunction(
    ({ panelSelector, expectedValue }) => document.querySelector(`${panelSelector} .value`)?.textContent?.includes(expectedValue),
    { panelSelector, expectedValue },
  );
  for (const expectedText of expectedTexts) {
    await page.waitForFunction((expectedText) => document.body.textContent?.includes(expectedText), expectedText);
  }
  const runtime = await page.textContent("#runtime-card .value");
  if (runtime !== "Ready") {
    throw new Error(`Expected runtime card to be Ready for ${url}, got ${runtime}`);
  }
}
