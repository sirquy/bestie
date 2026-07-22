import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { chromium } from "playwright";

import { startUiServer } from "../dist/ui/server.js";
import { createUiSmokeRuntimePaths, seedUiSmokeRuntime } from "./smoke-ui-fixture.mjs";

const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-browser-smoke-"));
const previousHome = process.env.HOME;
process.env.HOME = homeDir;

await seedUiSmokeRuntime(createUiSmokeRuntimePaths(homeDir));
const server = await startUiServer({ port: 0 });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await assertChatPanel(page, `${server.url}/#chat-panel`, homeDir);
  const brandColor = await page.locator(".brand strong").evaluate((element) => getComputedStyle(element).color);
  if (brandColor !== "rgb(238, 246, 237)") throw new Error(`Sidebar brand title should be light, got ${brandColor}`);
  await assertPanel(page, `${server.url}/#provider-panel`, "#provider-panel", "openai/test-model via openai-compatible", ["ChatGPT", "Gemini", "Set primary"]);
  await assertMemoryPanel(page, `${server.url}/#memory-panel`);
  await assertChannelPanel(page, `${server.url}/#channel-panel`);
  await assertApprovalsPanel(page, `${server.url}/#approvals-panel`);
  await assertMcpPanel(page, `${server.url}/#mcp-panel`);
  await assertToolsPanel(page, `${server.url}/#tools-panel`);
  await assertSkillsPanel(page, `${server.url}/#skills-panel`);
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
  const panels = ["chat-panel", "provider-panel", "channel-panel", "approvals-panel", "mcp-panel", "tools-panel", "skills-panel"];
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

async function assertChatPanel(page, url, homeDir) {
  await assertPanel(page, url, "#chat-panel", "Approval chat", ["Approval chat", "Retry", "Fork", "Stop"]);
  await page.waitForSelector(".chat-layout.chat-side-hidden");
  await page.waitForSelector('#chat-side-toggle[aria-expanded="false"] >> text=Details');
  await page.click("#chat-side-toggle");
  await page.waitForSelector('#chat-side-toggle[aria-expanded="true"] >> text=Hide');
  await page.waitForSelector("#chat-inspector >> text=Run inspector");
  await page.waitForSelector('#chat-rename-session[title="Rename chat"]');
  await page.waitForSelector('#chat-export-session[title="Export chat"]');
  await page.waitForSelector('#chat-import-session[title="Import chat"]');
  const sessionToolbar = await page.locator(".chat-session-tools").evaluate((element) => ({ height: element.getBoundingClientRect().height, buttons: element.querySelectorAll("button").length }));
  if (sessionToolbar.height > 48 || sessionToolbar.buttons !== 5) throw new Error(`Chat session toolbar is not compact: ${JSON.stringify(sessionToolbar)}`);
  const sessionsWidth = await page.locator(".chat-sessions").evaluate((element) => element.getBoundingClientRect().width);
  if (sessionsWidth < 230) throw new Error(`Chat sessions rail is too narrow: ${sessionsWidth}`);
  if (await page.locator(".topbar").count() > 0) throw new Error("Topbar should not be present in the UI layout.");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#chat-provider-model option")).some((option) => option.value === "openai/test-model"));
  if (!(await page.locator("#chat-tools").isChecked()) || !(await page.locator("#chat-memory").isChecked())) throw new Error("Chat preference checkboxes should default on.");
  await page.uncheck("#chat-memory");
  await page.selectOption("#chat-provider-model", "openai/test-model");
  await page.waitForSelector("text=Chat preferences saved.");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#chat-panel.active");
  await page.waitForSelector('#chat-side-toggle[aria-expanded="true"]');
  await page.waitForFunction(() => document.querySelector("#chat-provider-model")?.value === "openai/test-model");
  if (await page.locator("#chat-memory").isChecked()) throw new Error("Chat memory preference did not persist.");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForSelector("#command-palette-dialog[open]");
  await page.fill("#command-palette-input", "search");
  await page.waitForSelector("#command-palette-list >> text=Search Sessions");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "chat-session-search");
  await page.click("#chat-rename-session");
  await page.waitForSelector("#input-dialog[open]");
  await page.fill("#input-value", "Approval chat renamed");
  await page.click("#input-confirm");
  await page.waitForSelector("#chat-panel >> text=Approval chat renamed");
  await page.click("#chat-rename-session");
  await page.waitForSelector("#input-dialog[open]");
  await page.fill("#input-value", "Approval chat");
  await page.click("#input-confirm");
  await page.waitForSelector("#chat-panel >> text=Approval chat");
  await page.click("#chat-export-session");
  await page.waitForSelector("#chat-export-dialog[open]");
  await page.waitForSelector("#chat-export-summary >> text=JSON");
  await page.waitForFunction(() => document.querySelector("#chat-export-preview")?.value.includes('"messages"'));
  await page.click('[data-export-format="markdown"]');
  await page.waitForSelector("#chat-export-summary >> text=MARKDOWN");
  await page.waitForFunction(() => document.querySelector("#chat-export-preview")?.value.includes("# Approval chat"));
  await page.click('#chat-export-dialog button[value="cancel"]');
  await page.click("#chat-import-session");
  await page.waitForSelector("#chat-import-dialog[open]");
  await page.fill("#chat-import-text", JSON.stringify({ session: { title: "Browser import" }, messages: [{ role: "user", content: "hello import" }], events: [] }));
  await page.waitForSelector("#chat-import-preview >> text=Browser import");
  await page.waitForFunction(() => document.querySelector("#chat-import-confirm")?.disabled === false);
  await page.click('#chat-import-dialog button[value="cancel"]');
  await page.waitForSelector('#chat-session-list [data-chat-pin][data-pinned="true"] >> text=Pinned');
  await page.waitForSelector("#chat-session-list .chat-session-badges >> text=pinned");
  await page.locator('#chat-session-list [data-chat-session] strong', { hasText: /^Approval chat$/ }).click();
  await page.waitForSelector("#chat-timeline >> text=approval_required");
  await page.waitForSelector("#chat-inspector >> text=Run inspector");
  await page.waitForSelector("#chat-inspector >> text=Approvals");
  await page.waitForSelector("#chat-inspector >> text=Export trace");
  if (await page.locator("#chat-export-trace").isDisabled()) throw new Error("Run trace export should be enabled when timeline events exist.");
  await page.waitForSelector("#chat-composer-status >> text=Ready");
  await page.waitForSelector("#chat-composer-context >> text=No memory");
  await page.waitForSelector("#chat-attach >> text=Attach");
  await page.waitForSelector("#chat-context >> text=Context");
  await page.waitForSelector("#chat-transcript .chat-message.user .chat-bubble");
  await page.waitForSelector("#chat-transcript .chat-message.user .chat-message-head strong >> text=Boss");
  await page.waitForSelector("#chat-transcript .chat-message.assistant .chat-message-head strong >> text=Bestie");
  await page.waitForSelector("#chat-transcript .chat-message.user .chat-message-meta >> text=sent");
  await page.waitForSelector("#chat-transcript .chat-message.assistant .chat-message-meta >> text=sent");
  await page.waitForSelector("#chat-transcript .chat-message.assistant .chat-message-meta >> text=chars");
  const messageMeta = await page.locator("#chat-transcript .chat-message-meta").evaluateAll((elements) => elements.map((element) => ({ text: element.textContent ?? "", width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth })));
  if (messageMeta.length < 2 || messageMeta.some((meta) => !meta.text.includes("chars") || meta.scrollWidth > meta.width + 1)) throw new Error(`Chat bubble metadata regressed: ${JSON.stringify(messageMeta)}`);
  if (await page.locator(".metric-grid").count() > 0) throw new Error("metric-grid should not be present in the UI layout.");
  const firstMenu = page.locator("#chat-transcript .chat-message.user .message-menu").first();
  await firstMenu.locator("summary").click();
  await page.waitForSelector("#chat-transcript .chat-message.user .message-menu[open] [data-chat-copy-message] >> text=Copy");
  await page.waitForSelector("#chat-transcript .chat-message.user .message-menu[open] [data-chat-retry-message] >> text=Retry");
  await page.waitForSelector("#chat-transcript .chat-message.user .message-menu[open] [data-chat-fork] >> text=Fork");
  await page.waitForSelector("#chat-transcript .chat-message.assistant .markdown-body strong >> text=Ready");
  await page.waitForSelector("#chat-transcript .chat-message.assistant .markdown-body code >> text=approval");
  await page.waitForSelector("#chat-transcript .chat-message.assistant .copy-code >> text=Copy");
  await page.waitForSelector("#chat-transcript .chat-message.assistant .code-block code >> text=bestie doctor");
  const assistantMenu = page.locator("#chat-transcript .chat-message.assistant .message-menu").last();
  await assistantMenu.locator("summary").click();
  await page.waitForSelector("#chat-transcript .chat-message.assistant .message-menu[open] [data-chat-inspect-run] >> text=Inspect run");
  await page.click("#chat-transcript .chat-message.assistant .message-menu[open] [data-chat-inspect-run]");
  await page.waitForSelector("#chat-inspector >> text=Run #");
  await page.waitForSelector("#chat-inspector >> text=Replay diff");
  await page.waitForSelector("#chat-inspector >> text=changed");
  await page.waitForSelector("#chat-replay-run >> text=Replay run");
  if (await page.locator("#chat-replay-run").isDisabled()) throw new Error("Replay run should be enabled for a selected historical run.");
  const chatComfort = await page.locator("#chat-transcript .chat-message.assistant .chat-bubble").first().evaluate((element) => {
    const bubble = getComputedStyle(element);
    const transcript = getComputedStyle(document.querySelector("#chat-transcript"));
    const markdown = getComputedStyle(element.querySelector(".markdown-body"));
    return {
      bubbleGap: Number.parseFloat(bubble.gap),
      bubblePaddingTop: Number.parseFloat(bubble.paddingTop),
      markdownLineHeight: Number.parseFloat(markdown.lineHeight),
      transcriptGap: Number.parseFloat(transcript.gap),
    };
  });
  if (chatComfort.bubbleGap < 8 || chatComfort.bubblePaddingTop < 12 || chatComfort.markdownLineHeight < 22 || chatComfort.transcriptGap < 10) {
    throw new Error(`Chat reading comfort styles regressed: ${JSON.stringify(chatComfort)}`);
  }
  const scrollState = await page.locator("#chat-transcript").evaluate((element) => { element.scrollTop = element.scrollHeight; return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight }; });
  if (scrollState.max > 0 && scrollState.max - scrollState.top > 2) throw new Error(`Chat transcript did not auto-scroll to bottom: ${JSON.stringify(scrollState)}`);
  await page.waitForSelector("#chat-timeline >> text=internal.exec requires approval");
  await page.waitForSelector("#chat-timeline details.timeline-row[open]");
  const timelineDetails = await page.locator("#chat-timeline .timeline-detail").evaluateAll((elements) => elements.map((element) => element.textContent ?? ""));
  if (timelineDetails.some((detail) => detail.trim().startsWith("{") || detail.includes('"approvalId"'))) throw new Error(`Chat timeline leaked raw JSON details: ${JSON.stringify(timelineDetails)}`);
  await page.waitForSelector("#chat-branch >> text=Root session");
  await page.waitForSelector("#chat-branch >> text=Approval chat fork");
  await page.waitForSelector("#chat-session-list .chat-session-badges >> text=approval");
  const transcriptHeight = await page.locator("#chat-transcript").evaluate((element) => element.getBoundingClientRect().height);
  if (transcriptHeight <= 0 || transcriptHeight > 760) throw new Error(`Chat transcript height is not screen bounded: ${transcriptHeight}`);
  await page.fill("#chat-session-search", "Approval");
  await page.waitForSelector("#chat-session-list >> text=Approval chat");
  await page.selectOption("#chat-session-filter", "approval");
  await page.waitForSelector("#chat-session-list >> text=Approval chat");
  if (!(await page.locator("#chat-stop").isDisabled())) throw new Error("Chat Stop button should start disabled.");
  const attachmentPath = resolve(homeDir, "chat-context.md");
  await writeFile(attachmentPath, "# Chat Context\n\nBrowser smoke attachment.");
  await page.setInputFiles("#chat-attachment-input", attachmentPath);
  await page.waitForSelector("#chat-attachment-preview >> text=chat-context.md");
  await page.waitForSelector("#chat-composer-context >> text=1 file");
  const heightBefore = await page.locator("#chat-input").evaluate((element) => element.getBoundingClientRect().height);
  await page.fill("#chat-input", "Line one");
  await page.press("#chat-input", "Shift+Enter");
  await page.type("#chat-input", "Line two");
  const multilineValue = await page.inputValue("#chat-input");
  const heightAfter = await page.locator("#chat-input").evaluate((element) => element.getBoundingClientRect().height);
  if (!multilineValue.includes("\n") || heightAfter <= heightBefore) throw new Error("Chat composer did not preserve Shift+Enter multiline auto-resize.");
  await page.fill("#chat-input", "Hello from smoke");
  const value = await page.inputValue("#chat-input");
  if (value !== "Hello from smoke") throw new Error("Chat composer did not accept input.");
  await page.press("#chat-input", "Enter");
  await page.waitForFunction(() => document.querySelector("#chat-input")?.value === "");
}

async function assertSkillsPanel(page, url) {
  await assertPanel(page, url, "#skills-panel", "Editing smoke-skill", ["smoke-skill", "SKILL.md", "Save skill", "New skill"]);
  await page.waitForSelector("#skill-content");
  await page.waitForSelector(".skills-layout .skill-list");
  await page.fill("#skill-search", "smoke");
  await page.waitForSelector('#skill-list [data-skill-name="smoke-skill"]');
  await page.fill("#skill-search", "");
  await page.click("#skill-new");
  await page.waitForFunction(() => document.querySelector("#skill-status")?.value === "New skill");
  await page.fill("#skill-name", "browser-skill");
  await page.fill("#skill-content", "# Browser Skill\n\nCreated by browser smoke.\n");
  await page.click("#skill-save");
  await page.waitForSelector("#confirm-dialog[open]");
  const confirmTitleColor = await page.locator("#confirm-title").evaluate((element) => getComputedStyle(element).color);
  if (confirmTitleColor !== "rgb(238, 246, 237)") throw new Error(`Confirm title should use light ink color, got ${confirmTitleColor}`);
  await page.click('#confirm-dialog button[value="confirm"]');
  await page.waitForSelector(".toast.show >> text=Skill saved.");
  await page.waitForSelector("#skills-panel >> text=browser-skill");
  await page.click('[data-skill-name="browser-skill"]');
  await page.waitForFunction(() => document.querySelector("#skill-content")?.value?.includes("Created by browser smoke."));
  await page.fill("#skill-content", "# Browser Skill\n\nUpdated by browser smoke.\n");
  await page.waitForFunction(() => document.querySelector("#skill-content")?.value?.includes("Updated by browser smoke."));
  await page.click("#skill-save");
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click('#confirm-dialog button[value="confirm"]');
  await page.waitForSelector(".toast.show >> text=Skill saved.");
  await page.waitForFunction(() => document.querySelector("#skill-content")?.value?.includes("Updated by browser smoke."));
  await page.fill("#skill-name", "browser-skill-renamed");
  await page.waitForFunction(() => document.querySelector("#skill-name")?.value === "browser-skill-renamed");
  await page.click("#skill-save");
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click('#confirm-dialog button[value="confirm"]');
  await page.waitForSelector("#skills-panel >> text=browser-skill-renamed");
  await page.waitForFunction(() => !document.querySelector('[data-skill-name="browser-skill"]'));
  await page.click("#skill-delete");
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click('#confirm-dialog button[value="confirm"]');
  await page.waitForFunction(() => !document.querySelector('[data-skill-name="browser-skill-renamed"]'));
}

async function assertChannelPanel(page, url) {
  await assertPanel(page, url, "#channel-panel", "Channels 1 / Cron 1", ["Telegram", "Zalo", "Cron"]);
  const secretPill = await page.locator("#channel-daemons.active .action-row .pill.good", { hasText: "secret" }).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, scrollWidth: element.scrollWidth };
  });
  if (secretPill.width > 120 || secretPill.scrollWidth > secretPill.width + 1) throw new Error(`Channel secret pill should fit content, got ${JSON.stringify(secretPill)}`);
  await page.click('#channel-panel [data-segment-target="channel-cron"]');
  await page.waitForSelector("#channel-cron.active");
  await page.waitForSelector("#channel-cron.active >> text=Daily check");
  await page.click("#channel-cron.active summary");
  await page.fill('#cron-create-form input[name="name"]', "Created from UI");
  await page.fill('#cron-create-form input[name="scheduleValue"]', "10m");
  await page.fill('#cron-create-form textarea[name="prompt"]', "Created from browser smoke.");
  await page.click('#cron-create-form button[type="submit"]');
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click('#confirm-dialog button[value="confirm"]');
  await page.waitForSelector("#channel-cron.active >> text=Created from UI");
  await page.waitForSelector("#channel-cron.active >> text=View");
  await page.click('#channel-cron.active [data-cron-view]');
  await page.waitForSelector('#channel-cron.active [data-cron-detail]:not(.hidden) >> text=Next run');
  await page.waitForSelector('#channel-cron.active [data-cron-detail]:not(.hidden) >> text=Send a short update.');
  await page.waitForSelector('#channel-cron.active >> text=Trigger');
  await page.click('#channel-cron.active [data-cron-edit]');
  await page.waitForSelector('#channel-cron.active [data-cron-form]:not(.hidden)');
  await page.locator('#channel-cron.active [data-cron-form]:not(.hidden) textarea[name="prompt"]').waitFor();
  await page.fill('#channel-cron.active [data-cron-form] input[name="name"]', "Daily check edited");
  await page.selectOption('#channel-cron.active [data-cron-form] select[name="scheduleType"]', "interval");
  await page.fill('#channel-cron.active [data-cron-form] input[name="scheduleValue"]', "5m");
  await page.fill('#channel-cron.active [data-cron-form] textarea[name="prompt"]', "Send a short edited update.");
  await page.click('#channel-cron.active [data-cron-form] button[type="submit"]');
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click('#confirm-dialog button[value="confirm"]');
  await page.waitForSelector("#channel-cron.active >> text=Daily check edited");
  await page.click('#channel-panel [data-segment-target="channel-cron-logs"]');
  await page.waitForSelector("#channel-cron-logs.active");
  await page.waitForSelector("#channel-cron-logs.active >> text=Smoke cron output");
  await page.click('#channel-panel [data-segment-target="channel-cron"]');
  await page.waitForSelector("#channel-cron.active");
  await page.click('#channel-cron.active [data-cron-delete]');
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click('#confirm-dialog button[value="confirm"]');
  await page.waitForFunction(() => document.querySelector("#channel-panel .value")?.textContent?.includes("Channels 1 / Cron 1"));
  await page.waitForSelector("#channel-cron.active >> text=Created from UI");
}

async function assertApprovalsPanel(page, url) {
  await assertPanel(page, url, "#approvals-panel", "Pending 1", ["internal.write_file", "Approve", "History"]);
  await page.click('#approvals-panel [data-segment-target="approvals-history"]');
  await page.waitForSelector("#approvals-history.active");
  await page.waitForSelector("#approvals-history.active >> text=Approval history is not stored");
}

async function assertMcpPanel(page, url) {
  await assertPanel(page, url, "#mcp-panel", "Servers 1/2 / Tools 3", ["fs", "remote-oauth", "Tools", "Auth"]);
  await page.waitForSelector('#mcp-panel .mcp-tool-chip[title="COMPOSIO_GET_TOOL_SCHEMAS"]');
  await assertMcpChipLayout(page, "servers");
  await page.click('#mcp-panel [data-segment-target="mcp-tools"]');
  await page.waitForSelector("#mcp-tools.active");
  await page.waitForSelector("#mcp-tools.active >> text=public_action");
  await assertMcpChipLayout(page, "tools");
  await page.click('#mcp-panel [data-segment-target="mcp-auth"]');
  await page.waitForSelector("#mcp-auth.active");
  await page.waitForSelector("#mcp-auth.active >> text=REMOTE_MCP_TOKEN");
}

async function assertMcpChipLayout(page, surface) {
  const result = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#mcp-panel .pill-row"));
    const chips = Array.from(document.querySelectorAll("#mcp-panel .mcp-chip"));
    return {
      overflowingRows: rows
        .filter((row) => row.scrollWidth > row.clientWidth + 1)
        .map((row) => row.textContent?.trim() ?? "pill-row"),
      oversizedChips: chips
        .filter((chip) => {
          const parentWidth = chip.parentElement?.getBoundingClientRect().width ?? 0;
          return chip.getBoundingClientRect().width > parentWidth + 1;
        })
        .map((chip) => chip.getAttribute("title") || chip.textContent?.trim() || "chip"),
    };
  });
  if (result.overflowingRows.length > 0 || result.oversizedChips.length > 0) {
    throw new Error(`MCP ${surface} chip layout overflowed: ${JSON.stringify(result)}`);
  }
}

async function assertToolsPanel(page, url) {
  await assertPanel(page, url, "#tools-panel", "Policies 3 / External paths 2", ["internal.write_file", "Workspace", "Execution"]);
  await page.waitForSelector('[data-tool-policy-select="internal.write_file"]');
  const writePolicy = page.locator('[data-tool-policy-select="internal.write_file"]');
  if ((await writePolicy.inputValue()) !== "deny") throw new Error("internal.write_file policy select should start at deny.");
  await writePolicy.selectOption("ask");
  await page.waitForFunction(() => document.querySelector('[data-tool-policy-select="internal.write_file"]')?.value === "ask");
  await page.waitForSelector(".toast.show >> text=Tool policy saved.");
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
}
