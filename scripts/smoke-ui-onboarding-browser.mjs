import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { chromium } from "playwright";

import { startUiServer } from "../dist/ui/server.js";

const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-onboarding-browser-"));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = homeDir;
process.env.USERPROFILE = homeDir;

const provider = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const requestBody = JSON.parse(body);
  const userMessage = requestBody.messages?.findLast?.((message) => message.role === "user")?.content ?? "";
  const content = String(userMessage).includes("Say hi to confirm") ? "Provider ready." : "Kết quả thật từ mock provider.";
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
});
await new Promise((resolvePromise) => provider.listen(0, "127.0.0.1", resolvePromise));
const providerPort = provider.address().port;
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
  page.on("response", (response) => {
    if (response.status() >= 500) pageErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(server.url, { waitUntil: "domcontentloaded" });
  await page.getByText("Tạo mã mở khóa", { exact: false }).waitFor();
  await fillPin(page, "Mã mở khóa", "123456");
  await fillPin(page, "Nhập lại mã", "123456");
  await page.getByRole("button", { name: "Lưu và mở Bestie" }).click();
  await page.getByText("Tạo người bạn đồng hành của bạn", { exact: false }).waitFor().catch(async () => {
    throw new Error(`Onboarding screen did not render. Errors: ${pageErrors.join(" | ")}; body: ${(await page.locator("body").innerText()).slice(0, 500)}`);
  });
  await page.getByLabel("Tên của Bestie").fill("Miu");
  await page.getByLabel("Bestie gọi bạn là gì?").fill("Quỳnh");
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.getByText("Kết nối model AI", { exact: false }).waitFor();
  await page.getByLabel("Base URL").fill(`http://127.0.0.1:${providerPort}/v1`);
  await page.getByLabel("API key").fill("mock-secret");
  await page.getByRole("button", { name: /Lưu & kiểm tra kết nối/ }).click();
  await page.getByText("Kết nối thành công", { exact: false }).waitFor();
  await page.getByRole("button", { name: /Bắt đầu trò chuyện/ }).click();
  await page.waitForSelector("[data-chat-panel]");
  await page.locator("#chat-input").waitFor().catch(async () => {
    throw new Error(`Chat composer did not render. Body: ${(await page.locator("body").innerText()).slice(0, 2000)}`);
  });
  await page.locator("#chat-input").fill("Cho mình kết quả thật.");
  await page.locator("#chat-send").click();
  await page.getByText("Kết quả thật từ mock provider.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Khóa Bestie" }).click();
  await page.getByRole("dialog", { name: "Khóa Bestie" }).waitFor();
  await page.getByRole("button", { name: "Khóa ngay" }).click();
  await page.getByText("Mở khóa Bestie", { exact: false }).waitFor();
  await fillPin(page, "Mã mở khóa", "123456");
  await page.getByRole("button", { name: "Mở khóa" }).click();
  await page.locator("#chat-input").waitFor();
  await page.getByRole("link", { name: "Cài đặt" }).click();
  await page.getByText("Bestie đang mở khóa trên máy này", { exact: false }).waitFor();
  await page.getByText("Tự khóa sau", { exact: false }).waitFor();
  await fillPin(page, "Mã mở khóa hiện tại", "123456");
  await fillPin(page, "Mã mở khóa mới", "654321");
  await fillPin(page, "Nhập lại mã mới", "654321");
  await page.getByRole("button", { name: "Đổi mã mở khóa" }).click();
  await page.getByRole("dialog", { name: "Xác nhận" }).waitFor();
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await page.getByText("Mở khóa Bestie", { exact: false }).waitFor();
  await fillPin(page, "Mã mở khóa", "654321");
  await page.getByRole("button", { name: "Mở khóa" }).click();
  await page.getByRole("link", { name: "Trò chuyện" }).click();
  await page.locator("#chat-input").waitFor();

  if (pageErrors.length) throw new Error(`Browser emitted errors: ${pageErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({ ok: true, service: "bestie-ui-onboarding-browser" })}\n`);
} finally {
  await browser?.close();
  await server.close();
  await new Promise((resolvePromise) => provider.close(resolvePromise));
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  await rm(homeDir, { recursive: true, force: true });
}

async function fillPin(page, label, pin) {
  const firstCell = page.getByLabel(`${label}, số 1`);
  await firstCell.click();
  await firstCell.pressSequentially(pin);
}
