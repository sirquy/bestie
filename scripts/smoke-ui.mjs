import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runUiCommand } from "../dist/cli/commands/ui.js";
import { validateDoctorReportContract, validateDoctorReportJsonContract } from "../dist/runtime/doctor-report-contract.js";
import { HOME_PAGE_CLIENT_SCRIPT } from "../dist/ui/home/client-script.js";
import { startUiServer } from "../dist/ui/server.js";
import { createUiSmokeRuntimePaths, seedUiSmokeRuntime } from "./smoke-ui-fixture.mjs";

const homeDir = await mkdtemp(resolve(tmpdir(), "bestie-ui-smoke-"));
const previousHome = process.env.HOME;
process.env.HOME = homeDir;

const server = await startUiServer({ port: 0 });
try {
  await seedUiSmokeRuntime(createUiSmokeRuntimePaths(homeDir));
  await assertJson(`${server.url}/api/health`, { ok: true, service: "bestie-ui" });
  await assertJson(`${server.url}/api/status`, { ok: true, provider: "openai-compatible", secretPresent: true });
  await assertJson(`${server.url}/api/config/summary`, { ok: true, provider: "openai-compatible", secretPresent: true });
  await assertDoctor(`${server.url}/api/doctor`);
  await assertDoctorFixRequiresConfirmation(`${server.url}/api/doctor/fix`);
  await assertDoctorFix(`${server.url}/api/doctor/fix`);
  await assertProviders(`${server.url}/api/providers`);
  await assertProviderTest(`${server.url}/api/providers/test`);
  await assertProviderPrimary(`${server.url}/api/providers/primary`, `${server.url}/api/providers`);
  await assertProviderFallbacks(`${server.url}/api/providers/fallbacks`, `${server.url}/api/providers`);
  await assertProviderSetup(`${server.url}/api/providers/setup`, `${server.url}/api/providers`);
  await assertCharacter(`${server.url}/api/character`);
  await assertMemory(`${server.url}/api/memory`, `${server.url}/api/memory/search`, `${server.url}/api/memory/action`);
  await assertChannels(`${server.url}/api/channels`, `${server.url}/api/channels/action`);
  await assertApprovals(`${server.url}/api/approvals`, `${server.url}/api/approvals/action`);
  await assertMcp(`${server.url}/api/mcp`);
  await assertTools(`${server.url}/api/tools`);
  await assertSettings(`${server.url}/api/settings`, `${server.url}/api/config/summary`);
  await assertHome(`${server.url}/`, `${server.url}/assets/home.js`);
  await runUiCommand({ argv: ["node", "bestie", "ui", "--port", "0", "--no-open"], runUntilReady: true, writeLine: () => undefined });
  process.stdout.write(`${JSON.stringify({ ok: true, service: "bestie-ui" })}\n`);
} finally {
  await server.close();
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  await rm(homeDir, { recursive: true, force: true });
}

async function assertJson(url, expected) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== expected.ok) {
    throw new Error(`Unexpected response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  if (expected.service && body.service !== expected.service) {
    throw new Error(`Unexpected service for ${url}: ${JSON.stringify(body)}`);
  }
  if (expected.provider && body.llm?.provider !== expected.provider) {
    throw new Error(`Unexpected provider for ${url}: ${JSON.stringify(body)}`);
  }
  if (expected.secretPresent !== undefined && body.llm?.secretPresent !== expected.secretPresent) {
    throw new Error(`Unexpected secret status for ${url}: ${JSON.stringify(body)}`);
  }
}

async function assertHome(url, scriptUrl) {
  const response = await fetch(url);
  const html = await response.text();
  assertHomeScriptSyntax();
  if (!response.ok || !html.includes("Bestie UI") || !html.includes("/assets/home.js") || !html.includes("memory-panel") || !html.includes("channel-panel") || !html.includes("approvals-panel") || !html.includes("mcp-panel") || !html.includes("tools-panel") || !html.includes("settings-panel") || html.includes("/api/status") || html.includes("data-provider-preset")) {
    throw new Error(`Unexpected home response for ${url}: ${response.status}`);
  }
  const scriptResponse = await fetch(scriptUrl);
  const script = await scriptResponse.text();
  if (!scriptResponse.ok || !script.includes("/api/status") || !script.includes("/api/doctor") || !script.includes("/api/doctor/fix") || !script.includes("/api/providers") || !script.includes("/api/providers/test") || !script.includes("/api/character") || !script.includes("/api/memory") || !script.includes("/api/channels") || !script.includes("/api/channels/action") || !script.includes("/api/approvals") || !script.includes("/api/approvals/action") || !script.includes("/api/mcp") || !script.includes("/api/tools") || !script.includes("/api/settings") || !script.includes("data-provider-preset") || !script.includes("character-form") || !script.includes("data-channel-action") || !script.includes("settings-form") || !script.includes("provider-setup-note") || !script.includes("data-provider-field") || !script.includes("data-approval-action") || !script.includes("memory-row") || !script.includes("data-mcp-summary") || !script.includes("data-mcp-server") || !script.includes("data-mcp-categories") || !script.includes("data-tools-summary") || !script.includes("data-tool-policy") || !script.includes("hashchange")) {
    throw new Error(`Unexpected home script response for ${scriptUrl}: ${scriptResponse.status}`);
  }
}

function assertHomeScriptSyntax() {
  try {
    new Function(HOME_PAGE_CLIENT_SCRIPT);
  } catch (error) {
    throw new Error(`Home client script is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertSettings(url, statusUrl) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.agent?.toneIntensity !== 7 || body.memory?.writePolicy !== "ask" || body.llm?.primary !== "groq/llama-3.3-70b-versatile") {
    throw new Error(`Unexpected settings response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }

  const missingConfirmResponse = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: { toneIntensity: 8 } }) });
  const missingConfirmBody = await missingConfirmResponse.json();
  if (missingConfirmResponse.status !== 400 || missingConfirmBody.code !== "UiSettingsConfirmationRequired") {
    throw new Error(`Unexpected settings confirmation response for ${url}: ${missingConfirmResponse.status} ${JSON.stringify(missingConfirmBody)}`);
  }

  const updateResponse = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: { name: "Miu", ownerName: "Boss Prime", language: "vi", toneIntensity: 8 }, memory: { writePolicy: "allow" }, confirm: true }) });
  const updated = await updateResponse.json();
  if (!updateResponse.ok || updated.agent?.name !== "Miu" || updated.agent?.ownerName !== "Boss Prime" || updated.agent?.toneIntensity !== 8 || updated.memory?.writePolicy !== "allow") {
    throw new Error(`Unexpected settings update response for ${url}: ${updateResponse.status} ${JSON.stringify(updated)}`);
  }

  const refreshed = await fetch(url).then((result) => result.json());
  if (refreshed.agent?.name !== "Miu" || refreshed.memory?.writePolicy !== "allow") {
    throw new Error(`Settings update was not persisted for ${url}: ${JSON.stringify(refreshed)}`);
  }

  const status = await fetch(statusUrl).then((result) => result.json());
  if (status.ok !== true || status.llm?.modelRef !== "groq/llama-3.3-70b-versatile") {
    throw new Error(`Settings update broke config summary for ${statusUrl}: ${JSON.stringify(status)}`);
  }
}

async function assertTools(url) {
  const response = await fetch(url);
  const body = await response.json();
  const serialized = JSON.stringify(body);
  if (!response.ok || body.ok !== true || body.policies?.count !== 3 || body.policies?.allow !== 1 || body.policies?.ask !== 1 || body.policies?.deny !== 1 || body.workspace?.externalPathCount !== 2 || body.exec?.timeoutMs !== 120000) {
    throw new Error(`Unexpected tools response for ${url}: ${response.status} ${serialized}`);
  }
  if (!body.policies.entries?.some((entry) => entry.tool === "internal.write_file" && entry.policy === "deny")) {
    throw new Error(`Tools response missed write policy for ${url}: ${serialized}`);
  }
  if (serialized.includes("test-key") || serialized.includes("telegram-test-token") || serialized.includes("remote-token-value")) {
    throw new Error(`Tools API leaked secret values for ${url}: ${serialized}`);
  }
}

async function assertMcp(url) {
  const response = await fetch(url);
  const body = await response.json();
  const fsServer = body.servers?.find((server) => server.name === "fs");
  const remoteServer = body.servers?.find((server) => server.name === "remote-oauth");
  const serialized = JSON.stringify(body);
  if (!response.ok || body.ok !== true || body.counts?.total !== 2 || body.counts?.enabled !== 1 || body.counts?.tools !== 2 || !fsServer || !remoteServer) {
    throw new Error(`Unexpected MCP response for ${url}: ${response.status} ${serialized}`);
  }
  if (fsServer.transport !== "stdio" || fsServer.envKeys?.[0] !== "MCP_SECRET" || fsServer.commandConfigured !== true || fsServer.argCount !== 1) {
    throw new Error(`Unexpected stdio MCP summary for ${url}: ${JSON.stringify(fsServer)}`);
  }
  if (remoteServer.transport !== "http" || remoteServer.headerEnvNames?.[0] !== "REMOTE_MCP_TOKEN" || remoteServer.auth?.envVar !== "REMOTE_MCP_OAUTH" || remoteServer.tools?.categories?.[0] !== "public_action") {
    throw new Error(`Unexpected remote MCP summary for ${url}: ${JSON.stringify(remoteServer)}`);
  }
  if (serialized.includes("super-secret-mcp") || serialized.includes("Bearer direct-secret") || serialized.includes("remote-token-value")) {
    throw new Error(`MCP API leaked secret values for ${url}: ${serialized}`);
  }
}

async function assertApprovals(url, actionUrl) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.count !== 1 || body.approvals?.[0]?.action !== "internal.write_file" || body.approvals?.[0]?.payloadJson !== undefined) {
    throw new Error(`Unexpected approvals response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }

  const approvalId = body.approvals[0].id;
  const missingConfirmResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", id: approvalId }) });
  const missingConfirmBody = await missingConfirmResponse.json();
  if (missingConfirmResponse.status !== 400 || missingConfirmBody.code !== "UiApprovalActionConfirmationRequired") {
    throw new Error(`Unexpected approval action confirmation response for ${actionUrl}: ${missingConfirmResponse.status} ${JSON.stringify(missingConfirmBody)}`);
  }

  const approveResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", id: approvalId, confirm: true }) });
  const approveBody = await approveResponse.json();
  if (!approveResponse.ok || approveBody.action !== "approve" || approveBody.approval?.status !== "approved" || approveBody.count !== 0) {
    throw new Error(`Unexpected approval action response for ${actionUrl}: ${approveResponse.status} ${JSON.stringify(approveBody)}`);
  }
}

async function assertChannels(url, actionUrl) {
  const response = await fetch(url);
  const body = await response.json();
  const telegram = body.channels?.find((channel) => channel.id === "telegram");
  const zalo = body.channels?.find((channel) => channel.id === "zalo");
  if (!response.ok || body.ok !== true || !telegram || !zalo || body.cron?.counts?.total !== 1 || body.cron?.counts?.enabled !== 1) {
    throw new Error(`Unexpected channel response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  if (telegram.enabled !== true || telegram.tokenEnv !== "BESTIE_TELEGRAM_BOT_TOKEN" || telegram.secretPresent !== true || telegram.daemon?.state !== "stopped") {
    throw new Error(`Unexpected telegram channel summary for ${url}: ${JSON.stringify(telegram)}`);
  }
  if (zalo.enabled !== false || zalo.secretPresent !== false || JSON.stringify(body).includes("telegram-test-token")) {
    throw new Error(`Unexpected channel secret/config response for ${url}: ${JSON.stringify(body)}`);
  }

  const missingConfirmResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "daemon_stop", channel: "cron" }) });
  const missingConfirmBody = await missingConfirmResponse.json();
  if (missingConfirmResponse.status !== 400 || missingConfirmBody.code !== "UiChannelActionConfirmationRequired") {
    throw new Error(`Unexpected channel action confirmation response for ${actionUrl}: ${missingConfirmResponse.status} ${JSON.stringify(missingConfirmBody)}`);
  }

  const invalidResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "daemon_stop", channel: "all", confirm: true }) });
  const invalidBody = await invalidResponse.json();
  if (invalidResponse.status !== 400 || invalidBody.code !== "UiChannelInvalidActionRequest") {
    throw new Error(`Unexpected channel action invalid response for ${actionUrl}: ${invalidResponse.status} ${JSON.stringify(invalidBody)}`);
  }

  const stopResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "daemon_stop", channel: "cron", confirm: true }) });
  const stopBody = await stopResponse.json();
  if (!stopResponse.ok || stopBody.action !== "daemon_stop" || stopBody.channel !== "cron" || !Array.isArray(stopBody.messages) || !stopBody.messages[0]?.toLowerCase().includes("cron")) {
    throw new Error(`Unexpected channel action stop response for ${actionUrl}: ${stopResponse.status} ${JSON.stringify(stopBody)}`);
  }

  const scheduleId = body.cron.schedules[0]?.id;
  const toggleResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cron_toggle", id: scheduleId, enabled: false, confirm: true }) });
  const toggleBody = await toggleResponse.json();
  if (!toggleResponse.ok || toggleBody.action !== "cron_toggle" || toggleBody.id !== scheduleId || toggleBody.enabled !== false || toggleBody.cron?.counts?.enabled !== 0 || toggleBody.cron?.counts?.disabled !== 1) {
    throw new Error(`Unexpected cron toggle response for ${actionUrl}: ${toggleResponse.status} ${JSON.stringify(toggleBody)}`);
  }
}

async function assertMemory(url, searchUrl, actionUrl) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.counts?.active !== 2 || body.counts?.pending !== 1 || body.memories?.length !== 2 || body.pending?.length !== 1) {
    throw new Error(`Unexpected memory response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  const searchResponse = await fetch(`${searchUrl}?q=Bestie`);
  const searchBody = await searchResponse.json();
  if (!searchResponse.ok || searchBody.query !== "Bestie" || searchBody.memories?.length !== 1 || !searchBody.memories[0]?.content.includes("Bestie")) {
    throw new Error(`Unexpected memory search response for ${searchUrl}: ${searchResponse.status} ${JSON.stringify(searchBody)}`);
  }

  const pendingId = body.pending[0]?.id;
  const missingConfirmResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve_pending", id: pendingId }) });
  const missingConfirmBody = await missingConfirmResponse.json();
  if (missingConfirmResponse.status !== 400 || missingConfirmBody.code !== "UiMemoryActionConfirmationRequired") {
    throw new Error(`Unexpected memory action confirmation response for ${actionUrl}: ${missingConfirmResponse.status} ${JSON.stringify(missingConfirmBody)}`);
  }

  const approveResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve_pending", id: pendingId, confirm: true }) });
  const approveBody = await approveResponse.json();
  if (!approveResponse.ok || approveBody.counts?.active !== 3 || approveBody.counts?.pending !== 0) {
    throw new Error(`Unexpected memory approve response for ${actionUrl}: ${approveResponse.status} ${JSON.stringify(approveBody)}`);
  }
}

async function assertCharacter(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.character?.parsed?.name !== "Bestie" || body.prompt?.text !== "You are Bestie.\n") {
    throw new Error(`Unexpected character response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }

  const invalidResponse = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterText: "{}" }) });
  if (invalidResponse.ok) {
    throw new Error("Character update accepted invalid character JSON.");
  }

  const nextCharacter = JSON.parse(body.character.text);
  nextCharacter.name = "Miu";
  nextCharacter.tone.roastLevel = 4;
  const updateResponse = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterText: JSON.stringify(nextCharacter), promptText: "You are Miu.\n" }) });
  const updated = await updateResponse.json();
  if (!updateResponse.ok || updated.character?.parsed?.name !== "Miu" || updated.character?.parsed?.tone?.roastLevel !== 4 || updated.prompt?.text !== "You are Miu.\n") {
    throw new Error(`Unexpected character update response for ${url}: ${updateResponse.status} ${JSON.stringify(updated)}`);
  }
}

async function assertProviderPrimary(url, providersUrl) {
  const missingResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const missingBody = await missingResponse.json();
  if (missingResponse.status !== 400 || missingBody.code !== "UiProviderMissingModelRef") {
    throw new Error(`Unexpected provider primary rejection for ${url}: ${missingResponse.status} ${JSON.stringify(missingBody)}`);
  }

  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelRef: "gemini/gemini-2.5-flash" }) });
  const body = await response.json();
  if (!response.ok || body.primary?.modelRef !== "gemini/gemini-2.5-flash" || body.primary?.baseUrl !== "SDK default" || body.primary?.secretPresent !== true) {
    throw new Error(`Unexpected provider primary response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  if (body.fallbacks.some((fallback) => fallback.modelRef === "gemini/gemini-2.5-flash")) {
    throw new Error(`Primary model was not removed from fallbacks: ${JSON.stringify(body)}`);
  }

  const refreshed = await fetch(providersUrl).then((result) => result.json());
  if (refreshed.primary?.modelRef !== "gemini/gemini-2.5-flash") {
    throw new Error(`Provider primary was not persisted: ${JSON.stringify(refreshed)}`);
  }
}

async function assertProviderFallbacks(url, providersUrl) {
  const invalidResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add", modelRef: "gemini/gemini-2.5-flash" }) });
  if (invalidResponse.ok) {
    throw new Error("Provider fallback add accepted the primary model.");
  }

  const addResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add", modelRef: "openai/test-model" }) });
  const addBody = await addResponse.json();
  if (!addResponse.ok || !addBody.fallbacks.some((fallback) => fallback.modelRef === "openai/test-model")) {
    throw new Error(`Unexpected provider fallback add response for ${url}: ${addResponse.status} ${JSON.stringify(addBody)}`);
  }

  const removeResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", modelRef: "openai/test-model" }) });
  const removeBody = await removeResponse.json();
  if (!removeResponse.ok || removeBody.fallbacks.some((fallback) => fallback.modelRef === "openai/test-model")) {
    throw new Error(`Unexpected provider fallback remove response for ${url}: ${removeResponse.status} ${JSON.stringify(removeBody)}`);
  }

  const refreshed = await fetch(providersUrl).then((result) => result.json());
  if (refreshed.fallbacks.some((fallback) => fallback.modelRef === "openai/test-model")) {
    throw new Error(`Provider fallback removal was not persisted: ${JSON.stringify(refreshed)}`);
  }
}

async function assertProviderSetup(url, providersUrl) {
  const missingResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const missingBody = await missingResponse.json();
  if (missingResponse.status !== 400 || missingBody.code !== "UiProviderSetupMissingProvider") {
    throw new Error(`Unexpected provider setup rejection for ${url}: ${missingResponse.status} ${JSON.stringify(missingBody)}`);
  }

  const geminiBaseUrlResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "gemini", baseUrl: "http://127.0.0.1:1234" }) });
  if (geminiBaseUrlResponse.ok) {
    throw new Error("Gemini setup accepted baseUrl.");
  }

  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "groq", model: "llama-3.3-70b-versatile", apiKeyEnv: "GROQ_API_KEY", secret: "test-groq-key", setDefault: true }) });
  const body = await response.json();
  if (!response.ok || body.primary?.modelRef !== "groq/llama-3.3-70b-versatile" || body.primary?.baseUrl !== "https://api.groq.com/openai/v1" || body.primary?.secretPresent !== true) {
    throw new Error(`Unexpected provider setup response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  if (JSON.stringify(body).includes("test-groq-key")) {
    throw new Error("Provider setup response leaked a secret value.");
  }

  const refreshed = await fetch(providersUrl).then((result) => result.json());
  if (refreshed.primary?.modelRef !== "groq/llama-3.3-70b-versatile" || !refreshed.profiles.some((profile) => profile.id === "groq:api-key" && profile.secretPresent === true)) {
    throw new Error(`Provider setup was not persisted: ${JSON.stringify(refreshed)}`);
  }
}

async function assertProviders(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.primary?.provider !== "openai-compatible" || body.primary?.secretPresent !== true) {
    throw new Error(`Unexpected providers response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  const openaiProfile = body.profiles?.find((profile) => profile.id === "openai:api-key");
  const geminiProfile = body.profiles?.find((profile) => profile.id === "gemini:api-key");
  if (body.primary.baseUrl !== "http://127.0.0.1:9/v1" || openaiProfile?.baseUrl !== "http://127.0.0.1:9/v1" || geminiProfile?.baseUrl !== "SDK default") {
    throw new Error(`Unexpected provider baseUrl response for ${url}: ${JSON.stringify(body)}`);
  }
  if (JSON.stringify(body).includes("test-key")) {
    throw new Error("Provider API response leaked a secret value.");
  }
}

async function assertProviderTest(url) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await response.json();
  if (!response.ok || body.modelRef !== "openai/test-model" || body.ok !== false || typeof body.message !== "string") {
    throw new Error(`Unexpected provider test response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  if (JSON.stringify(body).includes("test-key")) {
    throw new Error("Provider test API response leaked a secret value.");
  }
}

async function assertDoctor(url) {
  const response = await fetch(url);
  const text = await response.text();
  const body = JSON.parse(text);
  if (!response.ok || typeof body.ok !== "boolean" || !body.report || !body.summary) {
    throw new Error(`Unexpected doctor response for ${url}: ${response.status} ${text}`);
  }
  const contract = validateDoctorReportContract(body.report);
  if (!contract.valid) {
    throw new Error(contract.errors.join("\n"));
  }
  const jsonContract = validateDoctorReportJsonContract(JSON.stringify(body.report));
  if (!jsonContract.valid) {
    throw new Error(jsonContract.errors.join("\n"));
  }
}

async function assertDoctorFixRequiresConfirmation(url) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await response.json();
  if (response.status !== 400 || body.ok !== false || body.code !== "UiDoctorFixConfirmationRequired") {
    throw new Error(`Unexpected doctor fix rejection for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
}

async function assertDoctorFix(url) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
  const text = await response.text();
  const body = JSON.parse(text);
  if (!response.ok || typeof body.ok !== "boolean" || !body.report || !body.summary) {
    throw new Error(`Unexpected doctor fix response for ${url}: ${response.status} ${text}`);
  }
  const contract = validateDoctorReportJsonContract(JSON.stringify(body.report));
  if (!contract.valid) {
    throw new Error(contract.errors.join("\n"));
  }
}
