import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
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
  await assertKnowledgeGraph(`${server.url}/api/knowledge-graph`, `${server.url}/api/knowledge-graph/search`, `${server.url}/api/knowledge-graph/action`, `${server.url}/api/approvals`, `${server.url}/api/approvals/action`);
  await assertMcp(`${server.url}/api/mcp`);
  await assertTools(`${server.url}/api/tools`);
  await assertSkills(`${server.url}/api/skills`, `${server.url}/api/skills/item`, `${server.url}/api/skills/delete`);
  await assertSettings(`${server.url}/api/settings`, `${server.url}/api/config/summary`);
  await assertHome(`${server.url}/`, `${server.url}/assets/home.js`);
  await assertChatStream(`${server.url}/api/chat/stream`, `${server.url}/api/chat/sessions`, `${server.url}/api/chat/session`, `${server.url}/api/chat/search`, `${server.url}/api/chat/continue/stream`, `${server.url}/api/chat/retry`, `${server.url}/api/chat/replay`, `${server.url}/api/chat/fork`, `${server.url}/api/chat/export`, `${server.url}/api/chat/import`, `${server.url}/api/approvals`, `${server.url}/api/approvals/action`, `${server.url}/api/providers/setup`);
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
  if (!response.ok || !html.includes("Bestie UI") || !html.includes("/assets/cytoscape.min.js") || !html.includes("/assets/home.js") || !html.includes("memory-panel") || !html.includes("knowledge-panel") || !html.includes("channel-panel") || !html.includes("approvals-panel") || !html.includes("mcp-panel") || !html.includes("tools-panel") || !html.includes("settings-panel") || !html.includes("input-dialog") || html.includes("topbar") || html.includes("status-strip") || html.includes("metric-grid") || html.includes("/api/status") || html.includes("data-provider-preset")) {
    throw new Error(`Unexpected home response for ${url}: ${response.status}`);
  }
  const scriptResponse = await fetch(scriptUrl);
  const script = await scriptResponse.text();
  if (!scriptResponse.ok || !script.includes("/api/status") || !script.includes("/api/doctor") || !script.includes("/api/doctor/fix") || !script.includes("/api/providers") || !script.includes("/api/providers/test") || !script.includes("/api/character") || !script.includes("/api/memory") || !script.includes("/api/knowledge-graph") || !script.includes("/api/knowledge-graph/action") || !script.includes("/api/channels") || !script.includes("/api/channels/action") || !script.includes("/api/approvals") || !script.includes("/api/approvals/action") || !script.includes("/api/mcp") || !script.includes("/api/tools") || !script.includes("/api/settings") || !script.includes("data-provider-preset") || !script.includes("character-form") || !script.includes("data-channel-action") || !script.includes("settings-form") || !script.includes("provider-setup-note") || !script.includes("data-provider-field") || !script.includes("data-approval-action") || !script.includes("memory-row") || !script.includes("knowledge-row") || !script.includes("knowledge-cytoscape") || !script.includes("knowledge-provenance-overlay") || !script.includes("renderKnowledgeProvenanceOverlay") || !script.includes("getSelectedKnowledgeItem") || !script.includes("renderKnowledgeCytoscapeGraph") || !script.includes("data-knowledge-graph-action") || !script.includes("data-knowledge-overlay-toggle") || !script.includes("knowledgeOverlayCollapsed") || !script.includes("KNOWLEDGE_MAP_PREFS_KEY") || !script.includes("data-knowledge-view-save") || !script.includes("applyKnowledgeMapView") || !script.includes("knowledge-cluster-by") || !script.includes("knowledgeRelationDensity") || !script.includes("knowledge-motion") || !script.includes("knowledgeMotionEnabled") || !script.includes("knowledgeGraphLayoutOptions") || !script.includes("buildKnowledgeClusterElements") || !script.includes("renderKnowledgeClusterDrilldown") || !script.includes("data-knowledge-cluster-expand") || !script.includes("clearKnowledgeGraphFocus") || !script.includes("unfocus") || !script.includes("knowledge-kind-filter") || !script.includes("knowledge-visible-count") || !script.includes("knowledge-map-search") || !script.includes("focusKnowledgeGraphSearchResult") || !script.includes("applyKnowledgeConnectedOnlyFilter") || !script.includes("applyKnowledgeGraphFilters") || !script.includes("applyKnowledgeGraphSelectionHighlight") || !script.includes("knowledge-svg") || !script.includes("knowledge-inspector") || !script.includes("knowledge-timeline") || !script.includes("knowledge-review-toolbar") || !script.includes("knowledge-trust") || !script.includes("knowledge-trust-filter") || !script.includes("renderKnowledgeTrustDashboard") || !script.includes("Impact preview") || !script.includes("data-knowledge-jump-type") || !script.includes("Why this exists") || !script.includes("data-knowledge-action") || !script.includes("data-knowledge-select") || !script.includes("data-knowledge-source-session") || !script.includes("jumpToKnowledgeSource") || !script.includes("source-highlight") || !script.includes("data-mcp-summary") || !script.includes("data-mcp-server") || !script.includes("data-mcp-categories") || !script.includes("data-tools-summary") || !script.includes("data-tool-policy") || !script.includes("message-menu") || !script.includes("data-chat-inspect-run") || !script.includes("chat-replay-run") || !script.includes("renderChatInspector") || !script.includes("chat-composer-status") || !script.includes("resizeChatComposer") || !script.includes("loadChatAttachments") || !script.includes("chat-attachment-preview") || !script.includes("scrollChatTranscriptToBottom") || !script.includes("hashchange")) {
    throw new Error(`Unexpected home script response for ${scriptUrl}: ${scriptResponse.status}`);
  }
  if (!script.includes("startKnowledgeAmbientMotion") || !script.includes("stopKnowledgeAmbientMotion") || !script.includes("knowledgeAmbientMotionToken")) {
    throw new Error(`Knowledge graph ambient motion hooks missing from ${scriptUrl}`);
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

async function assertSkills(url, itemUrl, deleteUrl) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.count !== 1 || body.skills?.[0]?.name !== "smoke-skill") {
    throw new Error(`Unexpected skills response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }

  const writeResponse = await fetch(itemUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "api-smoke", content: "# API Smoke\n\nCreated by API smoke.\n" }) });
  const written = await writeResponse.json();
  if (!writeResponse.ok || !written.skills?.some((skill) => skill.name === "api-smoke")) {
    throw new Error(`Unexpected skill write response for ${itemUrl}: ${writeResponse.status} ${JSON.stringify(written)}`);
  }

  const itemResponse = await fetch(`${itemUrl}?name=api-smoke`);
  const item = await itemResponse.json();
  if (!itemResponse.ok || !item.content?.includes("Created by API smoke.")) {
    throw new Error(`Unexpected skill item response for ${itemUrl}: ${itemResponse.status} ${JSON.stringify(item)}`);
  }

  const deleteResponse = await fetch(deleteUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "api-smoke", confirm: true }) });
  const deleted = await deleteResponse.json();
  if (!deleteResponse.ok || deleted.skills?.some((skill) => skill.name === "api-smoke")) {
    throw new Error(`Unexpected skill delete response for ${deleteUrl}: ${deleteResponse.status} ${JSON.stringify(deleted)}`);
  }
}

async function assertChatStream(url, sessionsUrl, sessionUrl, searchUrl, continueUrl, retryUrl, replayUrl, forkUrl, exportUrl, importUrl, approvalsUrl, approvalsActionUrl, providerSetupUrl) {
  const fakeProvider = await startFakeStreamingProvider();
  try {
    const setupResponse = await fetch(providerSetupUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "openai", model: "stream-smoke", baseUrl: fakeProvider.url, apiKeyEnv: "OPENAI_API_KEY", setDefault: true }) });
    const setupBody = await setupResponse.json();
    if (!setupResponse.ok || setupBody.ok !== true) {
      throw new Error(`Unexpected provider setup response for chat stream smoke: ${setupResponse.status} ${JSON.stringify(setupBody)}`);
    }

    const sessionCreateResponse = await fetch(sessionsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Smoke chat" }) });
    const sessionCreate = await sessionCreateResponse.json();
    if (!sessionCreateResponse.ok || !sessionCreate.session?.id) {
      throw new Error(`Unexpected chat session create response: ${sessionCreateResponse.status} ${JSON.stringify(sessionCreate)}`);
    }

    const preferencesResponse = await fetch(sessionUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: sessionCreate.session.id, toolsEnabled: false, memoryEnabled: false, providerModelRef: "openai/stream-smoke" }) });
    const preferences = await preferencesResponse.json();
    if (!preferencesResponse.ok || preferences.session?.toolsEnabled !== false || preferences.session?.memoryEnabled !== false || preferences.session?.providerModelRef !== "openai/stream-smoke") {
      throw new Error(`Unexpected chat preferences response: ${preferencesResponse.status} ${JSON.stringify(preferences)}`);
    }

    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Say hi", sessionId: sessionCreate.session.id, history: [], toolsEnabled: true, memoryEnabled: false, providerModelRef: "openai/stream-smoke", attachments: [{ name: "note.md", type: "text/markdown", size: 13, content: "attached note" }] }) });
    const body = await response.text();
    if (!response.ok || !body.includes("event: ready") || !body.includes("event: done") || !body.includes("stream smoke answer")) {
      throw new Error(`Unexpected chat stream response for ${url}: ${response.status} ${body}`);
    }
    if (!fakeProvider.requests.some((request) => request.model === "stream-smoke" && JSON.stringify(request).includes("attached note"))) {
      throw new Error(`Chat provider override or attachment context was not sent to the provider: ${JSON.stringify(fakeProvider.requests)}`);
    }

    const messagesResponse = await fetch(`${sessionUrl}?id=${sessionCreate.session.id}`);
    const messages = await messagesResponse.json();
    if (!messagesResponse.ok || messages.messages?.length !== 2 || messages.messages[0]?.content !== "Say hi" || messages.messages[1]?.content !== "stream smoke answer") {
      throw new Error(`Unexpected persisted chat messages: ${messagesResponse.status} ${JSON.stringify(messages)}`);
    }
    if (!messages.runs?.[0]?.id || messages.runs[0].status !== "done" || messages.runs[0].model !== "openai/stream-smoke" || messages.runs[0].assistantMessageId !== messages.messages[1].id || messages.messages[1].runId !== messages.runs[0].id) {
      throw new Error(`Unexpected persisted chat run: ${messagesResponse.status} ${JSON.stringify(messages.runs)} ${JSON.stringify(messages.messages)}`);
    }
    const runMetadata = JSON.parse(messages.runs[0].metadataJson ?? "{}");
    if (runMetadata.attachmentCount !== 1 || runMetadata.attachments?.[0]?.name !== "note.md") {
      throw new Error(`Unexpected persisted chat run metadata: ${JSON.stringify(runMetadata)}`);
    }
    const eventTypes = (messages.events ?? []).map((event) => event.eventType);
    if (!eventTypes.includes("thinking") || !eventTypes.includes("done")) {
      throw new Error(`Unexpected persisted chat timeline: ${messagesResponse.status} ${JSON.stringify(messages.events)}`);
    }
    if (!(messages.events ?? []).filter((event) => ["thinking", "done"].includes(event.eventType)).every((event) => event.runId === messages.runs[0].id)) {
      throw new Error(`Chat timeline events were not linked to the run: ${JSON.stringify(messages.events)}`);
    }

    const replayPrepareResponse = await fetch(replayUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionCreate.session.id, runId: messages.runs[0].id, confirm: true }) });
    const replayPrepare = await replayPrepareResponse.json();
    if (!replayPrepareResponse.ok || replayPrepare.retryMessage !== "Say hi" || replayPrepare.replay?.providerModelRef !== "openai/stream-smoke" || replayPrepare.replay?.toolsEnabled !== true || replayPrepare.replay?.memoryEnabled !== false || replayPrepare.replay?.attachments?.[0]?.content !== "attached note" || replayPrepare.messages?.length !== 1) {
      throw new Error(`Unexpected chat run replay prepare response: ${replayPrepareResponse.status} ${JSON.stringify(replayPrepare)}`);
    }
    const replayRunResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: replayPrepare.retryMessage, sessionId: sessionCreate.session.id, history: replayPrepare.history, attachments: replayPrepare.replay.attachments, toolsEnabled: replayPrepare.replay.toolsEnabled, memoryEnabled: replayPrepare.replay.memoryEnabled, providerModelRef: replayPrepare.replay.providerModelRef, replaySourceRunId: messages.runs[0].id }) });
    const replayRunBody = await replayRunResponse.text();
    if (!replayRunResponse.ok || !replayRunBody.includes("stream smoke answer")) {
      throw new Error(`Unexpected chat replay stream response: ${replayRunResponse.status} ${replayRunBody}`);
    }
    const replayedSession = await fetch(`${sessionUrl}?id=${sessionCreate.session.id}`).then((result) => result.json());
    const replayedRun = replayedSession.runs?.at(-1);
    const replayedMetadata = JSON.parse(replayedRun?.metadataJson ?? "{}");
    if (!replayedRun || replayedRun.id === messages.runs[0].id || replayedMetadata.replaySourceRunId !== messages.runs[0].id || replayedMetadata.output !== "stream smoke answer") {
      throw new Error(`Replay source run was not persisted for diffing: ${JSON.stringify(replayedRun)} ${JSON.stringify(replayedMetadata)}`);
    }

    const retryPrepareResponse = await fetch(retryUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionCreate.session.id, confirm: true }) });
    const retryPrepare = await retryPrepareResponse.json();
    if (!retryPrepareResponse.ok || retryPrepare.retryMessage !== "Say hi" || retryPrepare.messages?.filter((message) => message.role === "user").length !== 2 || retryPrepare.history?.length !== 1) {
      throw new Error(`Unexpected chat retry prepare response: ${retryPrepareResponse.status} ${JSON.stringify(retryPrepare)}`);
    }
    const retryResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: retryPrepare.retryMessage, sessionId: sessionCreate.session.id, history: retryPrepare.history, toolsEnabled: true, memoryEnabled: false }) });
    const retryBody = await retryResponse.text();
    if (!retryResponse.ok || !retryBody.includes("stream smoke answer")) {
      throw new Error(`Unexpected chat retry stream response: ${retryResponse.status} ${retryBody}`);
    }
    const retriedSession = await fetch(`${sessionUrl}?id=${sessionCreate.session.id}`).then((result) => result.json());
    if (retriedSession.messages?.filter((message) => message.role === "assistant").length !== 1 || retriedSession.messages?.filter((message) => message.role === "user").length !== 3 || !retriedSession.events?.some((event) => event.eventType === "retry")) {
      throw new Error(`Unexpected persisted chat retry result: ${JSON.stringify(retriedSession)}`);
    }

    const searchByText = await fetch(`${searchUrl}?q=${encodeURIComponent("Say hi")}&filter=all`).then((result) => result.json());
    if (!searchByText.sessions?.some((session) => session.id === sessionCreate.session.id)) {
      throw new Error(`Chat text search missed session: ${JSON.stringify(searchByText)}`);
    }
    const searchByRetry = await fetch(`${searchUrl}?filter=retry`).then((result) => result.json());
    const retrySession = searchByRetry.sessions?.find((session) => session.id === sessionCreate.session.id);
    if (!retrySession || !retrySession.eventTypes?.includes("retry")) {
      throw new Error(`Chat retry filter missed session: ${JSON.stringify(searchByRetry)}`);
    }

    const forkResponse = await fetch(forkUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionCreate.session.id, messageId: retriedSession.messages[0].id, confirm: true }) });
    const forked = await forkResponse.json();
    if (!forkResponse.ok || forked.session?.id === sessionCreate.session.id || forked.messages?.length !== 1 || forked.messages?.[0]?.content !== "Say hi" || !forked.events?.some((event) => event.eventType === "fork")) {
      throw new Error(`Unexpected chat fork response: ${forkResponse.status} ${JSON.stringify(forked)}`);
    }
    if (!forked.session?.eventTypes?.includes("fork")) {
      throw new Error(`Forked session missed event type badges: ${JSON.stringify(forked.session)}`);
    }

    const exportResponse = await fetch(`${exportUrl}?id=${sessionCreate.session.id}`);
    const exported = await exportResponse.json();
    if (!exportResponse.ok || exported.export?.messages?.length !== retriedSession.messages.length || !exported.markdown?.includes("# Smoke chat")) {
      throw new Error(`Unexpected chat export response: ${exportResponse.status} ${JSON.stringify(exported)}`);
    }
    const importResponse = await fetch(importUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exported.export) });
    const imported = await importResponse.json();
    if (!importResponse.ok || imported.session?.id === sessionCreate.session.id || imported.messages?.length !== exported.export.messages.length || !imported.session?.title?.includes("Smoke chat")) {
      throw new Error(`Unexpected chat import response: ${importResponse.status} ${JSON.stringify(imported)}`);
    }

    const cancelSessionResponse = await fetch(sessionsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Cancel smoke" }) });
    const cancelSession = await cancelSessionResponse.json();
    if (!cancelSessionResponse.ok || !cancelSession.session?.id) {
      throw new Error(`Unexpected cancel chat session response: ${cancelSessionResponse.status} ${JSON.stringify(cancelSession)}`);
    }
    const cancelController = new AbortController();
    const cancelPromise = fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "slow stream smoke", sessionId: cancelSession.session.id, history: [], toolsEnabled: true, memoryEnabled: false }), signal: cancelController.signal }).catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 30));
    cancelController.abort();
    await cancelPromise;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const cancelledSession = await fetch(`${sessionUrl}?id=${cancelSession.session.id}`).then((result) => result.json());
    if (!cancelledSession.events?.some((event) => event.eventType === "cancelled")) {
      throw new Error(`Cancelled chat stream was not persisted: ${JSON.stringify(cancelledSession.events)}`);
    }

    const approvalSessionResponse = await fetch(sessionsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Approval smoke" }) });
    const approvalSession = await approvalSessionResponse.json();
    if (!approvalSessionResponse.ok || !approvalSession.session?.id) {
      throw new Error(`Unexpected approval chat session response: ${approvalSessionResponse.status} ${JSON.stringify(approvalSession)}`);
    }

    const approvalResponse = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "request approval smoke", sessionId: approvalSession.session.id, history: [], toolsEnabled: true, memoryEnabled: false, providerModelRef: "openai/stream-smoke" }) });
    const approvalBody = await approvalResponse.text();
    if (!approvalResponse.ok || !approvalBody.includes("approval_required")) {
      throw new Error(`Unexpected chat approval stream response for ${url}: ${approvalResponse.status} ${approvalBody}`);
    }

    const approvals = await fetch(approvalsUrl).then((result) => result.json());
    const chatApproval = approvals.approvals?.find((approval) => approval.channel === "ui-chat" && approval.action === "internal.exec");
    if (!chatApproval) {
      throw new Error(`Chat approval was not listed: ${JSON.stringify(approvals)}`);
    }

    const approveResponse = await fetch(approvalsActionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", id: chatApproval.id, confirm: true }) });
    const approved = await approveResponse.json();
    if (!approveResponse.ok || approved.approval?.status !== "approved") {
      throw new Error(`Unexpected chat approval approve response: ${approveResponse.status} ${JSON.stringify(approved)}`);
    }

    const continueResponse = await fetch(continueUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: approvalSession.session.id, approvalId: chatApproval.id, confirm: true }) });
    const continueBody = await continueResponse.text();
    if (!continueResponse.ok || !continueBody.includes("event: ready") || !continueBody.includes("event: timeline") || !continueBody.includes("event: done") || !continueBody.includes("approval smoke finished")) {
      throw new Error(`Unexpected chat continue stream response: ${continueResponse.status} ${continueBody}`);
    }

    const continuedSession = await fetch(`${sessionUrl}?id=${approvalSession.session.id}`).then((result) => result.json());
    const continuedEventTypes = (continuedSession.events ?? []).map((event) => event.eventType);
    if (!continuedSession.messages?.some((message) => message.role === "assistant" && message.content === "approval smoke finished") || !continuedEventTypes.includes("approval_approved") || !continuedEventTypes.includes("tool_finish") || !continuedEventTypes.includes("done")) {
      throw new Error(`Unexpected persisted chat continue result: ${JSON.stringify(continuedSession)}`);
    }

    const messageCountAfterContinue = continuedSession.messages.length;
    const duplicateContinueResponse = await fetch(continueUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: approvalSession.session.id, approvalId: chatApproval.id, confirm: true }) });
    const duplicateContinueBody = await duplicateContinueResponse.text();
    if (!duplicateContinueResponse.ok || !duplicateContinueBody.includes("Approved action already continued")) {
      throw new Error(`Unexpected duplicate chat continue response: ${duplicateContinueResponse.status} ${duplicateContinueBody}`);
    }
    const duplicateSession = await fetch(`${sessionUrl}?id=${approvalSession.session.id}`).then((result) => result.json());
    if (duplicateSession.messages?.length !== messageCountAfterContinue || duplicateSession.approvals?.[String(chatApproval.id)]?.status !== "executed") {
      throw new Error(`Duplicate chat continue changed persisted state: ${JSON.stringify(duplicateSession)}`);
    }
  } finally {
    await fakeProvider.close();
  }
}

async function startFakeStreamingProvider() {
  const requests = [];
  const server = createServer((request, response) => {
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try { requests.push(JSON.parse(body)); } catch { requests.push({ raw: body }); }
      const content = body.includes("Tool result for internal.exec")
        ? '{"answer":"approval smoke finished"}'
        : body.includes("request approval smoke")
        ? JSON.stringify({ tool: "internal.exec", arguments: { command: "node", args: ["--version"], cwd: "." } })
        : '{"answer":"stream smoke answer"}';
      if (body.includes('"stream":true')) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        setTimeout(() => {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
          response.end("data: [DONE]\n\n");
        }, 120);
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start fake provider.");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function assertMcp(url) {
  const response = await fetch(url);
  const body = await response.json();
  const fsServer = body.servers?.find((server) => server.name === "fs");
  const remoteServer = body.servers?.find((server) => server.name === "remote-oauth");
  const serialized = JSON.stringify(body);
  if (!response.ok || body.ok !== true || body.counts?.total !== 2 || body.counts?.enabled !== 1 || body.counts?.tools !== 3 || !fsServer || !remoteServer) {
    throw new Error(`Unexpected MCP response for ${url}: ${response.status} ${serialized}`);
  }
  if (fsServer.transport !== "stdio" || fsServer.envKeys?.[0] !== "MCP_SECRET" || fsServer.commandConfigured !== true || fsServer.argCount !== 1) {
    throw new Error(`Unexpected stdio MCP summary for ${url}: ${JSON.stringify(fsServer)}`);
  }
  if (remoteServer.transport !== "http" || remoteServer.headerEnvNames?.[0] !== "REMOTE_MCP_TOKEN" || remoteServer.auth?.envVar !== "REMOTE_MCP_OAUTH" || remoteServer.tools?.categories?.[0] !== "public_action") {
    throw new Error(`Unexpected remote MCP summary for ${url}: ${JSON.stringify(remoteServer)}`);
  }
  if (!fsServer.tools?.names?.includes("COMPOSIO_GET_TOOL_SCHEMAS")) {
    throw new Error(`Expected long MCP tool name in fixture for ${url}: ${JSON.stringify(fsServer.tools)}`);
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

async function assertKnowledgeGraph(url, searchUrl, actionUrl, approvalsUrl, approvalActionUrl) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.counts?.entities !== 3 || body.counts?.relations !== 2 || body.counts?.pending !== 1 || body.entities?.length !== 3 || body.relations?.length !== 2 || body.pending?.length !== 1 || body.analysis?.checkedEntities !== 3 || typeof body.review?.score !== "number") {
    throw new Error(`Unexpected knowledge graph response for ${url}: ${response.status} ${JSON.stringify(body)}`);
  }
  if (!body.relations?.some((relation) => relation.sourceName === "User" && relation.relationType === "works_on" && relation.targetName === "Bestie")) {
    throw new Error(`Knowledge graph response missed seeded relation for ${url}: ${JSON.stringify(body)}`);
  }
  if (typeof body.trust?.averageScore !== "number" || !body.entities?.every((entity) => typeof entity.trust?.score === "number" && Array.isArray(entity.trust?.signals)) || !body.relations?.every((relation) => typeof relation.trust?.score === "number" && Array.isArray(relation.trust?.warnings))) {
    throw new Error(`Knowledge graph response missed trust metrics for ${url}: ${JSON.stringify(body)}`);
  }
  if (!body.entities?.every((entity) => typeof entity.createdAt === "string" && typeof entity.updatedAt === "string") || !body.relations?.every((relation) => typeof relation.createdAt === "string" && typeof relation.updatedAt === "string")) {
    throw new Error(`Knowledge graph response missed audit timestamps for ${url}: ${JSON.stringify(body)}`);
  }
  if (!body.entities?.every((entity) => Array.isArray(entity.auditTrail) && entity.auditTrail.some((event) => event.eventType === "created")) || !body.relations?.every((relation) => Array.isArray(relation.auditTrail) && relation.auditTrail.some((event) => event.eventType === "created"))) {
    throw new Error(`Knowledge graph response missed audit trail events for ${url}: ${JSON.stringify(body)}`);
  }

  const searchResponse = await fetch(`${searchUrl}?q=${encodeURIComponent("Bestie UI")}`);
  const searchBody = await searchResponse.json();
  if (!searchResponse.ok || searchBody.query !== "Bestie UI" || !searchBody.entities?.some((entity) => entity.canonicalName === "Bestie UI") || !searchBody.relations?.some((relation) => relation.targetName === "Bestie UI")) {
    throw new Error(`Unexpected knowledge graph search response for ${searchUrl}: ${searchResponse.status} ${JSON.stringify(searchBody)}`);
  }

  const relationId = body.relations?.find((relation) => relation.relationType === "includes")?.id;
  const missingConfirmResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_relation", id: relationId, confidence: 0.55 }) });
  const missingConfirmBody = await missingConfirmResponse.json();
  if (missingConfirmResponse.status !== 400 || missingConfirmBody.code !== "UiKnowledgeGraphActionConfirmationRequired") {
    throw new Error(`Unexpected graph action confirmation response for ${actionUrl}: ${missingConfirmResponse.status} ${JSON.stringify(missingConfirmBody)}`);
  }

  const actionResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_relation", id: relationId, confidence: 0.55, reason: "UI smoke reviewed relation confidence.", confirm: true }) });
  const actionBody = await actionResponse.json();
  if (!actionResponse.ok || actionBody.action !== "update_relation" || actionBody.actionStatus !== "queued" || typeof actionBody.approvalId !== "number") {
    throw new Error(`Unexpected graph queued action response for ${actionUrl}: ${actionResponse.status} ${JSON.stringify(actionBody)}`);
  }

  const approvalsResponse = await fetch(approvalsUrl);
  const approvalsBody = await approvalsResponse.json();
  if (!approvalsResponse.ok || approvalsBody.count !== 1 || approvalsBody.approvals?.[0]?.id !== actionBody.approvalId || approvalsBody.approvals?.[0]?.channel !== "ui") {
    throw new Error(`Unexpected graph approval response for ${approvalsUrl}: ${approvalsResponse.status} ${JSON.stringify(approvalsBody)}`);
  }

  const approveResponse = await fetch(approvalActionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", id: actionBody.approvalId, confirm: true }) });
  const approveBody = await approveResponse.json();
  if (!approveResponse.ok || approveBody.execution?.status !== "executed" || approveBody.count !== 0) {
    throw new Error(`Unexpected graph approval execution response for ${approvalActionUrl}: ${approveResponse.status} ${JSON.stringify(approveBody)}`);
  }

  const updatedResponse = await fetch(url);
  const updatedBody = await updatedResponse.json();
  const updatedRelation = updatedBody.relations?.find((relation) => relation.id === relationId);
  if (!updatedResponse.ok || updatedRelation?.confidence !== 0.55) {
    throw new Error(`Knowledge graph relation was not updated after approval for ${url}: ${updatedResponse.status} ${JSON.stringify(updatedBody)}`);
  }

  const entityId = updatedBody.entities?.find((entity) => entity.canonicalName === "Bestie UI")?.id;
  const forgetEntityResponse = await fetch(actionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "forget_entity", id: entityId, reason: "UI smoke undo captured entity.", confirm: true }) });
  const forgetEntityBody = await forgetEntityResponse.json();
  if (!forgetEntityResponse.ok || forgetEntityBody.action !== "forget_entity" || forgetEntityBody.actionStatus !== "queued" || typeof forgetEntityBody.approvalId !== "number") {
    throw new Error(`Unexpected graph entity forget response for ${actionUrl}: ${forgetEntityResponse.status} ${JSON.stringify(forgetEntityBody)}`);
  }

  const approveForgetResponse = await fetch(approvalActionUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", id: forgetEntityBody.approvalId, confirm: true }) });
  const approveForgetBody = await approveForgetResponse.json();
  if (!approveForgetResponse.ok || approveForgetBody.execution?.status !== "executed" || approveForgetBody.count !== 0) {
    throw new Error(`Unexpected graph entity forget approval response for ${approvalActionUrl}: ${approveForgetResponse.status} ${JSON.stringify(approveForgetBody)}`);
  }

  const afterForgetBody = await fetch(url).then((result) => result.json());
  if (afterForgetBody.entities?.some((entity) => entity.id === entityId)) {
    throw new Error(`Knowledge graph entity was not forgotten after approval for ${url}: ${JSON.stringify(afterForgetBody)}`);
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
