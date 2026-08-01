import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { getUiApprovalsSummary, runUiApprovalAction } from "./api/approvals.js";
import type { AgentToolActivity } from "../chat/mcp-tool-use.js";
import { SqliteMemoryStore } from "../memory/sqlite-store.js";
import { getUiCharacterSummary, updateUiCharacter } from "./api/character.js";
import { getUiChannelSummary, runUiChannelAction } from "./api/channels.js";
import { createUiChatSession, deleteUiChatSession, exportUiChatSession, forkUiChatSession, getUiChatSessionEvents, getUiChatSessionMessages, getUiChatSessions, importUiChatSession, prepareUiChatRetry, prepareUiChatRunReplay, runUiChat, runUiChatContinue, searchUiChatSessions, updateUiChatSession } from "./api/chat.js";
import { getUiDoctorSummary, runUiDoctorFix } from "./api/doctor.js";
import { getUiKnowledgeGraphSummary, runUiKnowledgeGraphAction, searchUiKnowledgeGraph } from "./api/knowledge-graph.js";
import { getUiMemorySummary, runUiMemoryAction, searchUiMemories } from "./api/memory.js";
import { getUiMcpSummary } from "./api/mcp.js";
import { getUiProviderSummary, runUiProviderTest, setUiProviderPrimary, setupUiProvider, updateUiProviderFallback } from "./api/providers.js";
import { getUiSettingsSummary, updateUiSettings } from "./api/settings.js";
import { clearUiSkillRemoteRegistryCache, deleteUiSkill, getUiSkill, getUiSkillLibrary, getUiSkillLibraryDiff, getUiSkillLibraryItem, getUiSkillsSummary, installUiSkillFromLibrary, rollbackUiSkill, testUiSkillRemoteRegistry, toggleUiSkillEnabled, writeUiSkill } from "./api/skills.js";
import { getUiStatusSummary } from "./api/status.js";
import { getUiToolsSummary, updateUiToolPolicy } from "./api/tools.js";
import { HOME_PAGE_CLIENT_SCRIPT } from "./home/client-script.js";
import { renderHomePage } from "./home-page.js";

const require = createRequire(import.meta.url);
const CYTOSCAPE_SCRIPT_PATH = require.resolve("cytoscape/dist/cytoscape.min.js");
const BESTIE_ICON_PNG_PATH = fileURLToPath(new URL("../../assets/bestie-app-icon.png", import.meta.url));
const BESTIE_ICON_ICO_PATH = fileURLToPath(new URL("../../assets/bestie-app-icon.ico", import.meta.url));
const UI_WEB_INDEX_PATH = fileURLToPath(new URL("./web/index.html", import.meta.url));
const UI_WEB_ROUTE_PATHS = new Set(["/chat", "/doctor", "/providers", "/character", "/memory", "/knowledge", "/channels", "/approvals", "/mcp", "/tools", "/skills", "/settings"]);

export interface UiServerOptions {
  host?: string;
  port?: number;
}

export interface RunningUiServer {
  close: () => Promise<void>;
  host: string;
  port: number;
  server: Server;
  url: string;
}

export async function startUiServer(options: UiServerOptions = {}): Promise<RunningUiServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 8787;
  const server = createServer(handleRequest);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port: requestedPort }, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve Bestie UI server address.");
  }

  const port = (address as AddressInfo).port;
  return {
    close: () => closeServer(server),
    host,
    port,
    server,
    url: `http://${host}:${port}`,
  };
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  void handleRequestAsync(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected UI server error.";
    sendJson(response, 500, { ok: false, error: message, code: "UiInternalError" });
  });
}

async function handleRequestAsync(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "bestie-ui" });
    return;
  }

  if (method === "GET" && url.pathname === "/") {
    await sendUiHome(response);
    return;
  }

  if (method === "GET" && url.pathname === "/assets/home.js") {
    sendJavaScript(response, HOME_PAGE_CLIENT_SCRIPT);
    return;
  }

  if (method === "GET" && url.pathname === "/assets/cytoscape.min.js") {
    sendJavaScript(response, await readFile(CYTOSCAPE_SCRIPT_PATH, "utf8"));
    return;
  }

  if (method === "GET" && url.pathname === "/assets/bestie-app-icon.png") {
    sendBinary(response, await readFile(BESTIE_ICON_PNG_PATH), "image/png");
    return;
  }

  if (method === "GET" && (url.pathname === "/assets/bestie-app-icon.ico" || url.pathname === "/favicon.ico")) {
    sendBinary(response, await readFile(BESTIE_ICON_ICO_PATH), "image/x-icon");
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/assets/")) {
    const asset = await readUiWebAsset(url.pathname);
    if (asset) {
      sendBinary(response, asset.body, asset.contentType);
      return;
    }
  }

  if (method === "GET" && url.pathname === "/manifest.webmanifest") {
    sendJson(response, 200, {
      name: "Bestie",
      short_name: "Bestie",
      description: "Bestie local agent console",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#050610",
      theme_color: "#171c62",
      icons: [{ src: "/assets/bestie-app-icon.png", sizes: "1024x1024", type: "image/png", purpose: "any maskable" }],
    });
    return;
  }

  if (method === "GET" && (url.pathname === "/api/status" || url.pathname === "/api/config/summary")) {
    sendJson(response, 200, await getUiStatusSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/doctor") {
    sendJson(response, 200, await getUiDoctorSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/character") {
    sendJson(response, 200, await getUiCharacterSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/channels") {
    sendJson(response, 200, await getUiChannelSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/approvals") {
    sendJson(response, 200, await getUiApprovalsSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/mcp") {
    sendJson(response, 200, await getUiMcpSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/tools") {
    sendJson(response, 200, await getUiToolsSummary());
    return;
  }

  if (method === "PUT" && url.pathname === "/api/tools/policy") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.tool !== "string" || typeof body.policy !== "string") {
      sendJson(response, 400, { ok: false, error: "Tool policy update requires tool and policy.", code: "UiToolPolicyInvalidRequest" });
      return;
    }
    sendJson(response, 200, await updateUiToolPolicy({ tool: body.tool, policy: body.policy as "allow" | "ask" | "deny" }));
    return;
  }

  if (method === "GET" && url.pathname === "/api/settings") {
    sendJson(response, 200, await getUiSettingsSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/skills") {
    sendJson(response, 200, await getUiSkillsSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/skills/library") {
    sendJson(response, 200, await getUiSkillLibrary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/skills/library/item") {
    const name = url.searchParams.get("name") ?? "";
    const sourceId = url.searchParams.get("sourceId") ?? "bundled-official";
    sendJson(response, 200, await getUiSkillLibraryItem(name, undefined, sourceId));
    return;
  }

  if (method === "GET" && url.pathname === "/api/skills/library/diff") {
    const name = url.searchParams.get("name") ?? "";
    const sourceId = url.searchParams.get("sourceId") ?? undefined;
    sendJson(response, 200, await getUiSkillLibraryDiff(name, undefined, sourceId));
    return;
  }

  if (method === "GET" && url.pathname === "/api/skills/item") {
    const name = url.searchParams.get("name") ?? "";
    sendJson(response, 200, await getUiSkill(name));
    return;
  }

  if (method === "GET" && url.pathname === "/api/chat/sessions") {
    sendJson(response, 200, await getUiChatSessions());
    return;
  }

  if (method === "GET" && url.pathname === "/api/chat/search") {
    const filter = url.searchParams.get("filter") ?? "all";
    if (!isUiChatSessionFilter(filter)) {
      sendJson(response, 400, { ok: false, error: "Chat search filter must be all|approval|cancelled|error|fork|retry.", code: "UiChatInvalidSearchFilter" });
      return;
    }
    sendJson(response, 200, await searchUiChatSessions({ query: url.searchParams.get("q") ?? undefined, filter }));
    return;
  }

  if (method === "GET" && url.pathname === "/api/chat/session") {
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id)) {
      sendJson(response, 400, { ok: false, error: "Chat session requires numeric id.", code: "UiChatInvalidSession" });
      return;
    }
    sendJson(response, 200, await getUiChatSessionMessages(id));
    return;
  }

  if (method === "GET" && url.pathname === "/api/chat/events") {
    const id = Number(url.searchParams.get("sessionId"));
    if (!Number.isFinite(id)) {
      sendJson(response, 400, { ok: false, error: "Chat events require numeric sessionId.", code: "UiChatInvalidSession" });
      return;
    }
    sendJson(response, 200, await getUiChatSessionEvents(id));
    return;
  }

  if (method === "PUT" && url.pathname === "/api/settings") {
    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      sendJson(response, 400, { ok: false, error: "Request body must be an object.", code: "UiSettingsInvalidUpdate" });
      return;
    }
    if (body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Settings updates require confirm=true.", code: "UiSettingsConfirmationRequired" });
      return;
    }

    sendJson(response, 200, await updateUiSettings({
      confirm: true,
      ...(isRecord(body.agent) ? { agent: {
        ...(typeof body.agent.name === "string" ? { name: body.agent.name } : {}),
        ...(typeof body.agent.ownerName === "string" ? { ownerName: body.agent.ownerName } : {}),
        ...(typeof body.agent.language === "string" ? { language: body.agent.language } : {}),
        ...(typeof body.agent.toneIntensity === "number" ? { toneIntensity: body.agent.toneIntensity } : {}),
      } } : {}),
      ...(isRecord(body.memory) ? { memory: {
        ...(isMemoryWritePolicy(body.memory.writePolicy) ? { writePolicy: body.memory.writePolicy } : {}),
      } } : {}),
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/approvals/action") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || (body.action !== "approve" && body.action !== "deny") || typeof body.id !== "number") {
      sendJson(response, 400, { ok: false, error: "Missing action approve|deny or numeric id.", code: "UiApprovalInvalidActionRequest" });
      return;
    }
    if (body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Approval actions require confirm=true.", code: "UiApprovalActionConfirmationRequired" });
      return;
    }

    sendJson(response, 200, await runUiApprovalAction({ action: body.action, id: body.id, confirm: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.message !== "string") {
      sendJson(response, 400, { ok: false, error: "Chat requires message.", code: "UiChatInvalidRequest" });
      return;
    }
    sendJson(response, 200, await runUiChat({
      message: body.message,
      sessionId: typeof body.sessionId === "number" ? body.sessionId : undefined,
      history: Array.isArray(body.history) ? body.history.filter(isUiChatMessage) : [],
      attachments: Array.isArray(body.attachments) ? body.attachments.filter(isUiChatAttachment) : [],
      toolsEnabled: body.toolsEnabled !== false,
      memoryEnabled: body.memoryEnabled !== false,
      providerModelRef: typeof body.providerModelRef === "string" && body.providerModelRef ? body.providerModelRef : undefined,
      replaySourceRunId: typeof body.replaySourceRunId === "number" ? body.replaySourceRunId : undefined,
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/sessions") {
    const body = await readJsonBody(request);
    const title = isRecord(body) && typeof body.title === "string" ? body.title : undefined;
    sendJson(response, 200, await createUiChatSession(title));
    return;
  }

  if (method === "GET" && url.pathname === "/api/chat/export") {
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id)) {
      sendJson(response, 400, { ok: false, error: "Chat export requires id.", code: "UiChatInvalidExport" });
      return;
    }
    sendJson(response, 200, await exportUiChatSession(id));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/import") {
    const body = await readJsonBody(request);
    const source = isRecord(body) && isRecord(body.export) ? body.export : body;
    if (!isRecord(source) || !Array.isArray(source.messages)) {
      sendJson(response, 400, { ok: false, error: "Chat import requires exported messages.", code: "UiChatInvalidImport" });
      return;
    }
    const session = isRecord(source.session) ? source.session : undefined;
    const title = isRecord(body) && typeof body.title === "string" ? body.title : session && typeof session.title === "string" ? session.title : undefined;
    sendJson(response, 200, await importUiChatSession({
      title,
      messages: source.messages.filter(isUiChatMessage),
      events: Array.isArray(source.events) ? source.events.filter(isRecord) : [],
    }));
    return;
  }

  if (method === "PUT" && url.pathname === "/api/chat/session") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.id !== "number") {
      sendJson(response, 400, { ok: false, error: "Chat session update requires id.", code: "UiChatInvalidSessionUpdate" });
      return;
    }
    sendJson(response, 200, await updateUiChatSession({ id: body.id, title: typeof body.title === "string" ? body.title : undefined, pinned: typeof body.pinned === "boolean" ? body.pinned : undefined, toolsEnabled: typeof body.toolsEnabled === "boolean" ? body.toolsEnabled : undefined, memoryEnabled: typeof body.memoryEnabled === "boolean" ? body.memoryEnabled : undefined, providerModelRef: typeof body.providerModelRef === "string" ? body.providerModelRef : undefined }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/sessions/delete") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.id !== "number" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Chat session delete requires id and confirm=true.", code: "UiChatInvalidSessionDelete" });
      return;
    }
    sendJson(response, 200, await deleteUiChatSession(body.id));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/retry") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.sessionId !== "number" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Chat retry requires sessionId and confirm=true.", code: "UiChatInvalidRetry" });
      return;
    }
    sendJson(response, 200, await prepareUiChatRetry(body.sessionId, typeof body.messageId === "number" ? body.messageId : undefined));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/replay") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.sessionId !== "number" || typeof body.runId !== "number" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Chat replay requires sessionId, runId, and confirm=true.", code: "UiChatInvalidReplay" });
      return;
    }
    sendJson(response, 200, await prepareUiChatRunReplay({ sessionId: body.sessionId, runId: body.runId }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/fork") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.sessionId !== "number" || typeof body.messageId !== "number" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Chat fork requires sessionId, messageId, and confirm=true.", code: "UiChatInvalidFork" });
      return;
    }
    sendJson(response, 200, await forkUiChatSession({ sessionId: body.sessionId, messageId: body.messageId, title: typeof body.title === "string" ? body.title : undefined }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/continue") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.sessionId !== "number" || typeof body.approvalId !== "number" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Chat continue requires sessionId, approvalId, and confirm=true.", code: "UiChatInvalidContinue" });
      return;
    }
    sendJson(response, 200, await runUiChatContinue({ sessionId: body.sessionId, approvalId: body.approvalId }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/continue/stream") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.sessionId !== "number" || typeof body.approvalId !== "number" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Chat continue requires sessionId, approvalId, and confirm=true.", code: "UiChatInvalidContinue" });
      return;
    }

    sendSseHeaders(response);
    sendSseEvent(response, "ready", { ok: true });
    const streamSessionId = body.sessionId;
    let completed = false;
    response.once("close", () => {
      if (!completed) void recordChatStreamCancelled(streamSessionId);
    });
    try {
      const result = await runUiChatContinue({
        sessionId: body.sessionId,
        approvalId: body.approvalId,
        stream: true,
        onTimelineEvent: (event) => sendSseEvent(response, "timeline", event),
        onToken: (token) => sendSseEvent(response, "token", { token }),
      });
      completed = true;
      sendSseEvent(response, "done", result);
    } catch (error) {
      completed = true;
      sendSseEvent(response, "error", { ok: false, error: error instanceof Error ? error.message : "Unexpected chat continue error.", code: "UiChatContinueStreamError" });
    } finally {
      response.end();
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/stream") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.message !== "string") {
      sendJson(response, 400, { ok: false, error: "Chat requires message.", code: "UiChatInvalidRequest" });
      return;
    }

    sendSseHeaders(response);
    sendSseEvent(response, "ready", { ok: true });
    const streamSessionId = typeof body.sessionId === "number" ? body.sessionId : undefined;
    let completed = false;
    response.once("close", () => {
      if (!completed && streamSessionId !== undefined) void recordChatStreamCancelled(streamSessionId);
    });
    try {
      const result = await runUiChat({
        message: body.message,
        sessionId: typeof body.sessionId === "number" ? body.sessionId : undefined,
        history: Array.isArray(body.history) ? body.history.filter(isUiChatMessage) : [],
        attachments: Array.isArray(body.attachments) ? body.attachments.filter(isUiChatAttachment) : [],
        toolsEnabled: body.toolsEnabled !== false,
        memoryEnabled: body.memoryEnabled !== false,
        providerModelRef: typeof body.providerModelRef === "string" && body.providerModelRef ? body.providerModelRef : undefined,
        replaySourceRunId: typeof body.replaySourceRunId === "number" ? body.replaySourceRunId : undefined,
        stream: true,
        onTimelineEvent: (event) => sendSseEvent(response, "timeline", event),
        onToken: (token) => sendSseEvent(response, "token", { token }),
        onToolActivity: (activity: AgentToolActivity) => sendSseEvent(response, "tool", activity),
      });
      completed = true;
      sendSseEvent(response, "done", result);
    } catch (error) {
      completed = true;
      sendSseEvent(response, "error", { ok: false, error: error instanceof Error ? error.message : "Unexpected chat error.", code: "UiChatStreamError" });
    } finally {
      response.end();
    }
    return;
  }

  if (method === "PUT" && url.pathname === "/api/skills/item") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.name !== "string" || typeof body.content !== "string") {
      sendJson(response, 400, { ok: false, error: "Skill write requires name and content.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await writeUiSkill({ name: body.name, content: body.content, previousName: typeof body.previousName === "string" ? body.previousName : undefined }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/skills/delete") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.name !== "string" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Skill delete requires name and confirm=true.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await deleteUiSkill({ name: body.name }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/skills/uninstall") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.name !== "string" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Skill uninstall requires name and confirm=true.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await deleteUiSkill({ name: body.name }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/skills/toggle") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.name !== "string" || typeof body.enabled !== "boolean" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Skill toggle requires name, enabled, and confirm=true.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await toggleUiSkillEnabled({ name: body.name, enabled: body.enabled, confirm: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/skills/install") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.name !== "string" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Skill install requires name and confirm=true.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await installUiSkillFromLibrary({ name: body.name, sourceId: typeof body.sourceId === "string" ? body.sourceId : undefined, confirm: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/skills/rollback") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.name !== "string" || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Skill rollback requires name and confirm=true.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await rollbackUiSkill({ name: body.name, confirm: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/skills/registry/test") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Remote skill registry test requires confirm=true.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await testUiSkillRemoteRegistry({ confirm: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/skills/registry/cache/clear") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Remote skill registry cache clear requires confirm=true.", code: "UiSkillInvalidRequest" });
      return;
    }
    sendJson(response, 200, await clearUiSkillRemoteRegistryCache({ confirm: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/channels/action") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || !isUiChannelAction(body.action)) {
      sendJson(response, 400, { ok: false, error: "Missing action daemon_start|daemon_stop|daemon_restart|cron_toggle|cron_add|cron_update|cron_delete|cron_trigger.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    if (body.action === "cron_toggle" && (typeof body.id !== "number" || typeof body.enabled !== "boolean")) {
      sendJson(response, 400, { ok: false, error: "Cron toggle requires numeric id and boolean enabled.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    if ((body.action === "cron_delete" || body.action === "cron_trigger") && typeof body.id !== "number") {
      sendJson(response, 400, { ok: false, error: "Cron action requires numeric id.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    if ((body.action === "cron_add" || body.action === "cron_update") && !isUiCronWriteRequest(body, body.action === "cron_update")) {
      sendJson(response, 400, { ok: false, error: "Cron write requires name, scheduleType, scheduleValue, prompt, and enabled.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    if (!body.action.startsWith("cron_") && !isUiDaemonChannel(body.channel)) {
      sendJson(response, 400, { ok: false, error: "Daemon actions require channel telegram|zalo|cron.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    if (body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Channel actions require confirm=true.", code: "UiChannelActionConfirmationRequired" });
      return;
    }

    if (body.action === "cron_toggle") {
      const id = body.id;
      const enabled = body.enabled;
      if (typeof id !== "number" || typeof enabled !== "boolean") {
        sendJson(response, 400, { ok: false, error: "Cron toggle requires numeric id and boolean enabled.", code: "UiChannelInvalidActionRequest" });
        return;
      }
      sendJson(response, 200, await runUiChannelAction({ action: body.action, id, enabled, confirm: true }));
      return;
    }

    if (body.action === "cron_add") {
      const cronAdd = body as { name: string; scheduleType: "interval" | "cron_expr" | "once"; scheduleValue: string; prompt: string; channel?: string; enabled: boolean };
      sendJson(response, 200, await runUiChannelAction({
        action: body.action,
        name: cronAdd.name,
        scheduleType: cronAdd.scheduleType,
        scheduleValue: cronAdd.scheduleValue,
        prompt: cronAdd.prompt,
        channel: cronAdd.channel,
        enabled: cronAdd.enabled,
        confirm: true,
      }));
      return;
    }

    if (body.action === "cron_update") {
      const cronUpdate = body as { id: number; name: string; scheduleType: "interval" | "cron_expr" | "once"; scheduleValue: string; prompt: string; channel?: string; enabled: boolean };
      sendJson(response, 200, await runUiChannelAction({
        action: body.action,
        id: cronUpdate.id,
        name: cronUpdate.name,
        scheduleType: cronUpdate.scheduleType,
        scheduleValue: cronUpdate.scheduleValue,
        prompt: cronUpdate.prompt,
        channel: cronUpdate.channel,
        enabled: cronUpdate.enabled,
        confirm: true,
      }));
      return;
    }

    if (body.action === "cron_delete") {
      const id = body.id as number;
      sendJson(response, 200, await runUiChannelAction({ action: body.action, id, confirm: true }));
      return;
    }

    if (body.action === "cron_trigger") {
      const id = body.id as number;
      sendJson(response, 200, await runUiChannelAction({ action: body.action, id, confirm: true }));
      return;
    }

    const channel = body.channel;
    if (!isUiDaemonChannel(channel)) {
      sendJson(response, 400, { ok: false, error: "Daemon actions require channel telegram|zalo|cron.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    sendJson(response, 200, await runUiChannelAction({ action: body.action, channel, confirm: true }));
    return;
  }

  if (method === "PUT" && url.pathname === "/api/character") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || (typeof body.characterText !== "string" && typeof body.promptText !== "string")) {
      sendJson(response, 400, { ok: false, error: "Missing characterText or promptText.", code: "UiCharacterMissingUpdate" });
      return;
    }

    sendJson(response, 200, await updateUiCharacter({
      ...(typeof body.characterText === "string" ? { characterText: body.characterText } : {}),
      ...(typeof body.promptText === "string" ? { promptText: body.promptText } : {}),
    }));
    return;
  }

  if (method === "GET" && url.pathname === "/api/providers") {
    sendJson(response, 200, await getUiProviderSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/memory") {
    sendJson(response, 200, await getUiMemorySummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/memory/search") {
    sendJson(response, 200, await searchUiMemories(url.searchParams.get("q") ?? ""));
    return;
  }

  if (method === "GET" && url.pathname === "/api/knowledge-graph") {
    sendJson(response, 200, await getUiKnowledgeGraphSummary());
    return;
  }

  if (method === "GET" && url.pathname === "/api/knowledge-graph/search") {
    sendJson(response, 200, await searchUiKnowledgeGraph(url.searchParams.get("q") ?? ""));
    return;
  }

  if (method === "POST" && url.pathname === "/api/knowledge-graph/action") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || !isUiKnowledgeGraphAction(body.action)) {
      sendJson(response, 400, { ok: false, error: "Missing graph action merge_entity|forget_entity|forget_relation|update_relation|approve_pending|reject_pending.", code: "UiKnowledgeGraphInvalidActionRequest" });
      return;
    }
    if (body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Knowledge graph actions require confirm=true.", code: "UiKnowledgeGraphActionConfirmationRequired" });
      return;
    }

    sendJson(response, 200, await runUiKnowledgeGraphAction({
      action: body.action,
      confirm: true,
      ...(typeof body.id === "number" ? { id: body.id } : {}),
      ...(typeof body.primaryId === "number" ? { primaryId: body.primaryId } : {}),
      ...(typeof body.duplicateId === "number" ? { duplicateId: body.duplicateId } : {}),
      ...(typeof body.confidence === "number" ? { confidence: body.confidence } : {}),
      ...(typeof body.evidence === "string" ? { evidence: body.evidence } : {}),
      ...(body.scope === "core" || body.scope === "project" || body.scope === "session" ? { scope: body.scope } : {}),
      ...(body.sensitivity === "normal" || body.sensitivity === "sensitive" ? { sensitivity: body.sensitivity } : {}),
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/memory/action") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || (body.action !== "approve_pending" && body.action !== "reject_pending") || typeof body.id !== "number") {
      sendJson(response, 400, { ok: false, error: "Missing action approve_pending|reject_pending or numeric id.", code: "UiMemoryInvalidActionRequest" });
      return;
    }
    if (body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Memory actions require confirm=true.", code: "UiMemoryActionConfirmationRequired" });
      return;
    }

    sendJson(response, 200, await runUiMemoryAction({ action: body.action, id: body.id, confirm: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/providers/test") {
    const body = await readJsonBody(request);
    const modelRef = isRecord(body) && typeof body.modelRef === "string" ? body.modelRef : undefined;
    sendJson(response, 200, await runUiProviderTest({ modelRef }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/providers/primary") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.modelRef !== "string") {
      sendJson(response, 400, { ok: false, error: "Missing modelRef.", code: "UiProviderMissingModelRef" });
      return;
    }

    sendJson(response, 200, await setUiProviderPrimary({ modelRef: body.modelRef }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/providers/fallbacks") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || (body.action !== "add" && body.action !== "remove") || typeof body.modelRef !== "string") {
      sendJson(response, 400, { ok: false, error: "Missing action add|remove or modelRef.", code: "UiProviderInvalidFallbackRequest" });
      return;
    }

    sendJson(response, 200, await updateUiProviderFallback({ action: body.action, modelRef: body.modelRef }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/providers/setup") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.provider !== "string") {
      sendJson(response, 400, { ok: false, error: "Missing provider.", code: "UiProviderSetupMissingProvider" });
      return;
    }

    sendJson(response, 200, await setupUiProvider({
      provider: body.provider,
      ...(typeof body.mode === "string" ? { mode: body.mode as never } : {}),
      ...(typeof body.model === "string" ? { model: body.model } : {}),
      ...(typeof body.baseUrl === "string" ? { baseUrl: body.baseUrl } : {}),
      ...(typeof body.apiKeyEnv === "string" ? { apiKeyEnv: body.apiKeyEnv } : {}),
      ...(typeof body.secret === "string" ? { secret: body.secret } : {}),
      setDefault: body.setDefault === true,
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/doctor/fix") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || body.confirm !== true) {
      sendJson(response, 400, { ok: false, error: "Doctor fixes require confirm=true.", code: "UiDoctorFixConfirmationRequired" });
      return;
    }

    sendJson(response, 200, await runUiDoctorFix({ confirm: true }));
    return;
  }

  if (method === "GET" && isUiWebRoute(url.pathname)) {
    await sendUiHome(response);
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found", code: "UiRouteNotFound" });
}

async function sendUiHome(response: ServerResponse): Promise<void> {
  const reactHome = await readOptionalTextFile(UI_WEB_INDEX_PATH);
  sendHtml(response, reactHome ?? renderHomePage());
}

function isUiWebRoute(pathname: string): boolean {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return UI_WEB_ROUTE_PATHS.has(normalizedPath);
}

function isUiChatAttachment(value: unknown): value is { name: string; type?: string; size?: number; content: string } {
  return isRecord(value) && typeof value.name === "string" && typeof value.content === "string" && (value.type === undefined || typeof value.type === "string") && (value.size === undefined || typeof value.size === "number");
}

async function recordChatStreamCancelled(sessionId: number): Promise<void> {
  const store = await SqliteMemoryStore.open();
  try {
    store.getUiChatSession(sessionId);
    store.addUiChatEvent(sessionId, "cancelled", "Chat stream cancelled by client", JSON.stringify({ sessionId }));
  } catch {
    return;
  } finally {
    store.close();
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUiChatMessage(value: unknown): value is { role: "user" | "assistant"; content: string } {
  return isRecord(value) && (value.role === "user" || value.role === "assistant") && typeof value.content === "string";
}

function isUiChatSessionFilter(value: string): value is "all" | "approval" | "cancelled" | "error" | "fork" | "retry" {
  return value === "all" || value === "approval" || value === "cancelled" || value === "error" || value === "fork" || value === "retry";
}

function isUiChannelAction(value: unknown): value is "daemon_start" | "daemon_stop" | "daemon_restart" | "cron_toggle" | "cron_add" | "cron_update" | "cron_delete" | "cron_trigger" {
  return value === "daemon_start" || value === "daemon_stop" || value === "daemon_restart" || value === "cron_toggle" || value === "cron_add" || value === "cron_update" || value === "cron_delete" || value === "cron_trigger";
}

function isUiCronWriteRequest(value: Record<string, unknown>, requireId: boolean): value is Record<string, unknown> & { id?: number; name: string; scheduleType: "interval" | "cron_expr" | "once"; scheduleValue: string; prompt: string; channel?: string; enabled: boolean } {
  return (!requireId || typeof value.id === "number") && typeof value.name === "string" && isUiCronScheduleType(value.scheduleType) && typeof value.scheduleValue === "string" && typeof value.prompt === "string" && typeof value.enabled === "boolean" && (value.channel === undefined || typeof value.channel === "string");
}

function isUiCronScheduleType(value: unknown): value is "interval" | "cron_expr" | "once" {
  return value === "interval" || value === "cron_expr" || value === "once";
}

function isUiDaemonChannel(value: unknown): value is "telegram" | "zalo" | "cron" {
  return value === "telegram" || value === "zalo" || value === "cron";
}

function isMemoryWritePolicy(value: unknown): value is "allow" | "ask" | "deny" {
  return value === "allow" || value === "ask" || value === "deny";
}

function isUiKnowledgeGraphAction(value: unknown): value is "merge_entity" | "forget_entity" | "forget_relation" | "update_relation" | "approve_pending" | "reject_pending" {
  return value === "merge_entity" || value === "forget_entity" || value === "forget_relation" || value === "update_relation" || value === "approve_pending" || value === "reject_pending";
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) return undefined;
    throw error;
  }
}

async function readUiWebAsset(pathname: string): Promise<{ body: Buffer; contentType: string } | undefined> {
  const normalizedPath = pathname.replace(/^\/+/, "");
  if (!normalizedPath.startsWith("assets/") || normalizedPath.includes("..") || normalizedPath.includes("\\")) {
    return undefined;
  }

  try {
    return {
      body: await readFile(fileURLToPath(new URL(`./web/${normalizedPath}`, import.meta.url))),
      contentType: contentTypeForPath(normalizedPath),
    };
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) return undefined;
    throw error;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function contentTypeForPath(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function sendSseHeaders(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
}

function sendSseEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function sendJavaScript(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/javascript; charset=utf-8",
  });
  response.end(body);
}

function sendBinary(response: ServerResponse, body: Buffer, contentType: string): void {
  response.writeHead(200, {
    "cache-control": "public, max-age=86400",
    "content-length": String(body.byteLength),
    "content-type": contentType,
  });
  response.end(body);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
