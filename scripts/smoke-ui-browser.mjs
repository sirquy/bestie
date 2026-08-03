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
  await expectPath(page, "/chat");
  await assertSidebarToggle(page);
  await assertMobileSidebarToggle(page);
  await assertChatPanel(page);
  await assertPanel(page, "Kiểm tra", "/doctor", ["Kiểm tra sức khoẻ", "Sửa lỗi thường gặp"]);
  await assertPanel(page, "Nhà cung cấp", "/providers", ["Lựa chọn mô hình AI", "ChatGPT", "Đặt làm chính"]);
  await assertPanel(page, "Tính cách", "/character", ["Chi tiết tính cách", "Hướng dẫn trò chuyện"]);
  await assertPanel(page, "Bộ nhớ", "/memory", ["Kho bộ nhớ", "Cần xem xét"]);
  await assertKnowledgePanel(page);
  await assertPanel(page, "Kênh", "/channels", ["Kênh", "Tin nhắn hẹn giờ"]);
  await assertPanel(page, "Phê duyệt", "/approvals", ["Cần phê duyệt"]);
  await assertPanel(page, "Tiện ích mở rộng", "/mcp", ["Tiện ích đã kết nối", "Công cụ"]);
  await assertPanel(page, "Công cụ", "/tools", ["Thao tác được phép", "Thư mục"]);
  await assertSkillsPanel(page);
  await assertPanel(page, "Cài đặt", "/settings", ["Tuỳ chọn an toàn", "Chế độ duyệt bộ nhớ"]);
  await assertDirectRoute(page, `${server.url}/knowledge`, "/knowledge");
  await page.goBack({ waitUntil: "networkidle" });
  await expectPath(page, "/settings");
  await page.goForward({ waitUntil: "networkidle" });
  await expectPath(page, "/knowledge");

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

async function assertPanel(page, navName, route, texts) {
  await page.getByRole("link", { name: new RegExp(navName) }).click();
  await expectPath(page, route);
  for (const text of texts) {
    await page.getByText(text, { exact: false }).first().waitFor();
  }
}

async function assertChatPanel(page) {
  await page.getByRole("link", { name: /Trò chuyện/ }).click();
  await expectPath(page, "/chat");
  await page.waitForSelector("[data-chat-summary]");
  await page.waitForSelector("#chat-session-list");
  await page.waitForSelector("[data-chat-session]");
  await page.locator("[data-chat-session]").first().click();
  await page.waitForSelector("#chat-transcript .chat-message");
  await page.waitForSelector('textarea[placeholder="Gửi tin nhắn cho Bestie"]');
  await page.waitForSelector('#chat-provider-model option[value="openai/test-model"]', { state: "attached" });
  await page.waitForSelector("#chat-transcript strong");
  await page.waitForSelector("#chat-transcript code");
  await page.waitForSelector("#chat-transcript li");
  await page.waitForSelector('[data-chat-attachment="smoke-note.md"]');
  await page.getByText("# Smoke attachment", { exact: false }).first().waitFor();
  await page.locator('summary[aria-label="Tác vụ tin nhắn"]').first().click();
  await page.waitForSelector('[data-chat-action="fork"]');
  await page.waitForSelector('[data-chat-action="copy"]');
  await page.waitForSelector('[data-chat-action="retry"]');
  await page.locator('summary[aria-label="Tác vụ tin nhắn"]').first().click();
  await page.locator('summary[aria-label="Tác vụ trò chuyện"]').click();
  await page.locator('[data-chat-header-action="retry"]').click();
  await page.getByRole("dialog", { name: "Thử lại tin nhắn" }).waitFor();
  await page.getByRole("button", { name: "Huỷ" }).click();
  await page.getByRole("button", { name: "Sửa tên cuộc trò chuyện" }).click();
  await page.getByRole("textbox", { name: "Sửa tên cuộc trò chuyện" }).fill("Smoke chat đã đổi tên");
  await page.getByRole("button", { name: "Lưu tên cuộc trò chuyện" }).click();
  await page.getByText("Smoke chat đã đổi tên", { exact: true }).first().waitFor();
  await page.locator('[data-chat-header-action="fullscreen"]').click();
  await page.waitForSelector('[data-chat-fullscreen="true"]');
  await page.locator('[data-chat-header-action="fullscreen"]').click();
  await page.waitForSelector('[data-chat-fullscreen="false"]');
  await page.waitForSelector("#chat-inspector");
  await page.getByRole("button", { name: "Thu gọn danh sách" }).click();
  await page.getByRole("button", { name: "Thu gọn tuỳ chọn" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Mở rộng danh sách" }).waitFor();
  await page.getByRole("button", { name: "Mở rộng tuỳ chọn" }).waitFor();
  await page.getByRole("button", { name: "Mở rộng danh sách" }).click();
  await page.getByRole("button", { name: "Mở rộng tuỳ chọn" }).click();
  await page.waitForSelector("#chat-session-list");
  await page.waitForSelector("#chat-inspector");
}

async function assertSidebarToggle(page) {
  await page.waitForSelector('[data-sidebar-state="expanded"]');
  await page.getByRole("button", { name: /Thu gọn thanh bên/ }).click();
  await page.waitForSelector('[data-sidebar-state="collapsed"]');
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-sidebar-state="collapsed"]');
  await page.getByRole("button", { name: /Mở rộng thanh bên/ }).click();
  await page.waitForSelector('[data-sidebar-state="expanded"]');
}

async function assertMobileSidebarToggle(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector('[data-sidebar-state="expanded"]');
  const sidebarBox = await page.locator("[data-sidebar-state]").evaluate((element) => ({ height: element.getBoundingClientRect().height, viewportHeight: window.innerHeight }));
  if (sidebarBox.height < sidebarBox.viewportHeight - 80) throw new Error(`Mobile sidebar should be full height, got ${sidebarBox.height}/${sidebarBox.viewportHeight}`);
  const navColumns = await page.locator("[data-sidebar-state] nav").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  if (navColumns !== 1) throw new Error(`Mobile sidebar menu should be one column, got ${navColumns}`);
  await page.locator("[data-sidebar-toggle]").click();
  await page.waitForSelector('[data-sidebar-state="collapsed"]');
  await page.locator("[data-sidebar-state] nav").waitFor({ state: "hidden" });
  const mainLeft = await page.locator("main").evaluate((element) => element.getBoundingClientRect().left);
  if (mainLeft > 24) throw new Error(`Collapsed mobile sidebar should not reserve layout width, main starts at ${mainLeft}`);
  await page.locator("[data-sidebar-floating-toggle]").click();
  await page.waitForSelector('[data-sidebar-state="expanded"]');
  await page.locator("[data-sidebar-state] nav").waitFor({ state: "visible" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function assertKnowledgePanel(page) {
  await page.getByRole("link", { name: /Tri thức/ }).click();
  await expectPath(page, "/knowledge");
  await page.waitForSelector('[data-knowledge-summary="true"]');
  await page.waitForSelector("#knowledge-cytoscape");
  await page.waitForSelector('[data-knowledge-map-3d]');
  await page.waitForSelector('[data-knowledge-map-canvas] canvas');
  await page.waitForSelector('[data-knowledge-map-node]', { state: "attached" });
  await page.waitForSelector('[data-knowledge-map-edge]', { state: "attached" });
  await page.waitForSelector(".knowledge-row");
  await page.waitForSelector('[data-knowledge-action="approve_pending"]');
  await page.waitForSelector('[data-knowledge-select="knowledge-primary-entity"]');
  await page.waitForSelector('[data-knowledge-graph-action="update_relation"]');
}

async function assertSkillsPanel(page) {
  await page.getByRole("link", { name: /Kỹ năng/ }).click();
  await expectPath(page, "/skills");
  await page.waitForSelector("[data-skills-summary]");
  await page.waitForSelector("[data-skill-editor]");
  await page.waitForSelector('[data-skill-row="smoke-skill"]');
  await page.locator('[data-skill-row="smoke-skill"] [data-skill-action="open"]').click();
  await page.waitForFunction(() => document.querySelector("[data-skill-content]")?.value?.includes("Smoke Skill"));
  await page.getByRole("button", { name: /^Thư viện$/ }).click();
  await page.getByRole("button", { name: /Tải thư viện/ }).click();
  await page.waitForSelector("[data-skill-library-row]");
  await page.waitForSelector('[data-skill-action="preview"]');
}

async function assertDirectRoute(page, url, route) {
  await page.goto(url, { waitUntil: "networkidle" });
  await expectPath(page, route);
  await page.waitForSelector("#root");
}

async function expectPath(page, route) {
  await page.waitForFunction((expected) => window.location.pathname === expected, route);
}
