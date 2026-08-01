import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { chromium } from "playwright";

import { startUiServer } from "../dist/ui/server.js";
import { createUiSmokeRuntimePaths, seedUiSmokeRuntime } from "./smoke-ui-fixture.mjs";

const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-browser-smoke-"));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = homeDir;
process.env.USERPROFILE = homeDir;

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

  await page.goto(server.url, { waitUntil: "networkidle" });
  await page.waitForSelector("#root");
  await page.waitForSelector("[data-chat-summary]");
  await assertChatPanel(page);
  await assertPanel(page, "Doctor", "Doctor", ["Runtime", "Secrets", "Safe fixes"]);
  await assertPanel(page, "Providers", "Provider Hub", ["Primary model", "ChatGPT", "Set primary"]);
  await assertPanel(page, "Character", "Character Studio", ["Character JSON", "System prompt"]);
  await assertPanel(page, "Memory", "Memory Center", ["Memory database", "Pending approval"]);
  await assertKnowledgePanel(page);
  await assertPanel(page, "Channels", "Channel Hub", ["Daemon controls", "Cron schedules"]);
  await assertPanel(page, "Approvals", "Approvals", ["Pending approvals"]);
  await assertPanel(page, "MCP", "MCP Hub", ["Servers", "Tools"]);
  await assertPanel(page, "Tools", "Tools & Permissions", ["Tool policies", "Workspace"]);
  await assertSkillsPanel(page);
  await assertPanel(page, "Settings", "Settings", ["Low-risk", "Memory policy"]);

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
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
  await rm(homeDir, { recursive: true, force: true });
}

async function assertPanel(page, navName, heading, texts) {
  await page.getByRole("button", { name: new RegExp(navName) }).click();
  await page.getByRole("heading", { name: heading, exact: true }).first().waitFor();
  for (const text of texts) {
    await page.getByText(text, { exact: false }).first().waitFor();
  }
}

async function assertChatPanel(page) {
  await page.getByRole("button", { name: /Chat/ }).click();
  await page.waitForSelector("[data-chat-summary]");
  await page.waitForSelector("#chat-session-list");
  await page.waitForSelector("[data-chat-session]");
  await page.locator("[data-chat-session]").first().click();
  await page.waitForSelector("#chat-transcript .chat-message");
  await page.waitForSelector("#chat-inspector");
  await page.getByRole("button", { name: /Export/ }).click();
  await page.waitForFunction(() => document.querySelector('textarea[placeholder="Exported chat JSON"]')?.value?.includes("messages"));
}

async function assertKnowledgePanel(page) {
  await page.getByRole("button", { name: /Knowledge/ }).click();
  await page.waitForSelector('[data-knowledge-summary="true"]');
  await page.waitForSelector("#knowledge-cytoscape");
  await page.waitForSelector(".knowledge-row");
  await page.waitForSelector('[data-knowledge-action="approve_pending"]');
  await page.waitForSelector('[data-knowledge-select="knowledge-primary-entity"]');
  await page.waitForSelector('[data-knowledge-graph-action="update_relation"]');
}

async function assertSkillsPanel(page) {
  await page.getByRole("button", { name: /Skills/ }).click();
  await page.waitForSelector("[data-skills-summary]");
  await page.waitForSelector("[data-skill-editor]");
  await page.waitForSelector('[data-skill-row="smoke-skill"]');
  await page.locator('[data-skill-row="smoke-skill"] [data-skill-action="open"]').click();
  await page.waitForFunction(() => document.querySelector("[data-skill-content]")?.value?.includes("Smoke Skill"));
  await page.getByRole("button", { name: /^Library$/ }).click();
  await page.getByRole("button", { name: /Load library/ }).click();
  await page.waitForSelector("[data-skill-library-row]");
  await page.waitForSelector('[data-skill-action="preview"]');
}
