import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { getUiApprovalsSummary, runUiApprovalAction } from "./api/approvals.js";
import { getUiCharacterSummary, updateUiCharacter } from "./api/character.js";
import { getUiChannelSummary, runUiChannelAction } from "./api/channels.js";
import { getUiDoctorSummary, runUiDoctorFix } from "./api/doctor.js";
import { getUiMemorySummary, runUiMemoryAction, searchUiMemories } from "./api/memory.js";
import { getUiMcpSummary } from "./api/mcp.js";
import { getUiProviderSummary, runUiProviderTest, setUiProviderPrimary, setupUiProvider, updateUiProviderFallback } from "./api/providers.js";
import { getUiSettingsSummary, updateUiSettings } from "./api/settings.js";
import { getUiStatusSummary } from "./api/status.js";
import { getUiToolsSummary } from "./api/tools.js";
import { HOME_PAGE_CLIENT_SCRIPT } from "./home/client-script.js";
import { renderHomePage } from "./home-page.js";

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
    sendHtml(response, renderHomePage());
    return;
  }

  if (method === "GET" && url.pathname === "/assets/home.js") {
    sendJavaScript(response, HOME_PAGE_CLIENT_SCRIPT);
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

  if (method === "GET" && url.pathname === "/api/settings") {
    sendJson(response, 200, await getUiSettingsSummary());
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

  if (method === "POST" && url.pathname === "/api/channels/action") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || !isUiChannelAction(body.action)) {
      sendJson(response, 400, { ok: false, error: "Missing action daemon_start|daemon_stop|daemon_restart|cron_toggle.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    if (body.action === "cron_toggle" && (typeof body.id !== "number" || typeof body.enabled !== "boolean")) {
      sendJson(response, 400, { ok: false, error: "Cron toggle requires numeric id and boolean enabled.", code: "UiChannelInvalidActionRequest" });
      return;
    }
    if (body.action !== "cron_toggle" && !isUiDaemonChannel(body.channel)) {
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

  sendJson(response, 404, { ok: false, error: "Not found", code: "UiRouteNotFound" });
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

function isUiChannelAction(value: unknown): value is "daemon_start" | "daemon_stop" | "daemon_restart" | "cron_toggle" {
  return value === "daemon_start" || value === "daemon_stop" || value === "daemon_restart" || value === "cron_toggle";
}

function isUiDaemonChannel(value: unknown): value is "telegram" | "zalo" | "cron" {
  return value === "telegram" || value === "zalo" || value === "cron";
}

function isMemoryWritePolicy(value: unknown): value is "allow" | "ask" | "deny" {
  return value === "allow" || value === "ask" || value === "deny";
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
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