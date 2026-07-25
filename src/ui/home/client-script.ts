export const HOME_PAGE_CLIENT_SCRIPT = `const state = {};
const KNOWLEDGE_MAP_PREFS_KEY = "bestie.knowledgeMapPreferences.v1";
const text = (value) => value === undefined || value === null || value === "" ? "-" : String(value);
const pillClass = (value) => value === true || value === "pass" || value === "running" || value === "allow" ? "good" : value === false || value === "fail" || value === "stopped" || value === "deny" ? "bad" : "warn";
const escapeHtml = (value) => text(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const panel = (id) => document.querySelector(id);
const setValue = (selector, value) => { const target = document.querySelector(selector); if (target) target.textContent = value; };
const setBody = (selector, html) => { const target = document.querySelector(selector + " .panel-body"); if (target) target.innerHTML = html; };
const icons = {
  activity: "M4 12h3l2-7 4 14 2-7h5",
  brain: "M8 5a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 3 3m8-14a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-3 3M8 5v14m8-14v14M8 9H6m12 0h-2M8 15H6m12 0h-2",
  check: "M20 6 9 17l-5-5",
  clip: "M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7L9.1 18.3a2 2 0 0 1-2.8-2.8l9.2-9.2",
  cloud: "M17.5 19H8a5 5 0 1 1 .7-10A6 6 0 0 1 20 11.5 3.5 3.5 0 0 1 17.5 19Z",
  database: "M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3Zm0 0v6c0 2 4 3 8 3s8-1 8-3V6M4 12v6c0 2 4 3 8 3s8-1 8-3v-6",
  dots: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  refresh: "M20 11a8 8 0 0 0-14.9-4M4 5v5h5m-5 3a8 8 0 0 0 14.9 4M20 19v-5h-5",
  shield: "M12 3 20 7v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4Z",
  sliders: "M4 7h10m4 0h2M4 17h2m4 0h10M7 4v6m10 4v6",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z",
  terminal: "M4 17l6-5-6-5m8 10h8",
  layers: "M12 2 3 7l9 5 9-5-9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5",
  square: "M5 5h14v14H5Z",
  x: "M18 6 6 18M6 6l12 12",
};
const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="' + icons[name] + '"/></svg>';
const iconButton = (name, label, attrs) => '<button ' + attrs + ' type="button">' + icon(name) + '<span>' + escapeHtml(label) + '</span></button>';
const actionDropdown = (actions) => '<details class="message-menu knowledge-action-menu"><summary aria-label="Actions" onclick="event.stopPropagation()">' + icon('dots') + '</summary><div class="message-menu-popover">' + actions.join('') + '</div></details>';
const row = (label, value, tone) => '<div class="row"><span>' + icon(tone === "good" ? "check" : tone === "bad" ? "x" : "activity") + escapeHtml(label) + '</span><span class="pill ' + (tone ?? "") + '">' + escapeHtml(value) + '</span></div>';
const option = (value, label, selected) => '<option value="' + escapeHtml(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
function readLocalJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function writeLocalJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function loadKnowledgeMapPreferences() {
  if (state.knowledgeMapPreferencesLoaded) return;
  state.knowledgeMapPreferencesLoaded = true;
  const prefs = readLocalJson(KNOWLEDGE_MAP_PREFS_KEY) ?? {};
  state.knowledgeDrawer = prefs.drawer ?? state.knowledgeDrawer;
  state.knowledgeGraphFilters = prefs.filters ?? state.knowledgeGraphFilters;
  state.knowledgeGraphSearch = prefs.search ?? state.knowledgeGraphSearch;
  state.knowledgeConnectedOnly = prefs.connectedOnly ?? state.knowledgeConnectedOnly;
  state.knowledgeOverlayCollapsed = prefs.overlayCollapsed ?? state.knowledgeOverlayCollapsed;
  state.knowledgeClusterBy = prefs.clusterBy ?? state.knowledgeClusterBy;
  state.knowledgeRelationDensity = prefs.relationDensity ?? state.knowledgeRelationDensity;
  state.knowledgeMotion = prefs.motion ?? state.knowledgeMotion;
  state.knowledgeActiveView = prefs.activeView ?? state.knowledgeActiveView ?? "all";
  state.knowledgeSavedView = prefs.savedView ?? state.knowledgeSavedView;
  state.selectedKnowledge = prefs.selected ?? state.selectedKnowledge;
}

function captureKnowledgeMapView() {
  return {
    drawer: state.knowledgeDrawer ?? "closed",
    filters: state.knowledgeGraphFilters ?? { kind: "all", scope: "all", trust: "all" },
    search: state.knowledgeGraphSearch ?? "",
    connectedOnly: Boolean(state.knowledgeConnectedOnly),
    overlayCollapsed: Boolean(state.knowledgeOverlayCollapsed),
    clusterBy: state.knowledgeClusterBy ?? "none",
    relationDensity: state.knowledgeRelationDensity ?? "all",
    motion: state.knowledgeMotion ?? "subtle",
    selected: state.selectedKnowledge?.type === "entity" || state.selectedKnowledge?.type === "relation" ? state.selectedKnowledge : undefined,
  };
}

function saveKnowledgeMapPreferences() {
  writeLocalJson(KNOWLEDGE_MAP_PREFS_KEY, { ...captureKnowledgeMapView(), activeView: state.knowledgeActiveView ?? "all", savedView: state.knowledgeSavedView });
}
function renderMarkdown(value) {
  const escaped = escapeHtml(value);
  const fence = String.fromCharCode(96).repeat(3);
  const codeBlocks = [];
  const withCodeBlocks = escaped.replace(new RegExp(fence + "([\\\\s\\\\S]*?)" + fence, "g"), (_match, code) => {
    const token = "BESTIE_CODE_BLOCK_" + codeBlocks.length;
    codeBlocks.push('<div class="code-block"><button class="copy-code" type="button">Sao chép</button><pre><code>' + code.trim() + '</code></pre></div>');
    return token;
  });
  const lines = withCodeBlocks.split("\\n");
  const html = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (line.startsWith("- ")) {
      if (!inList) html.push("<ul>");
      inList = true;
      html.push("<li>" + renderInlineMarkdown(line.slice(2)) + "</li>");
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    if (trimmed.startsWith("BESTIE_CODE_BLOCK_")) {
      const index = Number(trimmed.replace("BESTIE_CODE_BLOCK_", ""));
      html.push(codeBlocks[index] ?? "");
    } else if (!trimmed) {
      html.push("");
    } else if (line.startsWith("### ")) {
      html.push("<h4>" + renderInlineMarkdown(line.slice(4)) + "</h4>");
    } else if (line.startsWith("## ")) {
      html.push("<h3>" + renderInlineMarkdown(line.slice(3)) + "</h3>");
    } else if (line.startsWith("# ")) {
      html.push("<h2>" + renderInlineMarkdown(line.slice(2)) + "</h2>");
    } else {
      html.push("<p>" + renderInlineMarkdown(line) + "</p>");
    }
  }
  if (inList) html.push("</ul>");
  return html.join("");
}
function renderInlineMarkdown(value) {
  const tick = String.fromCharCode(96);
  return value
    .replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), "<code>$1</code>")
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
}
const providerPresets = {
  anthropic: { provider: "anthropic", model: "claude-sonnet-4-5", apiKeyEnv: "ANTHROPIC_API_KEY", baseUrl: "https://api.anthropic.com/v1" },
  openai: { provider: "openai", model: "gpt-4o-mini", apiKeyEnv: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
  gemini: { provider: "gemini", model: "gemini-2.5-flash", apiKeyEnv: "GEMINI_API_KEY", baseUrl: "" },
  groq: { provider: "groq", model: "llama-3.1-8b-instant", apiKeyEnv: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1" },
  openrouter: { provider: "openrouter", model: "openai/gpt-4o-mini", apiKeyEnv: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { provider: "ollama", model: "llama3.1", apiKeyEnv: "", baseUrl: "http://127.0.0.1:11434/v1" },
};
const scheduleTypes = ["interval", "cron_expr", "once"];
const commandPaletteItems = [
  { id: "chat-new", title: "New Chat", hint: "Create a blank chat session", run: () => createChatSession() },
  { id: "chat-rename", title: "Rename Chat", hint: "Rename the active session", run: () => renameActiveChatSession() },
  { id: "chat-pin", title: "Toggle Pin", hint: "Pin or unpin the active session", run: () => state.activeChatSession && toggleChatSessionPin(state.activeChatSession.id, !state.activeChatSession.pinnedAt) },
  { id: "chat-export", title: "Export Chat", hint: "Open JSON/Markdown export", run: () => exportActiveChatSession() },
  { id: "chat-import", title: "Import Chat", hint: "Open import dialog", run: () => importChatSessionFromPrompt() },
  { id: "chat-retry", title: "Retry Last", hint: "Retry the last user message", run: () => retryLastChatMessage() },
  { id: "chat-search", title: "Tìm kiếm Phiên", hint: "Focus session search", run: () => document.querySelector("#chat-session-search")?.focus() },
];

function providerSetupNote(provider) {
  if (provider === "gemini") return "Gemini uses the native SDK endpoint; baseUrl is ignored.";
  if (provider === "ollama") return "Ollama runs locally and does not need an API key.";
  return "Setup may write the provided có secret to the local .env file.";
}

function showToast(message, tone) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast show ' + (tone ?? "");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

function openCommandPalette() {
  const dialog = document.querySelector("#command-palette-dialog");
  const input = document.querySelector("#command-palette-input");
  if (!dialog?.showModal || !input) return;
  input.value = "";
  renderCommandPalette();
  dialog.showModal();
  input.focus();
}

function renderCommandPalette() {
  const input = document.querySelector("#command-palette-input");
  const list = document.querySelector("#command-palette-list");
  if (!list) return;
  const query = (input?.value ?? "").toLowerCase().trim();
  const items = commandPaletteItems.filter((item) => !query || item.title.toLowerCase().includes(query) || item.hint.toLowerCase().includes(query));
  list.innerHTML = items.length ? items.map((item, index) => '<button class="palette-row ' + (index === 0 ? "active" : "") + '" data-command-id="' + item.id + '" type="button"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.hint) + '</span></button>').join("") : '<div class="notice">No commands found.</div>';
  bindCommandPaletteRows();
}

function bindCommandPaletteRows() {
  document.querySelectorAll("[data-command-id]").forEach((button) => button.addEventListener("click", () => runCommandPaletteItem(button.dataset.commandId)));
}

function runCommandPaletteItem(id) {
  const item = commandPaletteItems.find((command) => command.id === id);
  if (!item) return;
  document.querySelector("#command-palette-dialog")?.close();
  item.run();
}

function withLoading(selector, message, task) {
  setValue(selector, message);
  return Promise.resolve().then(task).catch((error) => {
    showToast(error?.message ?? "Action failed.", "bad");
    throw error;
  });
}

function confirmAction(title, message) {
  const dialog = document.querySelector("#confirm-dialog");
  if (!dialog?.showModal) return Promise.resolve(false);
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
}

function inputAction({ label, title, message, value, confirmLabel }) {
  const dialog = document.querySelector("#input-dialog");
  const input = document.querySelector("#input-value");
  if (!dialog?.showModal || !input) return Promise.resolve(undefined);
  document.querySelector("#input-label").textContent = label ?? "Input";
  document.querySelector("#input-title").textContent = title ?? "Enter value";
  document.querySelector("#input-message").textContent = message ?? "This updates local Bestie state.";
  document.querySelector("#input-confirm").textContent = confirmLabel ?? "Save";
  input.value = value ?? "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm" ? input.value : undefined), { once: true });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

function requireConfirm(title, message, task) {
  return confirmAction(title, message).then((confirmed) => {
    if (!confirmed) {
      showToast("Action cancelled.", "warn");
      return undefined;
    }
    return task();
  });
}

function postJson(url, body) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json()).then((body) => {
    if (body.ok === false) throw new Error(body.error ?? "Request failed.");
    return body;
  });
}

function setChatStreaming(active, controller) {
  state.chatStreamController = controller;
  const stop = document.querySelector("#chat-stop");
  const send = document.querySelector("[data-chat-send]");
  if (stop) stop.disabled = !active;
  if (send) send.disabled = active;
  setComposerStatus(active ? "Streaming..." : "Sẵn sàng");
}

function stopChatStream() {
  state.chatStreamController?.abort();
  state.chatStreamController = undefined;
  setValue("#chat-panel .value", "Cancelling...");
}

function putJson(url, body) {
  return fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json()).then((body) => {
    if (body.ok === false) throw new Error(body.error ?? "Request failed.");
    return body;
  });
}

function activatePanel(panelId) {
  const targetId = document.getElementById(panelId) ? panelId : "doctor-panel";
  state.activePanel = targetId;
  document.querySelectorAll("[data-panel]").forEach((element) => element.classList.toggle("active", element.id === targetId));
  document.querySelectorAll("[data-panel-target]").forEach((link) => link.classList.toggle("active", link.dataset.panelTarget === targetId));
  document.querySelector(".panel-grid")?.setAttribute("data-active-panel", targetId);
}

function setSidebarCompact(compact) {
  document.body.classList.toggle("sidebar-compact", compact);
  const toggle = document.querySelector("#sidebar-toggle");
  toggle?.setAttribute("aria-pressed", compact ? "true" : "false");
  toggle?.setAttribute("aria-label", compact ? "Expand sidebar" : "Collapse sidebar");
  localStorage.setItem("bestie.sidebarCompact", compact ? "1" : "0");
}

setSidebarCompact(localStorage.getItem("bestie.sidebarCompact") === "1");
document.querySelector("#sidebar-toggle")?.addEventListener("click", () => setSidebarCompact(!document.body.classList.contains("sidebar-compact")));

document.querySelectorAll("[data-panel-target]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  activatePanel(link.dataset.panelTarget);
  history.replaceState(null, "", '#' + link.dataset.panelTarget);
}));

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key === "Escape" && document.querySelector("#command-palette-dialog")?.open) {
    document.querySelector("#command-palette-dialog")?.close();
  }
});

if (location.hash) activatePanel(location.hash.slice(1));
window.addEventListener("hashchange", () => activatePanel(location.hash.slice(1)));

function loadChat() {
  if (!state.chatHistory) state.chatHistory = [];
  if (state.chatSideOpen === undefined) state.chatSideOpen = localStorage.getItem("bestie.chatSideOpen") === "1";
  setValue("#chat-panel .value", state.activeChatSession ? 'Phiên #' + state.activeChatSession.id : "Sẵn sàng");
  setBody("#chat-panel", [
    '<div class="chat-layout ' + (state.chatSideOpen ? '' : 'chat-side-hidden') + '"><aside class="chat-sessions"><div class="chat-session-tools"><strong>Phiên</strong><span><button id="chat-new-session" type="button" title="Chat mới" aria-label="Chat mới">' + icon("check") + '</button><button id="chat-rename-session" type="button" title="Đổi tên chat" aria-label="Đổi tên chat">' + icon("refresh") + '</button><button id="chat-export-session" type="button" title="Xuất chat" aria-label="Xuất chat">' + icon("cloud") + '</button><button id="chat-import-session" type="button" title="Nhập chat" aria-label="Nhập chat">' + icon("database") + '</button><button id="chat-delete-session" type="button" title="Xóa chat" aria-label="Xóa chat">' + icon("x") + '</button></span></div><div class="chat-search"><input id="chat-session-search" placeholder="Tìm kiếm" value="' + escapeHtml(state.chatSearchQuery ?? "") + '"><select id="chat-session-filter"><option value="all">Tất cả</option><option value="approval">Phê duyệt</option><option value="cancelled">Đã hủy</option><option value="error">Lỗi</option><option value="fork">Tách nhánh</option><option value="retry">Thử lại</option></select></div><div id="chat-session-list" class="stack">' + row("Phiên", "đang tải", "") + '</div></aside><div id="chat-transcript" class="chat-transcript">' + renderChatTranscript() + '</div><button id="chat-side-toggle" class="chat-side-toggle" type="button" aria-expanded="' + (state.chatSideOpen ? 'true' : 'false') + '">' + icon("sliders") + '<span>' + (state.chatSideOpen ? 'Ẩn' : 'Chi tiết') + '</span></button><aside class="chat-side"><div class="summary-strip"><span><strong>Công cụ</strong><small>vòng lặp agent</small></span><span><strong>Trí nhớ</strong><small>tùy chọn</small></span><span><strong>Fallback</strong><small>theo provider</small></span></div><div id="chat-inspector" class="tool-section"><div class="label">Trình kiểm tra lượt chạy</div>' + renderChatInspector() + '</div><div id="chat-preferences" class="tool-section"><div class="label">Tùy chọn</div>' + renderChatPreferences() + '</div><div id="chat-branch" class="tool-section"><div class="label">Nhánh</div>' + renderChatBranchNavigator() + '</div><div id="chat-timeline" class="tool-section"><div class="label">Timeline lượt chạy</div>' + renderChatTimeline() + '</div></aside></div>',
    '<form id="chat-form" class="chat-composer"><div class="composer-field"><div class="composer-toolbar"><span id="chat-composer-status">Sẵn sàng</span><span id="chat-composer-context">Công cụ + Trí nhớ</span></div><textarea id="chat-input" placeholder="Nhắn với Bestie..." spellcheck="false" rows="1"></textarea><input id="chat-attachment-input" type="file" multiple hidden><div id="chat-attachment-preview" class="attachment-preview"></div><div class="composer-tools"><button id="chat-attach" type="button">' + icon("clip") + '<span>Đính kèm</span></button><button id="chat-context" type="button">' + icon("sliders") + '<span>Ngữ cảnh</span></button></div></div><button type="submit" data-chat-send>' + icon("check") + '<span>Gửi</span></button><button id="chat-stop" type="button" disabled>' + icon("square") + '<span>Dừng</span></button></form>',
  ].join(""));
  bindChatControls();
  const filter = document.querySelector("#chat-session-filter");
  if (filter) filter.value = state.chatSessionFilter ?? "all";
  loadChatPhiên();
}

function renderChatTranscript() {
  if (!state.chatHistory?.length) return '<div class="notice">Chưa có tin nhắn nào.</div>';
  return state.chatHistory.map((message, index) => {
    const messageId = Number(message.id ?? 0);
    const runId = Number(message.runId ?? 0);
    const highlighted = (messageId && Number(state.highlightChatMessageId ?? 0) === messageId) || (runId && Number(state.highlightChatRunId ?? 0) === runId);
    const actions = ['<button class="message-menu-item" data-chat-copy-message="' + index + '" type="button">' + icon("check") + '<span>Sao chép</span></button>'];
    if (messageId && message.role === "user") actions.push('<button class="message-menu-item" data-chat-retry-message="' + messageId + '" type="button">' + icon("refresh") + '<span>Thử lại</span></button>');
    if (message.runId && message.role === "assistant") actions.push('<button class="message-menu-item" data-chat-inspect-run="' + message.runId + '" type="button">' + icon("activity") + '<span>Kiểm tra lượt chạy</span></button>');
    if (messageId) actions.push('<button class="message-menu-item" data-chat-fork="' + messageId + '" type="button">' + icon("layers") + '<span>Tách nhánh</span></button>');
    const menu = '<details class="message-menu"><summary aria-label="Thao tác tin nhắn">' + icon("dots") + '</summary><div class="message-menu-popover">' + actions.join("") + '</div></details>';
    return '<div class="chat-message ' + escapeHtml(message.role) + (highlighted ? ' source-highlight' : '') + '"' + (messageId ? ' data-chat-message-id="' + escapeHtml(messageId) + '"' : '') + (runId ? ' data-chat-run-id="' + escapeHtml(runId) + '"' : '') + '>' +
      '<div class="chat-bubble-wrapper">' +
        '<div class="chat-bubble"><div class="chat-message-head"><strong>' + escapeHtml(chatDisplayName(message.role)) + '</strong>' + menu + '</div>' +
          '<div class="markdown-body">' + renderMarkdown(message.content) + '</div>' +
        '</div>' +
        renderChatMessageMeta(message) +
      '</div>' +
    '</div>';
  }).join("");
}

function renderChatMessageMeta(message) {
  const run = message.runId ? (state.chatRuns ?? []).find((candidate) => Number(candidate.id) === Number(message.runId)) : undefined;
  const metadata = parseJsonMaybe(run?.metadataJson) ?? {};
  const status = message.role === "assistant" ? (run?.status ?? "saved") : "sent";
  const context = formatChatMessageContext(message, metadata);
  const time = formatChatTime(message.createdAt ?? run?.finishedAt ?? run?.startedAt);
  return '<div class="chat-message-meta"><span title="Thời gian tin nhắn">' + icon("activity") + escapeHtml(time) + '</span><span title="Tổng ngữ cảnh">' + icon("brain") + escapeHtml(context) + '</span><span class="pill ' + pillClass(status) + '" title="Trạng thái tin nhắn">' + escapeHtml(formatChatStatus(status)) + '</span></div>';
}

function formatChatMessageContext(message, metadata) {
  const inputChars = Number(metadata.inputChars ?? 0);
  const outputChars = Number(metadata.outputChars ?? 0);
  const fallbackChars = String(message.content ?? "").length;
  const total = inputChars + outputChars || fallbackChars;
  const tools = Number(metadata.toolCalls ?? 0);
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments.length : 0;
  return formatCount(total, "char") + (tools ? ' · ' + tools + ' tool' + (tools === 1 ? "" : "s") : "") + (attachments ? ' · ' + attachments + ' file' + (attachments === 1 ? "" : "s") : "");
}

function formatChatTime(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatCount(value, unit) {
  const count = Number.isFinite(value) ? value : 0;
  return count.toLocaleString() + ' ' + unit + (count === 1 ? "" : "s");
}

function formatChatStatus(status) {
  if (status === "done") return "đã gửi";
  if (status === "error") return "error";
  if (status === "cancelled") return "đã hủy";
  if (status === "running") return "đang chạy";
  return status || "đã lưu";
}

function chatDisplayName(role) {
  const parsed = state.character?.character?.parsed;
  if (role === "user") return parsed?.ownerName || "Bạn";
  return parsed?.name || "Bestie";
}

function bindChatTranscriptControls() {
  document.querySelectorAll("[data-chat-fork]").forEach((button) => button.addEventListener("click", () => forkChatSession(Number(button.dataset.chatFork))));
  document.querySelectorAll("[data-chat-retry-message]").forEach((button) => button.addEventListener("click", () => retryChatMessage(Number(button.dataset.chatRetryMessage))));
  document.querySelectorAll("[data-chat-copy-message]").forEach((button) => button.addEventListener("click", () => copyChatMessage(Number(button.dataset.chatCopyMessage), button)));
  document.querySelectorAll("[data-chat-inspect-run]").forEach((button) => button.addEventListener("click", () => inspectChatRun(Number(button.dataset.chatInspectRun))));
}

function renderChatTranscriptIntoPanel() {
  const transcript = document.querySelector("#chat-transcript");
  if (!transcript) return;
  transcript.innerHTML = renderChatTranscript();
  bindChatTranscriptControls();
  scrollChatTranscriptToBottom();
}

function toChatHistoryItem(message) {
  return { id: message.id, runId: message.runId, role: message.role, content: message.content, createdAt: message.createdAt };
}

function bindChatControls() {
  const input = document.querySelector("#chat-input");
  document.querySelector("#chat-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage();
  });
  input?.addEventListener("input", () => resizeChatComposer());
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  resizeChatComposer();
  document.querySelector("#chat-new-session")?.addEventListener("click", () => createChatSession());
  document.querySelector("#chat-rename-session")?.addEventListener("click", () => renameActiveChatSession());
  document.querySelector("#chat-export-session")?.addEventListener("click", () => exportActiveChatSession());
  document.querySelector("#chat-import-session")?.addEventListener("click", () => importChatSessionFromPrompt());
  document.querySelector("#chat-delete-session")?.addEventListener("click", () => deleteActiveChatSession());
  document.querySelector("#chat-stop")?.addEventListener("click", () => stopChatStream());
  document.querySelector("#chat-side-toggle")?.addEventListener("click", toggleChatSide);
  document.querySelector("#chat-attach")?.addEventListener("click", () => document.querySelector("#chat-attachment-input")?.click());
  document.querySelector("#chat-attachment-input")?.addEventListener("change", loadChatAttachments);
  document.querySelector("#chat-context")?.addEventListener("click", () => document.querySelector("#chat-preferences")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  document.querySelector("#chat-retry")?.addEventListener("click", () => retryLastChatMessage());
  document.querySelector("#chat-session-search")?.addEventListener("input", (event) => { state.chatSearchQuery = event.target.value; loadChatPhiên(); });
  document.querySelector("#chat-session-filter")?.addEventListener("change", (event) => { state.chatSessionFilter = event.target.value; loadChatPhiên(); });
  bindChatPreferenceControls();
  document.querySelector("#chat-export-trace")?.addEventListener("click", exportChatRunTrace);
  bindChatBranchControls();
  document.querySelector("#chat-transcript")?.addEventListener("click", (event) => {
    const button = event.target.closest?.(".copy-code");
    if (!button) return;
    const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
    navigator.clipboard?.writeText(code).then(() => {
      button.textContent = "Copied";
      showToast("Code copied.", "good");
      setTimeout(() => { button.textContent = "Copy"; }, 1400);
    }).catch(() => showToast("Unable to copy code.", "bad"));
  });
  updateComposerContext();
}

function toggleChatSide() {
  state.chatSideOpen = !state.chatSideOpen;
  localStorage.setItem("bestie.chatSideOpen", state.chatSideOpen ? "1" : "0");
  const layout = document.querySelector(".chat-layout");
  layout?.classList.toggle("chat-side-hidden", !state.chatSideOpen);
  const toggle = document.querySelector("#chat-side-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", state.chatSideOpen ? "true" : "false");
    const label = toggle.querySelector("span");
    if (label) label.textContent = state.chatSideOpen ? "Ẩn" : "Chi tiết";
  }
}

function resizeChatComposer() {
  const input = document.querySelector("#chat-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 156) + "px";
}

function setComposerStatus(value) {
  const target = document.querySelector("#chat-composer-status");
  if (target) target.textContent = value;
}

function updateComposerContext() {
  const target = document.querySelector("#chat-composer-context");
  if (!target) return;
  const tools = document.querySelector("#chat-tools")?.checked !== false ? "Công cụ" : "No tools";
  const memory = document.querySelector("#chat-memory")?.checked !== false ? "Memory" : "No memory";
  const files = state.chatAttachments?.length ?? 0;
  target.textContent = tools + " + " + memory + (files ? " + " + files + " file" + (files > 1 ? "s" : "") : "");
}

function loadChatAttachments() {
  const files = Array.from(document.querySelector("#chat-attachment-input")?.files ?? []).slice(0, 5);
  Promise.all(files.map(readChatAttachmentFile)).then((attachments) => {
    state.chatAttachments = attachments.filter(Boolean);
    renderChatAttachmentPreview();
    updateComposerContext();
  }).catch((error) => showToast(error?.message ?? "Unable to read attachment.", "bad"));
}

function readChatAttachmentFile(file) {
  if (file.size > 256 * 1024) return Promise.reject(new Error("Attachment is too large. Use files under 256 KB."));
  const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (imageTypes.includes(file.type)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve({ name: file.name, type: file.type, size: file.size, content: String(reader.result ?? "") }));
      reader.addEventListener("error", () => reject(new Error("Unable to read image attachment.")));
      reader.readAsDataURL(file);
    });
  }
  return file.text().then((content) => ({ name: file.name, type: file.type || "text/plain", size: file.size, content: content.slice(0, 64 * 1024) }));
}

function renderChatAttachmentPreview() {
  const target = document.querySelector("#chat-attachment-preview");
  if (!target) return;
  const attachments = state.chatAttachments ?? [];
  target.innerHTML = attachments.length ? attachments.map((attachment, index) => '<span class="attachment-chip">' + icon("clip") + escapeHtml(attachment.name) + '<button type="button" data-remove-attachment="' + index + '">' + icon("x") + '</button></span>').join("") : "";
  document.querySelectorAll("[data-remove-attachment]").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.removeAttachment);
    state.chatAttachments = (state.chatAttachments ?? []).filter((_attachment, currentIndex) => currentIndex !== index);
    renderChatAttachmentPreview();
    updateComposerContext();
  }));
}

function clearChatAttachments() {
  state.chatAttachments = [];
  const input = document.querySelector("#chat-attachment-input");
  if (input) input.value = "";
  renderChatAttachmentPreview();
  updateComposerContext();
}

function renderChatPreferences() {
  const session = state.activeChatSession ?? { toolsEnabled: true, memoryEnabled: true };
  const models = state.providers?.models ?? [];
  const options = ['<option value="">Primary provider</option>'].concat(models.map((model) => option(model.modelRef, model.modelRef, session.providerModelRef === model.modelRef))).join("");
  return '<label class="check"><input id="chat-tools" type="checkbox" ' + (session.toolsEnabled === false ? "" : "checked") + '> Tools enabled</label><label class="check"><input id="chat-memory" type="checkbox" ' + (session.memoryEnabled === false ? "" : "checked") + '> Memory enabled</label><label class="stack">Provider override<select id="chat-provider-model">' + options + '</select></label>';
}

function renderChatPreferencesIntoPanel() {
  const target = document.querySelector("#chat-preferences");
  if (target) {
    target.innerHTML = '<div class="label">Tùy chọn</div>' + renderChatPreferences();
    bindChatPreferenceControls();
    updateComposerContext();
  }
}

function bindChatPreferenceControls() {
  document.querySelector("#chat-tools")?.addEventListener("change", saveChatPreferences);
  document.querySelector("#chat-memory")?.addEventListener("change", saveChatPreferences);
  document.querySelector("#chat-provider-model")?.addEventListener("change", saveChatPreferences);
}

function renderChatInspectorIntoPanel() {
  const target = document.querySelector("#chat-inspector");
  if (target) {
    target.innerHTML = '<div class="label">Trình kiểm tra lượt chạy</div>' + renderChatInspector();
    document.querySelector("#chat-export-trace")?.addEventListener("click", exportChatRunTrace);
    document.querySelector("#chat-replay-run")?.addEventListener("click", replaySelectedChatRun);
  }
}

function renderChatInspector() {
  const selectedRun = getSelectedChatRun();
  const events = selectedRun ? (state.chatTimeline ?? []).filter((event) => Number(event.runId ?? 0) === Number(selectedRun.id)) : state.chatTimeline ?? [];
  const run = selectedRun ?? state.chatRun ?? {};
  const eventTypes = events.map((event) => event.eventType ?? event.type ?? "event");
  const errors = events.filter((event) => (event.eventType ?? event.type) === "error");
  const approvals = events.filter((event) => (event.eventType ?? event.type)?.startsWith("approval_"));
  const toolCalls = events.filter((event) => ["tool_start", "tool_finish"].includes(event.eventType ?? event.type));
  const model = run.model ?? state.activeChatSession?.providerModelRef ?? state.providers?.primary?.modelRef ?? "primary";
  const status = run.status ?? (errors.length ? "error" : eventTypes.includes("cancelled") ? "cancelled" : eventTypes.includes("done") ? "done" : "idle");
  const lastEvent = events[events.length - 1];
  const trace = makeChatRunTrace();
  return '<div class="inspector-stack">'
    + row("Status", status, status === "done" ? "good" : status === "error" || status === "cancelled" ? "bad" : status === "running" ? "warn" : "")
    + row("Model", model, "")
    + row("Events", String(events.length), "")
    + row("Công cụ", String(toolCalls.length), toolCalls.length ? "warn" : "")
    + row("Approvals", String(approvals.length), approvals.length ? "warn" : "")
    + row("Errors", String(errors.length), errors.length ? "bad" : "good")
    + (selectedRun ? '<div class="subvalue">Run #' + escapeHtml(selectedRun.id) + (selectedRun.assistantMessageId ? ' · Message #' + escapeHtml(selectedRun.assistantMessageId) : '') + '</div>' : '')
    + '<div class="subvalue">Last: ' + escapeHtml(lastEvent?.label ?? lastEvent?.eventType ?? lastEvent?.type ?? "none") + '</div>'
    + renderChatRunDiff(selectedRun)
    + '<button id="chat-replay-run" type="button"' + (selectedRun && !state.chatStreamController ? "" : " disabled") + '>' + icon("refresh") + '<span>Replay run</span></button>'
    + '<button id="chat-export-trace" type="button"' + (trace.events.length ? "" : " disabled") + '>' + icon("cloud") + '<span>Export trace</span></button>'
    + '</div>';
}

function makeChatRunTrace() {
  const selectedRun = getSelectedChatRun();
  const events = selectedRun ? (state.chatTimeline ?? []).filter((event) => Number(event.runId ?? 0) === Number(selectedRun.id)) : state.chatTimeline ?? [];
  const metadata = parseJsonMaybe(selectedRun?.metadataJson) ?? {};
  return {
    session: state.activeChatSession ? { id: state.activeChatSession.id, title: state.activeChatSession.title, providerModelRef: state.activeChatSession.providerModelRef } : undefined,
    run: selectedRun ?? state.chatRun ?? {},
    attachments: metadata.attachments ?? state.chatRun?.attachments ?? (state.chatAttachments ?? []).map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size })),
    preferences: {
      toolsEnabled: document.querySelector("#chat-tools")?.checked !== false,
      memoryEnabled: document.querySelector("#chat-memory")?.checked !== false,
      providerModelRef: document.querySelector("#chat-provider-model")?.value || undefined,
    },
    events: events.map((event) => ({ type: event.eventType ?? event.type, label: event.label, payload: parseTimelinePayload(event), createdAt: event.createdAt, runId: event.runId })),
    approvals: state.chatApprovals ?? {},
  };
}

function getSelectedChatRun() {
  const id = Number(state.selectedChatRunId ?? 0);
  if (!id) return undefined;
  return (state.chatRuns ?? []).find((run) => Number(run.id) === id);
}

function inspectChatRun(runId) {
  state.selectedChatRunId = runId;
  renderChatInspectorIntoPanel();
  document.querySelector("#chat-inspector")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function replaySelectedChatRun() {
  const run = getSelectedChatRun();
  if (!run || !state.activeChatSession || state.chatStreamController) return;
  requireConfirm("Replay this run?", 'Run #' + run.id, () => postJson("/api/chat/replay", { sessionId: state.activeChatSession.id, runId: run.id, confirm: true }).then((result) => {
    state.activeChatSession = result.session;
    state.chatHistory = (result.messages ?? []).map(toChatHistoryItem);
    state.chatTimeline = result.events ?? [];
    state.chatRuns = result.runs ?? [];
    state.chatApprovals = result.approvals ?? {};
    state.chatBranch = result.branch ?? { children: [] };
    state.chatRun = undefined;
    renderChatTranscriptIntoPanel();
    renderChatBranchIntoPanel();
    renderChatTimelineIntoPanel();
    applyReplayPreferences(result.replay ?? {});
    const history = result.history ?? [];
    const attachments = result.replay?.attachments ?? [];
    state.chatHistory = [...history, { role: "user", content: result.retryMessage }];
    state.chatTimeline = [];
    state.chatApprovals = {};
    runChatStream({ message: result.retryMessage, history, restoreHistory: (result.messages ?? []).map(toChatHistoryItem), attachments, replaySourceRunId: run.id });
  })).catch(() => setValue("#chat-panel .value", "Unable to replay run."));
}

function renderChatRunDiff(run) {
  const diff = makeChatRunDiff(run);
  if (!diff) return "";
  const outputTone = diff.outputChanged ? "warn" : "good";
  return '<div class="run-diff"><strong>Replay diff</strong>'
    + row("Source", 'Run #' + diff.sourceId, "")
    + row("Model", diff.modelChanged ? "changed" : "same", diff.modelChanged ? "warn" : "good")
    + row("Settings", diff.settingsChanged ? "changed" : "same", diff.settingsChanged ? "warn" : "good")
    + row("Công cụ", String(diff.toolDelta), diff.toolDelta ? "warn" : "")
    + row("Output", diff.outputChanged ? 'changed ' + diff.outputDelta + ' chars' : "same", outputTone)
    + '<div class="subvalue">' + escapeHtml(diff.preview) + '</div>'
    + '</div>';
}

function makeChatRunDiff(run) {
  if (!run) return undefined;
  const metadata = parseJsonMaybe(run.metadataJson) ?? {};
  const sourceId = Number(metadata.replaySourceRunId ?? 0);
  if (!sourceId) return undefined;
  const source = (state.chatRuns ?? []).find((candidate) => Number(candidate.id) === sourceId);
  if (!source) return undefined;
  const sourceMetadata = parseJsonMaybe(source.metadataJson) ?? {};
  const sourceOutput = typeof sourceMetadata.output === "string" ? sourceMetadata.output : "";
  const output = typeof metadata.output === "string" ? metadata.output : "";
  const sourceTools = Number(sourceMetadata.toolCalls ?? countRunEvents(source.id, ["tool_start"]));
  const tools = Number(metadata.toolCalls ?? countRunEvents(run.id, ["tool_start"]));
  const outputDelta = output.length - sourceOutput.length;
  return {
    sourceId,
    modelChanged: text(source.model ?? sourceMetadata.model) !== text(run.model ?? metadata.model),
    settingsChanged: sourceMetadata.toolsEnabled !== metadata.toolsEnabled || sourceMetadata.memoryEnabled !== metadata.memoryEnabled || sourceMetadata.providerModelRef !== metadata.providerModelRef,
    toolDelta: tools - sourceTools,
    outputChanged: sourceOutput !== output,
    outputDelta: (outputDelta >= 0 ? "+" : "") + outputDelta,
    preview: output && sourceOutput ? firstTextDiff(sourceOutput, output) : "Output text unavailable for one side.",
  };
}

function countRunEvents(runId, types) {
  return (state.chatTimeline ?? []).filter((event) => Number(event.runId ?? 0) === Number(runId) && types.includes(event.eventType ?? event.type)).length;
}

function firstTextDiff(before, after) {
  if (before === after) return "Assistant output is unchanged.";
  let index = 0;
  while (index < before.length && index < after.length && before[index] === after[index]) index += 1;
  const start = Math.max(0, index - 24);
  const beforeSlice = before.slice(start, index + 64).replace(/\s+/g, " ");
  const afterSlice = after.slice(start, index + 64).replace(/\s+/g, " ");
  return 'Before: "' + beforeSlice + '" / After: "' + afterSlice + '"';
}

function applyReplayPreferences(replay) {
  const tools = document.querySelector("#chat-tools");
  const memory = document.querySelector("#chat-memory");
  const provider = document.querySelector("#chat-provider-model");
  if (tools && typeof replay.toolsEnabled === "boolean") tools.checked = replay.toolsEnabled;
  if (memory && typeof replay.memoryEnabled === "boolean") memory.checked = replay.memoryEnabled;
  if (provider && replay.providerModelRef) provider.value = replay.providerModelRef;
  updateComposerContext();
}

function parseJsonMaybe(value) {
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function exportChatRunTrace() {
  const trace = makeChatRunTrace();
  const blob = new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "bestie-chat-run-" + (trace.session?.id ?? "draft") + ".json";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Run trace exported.", "good");
}

function saveChatPreferences() {
  if (!state.activeChatSession) return;
  updateComposerContext();
  updateChatSession({
    id: state.activeChatSession.id,
    toolsEnabled: document.querySelector("#chat-tools")?.checked !== false,
    memoryEnabled: document.querySelector("#chat-memory")?.checked !== false,
    providerModelRef: document.querySelector("#chat-provider-model")?.value ?? "",
  });
}

function loadChatPhiên() {
  const query = state.chatSearchQuery ?? "";
  const filter = state.chatSessionFilter ?? "all";
  const url = query || filter !== "all" ? "/api/chat/search?q=" + encodeURIComponent(query) + "&filter=" + encodeURIComponent(filter) : "/api/chat/sessions";
  fetch(url)
    .then((response) => response.json())
    .then((summary) => {
      state.chatSessions = summary.sessions ?? [];
      renderChatPhiên();
      if (!state.activeChatSession && state.chatSessions[0]) loadChatSession(state.chatSessions[0].id);
    })
    .catch(() => { document.querySelector("#chat-session-list").innerHTML = row("Phiên", "unable to load", "bad"); });
}

function renderChatPhiên() {
  const list = document.querySelector("#chat-session-list");
  if (!list) return;
  if (!state.chatSessions?.length) {
    list.innerHTML = row("Phiên", "none", "");
    return;
  }
  list.innerHTML = state.chatSessions.map((session) => '<div class="chat-session-row ' + (state.activeChatSession?.id === session.id ? "active" : "") + '"><button class="chat-session-open" data-chat-session="' + session.id + '" type="button"><strong>' + escapeHtml(session.title) + '</strong><span>' + escapeHtml(session.messageCount) + ' tin nhắn</span>' + renderChatSessionBadges(session) + '</button><button class="pin-session" data-chat-pin="' + session.id + '" data-pinned="' + (session.pinnedAt ? "true" : "false") + '" type="button">' + (session.pinnedAt ? "Pinned" : "Pin") + '</button></div>').join("");
  document.querySelectorAll("[data-chat-session]").forEach((button) => button.addEventListener("click", () => loadChatSession(Number(button.dataset.chatSession))));
  document.querySelectorAll("[data-chat-pin]").forEach((button) => button.addEventListener("click", (event) => {
    toggleChatSessionPin(Number(button.dataset.chatPin), button.dataset.pinned !== "true");
  }));
}

function renderChatSessionBadges(session) {
  const types = new Set(session.eventTypes ?? []);
  const badges = [
    types.has("approval_required") ? "approval" : undefined,
    types.has("error") ? "error" : undefined,
    types.has("cancelled") ? "cancelled" : undefined,
    types.has("fork") ? "fork" : undefined,
    types.has("retry") ? "retry" : undefined,
    session.pinnedAt ? "pinned" : undefined,
  ].filter(Boolean);
  return badges.length ? '<span class="chat-session-badges">' + badges.map((badge) => '<span class="pill ' + (badge === "error" ? "bad" : badge === "approval" || badge === "cancelled" ? "warn" : "good") + '">' + escapeHtml(badge) + '</span>').join("") + '</span>' : "";
}

function createChatSession() {
  postJson("/api/chat/sessions", { title: "Chat mới" })
    .then((result) => {
      state.activeChatSession = result.session;
      state.chatHistory = [];
      state.chatTimeline = [];
      state.chatRuns = [];
      state.chatApprovals = {};
      state.chatBranch = result.branch ?? { children: [] };
      state.chatRun = undefined;
      setValue("#chat-panel .value", 'Phiên #' + result.session.id);
      renderChatTranscriptIntoPanel();
      renderChatBranchIntoPanel();
      renderChatTimelineIntoPanel();
      loadChatPhiên();
    })
    .catch((error) => setValue("#chat-panel .value", error?.message ?? "Unable to create session."));
}

function loadChatSession(id) {
  return loadChatSessionWithTarget(id);
}

function loadChatSessionWithTarget(id, target) {
  fetch("/api/chat/session?id=" + encodeURIComponent(id))
    .then((response) => response.json())
    .then((result) => {
      state.activeChatSession = result.session;
      state.chatHistory = (result.messages ?? []).map(toChatHistoryItem);
      state.chatTimeline = result.events ?? [];
      state.chatRuns = result.runs ?? [];
      state.chatApprovals = result.approvals ?? {};
      state.chatBranch = result.branch ?? { children: [] };
      state.chatRun = undefined;
      setValue("#chat-panel .value", result.session.title);
      renderChatTranscriptIntoPanel();
      renderChatPreferencesIntoPanel();
      renderChatBranchIntoPanel();
      renderChatTimelineIntoPanel();
      renderChatPhiên();
      if (target) focusChatSource(target);
    })
    .catch((error) => setValue("#chat-panel .value", error?.message ?? "Unable to load session."));
}

function focusChatSource(target) {
  state.highlightChatMessageId = target.messageId;
  state.highlightChatRunId = target.runId;
  if (target.runId) state.selectedChatRunId = target.runId;
  renderChatTranscriptIntoPanel();
  renderChatInspectorIntoPanel();
  renderChatTimelineIntoPanel();
  const selector = target.messageId ? '[data-chat-message-id="' + target.messageId + '"]' : target.runId ? '[data-chat-run-id="' + target.runId + '"]' : undefined;
  if (selector) document.querySelector(selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
  showToast("Opened graph source in chat.", "good");
}

function jumpToKnowledgeSource(source) {
  if (!source?.chatSessionId) {
    showToast("No chat source is linked to this graph item.", "warn");
    return;
  }
  state.chatSideOpen = true;
  localStorage.setItem("bestie.chatSideOpen", "1");
  activatePanel("chat-panel");
  history.replaceState(null, "", "#chat-panel");
  loadChatSessionWithTarget(source.chatSessionId, { messageId: source.chatMessageId, runId: source.chatRunId });
}

function deleteActiveChatSession() {
  if (!state.activeChatSession) return;
  requireConfirm("Xóa chat session?", state.activeChatSession.title, () => postJson("/api/chat/sessions/delete", { id: state.activeChatSession.id, confirm: true }).then((summary) => {
    state.chatSessions = summary.sessions ?? [];
    state.activeChatSession = undefined;
    state.chatHistory = [];
    state.chatTimeline = [];
    state.chatRuns = [];
    state.chatApprovals = {};
    state.chatBranch = { children: [] };
    state.chatRun = undefined;
    renderChatTranscriptIntoPanel();
    renderChatBranchIntoPanel();
    renderChatTimelineIntoPanel();
    renderChatPhiên();
    if (state.chatSessions[0]) loadChatSession(state.chatSessions[0].id);
    setValue("#chat-panel .value", state.chatSessions[0] ? 'Phiên #' + state.chatSessions[0].id : "Sẵn sàng");
    showToast("Chat session deleted.", "good");
  })).catch(() => setValue("#chat-panel .value", "Unable to delete session."));
}

function renameActiveChatSession() {
  if (!state.activeChatSession) return;
  inputAction({ label: "Đổi tên chat", title: "Session title", message: state.activeChatSession.title ?? "Chat mới", value: state.activeChatSession.title ?? "Chat mới", confirmLabel: "Rename" }).then((title) => {
    const nextTitle = String(title ?? "").trim();
    if (!nextTitle) return;
    updateChatSession({ id: state.activeChatSession.id, title: nextTitle });
  });
}

function toggleChatSessionPin(id, pinned) {
  updateChatSession({ id, pinned });
}

function updateChatSession(body) {
  putJson("/api/chat/session", body).then((result) => {
    if (state.activeChatSession?.id === result.session.id) {
      state.activeChatSession = result.session;
      state.chatHistory = (result.messages ?? []).map(toChatHistoryItem);
      state.chatTimeline = result.events ?? [];
      state.chatRuns = result.runs ?? state.chatRuns ?? [];
      state.chatApprovals = result.approvals ?? {};
      state.chatBranch = result.branch ?? state.chatBranch ?? { children: [] };
      setValue("#chat-panel .value", result.session.title);
      renderChatTranscriptIntoPanel();
      renderChatPreferencesIntoPanel();
      renderChatBranchIntoPanel();
      renderChatTimelineIntoPanel();
    }
    loadChatPhiên();
    showToast(body.pinned === true ? "Chat pinned." : body.pinned === false ? "Chat unpinned." : "toolsEnabled" in body || "memoryEnabled" in body || "providerModelRef" in body ? "Chat preferences saved." : "Chat renamed.", "good");
  }).catch(() => setValue("#chat-panel .value", "Unable to update chat session."));
}

function exportActiveChatSession() {
  if (!state.activeChatSession) return;
  fetch("/api/chat/export?id=" + encodeURIComponent(state.activeChatSession.id))
    .then((response) => response.json())
    .then((result) => {
      state.chatExport = result;
      state.chatExportFormat = "json";
      renderChatExportDialog();
      const dialog = document.querySelector("#chat-export-dialog");
      if (dialog?.showModal) dialog.showModal();
      setValue("#chat-panel .value", "Exported " + result.messages.length + " messages");
    })
    .catch(() => setValue("#chat-panel .value", "Unable to export chat."));
}

function renderChatExportDialog() {
  const result = state.chatExport;
  const format = state.chatExportFormat ?? "json";
  const preview = document.querySelector("#chat-export-preview");
  const title = document.querySelector("#chat-export-title");
  const summary = document.querySelector("#chat-export-summary");
  if (!result || !preview) return;
  const content = format === "markdown" ? result.markdown : JSON.stringify(result.export, null, 2);
  preview.value = content;
  if (title) title.textContent = result.session?.title ?? "Current session";
  if (summary) summary.textContent = format.toUpperCase() + " · " + (result.messages?.length ?? 0) + " messages · " + (result.events?.length ?? 0) + " events";
  document.querySelectorAll("[data-export-format]").forEach((button) => button.classList.toggle("active", button.dataset.exportFormat === format));
}

function copyChatExport() {
  const content = document.querySelector("#chat-export-preview")?.value;
  if (!content) return;
  navigator.clipboard?.writeText(content).then(() => showToast("Chat export copied.", "good")).catch(() => showToast("Unable to copy export.", "bad"));
}

function downloadChatExport() {
  const result = state.chatExport;
  const content = document.querySelector("#chat-export-preview")?.value;
  if (!result || !content) return;
  const format = state.chatExportFormat === "markdown" ? "md" : "json";
  const blob = new Blob([content], { type: format === "md" ? "text/markdown" : "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "bestie-chat-" + result.session.id + "." + format;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Chat export downloaded.", "good");
}

function importChatSessionFromPrompt() {
  openChatImportDialog();
}

function openChatImportDialog() {
  const dialog = document.querySelector("#chat-import-dialog");
  const textArea = document.querySelector("#chat-import-text");
  const fileInput = document.querySelector("#chat-import-file");
  if (!dialog?.showModal || !textArea || !fileInput) {
    showToast("Import dialog is unavailable.", "bad");
    return;
  }
  textArea.value = "";
  fileInput.value = "";
  updateChatImportPreview();
  dialog.showModal();
}

function updateChatImportPreview() {
  const textArea = document.querySelector("#chat-import-text");
  const preview = document.querySelector("#chat-import-preview");
  const confirm = document.querySelector("#chat-import-confirm");
  const raw = textArea?.value.trim() ?? "";
  if (!raw) {
    if (preview) preview.textContent = "Waiting for export JSON.";
    if (confirm) confirm.disabled = true;
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    const source = parsed.export ?? parsed;
    const messages = Array.isArray(source.messages) ? source.messages.length : 0;
    const events = Array.isArray(source.events) ? source.events.length : 0;
    const title = source.session?.title ?? parsed.title ?? "Imported chat";
    if (!messages) throw new Error("No messages found.");
    if (preview) preview.textContent = title + " · " + messages + " messages · " + events + " events";
    if (confirm) confirm.disabled = false;
    return parsed;
  } catch (error) {
    if (preview) preview.textContent = error?.message ?? "Invalid chat export JSON.";
    if (confirm) confirm.disabled = true;
    return undefined;
  }
}

function submitChatImport(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    showToast("Invalid chat export JSON.", "bad");
    return;
  }
  postJson("/api/chat/import", parsed).then((result) => {
    state.activeChatSession = result.session;
    state.chatHistory = (result.messages ?? []).map(toChatHistoryItem);
    state.chatTimeline = result.events ?? [];
    state.chatRuns = result.runs ?? [];
    state.chatApprovals = result.approvals ?? {};
    state.chatBranch = result.branch ?? { children: [] };
    state.chatRun = undefined;
    setValue("#chat-panel .value", result.session.title);
    renderChatTranscriptIntoPanel();
    renderChatBranchIntoPanel();
    renderChatTimelineIntoPanel();
    loadChatPhiên();
    document.querySelector("#chat-import-dialog")?.close();
    showToast("Chat imported.", "good");
  }).catch(() => setValue("#chat-panel .value", "Unable to import chat."));
}

function sendChatMessage() {
  const input = document.querySelector("#chat-input");
  const message = input?.value.trim() ?? "";
  if (!message) return;
  if (!state.activeChatSession) {
    createChatSessionWithMessage(message, input);
    return;
  }
  const history = state.chatHistory ?? [];
  state.chatHistory = [...history, { role: "user", content: message }];
  state.chatTimeline = [];
  state.chatRuns = state.chatRuns ?? [];
  state.chatApprovals = {};
  input.value = "";
  resizeChatComposer();
  const attachments = state.chatAttachments ?? [];
  runChatStream({ message, history, restoreHistory: history, attachments });
  clearChatAttachments();
}

function runChatStream({ message, history, restoreHistory, attachments, replaySourceRunId }) {
  setValue("#chat-panel .value", "Streaming...");
  state.chatRun = { status: "running", model: document.querySelector("#chat-provider-model")?.value || state.activeChatSession?.providerModelRef || state.providers?.primary?.modelRef, startedAt: new Date().toISOString(), messageLength: message.length, attachments: (attachments ?? []).map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size })) };
  renderChatInspectorIntoPanel();
  renderChatDraft("Thinking...");
  const controller = new AbortController();
  setChatStreaming(true, controller);
  streamChatMessage({ message, sessionId: state.activeChatSession?.id, history, attachments: attachments ?? [], toolsEnabled: document.querySelector("#chat-tools")?.checked !== false, memoryEnabled: document.querySelector("#chat-memory")?.checked !== false, providerModelRef: document.querySelector("#chat-provider-model")?.value || undefined, replaySourceRunId }, controller.signal)
    .then((result) => {
      if (result.session) state.activeChatSession = result.session;
      if (result.run) state.chatRuns = [...(state.chatRuns ?? []).filter((run) => Number(run.id) !== Number(result.run.id)), result.run];
      state.selectedChatRunId = result.run?.id;
      state.chatHistory = [...state.chatHistory, { role: "assistant", content: result.answer, runId: result.run?.id }];
      state.chatRun = { ...(state.chatRun ?? {}), ...(result.run ?? {}), status: "done", model: result.model, finishedAt: new Date().toISOString(), answerLength: result.answer.length };
      setValue("#chat-panel .value", 'Model ' + text(result.model));
      renderChatTranscriptIntoPanel();
      renderChatTimelineIntoPanel();
      loadChatPhiên();
    })
    .catch((error) => {
      if (error?.name === "AbortError") {
        state.chatTimeline = [...(state.chatTimeline ?? []), { type: "cancelled", label: "Chat stream cancelled" }];
        state.chatRun = { ...(state.chatRun ?? {}), status: "cancelled", finishedAt: new Date().toISOString() };
        setValue("#chat-panel .value", "Cancelled");
        renderChatTimelineIntoPanel();
        renderChatTranscriptIntoPanel();
        return;
      }
      setValue("#chat-panel .value", error?.message ?? "Unable to chat.");
      state.chatRun = { ...(state.chatRun ?? {}), status: "error", finishedAt: new Date().toISOString(), error: error?.message ?? "Unable to chat." };
      state.chatHistory = restoreHistory;
      renderChatTranscriptIntoPanel();
      renderChatInspectorIntoPanel();
    })
    .finally(() => setChatStreaming(false));
}

function retryLastChatMessage() {
  retryChatMessage();
}

function retryChatMessage(messageId) {
  if (!state.activeChatSession || state.chatStreamController) return;
  requireConfirm(messageId ? "Retry from this message?" : "Retry last message?", state.activeChatSession.title, () => postJson("/api/chat/retry", { sessionId: state.activeChatSession.id, messageId, confirm: true }).then((result) => {
    state.activeChatSession = result.session;
    state.chatHistory = (result.messages ?? []).map(toChatHistoryItem);
    state.chatTimeline = result.events ?? [];
    state.chatRuns = result.runs ?? [];
    state.chatApprovals = result.approvals ?? {};
    state.chatBranch = result.branch ?? { children: [] };
    state.chatRun = undefined;
    renderChatTranscriptIntoPanel();
    renderChatBranchIntoPanel();
    renderChatTimelineIntoPanel();
    const history = result.history ?? [];
    state.chatHistory = [...history, { role: "user", content: result.retryMessage }];
    state.chatTimeline = [];
    state.chatApprovals = {};
    state.chatBranch = result.branch ?? state.chatBranch ?? { children: [] };
    runChatStream({ message: result.retryMessage, history, restoreHistory: (result.messages ?? []).map(toChatHistoryItem) });
  })).catch(() => setValue("#chat-panel .value", "Unable to retry chat."));
}

function copyChatMessage(index, button) {
  const message = state.chatHistory?.[index];
  if (!message?.content) return;
  navigator.clipboard?.writeText(message.content).then(() => {
    button.querySelector("span") ? button.querySelector("span").textContent = "Copied" : button.textContent = "Copied";
    showToast("Message copied.", "good");
    setTimeout(() => { button.querySelector("span") ? button.querySelector("span").textContent = "Copy" : button.textContent = "Copy"; }, 1400);
  }).catch(() => showToast("Unable to copy message.", "bad"));
}

function forkChatSession(messageId) {
  if (!state.activeChatSession || state.chatStreamController) return;
  requireConfirm("Fork chat from this message?", state.activeChatSession.title, () => postJson("/api/chat/fork", { sessionId: state.activeChatSession.id, messageId, confirm: true }).then((result) => {
    state.activeChatSession = result.session;
    state.chatHistory = (result.messages ?? []).map(toChatHistoryItem);
    state.chatTimeline = result.events ?? [];
    state.chatRuns = result.runs ?? [];
    state.chatApprovals = result.approvals ?? {};
    state.chatBranch = result.branch ?? { children: [] };
    setValue("#chat-panel .value", result.session.title);
    renderChatTranscriptIntoPanel();
    renderChatBranchIntoPanel();
    renderChatTimelineIntoPanel();
    loadChatPhiên();
    showToast("Chat session forked.", "good");
  })).catch(() => setValue("#chat-panel .value", "Unable to fork chat."));
}

function createChatSessionWithMessage(message, input) {
  postJson("/api/chat/sessions", { title: message.slice(0, 54) })
    .then((result) => {
      state.activeChatSession = result.session;
      state.chatHistory = [];
      state.chatTimeline = [];
      state.chatRuns = [];
      state.chatApprovals = {};
      state.chatBranch = result.branch ?? { children: [] };
      input.value = message;
      renderChatPhiên();
      sendChatMessage();
    })
    .catch((error) => setValue("#chat-panel .value", error?.message ?? "Unable to create session."));
}

function renderChatDraft(content) {
  document.querySelector("#chat-transcript").innerHTML = renderChatTranscript() + '<div class="chat-message assistant streaming"><div class="chat-bubble"><div class="chat-message-head"><strong>' + escapeHtml(chatDisplayName("assistant")) + '</strong></div><div class="markdown-body">' + renderMarkdown(content || "Thinking...") + '</div></div></div>';
  scrollChatTranscriptToBottom();
}

function scrollChatTranscriptToBottom() {
  const transcript = document.querySelector("#chat-transcript");
  if (transcript) transcript.scrollTop = transcript.scrollHeight;
}

async function streamChatMessage(body, signal) {
  const response = await fetch("/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) return postJson("/api/chat", body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedAnswer = "";
  let finalResult;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\\n\\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = parseSseChunk(chunk);
      if (!event) continue;
      if (event.event === "token" && typeof event.data?.token === "string") {
        streamedAnswer += event.data.token;
        renderChatDraft(streamedAnswer);
      } else if (event.event === "tool") {
        state.chatToolActivities = [...(state.chatToolActivities ?? []), event.data];
      } else if (event.event === "timeline") {
        state.chatTimeline = [...(state.chatTimeline ?? []), event.data];
        mergeChatApprovalFromTimeline(event.data);
        renderChatTimelineIntoPanel();
      } else if (event.event === "done") {
        finalResult = event.data;
        if (finalResult?.approvals) state.chatApprovals = finalResult.approvals;
        if (!streamedAnswer && typeof finalResult.answer === "string") renderChatDraft(finalResult.answer);
      } else if (event.event === "error") {
        throw new Error(event.data?.error ?? "Chat stream failed.");
      }
    }
  }

  if (!finalResult) throw new Error("Chat stream ended without a final response.");
  return finalResult;
}

async function streamChatContinue(body, signal) {
  const response = await fetch("/api/chat/continue/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) return postJson("/api/chat/continue", body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedAnswer = "";
  let finalResult;

  renderChatDraft("");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\\n\\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = parseSseChunk(chunk);
      if (!event) continue;
      if (event.event === "token" && typeof event.data?.token === "string") {
        streamedAnswer += event.data.token;
        renderChatDraft(streamedAnswer);
      } else if (event.event === "timeline") {
        state.chatTimeline = [...(state.chatTimeline ?? []), event.data];
        mergeChatApprovalFromTimeline(event.data);
        renderChatTimelineIntoPanel();
      } else if (event.event === "done") {
        finalResult = event.data;
        if (finalResult?.approvals) state.chatApprovals = finalResult.approvals;
      } else if (event.event === "error") {
        throw new Error(event.data?.error ?? "Chat continue stream failed.");
      }
    }
  }

  if (!finalResult) throw new Error("Chat continue stream ended without a final response.");
  return finalResult;
}

function parseSseChunk(chunk) {
  const lines = chunk.split(/\\r?\\n/);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || !dataLines.length) return undefined;
  try {
    return { event: eventLine.slice("event:".length).trim(), data: JSON.parse(dataLines.map((line) => line.slice("data:".length).trim()).join("\\n")) };
  } catch {
    return undefined;
  }
}

function renderChatTimelineIntoPanel() {
  const target = document.querySelector("#chat-timeline");
  if (target) {
    target.innerHTML = '<div class="label">Timeline lượt chạy</div>' + renderChatTimeline();
    bindChatApprovalControls();
    bindChatContinueControls();
  }
  renderChatInspectorIntoPanel();
}

function renderChatBranchIntoPanel() {
  const target = document.querySelector("#chat-branch");
  if (target) {
    target.innerHTML = '<div class="label">Nhánh</div>' + renderChatBranchNavigator();
    bindChatBranchControls();
  }
}

function renderChatBranchNavigator() {
  const branch = state.chatBranch ?? { children: [] };
  const parent = branch.parent;
  const children = branch.children ?? [];
  if (!state.activeChatSession) return row("Branch", "no session", "");
  const parentRow = parent ? '<button class="branch-row" data-chat-branch-session="' + parent.sourceSessionId + '" type="button"><span>Parent</span><strong>#' + escapeHtml(parent.sourceSessionId) + '</strong><small>message #' + escapeHtml(parent.sourceMessageId) + '</small></button>' : '<div class="branch-row muted"><span>Parent</span><strong>Root session</strong><small>No upstream fork.</small></div>';
  const childRows = children.length ? children.map((child) => '<button class="branch-row" data-chat-branch-session="' + child.sessionId + '" type="button"><span>Child</span><strong>' + escapeHtml(child.title) + '</strong><small>message #' + escapeHtml(child.sourceMessageId) + '</small></button>').join("") : '<div class="branch-row muted"><span>Children</span><strong>No branches yet</strong><small>Fork a message to create one.</small></div>';
  return '<div class="branch-stack">' + parentRow + childRows + '</div>';
}

function bindChatBranchControls() {
  document.querySelectorAll("[data-chat-branch-session]").forEach((button) => button.addEventListener("click", () => loadChatSession(Number(button.dataset.chatBranchSession))));
}

function renderChatTimeline() {
  const events = state.chatTimeline ?? [];
  if (!events.length) return row("Timeline", "none yet", "");
  return events.slice(-12).map((event) => {
    const type = event.eventType ?? event.type ?? "event";
    const label = event.label ?? type;
    const payload = parseTimelinePayload(event);
    const approvalControls = type === "approval_required" && payload?.approvalId ? '<div class="timeline-actions">' + iconButton("check", "Approve", 'data-chat-approval="approve" data-approval-id="' + payload.approvalId + '"') + iconButton("x", "Deny", 'data-chat-approval="deny" data-approval-id="' + payload.approvalId + '"') + '</div>' : "";
    const approvalStatus = payload?.approvalId ? state.chatApprovals?.[String(payload.approvalId)]?.status : undefined;
    const continueControls = type === "approval_approved" && payload?.approvalId && approvalStatus === "approved" ? '<div class="timeline-actions">' + iconButton("activity", "Continue", 'data-chat-continue="' + payload.approvalId + '"') + '</div>' : "";
    const detail = formatTimelineDetail(type, payload, event);
    return '<details class="timeline-row" open><summary><span class="pill ' + timelineTone(type) + '">' + escapeHtml(type) + '</span><strong>' + escapeHtml(label) + '</strong></summary><div class="timeline-detail"><div class="subvalue">' + escapeHtml(detail) + '</div>' + approvalControls + continueControls + '</div></details>';
  }).join("");
}

function formatTimelineDetail(type, payload, event) {
  if (!payload || typeof payload !== "object") return event.createdAt ?? "live";
  if (type === "tool_start" || type === "tool_finish") return [payload.server, payload.tool, payload.action, payload.target].filter(Boolean).join(" · ") || payload.label || event.createdAt || "tool activity";
  if (type === "approval_required") return [payload.category, payload.target, payload.proposedReason ?? payload.reason].filter(Boolean).join(" · ") || "Approval required";
  if (type === "approval_approved" || type === "approval_denied") return [payload.status, payload.message, payload.reason].filter(Boolean).join(" · ") || "Approval updated";
  if (type === "done") return [payload.status, payload.characters ? payload.characters + " chars" : undefined, payload.toolCalls ? payload.toolCalls + " tools" : undefined].filter(Boolean).join(" · ") || "Completed";
  if (type === "memory_capture") return [payload.storedEntity ? payload.storedEntity + " entities" : undefined, payload.storedRelation ? payload.storedRelation + " relations" : undefined, payload.pending ? payload.pending + " pending" : undefined, payload.skipped ? payload.skipped + " skipped" : undefined].filter(Boolean).join(" · ") || "No graph changes";
  if (type === "error") return payload.message ?? payload.error ?? event.label ?? "Error";
  if (type === "thinking") return [payload.model, payload.memoryCount !== undefined ? payload.memoryCount + " memories" : undefined].filter(Boolean).join(" · ") || "Preparing context";
  if (type === "token") return payload.bytes ? payload.bytes + " bytes" : "Streaming";
  return [payload.label, payload.status, payload.target, payload.message].filter(Boolean).join(" · ") || event.createdAt || "live";
}

function parseTimelinePayload(event) {
  if (event.payload) return event.payload;
  if (!event.payloadJson) return undefined;
  try { return JSON.parse(event.payloadJson); } catch { return undefined; }
}

function mergeChatApprovalFromTimeline(event) {
  const type = event.eventType ?? event.type ?? "event";
  const payload = parseTimelinePayload(event);
  if (!payload?.approvalId) return;
  const id = String(payload.approvalId);
  const previous = state.chatApprovals?.[id] ?? { id: payload.approvalId };
  const status = type === "approval_approved" ? "approved" : type === "approval_denied" ? "denied" : type === "done" && payload.status === "executed" ? "executed" : undefined;
  if (status) state.chatApprovals = { ...(state.chatApprovals ?? {}), [id]: { ...previous, status } };
}

function bindChatApprovalControls() {
  document.querySelectorAll("[data-chat-approval]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.chatApproval;
    const id = Number(button.dataset.approvalId);
    requireConfirm((action === "approve" ? "Approve chat action?" : "Deny chat action?"), String(id), () => postJson("/api/approvals/action", { action, id, confirm: true }).then(() => {
      if (action === "approve") {
        state.chatTimeline = [...(state.chatTimeline ?? []), { type: "approval_approved", label: "Approval sẵn sàng to continue", payload: { approvalId: id } }];
        state.chatApprovals = { ...(state.chatApprovals ?? {}), [String(id)]: { ...(state.chatApprovals?.[String(id)] ?? { id }), status: "approved" } };
        renderChatTimelineIntoPanel();
      } else {
        state.chatApprovals = { ...(state.chatApprovals ?? {}), [String(id)]: { ...(state.chatApprovals?.[String(id)] ?? { id }), status: "denied" } };
      }
      showToast("Approval updated.", "good");
      if (state.activeChatSession) loadChatSession(state.activeChatSession.id);
      loadApprovals();
    })).catch(() => setValue("#chat-panel .value", "Unable to update approval."));
  }));
}

function bindChatContinueControls() {
  document.querySelectorAll("[data-chat-continue]").forEach((button) => button.addEventListener("click", () => {
    const approvalId = Number(button.dataset.chatContinue);
    if (!state.activeChatSession) return;
    requireConfirm("Continue approved action?", String(approvalId), () => {
      const controller = new AbortController();
      state.chatRun = { status: "running", model: state.activeChatSession.providerModelRef || state.providers?.primary?.modelRef, startedAt: new Date().toISOString(), approvalId };
      renderChatInspectorIntoPanel();
      setChatStreaming(true, controller);
      return streamChatContinue({ sessionId: state.activeChatSession.id, approvalId, confirm: true }, controller.signal).then((result) => {
      state.activeChatSession = result.session;
      state.chatHistory = (result.messages ?? []).map(toChatHistoryItem);
      state.chatTimeline = result.events ?? [];
      state.chatRuns = result.runs ?? [];
      state.chatApprovals = result.approvals ?? state.chatApprovals ?? {};
      state.chatRun = { ...(state.chatRun ?? {}), status: "done", finishedAt: new Date().toISOString() };
      renderChatTranscriptIntoPanel();
      renderChatTimelineIntoPanel();
      loadChatPhiên();
      showToast("Chat run continued.", "good");
      }).catch((error) => {
        if (error?.name === "AbortError") {
          state.chatTimeline = [...(state.chatTimeline ?? []), { type: "cancelled", label: "Chat continue cancelled" }];
          state.chatRun = { ...(state.chatRun ?? {}), status: "cancelled", finishedAt: new Date().toISOString() };
          setValue("#chat-panel .value", "Cancelled");
          renderChatTimelineIntoPanel();
          return;
        }
        setValue("#chat-panel .value", "Unable to continue chat run.");
        state.chatRun = { ...(state.chatRun ?? {}), status: "error", finishedAt: new Date().toISOString(), error: error?.message ?? "Unable to continue chat run." };
        renderChatInspectorIntoPanel();
      }).finally(() => setChatStreaming(false));
    });
  }));
}

function timelineTone(type) {
  return type === "done" || type === "tool_finish" || type === "approval_approved" || type === "memory_capture" ? "good" : type === "error" ? "bad" : type === "thinking" || type === "approval_required" || type === "cancelled" ? "warn" : "";
}

function renderMetrics(status) {
  setValue("#runtime-card .value", status.ok ? "Sẵn sàng" : text(status.error?.code));
}

function loadStatus() {
  fetch("/api/status")
    .then((response) => response.json())
    .then(renderMetrics)
    .catch(() => {
      setValue("#runtime-card .value", "Offline");
    });
}

function loadDoctor() {
  fetch("/api/doctor")
    .then((response) => response.json())
    .then((doctor) => {
      const firstIssue = doctor.report?.checks?.find((check) => check.status === "fail" || check.status === "warn");
      setValue("#doctor-panel .value", 'Pass ' + text(doctor.summary?.pass) + ' / Warn ' + text(doctor.summary?.warn) + ' / Fail ' + text(doctor.summary?.fail));
      setBody("#doctor-panel", row("First issue", firstIssue?.message ?? "No issues found.", pillClass(firstIssue?.status ?? "pass")));
    })
    .catch(() => setValue("#doctor-panel .value", "Unable to load diagnostics."));
}

function loadProviders() {
  fetch("/api/providers")
    .then((response) => response.json())
    .then((providers) => {
      state.providers = providers;
      setValue("#provider-panel .value", text(providers.primary?.modelRef) + ' via ' + text(providers.primary?.provider));
      const modelOptions = (providers.models ?? []).map((model) => option(model.modelRef, model.modelRef, model.primary)).join("");
      const fallbackOptions = (providers.models ?? []).filter((model) => !model.primary).map((model) => option(model.modelRef, model.modelRef, false)).join("");
      const profileRows = (providers.profiles ?? []).slice(0, 4).map((profile) => row(profile.id, profile.secretPresent ? profile.provider + ' sẵn sàng' : profile.provider + ' thiếu secret', profile.secretPresent ? "good" : "bad"));
      setBody("#provider-panel", [
        '<div class="segmented" role="tablist" aria-label="Provider views"><button class="active" data-segment-target="provider-overview" type="button">Overview</button><button data-segment-target="provider-configure" type="button">Configure</button><button data-segment-target="provider-profiles" type="button">Profiles</button></div>',
        '<div class="segment active" id="provider-overview">' + [row("Auth profile", providers.primary?.authProfile, ""), row("Secret", providers.primary?.secretPresent ? "present" : "missing", providers.primary?.secretPresent ? "good" : "bad"), row("Fallbacks", providers.fallbacks?.length ?? 0, "")].join("") + '</div>',
        '<div class="segment" id="provider-configure"><div class="preset-row"><button data-provider-preset="anthropic" type="button">' + icon("brain") + '<span>Claude</span></button><button data-provider-preset="openai" type="button">' + icon("spark") + '<span>ChatGPT</span></button><button data-provider-preset="gemini" type="button">' + icon("spark") + '<span>Gemini</span></button><button data-provider-preset="groq" type="button">' + icon("activity") + '<span>Groq</span></button><button data-provider-preset="openrouter" type="button">' + icon("cloud") + '<span>OpenRouter</span></button><button data-provider-preset="ollama" type="button">' + icon("terminal") + '<span>Ollama</span></button></div><div class="control-grid"><label>Primary model<select id="provider-primary-select">' + modelOptions + '</select></label>' + iconButton("check", "Set primary", 'id="provider-primary-set"') + '</div><div class="control-grid"><label>Fallback<select id="provider-fallback-select">' + fallbackOptions + '</select></label>' + iconButton("check", "Add", 'id="provider-fallback-add"') + iconButton("x", "Remove", 'id="provider-fallback-remove"') + '</div><form id="provider-setup-form" class="stack"><div class="control-grid"><label>Provider<input name="provider" value="gemini"></label><label>Model<input name="model" value="gemini-2.5-flash"></label><label data-provider-field="baseUrl">Base URL<input name="baseUrl" placeholder="SDK default for Gemini"></label><label data-provider-field="apiKeyEnv">API key env<input name="apiKeyEnv" value="GEMINI_API_KEY"></label><label data-provider-field="có secret">Secret<input name="có secret" type="password" placeholder="tùy chọn"></label><label class="check"><input name="setDefault" type="checkbox"> Set default</label><button type="submit">' + icon("check") + '<span>Setup</span></button></div><div class="notice" id="provider-setup-note">' + escapeHtml(providerSetupNote("gemini")) + '</div></form></div>',
        '<div class="segment" id="provider-profiles">' + (profileRows.join("") || row("Profiles", "empty", "")) + '</div>',
      ].join(""));
      bindProviderControls();
      renderChatPreferencesIntoPanel();
    })
    .catch(() => setValue("#provider-panel .value", "Unable to load providers."));
}

function loadCharacter() {
  fetch("/api/character")
    .then((response) => response.json())
    .then((character) => {
      state.character = character;
      const parsed = character.character?.parsed;
      setValue("#character-panel .value", parsed ? parsed.name + ' / ' + parsed.language : "Character file missing or invalid.");
      const tone = parsed?.tone ?? {};
      setBody("#character-panel", [
        row("Prompt bytes", character.prompt?.bytes ?? 0, ""),
        row("Roast", parsed?.tone?.roastLevel ?? "-", ""),
        row("Warmth", parsed?.tone?.warmthLevel ?? "-", "good"),
        '<form id="character-form" class="stack"><div class="control-grid"><label>Tên<input name="name" value="' + escapeHtml(parsed?.name) + '"></label><label>Owner<input name="ownerName" value="' + escapeHtml(parsed?.ownerName) + '"></label><label>Language<input name="language" value="' + escapeHtml(parsed?.language) + '"></label></div><div class="slider-grid"><label>Roast<input name="roastLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.roastLevel ?? 0) + '"></label><label>Warmth<input name="warmthLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.warmthLevel ?? 0) + '"></label><label>Bluntness<input name="bluntnessLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.bluntnessLevel ?? 0) + '"></label><label>Chaos<input name="chaosLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.chaosLevel ?? 0) + '"></label></div></form>',
        '<label class="stack">character.json<textarea id="character-json" spellcheck="false">' + escapeHtml(character.character?.text ?? "") + '</textarea></label>',
        '<label class="stack">system-prompt.md<textarea id="character-prompt" spellcheck="false">' + escapeHtml(character.prompt?.text ?? "") + '</textarea></label>',
      ].join(""));
      bindCharacterControls();
      renderChatTranscriptIntoPanel();
    })
    .catch(() => setValue("#character-panel .value", "Unable to load character."));
}

function loadMemory() {
  fetch("/api/memory")
    .then((response) => response.json())
    .then((memory) => {
      setValue("#memory-panel .value", 'Active ' + text(memory.counts?.active) + ' / Pending ' + text(memory.counts?.pending) + ' / Summaries ' + text(memory.counts?.conversationSummaries ?? 0));
      const memories = (memory.memories ?? []).slice(0, 6).map(renderMemoryItem);
      const pending = (memory.pending ?? []).slice(0, 6).map(renderPendingMemoryItem);
      const summaries = (memory.conversationSummaries ?? []).slice(0, 6).map(renderConversationSummaryItem);
      setBody("#memory-panel", [
        '<div class="segmented" role="tablist" aria-label="Memory views"><button class="active" data-segment-target="memory-active" type="button">Active</button><button data-segment-target="memory-pending" type="button">Đang chờ</button><button data-segment-target="memory-continuity" type="button">Continuity</button><button data-segment-target="memory-search-view" type="button">Tìm kiếm</button></div>',
        '<div class="segment active" id="memory-active">' + (memories.join("") || row("Active", "empty", "")) + '</div>',
        '<div class="segment" id="memory-pending">' + (pending.join("") || row("Pending", "empty", "")) + '</div>',
        '<div class="segment" id="memory-continuity">' + (summaries.join("") || row("Continuity", "no rolling summaries yet", "")) + '</div>',
        '<div class="segment" id="memory-search-view"><div class="control-grid"><input id="memory-search" placeholder="Tìm kiếm memories"><button id="memory-search-run" type="button">Tìm kiếm</button></div><div id="memory-search-results" class="stack">' + row("Tìm kiếm", "sẵn sàng", "") + '</div></div>',
      ].join(""));
      bindMemoryControls();
    })
    .catch(() => setValue("#memory-panel .value", "Unable to load memory."));
}

function renderMemoryItem(item) {
  const meta = 'scope ' + text(item.scope) + ' / importance ' + text(item.importance) + ' / confidence ' + text(item.confidence);
  return '<div class="memory-row"><div><strong>' + escapeHtml(item.type) + '</strong><div>' + escapeHtml(item.content) + '</div><div class="subvalue">' + escapeHtml(meta) + '</div></div><span><span class="pill ' + (item.pinned ? "good" : "") + '">' + (item.pinned ? "pinned" : "active") + '</span><span class="pill ' + (item.sensitivity === "sensitive" ? "warn" : "good") + '">' + escapeHtml(item.sensitivity) + '</span></span></div>';
}

function renderPendingMemoryItem(item) {
  const meta = [item.reason, item.source, item.explicitConsent ? "đã đồng ý rõ ràng" : "cần rà soát"].filter(Boolean).join(' / ');
  return '<div class="memory-row"><div><strong>Pending ' + escapeHtml(item.type) + '</strong><div>' + escapeHtml(item.content) + '</div><div class="subvalue">' + escapeHtml(meta || item.createdAt) + '</div></div><span>' + iconButton("check", "Approve", 'data-memory-action="approve_pending" data-memory-id="' + item.id + '"') + iconButton("x", "Reject", 'data-memory-action="reject_pending" data-memory-id="' + item.id + '"') + '</span></div>';
}

function renderConversationSummaryItem(item) {
  const owner = item.userId ? item.channel + ':' + item.userId : item.channel;
  const meta = 'through message #' + text(item.summarizedMessageId) + ' / updated ' + text(item.updatedAt);
  const content = text(item.content).length > 260 ? text(item.content).slice(0, 257) + '...' : text(item.content);
  return '<div class="memory-row"><div><strong>' + escapeHtml(owner) + '</strong><div>' + escapeHtml(content) + '</div><div class="subvalue">' + escapeHtml(meta) + '</div></div><span><span class="pill good">summary</span></span></div>';
}

function bindProviderControls() {
  document.querySelectorAll("#provider-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#provider-panel", button.dataset.segmentTarget)));
  const form = document.querySelector("#provider-setup-form");
  if (form) {
    updateProviderSetupFields(form.elements.provider.value);
    form.elements.provider.addEventListener("input", () => updateProviderSetupFields(form.elements.provider.value));
  }
  document.querySelectorAll("[data-provider-preset]").forEach((button) => button.addEventListener("click", () => {
    const preset = providerPresets[button.dataset.providerPreset];
    const form = document.querySelector("#provider-setup-form");
    if (!preset || !form) return;
    form.elements.provider.value = preset.provider;
    form.elements.model.value = preset.model;
    form.elements.baseUrl.value = preset.baseUrl;
    form.elements.apiKeyEnv.value = preset.apiKeyEnv;
    updateProviderSetupFields(preset.provider);
    showToast('Preset loaded: ' + button.textContent, "good");
  }));
  document.querySelector("#provider-primary-set")?.addEventListener("click", () => {
    const modelRef = document.querySelector("#provider-primary-select")?.value;
    if (!modelRef) return;
    requireConfirm("Set primary provider?", modelRef, () => withLoading("#provider-panel .value", "Setting primary...", () => postJson("/api/providers/primary", { modelRef }).then(loadProviders).then(loadStatus).then(() => showToast("Primary provider updated.", "good")))).catch(() => setValue("#provider-panel .value", "Unable to set primary."));
  });
  document.querySelector("#provider-fallback-add")?.addEventListener("click", () => updateFallback("add"));
  document.querySelector("#provider-fallback-remove")?.addEventListener("click", () => updateFallback("remove"));
  document.querySelector("#provider-setup-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      provider: text(form.get("provider")).trim(),
      model: text(form.get("model")).trim(),
      baseUrl: text(form.get("baseUrl")).trim(),
      apiKeyEnv: text(form.get("apiKeyEnv")).trim(),
      secret: text(form.get("secret")),
      setDefault: form.get("setDefault") === "on",
    };
    if (body.baseUrl === "-") delete body.baseUrl;
    if (body.apiKeyEnv === "-") delete body.apiKeyEnv;
    if (body.secret === "-") delete body.secret;
    requireConfirm("Setup provider?", body.provider + ' / ' + body.model, () => withLoading("#provider-panel .value", "Setting up provider...", () => postJson("/api/providers/setup", body).then(loadProviders).then(loadStatus).then(() => showToast("Provider saved.", "good")))).catch(() => setValue("#provider-panel .value", "Unable to setup provider."));
  });
}

function activateSegment(panelSelector, segmentId) {
  const root = document.querySelector(panelSelector);
  if (!root || !segmentId) return;
  root.dataset.activeSegment = segmentId;
  root.querySelectorAll("[data-segment-target]").forEach((button) => button.classList.toggle("active", button.dataset.segmentTarget === segmentId));
  root.querySelectorAll(".segment").forEach((segment) => segment.classList.toggle("active", segment.id === segmentId));
}

function updateProviderSetupFields(provider) {
  const normalized = text(provider).trim().toLowerCase();
  const isGemini = normalized === "gemini";
  const isOllama = normalized === "ollama";
  document.querySelector('[data-provider-field="baseUrl"]')?.classList.toggle("hidden", isGemini);
  document.querySelector('[data-provider-field="apiKeyEnv"]')?.classList.toggle("hidden", isOllama);
  document.querySelector('[data-provider-field="có secret"]')?.classList.toggle("hidden", isOllama);
  setValue("#provider-setup-note", providerSetupNote(normalized));
}

function bindCharacterControls() {
  document.querySelector("#character-form")?.addEventListener("input", () => {
    try {
      const current = JSON.parse(document.querySelector("#character-json")?.value || "{}");
      const form = new FormData(document.querySelector("#character-form"));
      current.name = text(form.get("name"));
      current.ownerName = text(form.get("ownerName"));
      current.language = text(form.get("language"));
      current.tone = {
        ...(current.tone ?? {}),
        roastLevel: Number(form.get("roastLevel")),
        warmthLevel: Number(form.get("warmthLevel")),
        bluntnessLevel: Number(form.get("bluntnessLevel")),
        chaosLevel: Number(form.get("chaosLevel")),
      };
      document.querySelector("#character-json").value = JSON.stringify(current, null, 2) + "\\n";
    } catch {
      setValue("#character-panel .value", "Fix character JSON before using form controls.");
    }
  });
}

function updateFallback(action) {
  const modelRef = document.querySelector("#provider-fallback-select")?.value;
  if (!modelRef) return;
  requireConfirm((action === "add" ? "Add fallback?" : "Remove fallback?"), modelRef, () => withLoading("#provider-panel .value", "Updating fallback...", () => postJson("/api/providers/fallbacks", { action, modelRef }).then(loadProviders).then(() => showToast("Fallback updated.", "good")))).catch(() => setValue("#provider-panel .value", "Unable to update fallback."));
}

function bindMemoryControls() {
  document.querySelectorAll("#memory-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#memory-panel", button.dataset.segmentTarget)));
  document.querySelector("#memory-search-run")?.addEventListener("click", () => {
    const query = document.querySelector("#memory-search")?.value ?? "";
    fetch("/api/memory/search?q=" + encodeURIComponent(query))
      .then((response) => response.json())
      .then((memory) => {
        const results = (memory.memories ?? []).map(renderMemoryItem);
        setValue("#memory-panel .value", 'Tìm kiếm results for "' + query + '"');
        document.querySelector("#memory-search-results").innerHTML = results.join("") || row("Tìm kiếm", "no results", "");
        activateSegment("#memory-panel", "memory-search-view");
      })
      .catch(() => setValue("#memory-panel .value", "Unable to search memory."));
  });
  document.querySelectorAll("[data-memory-action]").forEach((button) => button.addEventListener("click", () => {
    requireConfirm("Update memory?", button.dataset.memoryAction, () => withLoading("#memory-panel .value", "Updating memory...", () => postJson("/api/memory/action", { action: button.dataset.memoryAction, id: Number(button.dataset.memoryId), confirm: true }).then(loadMemory).then(() => showToast("Memory updated.", "good")))).catch(() => setValue("#memory-panel .value", "Unable to update memory."));
  }));
}

function loadKnowledgeGraph() {
  fetch("/api/knowledge-graph")
    .then((response) => response.json())
    .then((graph) => {
      state.knowledgeGraph = graph;
      renderKnowledgeGraphPanel(graph, "graph");
    })
    .catch(() => setValue("#knowledge-panel .value", "Không thể tải đồ thị."));
}

function renderKnowledgeGraphPanel(graph, mode) {
  loadKnowledgeMapPreferences();
  state.knowledgeGraph = graph;
  state.knowledgeReviewPriority = state.knowledgeReviewPriority ?? "all";
  state.knowledgeReviewAction = state.knowledgeReviewAction ?? "all";
  state.knowledgeTrustFilter = state.knowledgeTrustFilter ?? "all";
  state.knowledgeTrustSort = state.knowledgeTrustSort ?? "score";
  state.knowledgeDrawer = state.knowledgeDrawer ?? "closed";
  state.knowledgeGraphFilters = state.knowledgeGraphFilters ?? { kind: "all", scope: "all", trust: "all" };
  state.knowledgeGraphSearch = state.knowledgeGraphSearch ?? "";
  state.knowledgeConnectedOnly = state.knowledgeConnectedOnly ?? false;
  state.knowledgeOverlayCollapsed = state.knowledgeOverlayCollapsed ?? false;
  state.knowledgeClusterBy = state.knowledgeClusterBy ?? "none";
  state.knowledgeRelationDensity = state.knowledgeRelationDensity ?? "all";
  state.knowledgeMotion = state.knowledgeMotion ?? "subtle";
  setValue("#knowledge-panel .value", 'Thực thể ' + text(graph.counts?.entities) + ' / Liên kết ' + text(graph.counts?.relations) + ' / Score ' + text(graph.analysis?.score));
  const entities = graph.entities ?? [];
  const relations = graph.relations ?? [];
  const pending = graph.pending ?? [];
  const suggestions = filterKnowledgeReviewSuggestions(graph.review?.suggestions ?? []);
  const graphSummary = '<div class="summary-strip knowledge-map-summary"><span><strong>' + escapeHtml(graph.counts?.entities ?? 0) + '</strong><small>Thực thể</small></span><span><strong>' + escapeHtml(graph.counts?.relations ?? 0) + '</strong><small>Liên kết</small></span><span><strong>' + escapeHtml(graph.counts?.pending ?? 0) + '</strong><small>Đang chờ</small></span><span><strong>' + escapeHtml(graph.trust?.averageScore ?? graph.analysis?.score ?? 100) + '</strong><small>Độ tin cậy</small></span></div>';
  const graphSegments = '<div class="segmented knowledge-map-segments" role="tablist" aria-label="Các chế độ đồ thị tri thức"><button class="active" data-segment-target="knowledge-map" type="button">Bản đồ</button><button data-segment-target="knowledge-review" type="button">Rà soát</button><button data-segment-target="knowledge-trust" type="button">Độ tin cậy</button><button data-segment-target="knowledge-search-view" type="button">Tìm kiếm</button></div>';
  setBody("#knowledge-panel", [
    graphSummary,
    graphSegments,
    '<div class="segment active" id="knowledge-map"><div class="knowledge-map-shell" data-knowledge-drawer="' + escapeHtml(state.knowledgeDrawer) + '" data-knowledge-overlay="' + (state.knowledgeOverlayCollapsed ? "collapsed" : "expanded") + '"><div class="knowledge-map-overlay"><div class="knowledge-map-overlay-head"><button data-knowledge-overlay-toggle type="button" title="Bật/tắt công cụ bản đồ">' + icon(state.knowledgeOverlayCollapsed ? "sliders" : "x") + '<span>' + (state.knowledgeOverlayCollapsed ? "Công cụ" : "Ẩn") + '</span></button><span class="pill" id="knowledge-visible-count">đồ thị hiển thị</span><button data-knowledge-graph-action="fit" type="button" title="Vừa khung đồ thị">' + icon("activity") + '<span>Vừa khung</span></button><button data-knowledge-drawer-open="inspector" type="button" title="Mở chi tiết">' + icon("sliders") + '<span>Chi tiết</span></button></div>' + graphSummary + graphSegments + renderKnowledgeMapToolbar(entities, relations) + '</div><div class="knowledge-canvas"><div id="knowledge-provenance-overlay" class="knowledge-provenance-overlay" aria-live="polite">' + renderKnowledgeProvenanceOverlay(graph) + '</div><div id="knowledge-cytoscape" class="knowledge-cytoscape" role="img" aria-label="Bản đồ tri thức"></div></div><aside class="knowledge-drawer" aria-label="Drawer đồ thị tri thức"><div class="knowledge-drawer-head"><div><div class="label" id="knowledge-drawer-title">' + escapeHtml(state.knowledgeDrawer === "list" ? "Mục đồ thị" : "Inspector") + '</div><div class="subvalue">' + escapeHtml(state.knowledgeDrawer === "list" ? "Thực thể và liên kết" : "Mục đồ thị đã chọn") + '</div></div><button data-knowledge-drawer-close type="button" aria-label="Đóng">' + icon("x") + '</button></div><div class="knowledge-drawer-view knowledge-drawer-list"><div id="knowledge-drawer-list" class="stack">' + renderKnowledgeDrawerList(graph) + '</div></div><div class="knowledge-drawer-view knowledge-drawer-inspector"><div id="knowledge-inspector" class="knowledge-inspector">' + renderKnowledgeInspector(graph) + '</div></div></aside></div></div>',
    '<div class="segment" id="knowledge-review">' + renderKnowledgeReviewControls(graph) + '<div class="knowledge-detail-layout"><div class="stack">' + (suggestions.map((suggestion) => renderKnowledgeSuggestion(suggestion, suggestion.index, graph)).join("") || row("Review", "sạch với bộ lọc hiện tại", "good")) + renderKnowledgePendingReviewSection(pending) + '</div><div id="knowledge-review-inspector" class="knowledge-inspector">' + renderKnowledgeInspector(graph) + '</div></div></div>',
    '<div class="segment" id="knowledge-trust">' + renderKnowledgeTrustDashboard(graph) + '</div>',
    '<div class="segment" id="knowledge-search-view"><div class="control-grid"><input id="knowledge-search" placeholder="Tìm kiếm đồ thị"><button id="knowledge-search-run" type="button">Tìm kiếm</button></div><div class="knowledge-detail-layout"><div id="knowledge-search-results" class="stack">' + (mode === "search" ? renderKnowledgeSearchResults(graph) : row("Tìm kiếm", "sẵn sàng", "")) + '</div><div id="knowledge-search-inspector" class="knowledge-inspector">' + renderKnowledgeInspector(graph) + '</div></div></div>',
  ].join(""));
  bindKnowledgeGraphControls();
  renderKnowledgeCytoscapeGraph(entities, relations);
  document.querySelector("#knowledge-panel")?.setAttribute("data-active-segment", "knowledge-map");
  if (mode === "search") activateSegment("#knowledge-panel", "knowledge-search-view");
  if (mode === "review") activateSegment("#knowledge-panel", "knowledge-review");
  if (mode === "trust") activateSegment("#knowledge-panel", "knowledge-trust");
}

function renderKnowledgeMapToolbar(entities, relations) {
  const filters = state.knowledgeGraphFilters ?? { kind: "all", scope: "all", trust: "all" };
  const kinds = [...new Set((entities ?? []).map((entity) => entity.kind).filter(Boolean))].sort();
  const scopes = [...new Set([...(entities ?? []).map((entity) => entity.scope), ...(relations ?? []).map((relation) => relation.scope)].filter(Boolean))].sort();
  const trusts = [...new Set([...(entities ?? []).map((entity) => entity.trust?.level), ...(relations ?? []).map((relation) => relation.trust?.level)].filter(Boolean))].sort();
  const activeView = state.knowledgeActiveView ?? "all";
  const customOption = activeView === "custom" ? option("custom", "Custom", true) : "";
  const savedOption = state.knowledgeSavedView ? option("saved", "Saved view", activeView === "saved") : "";
  return '<div class="knowledge-map-toolbar"><div class="knowledge-map-views"><select id="knowledge-map-view" aria-label="View đồ thị đã lưu">' + option("all", "All", activeView === "all") + option("review", "Review", activeView === "review") + option("high-trust", "Độ tin cậy cao", activeView === "high-trust") + option("focused", "Tập trung", activeView === "focused") + customOption + savedOption + '</select><button data-knowledge-view-apply type="button">' + icon("check") + '<span>Áp dụng</span></button><button data-knowledge-view-save type="button">' + icon("database") + '<span>Lưu</span></button></div><div class="knowledge-map-cluster"><select id="knowledge-cluster-by" aria-label="Gom cụm đồ thị">' + option("none", "Tắt gom cụm", state.knowledgeClusterBy === "none") + option("kind", "Gom cụm theo loại", state.knowledgeClusterBy === "kind") + option("scope", "Gom cụm theo phạm vi", state.knowledgeClusterBy === "scope") + option("trust", "Gom cụm theo độ tin cậy", state.knowledgeClusterBy === "trust") + '</select><select id="knowledge-relation-density" aria-label="Mật độ liên kết">' + option("all", "Tất cả liên kết", state.knowledgeRelationDensity === "all") + option("balanced", "Cân bằng", state.knowledgeRelationDensity === "balanced") + option("strong", "Chỉ liên kết mạnh", state.knowledgeRelationDensity === "strong") + '</select><select id="knowledge-motion" aria-label="Chuyển động đồ thị">' + option("subtle", "Chuyển động nhẹ", state.knowledgeMotion !== "off") + option("off", "Tắt chuyển động", state.knowledgeMotion === "off") + '</select></div><div class="knowledge-map-search"><input id="knowledge-map-search" placeholder="Tìm kiếm đồ thị" value="' + escapeHtml(state.knowledgeGraphSearch ?? "") + '"><select id="knowledge-map-search-result" aria-label="Kết quả tìm trên đồ thị">' + renderKnowledgeMapSearchOptions(entities, relations, state.knowledgeGraphSearch ?? "") + '</select><button data-knowledge-graph-action="focus-search" type="button">' + icon("activity") + '<span>Tập trung</span></button><button data-knowledge-graph-action="unfocus" type="button">' + icon("x") + '<span>Bỏ focus</span></button><label class="knowledge-focus-toggle"><input id="knowledge-connected-only" type="checkbox"' + (state.knowledgeConnectedOnly ? ' checked' : '') + '><span>Chỉ mục liên kết</span></label></div><div class="knowledge-map-actions"><button data-knowledge-graph-action="fit" type="button" title="Vừa khung đồ thị">' + icon("activity") + '<span>Vừa khung</span></button><button data-knowledge-graph-action="reset" type="button" title="Đặt lại bố cục">' + icon("refresh") + '<span>Đặt lại</span></button><button data-knowledge-graph-action="zoom-in" type="button" title="Phóng to">' + icon("spark") + '<span>Phóng to</span></button><button data-knowledge-graph-action="zoom-out" type="button" title="Thu nhỏ">' + icon("square") + '<span>Thu nhỏ</span></button></div><div class="knowledge-map-filters"><select id="knowledge-kind-filter" aria-label="Bộ lọc loại đồ thị">' + option("all", "Tất cả loại", filters.kind === "all") + kinds.map((kind) => option(kind, kind, filters.kind === kind)).join("") + '</select><select id="knowledge-scope-filter" aria-label="Bộ lọc phạm vi đồ thị">' + option("all", "Tất cả phạm vi", filters.scope === "all") + scopes.map((scope) => option(scope, scope === "core" ? "Phạm vi core" : scope === "project" ? "Phạm vi project" : scope, filters.scope === scope)).join("") + '</select><select id="knowledge-map-trust-filter" aria-label="Bộ lọc độ tin cậy đồ thị">' + option("all", "Tất cả độ tin cậy", filters.trust === "all") + trusts.map((trust) => option(trust, trust, filters.trust === trust)).join("") + '</select><button data-knowledge-graph-action="clear-filters" type="button">' + icon("x") + '<span>Xóa</span></button></div><div class="knowledge-map-actions"><button data-knowledge-drawer-open="list" type="button">' + icon("layers") + '<span>Danh sách</span></button><button data-knowledge-drawer-open="inspector" type="button">' + icon("sliders") + '<span>Chi tiết</span></button></div></div><div class="knowledge-legend"><span><i class="person"></i>person</span><span><i class="project"></i>project</span><span><i class="preference"></i>preference</span><span><i class="topic"></i>topic</span></div>';
}

function renderKnowledgeMapSearchOptions(entities, relations, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  const options = [
    ...(entities ?? []).map((entity) => ({ value: "entity:" + entity.id, label: 'Entity #' + entity.id + ' ' + entity.canonicalName, text: [entity.canonicalName, entity.kind, entity.scope, ...(entity.aliases ?? [])].join(" ") })),
    ...(relations ?? []).map((relation) => ({ value: "relation:" + relation.id, label: 'Relation #' + relation.id + ' ' + relation.sourceName + ' --' + relation.relationType + '--> ' + relation.targetName, text: [relation.sourceName, relation.relationType, relation.targetName, relation.scope, relation.evidence].join(" ") })),
  ].filter((item) => !normalized || item.text.toLowerCase().includes(normalized) || item.label.toLowerCase().includes(normalized)).slice(0, 16);
  return options.length ? options.map((item) => option(item.value, item.label, false)).join("") : option("", "Không có kết quả đồ thị", true);
}

function renderKnowledgeDrawerList(graph) {
  if (state.selectedKnowledge?.type === "cluster") return renderKnowledgeClusterDrilldown(graph, String(state.selectedKnowledge.id));
  const entities = graph.entities ?? [];
  const relations = graph.relations ?? [];
  return (entities.slice(0, 12).map(renderKnowledgeEntity).join("") || row("Entities", "empty", "")) + relations.slice(0, 12).map(renderKnowledgeRelation).join("");
}

function renderKnowledgeClusterDrilldown(graph, clusterId) {
  const cluster = getKnowledgeClusterMembers(graph, clusterId);
  if (!cluster) return row("Cluster", "không tìm thấy", "warn");
  const relationRows = cluster.relations.slice(0, 8).map(renderKnowledgeRelation).join("") || row("Relations", "không có trong cụm", "");
  const entityRows = cluster.entities.slice(0, 12).map(renderKnowledgeEntity).join("") || row("Entities", "empty", "");
  return '<div class="knowledge-cluster-detail"><div class="label">Cluster</div><div class="value">' + escapeHtml(cluster.label) + '</div><div class="summary-strip"><span><strong>' + escapeHtml(cluster.entities.length) + '</strong><small>Thực thể</small></span><span><strong>' + escapeHtml(cluster.relations.length) + '</strong><small>Liên kết</small></span></div><div class="actions inline-actions"><button data-knowledge-cluster-expand="' + escapeHtml(cluster.id) + '" type="button">' + icon("layers") + '<span>Mở cụm</span></button></div><div class="tool-section"><div class="label">Thành viên</div>' + entityRows + '</div><div class="tool-section"><div class="label">Liên kết nội bộ</div>' + relationRows + '</div></div>';
}

function getKnowledgeClusterMembers(graph, clusterId) {
  const clusterBy = state.knowledgeClusterBy ?? "none";
  if (clusterBy === "none") return undefined;
  const prefix = "cluster-" + clusterBy + "-";
  if (!clusterId.startsWith(prefix)) return undefined;
  const normalizedValue = clusterId.slice(prefix.length);
  const entities = (graph.entities ?? []).filter((entity) => knowledgeClusterKey(entity, clusterBy).replace(/[^a-z0-9_-]/gi, "-").toLowerCase() === normalizedValue);
  const ids = new Set(entities.map((entity) => Number(entity.id)));
  const relations = (graph.relations ?? []).filter((relation) => ids.has(Number(relation.sourceEntityId)) && ids.has(Number(relation.targetEntityId)));
  const label = entities[0] ? knowledgeClusterKey(entities[0], clusterBy) + " (" + entities.length + ")" : normalizedValue;
  return { id: clusterId, label, clusterBy, value: entities[0] ? knowledgeClusterKey(entities[0], clusterBy) : normalizedValue, entities, relations };
}

function knowledgeClusterKey(entity, clusterBy) {
  if (clusterBy === "scope") return String(entity.scope ?? "session");
  if (clusterBy === "trust") return String(entity.trust?.level ?? "medium");
  return String(entity.kind ?? "topic");
}

function renderKnowledgeTrustDashboard(graph) {
  const trust = graph.trust ?? {};
  const items = getKnowledgeTrustItems(graph);
  return '<div class="knowledge-review-toolbar"><div class="summary-strip"><span><strong>' + escapeHtml(trust.averageScore ?? 100) + '</strong><small>Average</small></span><span><strong>' + escapeHtml(trust.lowTrust ?? 0) + '</strong><small>Low trust</small></span><span><strong>' + escapeHtml(trust.stale ?? 0) + '</strong><small>Stale</small></span><span><strong>' + escapeHtml(trust.needsSource ?? 0) + '</strong><small>Needs source</small></span><span><strong>' + escapeHtml(trust.conflicting ?? 0) + '</strong><small>Conflicts</small></span></div><div class="control-grid"><select id="knowledge-trust-filter" aria-label="Trust filter">' + option("all", "Tất cả độ tin cậy", state.knowledgeTrustFilter === "all") + option("low", "Low trust", state.knowledgeTrustFilter === "low") + option("stale", "Stale", state.knowledgeTrustFilter === "stale") + option("source", "Needs source", state.knowledgeTrustFilter === "source") + option("conflict", "Conflicting", state.knowledgeTrustFilter === "conflict") + '</select><select id="knowledge-trust-sort" aria-label="Trust sort">' + option("score", "Lowest trust first", state.knowledgeTrustSort === "score") + option("age", "Oldest first", state.knowledgeTrustSort === "age") + option("source", "Needs source first", state.knowledgeTrustSort === "source") + '</select></div></div><div class="knowledge-detail-layout"><div class="stack">' + (items.map(renderKnowledgeTrustRow).join("") || row("Trust", "sạch với bộ lọc hiện tại", "good")) + '</div><div id="knowledge-trust-inspector" class="knowledge-inspector">' + renderKnowledgeInspector(graph) + '</div></div>';
}

function getKnowledgeTrustItems(graph) {
  const entities = (graph.entities ?? []).map((entity) => ({ type: "entity", id: Number(entity.id), title: entity.canonicalName, detail: entity.kind + ' / ' + (entity.trust?.relationCount ?? 0) + ' relations', trust: entity.trust }));
  const relations = (graph.relations ?? []).map((relation) => ({ type: "relation", id: Number(relation.id), title: relation.sourceName + ' --' + relation.relationType + '--> ' + relation.targetName, detail: 'relation / confidence ' + relation.confidence, trust: relation.trust }));
  return [...entities, ...relations].filter((item) => {
    if (state.knowledgeTrustFilter === "low") return item.trust?.level === "low";
    if (state.knowledgeTrustFilter === "stale") return item.trust?.stale;
    if (state.knowledgeTrustFilter === "source") return item.trust?.needsSource;
    if (state.knowledgeTrustFilter === "conflict") return item.trust?.conflicting;
    return true;
  }).sort((left, right) => {
    if (state.knowledgeTrustSort === "age") return Number(right.trust?.ageDays ?? 0) - Number(left.trust?.ageDays ?? 0);
    if (state.knowledgeTrustSort === "source") return Number(Boolean(right.trust?.needsSource)) - Number(Boolean(left.trust?.needsSource)) || Number(left.trust?.score ?? 100) - Number(right.trust?.score ?? 100);
    return Number(left.trust?.score ?? 100) - Number(right.trust?.score ?? 100);
  });
}

function renderKnowledgeTrustRow(item) {
  const trust = item.trust ?? { score: 100, level: "high", warnings: [], signals: [] };
  const tone = trust.level === "high" ? "good" : trust.level === "low" ? "warn" : "";
  const warnings = trust.warnings?.length ? trust.warnings.join(" / ") : trust.signals?.slice(0, 2).join(" / ");
  return '<div class="knowledge-row knowledge-trust-row" data-knowledge-select="' + escapeHtml(item.type) + '" data-' + escapeHtml(item.type) + '-id="' + escapeHtml(item.id) + '"><div><strong>' + escapeHtml(item.type + ' #' + item.id + ' ' + item.title) + '</strong><div class="subvalue">' + escapeHtml(item.detail) + '</div><div class="subvalue">' + escapeHtml(warnings || "Trust signals available") + '</div></div><span><span class="pill ' + tone + '">' + escapeHtml(trust.score) + '</span><span class="pill ' + tone + '">' + escapeHtml(trust.level) + '</span></span></div>';
}

function renderKnowledgeReviewControls(graph) {
  const suggestions = graph.review?.suggestions ?? [];
  const high = suggestions.filter((suggestion) => suggestion.priority === "high").length;
  const medium = suggestions.filter((suggestion) => suggestion.priority === "medium").length;
  const low = suggestions.filter((suggestion) => suggestion.priority === "low").length;
  const actions = [...new Set(suggestions.map((suggestion) => suggestion.action))].sort();
  return '<div class="knowledge-review-toolbar"><div class="summary-strip"><span><strong>' + escapeHtml(graph.review?.issueCount ?? suggestions.length) + '</strong><small>Open issues</small></span><span><strong>' + escapeHtml(high) + '</strong><small>High</small></span><span><strong>' + escapeHtml(medium) + '</strong><small>Medium</small></span><span><strong>' + escapeHtml(low) + '</strong><small>Low</small></span></div><div class="control-grid"><select id="knowledge-review-priority" aria-label="Review priority filter">' + option("all", "All priorities", state.knowledgeReviewPriority === "all") + option("high", "High", state.knowledgeReviewPriority === "high") + option("medium", "Medium", state.knowledgeReviewPriority === "medium") + option("low", "Low", state.knowledgeReviewPriority === "low") + '</select><select id="knowledge-review-action" aria-label="Review action filter">' + option("all", "All actions", state.knowledgeReviewAction === "all") + actions.map((action) => option(action, formatKnowledgeReviewAction(action), state.knowledgeReviewAction === action)).join("") + '</select></div></div>';
}

function filterKnowledgeReviewSuggestions(suggestions) {
  return suggestions.map((suggestion, index) => ({ ...suggestion, index })).filter((suggestion) => {
    const priorityOk = !state.knowledgeReviewPriority || state.knowledgeReviewPriority === "all" || suggestion.priority === state.knowledgeReviewPriority;
    const actionOk = !state.knowledgeReviewAction || state.knowledgeReviewAction === "all" || suggestion.action === state.knowledgeReviewAction;
    return priorityOk && actionOk;
  });
}

function renderKnowledgePendingReviewSection(pending) {
  if (!pending.length || (state.knowledgeReviewAction !== "all" && state.knowledgeReviewAction !== "inspect_pending")) return "";
  return '<div class="tool-section"><div class="label">Pending graph writes</div>' + pending.map(renderPendingKnowledgeItem).join("") + '</div>';
}

function renderKnowledgeGraphSvg(entities, relations) {
  if (!entities.length && !relations.length) return '<div class="notice">No graph data yet.</div>';
  const byId = new Map(entities.map((entity) => [Number(entity.id), entity]));
  relations.forEach((relation) => {
    if (!byId.has(Number(relation.sourceEntityId))) byId.set(Number(relation.sourceEntityId), { id: relation.sourceEntityId, canonicalName: relation.sourceName, kind: relation.sourceKind, confidence: relation.confidence });
    if (!byId.has(Number(relation.targetEntityId))) byId.set(Number(relation.targetEntityId), { id: relation.targetEntityId, canonicalName: relation.targetName, kind: relation.targetKind, confidence: relation.confidence });
  });
  const nodes = [...byId.values()].slice(0, 24);
  const nodeIds = new Set(nodes.map((node) => Number(node.id)));
  const width = 760;
  const height = 420;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(160, 62 + nodes.length * 6);
  const positions = new Map(nodes.map((node, index) => {
    const angle = nodes.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    return [Number(node.id), { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }];
  }));
  const edgeHtml = relations.filter((relation) => nodeIds.has(Number(relation.sourceEntityId)) && nodeIds.has(Number(relation.targetEntityId))).slice(0, 36).map((relation) => {
    const source = positions.get(Number(relation.sourceEntityId));
    const target = positions.get(Number(relation.targetEntityId));
    if (!source || !target) return "";
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    return '<g class="knowledge-edge" tabindex="0" role="button" data-knowledge-select="relation" data-relation-id="' + escapeHtml(relation.id) + '"><line x1="' + source.x.toFixed(1) + '" y1="' + source.y.toFixed(1) + '" x2="' + target.x.toFixed(1) + '" y2="' + target.y.toFixed(1) + '"></line><text x="' + midX.toFixed(1) + '" y="' + midY.toFixed(1) + '">' + escapeHtml(relation.relationType) + '</text><title>Relation #' + escapeHtml(relation.id) + ' ' + escapeHtml(relation.sourceName) + ' -> ' + escapeHtml(relation.targetName) + '</title></g>';
  }).join("");
  const nodeHtml = nodes.map((node) => {
    const point = positions.get(Number(node.id));
    const tone = node.kind === "person" ? "person" : node.kind === "project" ? "project" : node.kind === "preference" ? "preference" : "topic";
    return '<g class="knowledge-node ' + tone + '" tabindex="0" role="button" data-knowledge-select="entity" data-entity-id="' + escapeHtml(node.id) + '"><circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="25"></circle><text x="' + point.x.toFixed(1) + '" y="' + (point.y + 4).toFixed(1) + '">#' + escapeHtml(node.id) + '</text><title>' + escapeHtml(node.canonicalName) + ' / ' + escapeHtml(node.kind) + '</title></g>';
  }).join("");
  return '<svg class="knowledge-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Bản đồ tri thức">' + edgeHtml + nodeHtml + '</svg>';
}

function renderKnowledgeCytoscapeGraph(entities, relations) {
  const container = document.querySelector("#knowledge-cytoscape");
  if (!container) return;
  stopKnowledgeAmbientMotion();
  const graphElements = buildKnowledgeCytoscapeElements(entities, relations);
  container.dataset.nodeCount = String(graphElements.nodeCount);
  container.dataset.edgeCount = String(graphElements.edgeCount);
  container.dataset.knowledgeGraphReady = "false";
  if (!graphElements.elements.length) {
    container.innerHTML = '<div class="notice">No graph data yet.</div>';
    container.dataset.knowledgeGraphReady = "true";
    return;
  }
  if (typeof window.cytoscape !== "function") {
    container.innerHTML = renderKnowledgeGraphSvg(entities, relations);
    container.dataset.knowledgeGraphReady = "fallback";
    bindKnowledgeGraphInteractiveControls();
    return;
  }
  container.innerHTML = "";
  const cy = window.cytoscape({
    container,
    elements: graphElements.elements,
    layout: knowledgeGraphLayoutOptions(28),
    minZoom: 0.42,
    maxZoom: 2.2,
    wheelSensitivity: 0.18,
    style: [
      { selector: "node", style: { "background-color": "#5ed4c4", "border-color": "rgba(238, 246, 237, 0.78)", "border-width": 2, color: "#eef6ed", "font-family": "Trebuchet MS, Verdana, sans-serif", "font-size": 11, "font-weight": 800, height: "data(size)", label: "data(label)", "min-zoomed-font-size": 8, "overlay-opacity": 0, "text-background-color": "rgba(8, 13, 11, 0.82)", "text-background-opacity": 1, "text-background-padding": 3, "text-margin-y": 8, "text-valign": "bottom", width: "data(size)" } },
      { selector: "node.person", style: { "background-color": "#e0b257" } },
      { selector: "node.project", style: { "background-color": "#64d487" } },
      { selector: "node.preference", style: { "background-color": "#f0b35d" } },
      { selector: "node.topic", style: { "background-color": "#8aa8ff" } },
      { selector: "node.cluster", style: { "border-color": "#eef6ed", "border-opacity": 0.84, "border-width": 4, "font-size": 12, "height": "data(size)", "shape": "round-rectangle", "text-margin-y": 10, "width": "data(size)" } },
      { selector: "edge", style: { "curve-style": "bezier", "font-family": "Trebuchet MS, Verdana, sans-serif", "font-size": 10, "font-weight": 800, label: "data(label)", "line-color": "rgba(238, 246, 237, 0.28)", opacity: "data(opacity)", "target-arrow-color": "rgba(238, 246, 237, 0.38)", "target-arrow-shape": "triangle", "text-background-color": "rgba(8, 13, 11, 0.88)", "text-background-opacity": 1, "text-background-padding": 2, "text-rotation": "autorotate", "text-wrap": "wrap", "width": "data(width)" } },
      { selector: ".filtered", style: { display: "none" } },
      { selector: ".dimmed", style: { opacity: 0.14 } },
      { selector: "node.highlighted", style: { "border-color": "#e0b257", "border-width": 4 } },
      { selector: "edge.highlighted", style: { "line-color": "#e0b257", "target-arrow-color": "#e0b257", opacity: 1, width: 2.2 } },
      { selector: ":selected", style: { "border-color": "#e0b257", "border-width": 4, "line-color": "#e0b257", "target-arrow-color": "#e0b257", opacity: 1 } },
    ],
  });
  cy.on("tap", "node", (event) => {
    const clusterId = event.target.data("clusterId");
    if (clusterId) {
      state.selectedKnowledge = { type: "cluster", id: clusterId };
      setKnowledgeDrawer("list");
      renderKnowledgeInspectorTargets(state.knowledgeGraph);
      return;
    }
    state.selectedKnowledge = { type: "entity", id: Number(event.target.data("entityId")) };
    setKnowledgeDrawer("inspector");
    renderKnowledgeInspectorTargets(state.knowledgeGraph);
  });
  cy.on("tap", "edge", (event) => {
    if (!event.target.data("relationId")) {
      setKnowledgeDrawer("list");
      return;
    }
    state.selectedKnowledge = { type: "relation", id: Number(event.target.data("relationId")) };
    setKnowledgeDrawer("inspector");
    renderKnowledgeInspectorTargets(state.knowledgeGraph);
  });
  cy.on("tap", (event) => {
    if (event.target === cy) {
      clearKnowledgeGraphFocus({ closeDrawer: true, save: true });
      applyKnowledgeGraphFilters();
    }
  });
  ["drag", "pan", "zoom", "grab", "free", "tapstart"].forEach((eventName) => cy.on(eventName, () => { state.knowledgeLastGraphInteraction = Date.now(); }));
  state.knowledgeCytoscape = cy;
  window.__bestieKnowledgeGraph = { cy, select: selectKnowledgeGraphById };
  applyKnowledgeGraphFilters();
  applyKnowledgeGraphSelectionHighlight();
  startKnowledgeAmbientMotion(cy);
  container.dataset.knowledgeGraphReady = "true";
}

function buildKnowledgeCytoscapeElements(entities, relations) {
  const byId = new Map((entities ?? []).map((entity) => [Number(entity.id), entity]));
  (relations ?? []).forEach((relation) => {
    if (!byId.has(Number(relation.sourceEntityId))) byId.set(Number(relation.sourceEntityId), { id: relation.sourceEntityId, canonicalName: relation.sourceName, kind: relation.sourceKind, confidence: relation.confidence });
    if (!byId.has(Number(relation.targetEntityId))) byId.set(Number(relation.targetEntityId), { id: relation.targetEntityId, canonicalName: relation.targetName, kind: relation.targetKind, confidence: relation.confidence });
  });
  const nodes = [...byId.values()].slice(0, 48);
  const nodeIds = new Set(nodes.map((node) => Number(node.id)));
  if ((state.knowledgeClusterBy ?? "none") !== "none") return buildKnowledgeClusterElements(nodes, relations ?? [], nodeIds);
  const relationCounts = new Map();
  (relations ?? []).forEach((relation) => {
    relationCounts.set(Number(relation.sourceEntityId), (relationCounts.get(Number(relation.sourceEntityId)) ?? 0) + 1);
    relationCounts.set(Number(relation.targetEntityId), (relationCounts.get(Number(relation.targetEntityId)) ?? 0) + 1);
  });
  const nodeElements = nodes.map((node) => {
    const confidence = Number(node.confidence ?? 0.7);
    const kind = ["person", "project", "preference", "topic"].includes(node.kind) ? node.kind : "topic";
    const relationCount = relationCounts.get(Number(node.id)) ?? Number(node.trust?.relationCount ?? 0);
    const trustBonus = node.trust?.level === "high" ? 4 : node.trust?.level === "low" ? -2 : 1;
    const size = Math.max(24, Math.min(58, 25 + Math.min(22, relationCount * 5) + Math.round(Math.max(0, Math.min(1, confidence)) * 7) + trustBonus));
    return { data: { id: "entity-" + node.id, entityId: Number(node.id), kind, scope: String(node.scope ?? "session"), trust: String(node.trust?.level ?? "medium"), relationCount, label: String(node.canonicalName ?? ("Entity " + node.id)), searchText: [node.canonicalName, node.kind, node.scope, ...(node.aliases ?? [])].join(" "), size }, classes: kind };
  });
  const edgeElements = (relations ?? []).filter((relation) => nodeIds.has(Number(relation.sourceEntityId)) && nodeIds.has(Number(relation.targetEntityId))).slice(0, 80).map((relation) => {
    const confidence = Math.max(0, Math.min(1, Number(relation.confidence ?? 0.55)));
    return { data: { id: "relation-" + relation.id, source: "entity-" + relation.sourceEntityId, target: "entity-" + relation.targetEntityId, relationId: Number(relation.id), kind: "relation", scope: String(relation.scope ?? "session"), trust: String(relation.trust?.level ?? "medium"), confidence, label: String(relation.relationType ?? "related"), searchText: [relation.sourceName, relation.relationType, relation.targetName, relation.scope, relation.evidence].join(" "), opacity: 0.32 + confidence * 0.52, width: 0.45 + confidence * 0.95 } };
  });
  return { elements: [...nodeElements, ...edgeElements], nodeCount: nodeElements.length, edgeCount: edgeElements.length };
}

function buildKnowledgeClusterElements(nodes, relations, nodeIds) {
  const clusterBy = state.knowledgeClusterBy ?? "none";
  const entityCluster = new Map();
  const groups = new Map();
  nodes.forEach((node) => {
    const key = String(clusterBy === "scope" ? node.scope ?? "session" : clusterBy === "trust" ? node.trust?.level ?? "medium" : node.kind ?? "topic");
    const id = "cluster-" + clusterBy + "-" + key.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    entityCluster.set(Number(node.id), id);
    const group = groups.get(id) ?? { id, key, count: 0, kinds: new Set(), scopes: new Set(), trusts: new Set(), confidence: 0 };
    group.count += 1;
    group.confidence += Number(node.confidence ?? 0.7);
    group.kinds.add(String(node.kind ?? "topic"));
    group.scopes.add(String(node.scope ?? "session"));
    group.trusts.add(String(node.trust?.level ?? "medium"));
    groups.set(id, group);
  });
  const nodeElements = [...groups.values()].map((group) => {
    const kind = clusterBy === "kind" && ["person", "project", "preference", "topic"].includes(group.key) ? group.key : "topic";
    const confidence = group.count ? group.confidence / group.count : 0.7;
    return { data: { id: group.id, clusterId: group.id, clusterBy, clusterValue: group.key, kind, scope: clusterBy === "scope" ? group.key : "cluster", trust: clusterBy === "trust" ? group.key : "medium", memberKinds: [...group.kinds], memberScopes: [...group.scopes], memberTrusts: [...group.trusts], label: group.key + " (" + group.count + ")", size: 42 + Math.min(34, group.count * 8 + Math.round(confidence * 8)) }, classes: kind + " cluster" };
  });
  const edges = new Map();
  relations.filter((relation) => nodeIds.has(Number(relation.sourceEntityId)) && nodeIds.has(Number(relation.targetEntityId))).forEach((relation) => {
    const source = entityCluster.get(Number(relation.sourceEntityId));
    const target = entityCluster.get(Number(relation.targetEntityId));
    if (!source || !target || source === target) return;
    const key = source < target ? source + "::" + target : target + "::" + source;
    const edge = edges.get(key) ?? { source, target, count: 0, confidence: 0, scopes: new Set(), trusts: new Set() };
    edge.count += 1;
    edge.confidence += Math.max(0, Math.min(1, Number(relation.confidence ?? 0.55)));
    edge.scopes.add(String(relation.scope ?? "session"));
    edge.trusts.add(String(relation.trust?.level ?? "medium"));
    edges.set(key, edge);
  });
  const edgeElements = [...edges.entries()].slice(0, 80).map(([id, edge]) => {
    const confidence = edge.count ? edge.confidence / edge.count : 0.55;
    return { data: { id: "cluster-edge-" + id.replace(/[^a-z0-9_-]/gi, "-"), source: edge.source, target: edge.target, kind: "relation", scope: edge.scopes.size === 1 ? [...edge.scopes][0] : "cluster", trust: edge.trusts.size === 1 ? [...edge.trusts][0] : "medium", confidence, label: edge.count + " relations", opacity: 0.26 + Math.min(0.56, confidence * 0.46), width: 0.75 + Math.min(1.8, edge.count * 0.35) } };
  });
  return { elements: [...nodeElements, ...edgeElements], nodeCount: nodeElements.length, edgeCount: edgeElements.length };
}

function renderKnowledgeEntity(entity) {
  const aliases = entity.aliases?.length ? ' / aliases ' + entity.aliases.join(", ") : "";
  return '<div class="knowledge-row" data-knowledge-select="entity" data-entity-id="' + escapeHtml(entity.id) + '"><div><strong>#' + escapeHtml(entity.id) + ' ' + escapeHtml(entity.canonicalName) + '</strong><div class="subvalue">' + escapeHtml(entity.kind + ' / scope ' + entity.scope + ' / confidence ' + entity.confidence + aliases) + '</div></div><span><span class="pill ' + (entity.sensitivity === "sensitive" ? "warn" : "good") + '">' + escapeHtml(entity.sensitivity) + '</span></span></div>';
}

function renderKnowledgeRelation(relation) {
  const meta = 'scope ' + text(relation.scope) + ' / confidence ' + text(relation.confidence) + (relation.evidence ? ' / ' + relation.evidence : '');
  const actions = [
    iconButton("sliders", "Update", 'class="message-menu-item" data-knowledge-action="update_relation" data-relation-id="' + escapeHtml(relation.id) + '" data-confidence="' + escapeHtml(relation.confidence) + '"'),
    iconButton("x", "Forget", 'class="message-menu-item" data-knowledge-action="forget_relation" data-relation-id="' + escapeHtml(relation.id) + '"'),
  ];
  return '<div class="knowledge-row" data-knowledge-select="relation" data-relation-id="' + escapeHtml(relation.id) + '"><div><strong>#' + escapeHtml(relation.id) + ' ' + escapeHtml(relation.sourceName) + ' --' + escapeHtml(relation.relationType) + '--> ' + escapeHtml(relation.targetName) + '</strong><div class="subvalue">' + escapeHtml(meta) + '</div></div><span><span class="pill ' + (relation.confidence >= 0.7 ? "good" : relation.confidence < 0.5 ? "warn" : "") + '">' + escapeHtml(relation.confidence) + '</span>' + actionDropdown(actions) + '</span></div>';
}

function renderKnowledgeSuggestion(suggestion, index, graph) {
  const tone = suggestion.priority === "high" ? "warn" : suggestion.priority === "low" ? "" : "good";
  return '<div class="knowledge-row" data-knowledge-select="suggestion" data-suggestion-index="' + escapeHtml(index ?? 0) + '"><div><strong>' + escapeHtml(suggestion.title) + '</strong><div>' + escapeHtml(suggestion.reason) + '</div><div class="subvalue">' + escapeHtml(suggestion.command) + '</div></div><span><span class="pill ' + tone + '">' + escapeHtml(suggestion.priority) + '</span>' + renderKnowledgeSuggestionActions(suggestion, graph) + '</span></div>';
}

function renderKnowledgeSuggestionActions(suggestion, graph) {
  const target = getKnowledgeSuggestionTarget(suggestion);
  const args = suggestion.toolCall?.arguments ?? {};
  if (suggestion.action === "merge_entity" && args.primaryId && args.duplicateId) {
    return iconButton("layers", "Merge", 'data-knowledge-action="merge_entity" data-primary-id="' + escapeHtml(args.primaryId) + '" data-duplicate-id="' + escapeHtml(args.duplicateId) + '" data-reason="' + escapeHtml(suggestion.reason) + '"');
  }
  if (suggestion.action === "inspect_pending" && target?.type === "pending") {
    return iconButton("check", "Review", 'data-knowledge-jump-type="pending" data-knowledge-jump-id="' + escapeHtml(target.id) + '"');
  }
  if (suggestion.action === "inspect_low_confidence" && target?.type === "relation") {
    const relation = (graph.relations ?? []).find((candidate) => Number(candidate.id) === Number(target.id));
    return iconButton("sliders", "Update", 'data-knowledge-action="update_relation" data-relation-id="' + escapeHtml(target.id) + '" data-confidence="' + escapeHtml(relation?.confidence ?? 0.5) + '"');
  }
  if (target) {
    return iconButton("activity", "Inspect", 'data-knowledge-jump-type="' + escapeHtml(target.type) + '" data-knowledge-jump-id="' + escapeHtml(target.id) + '"');
  }
  return "";
}

function getKnowledgeSuggestionTarget(suggestion) {
  const args = suggestion.toolCall?.arguments ?? {};
  if (args.primaryId) return { type: "entity", id: Number(args.primaryId) };
  if (args.id) return { type: suggestion.action === "inspect_pending" ? "pending" : "entity", id: Number(args.id) };
  const command = String([suggestion.command, suggestion.title].filter(Boolean).join(" "));
  const pendingTitle = command.match(/pending\\s+graph\\s+item\\s+#?(\\d+)/i);
  if (pendingTitle) return { type: "pending", id: Number(pendingTitle[1]) };
  const pending = command.match(/pending\\s+inspect\\s+(\\d+)/);
  if (pending) return { type: "pending", id: Number(pending[1]) };
  const relation = command.match(/inspect\\s+relation\\s+(\\d+)/);
  if (relation) return { type: "relation", id: Number(relation[1]) };
  const entity = command.match(/inspect\\s+entity\\s+(\\d+)/);
  if (entity) return { type: "entity", id: Number(entity[1]) };
  return undefined;
}

function formatKnowledgeReviewAction(action) {
  return String(action ?? "review").replace(/^inspect_/, "").replace(/_/g, " ");
}

function renderPendingKnowledgeItem(item) {
  const meta = [item.reason, item.source, item.explicitConsent ? "đã đồng ý rõ ràng" : "cần rà soát", item.createdAt].filter(Boolean).join(' / ');
  return '<div class="knowledge-row" data-knowledge-select="pending" data-pending-id="' + escapeHtml(item.id) + '"><div><strong>Pending #' + escapeHtml(item.id) + '</strong><div>' + escapeHtml(item.payloadSummary) + '</div><div class="subvalue">' + escapeHtml(meta) + '</div></div><span><span class="pill warn">pending</span>' + iconButton("sliders", "Sanitize", 'data-knowledge-action="sanitize_pending" data-pending-id="' + escapeHtml(item.id) + '"') + iconButton("check", "Approve", 'data-knowledge-action="approve_pending" data-pending-id="' + escapeHtml(item.id) + '"') + iconButton("x", "Reject", 'data-knowledge-action="reject_pending" data-pending-id="' + escapeHtml(item.id) + '"') + '</span></div>';
}

function renderKnowledgeSearchResults(graph) {
  const heading = row('Tìm kiếm results for "' + text(graph.query) + '"', (graph.relations?.length ?? 0) + ' relations / ' + (graph.entities?.length ?? 0) + ' entities', "");
  const relations = (graph.relations ?? []).map(renderKnowledgeRelation);
  const entities = (graph.entities ?? []).map(renderKnowledgeEntity);
  const pending = (graph.pending ?? []).map(renderPendingKnowledgeItem);
  return heading + ([...relations, ...entities, ...pending].join("") || row("Tìm kiếm", "no results", ""));
}

function bindKnowledgeGraphControls() {
  document.querySelectorAll("#knowledge-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#knowledge-panel", button.dataset.segmentTarget)));
  document.querySelector("#knowledge-review-priority")?.addEventListener("change", (event) => {
    state.knowledgeReviewPriority = event.target.value;
    renderKnowledgeGraphPanel(state.knowledgeGraph ?? {}, "review");
  });
  document.querySelector("#knowledge-review-action")?.addEventListener("change", (event) => {
    state.knowledgeReviewAction = event.target.value;
    renderKnowledgeGraphPanel(state.knowledgeGraph ?? {}, "review");
  });
  document.querySelector("#knowledge-trust-filter")?.addEventListener("change", (event) => {
    state.knowledgeTrustFilter = event.target.value;
    renderKnowledgeGraphPanel(state.knowledgeGraph ?? {}, "trust");
  });
  document.querySelector("#knowledge-trust-sort")?.addEventListener("change", (event) => {
    state.knowledgeTrustSort = event.target.value;
    renderKnowledgeGraphPanel(state.knowledgeGraph ?? {}, "trust");
  });
  document.querySelector("#knowledge-search-run")?.addEventListener("click", () => {
    const query = document.querySelector("#knowledge-search")?.value ?? "";
    fetch("/api/knowledge-graph/search?q=" + encodeURIComponent(query))
      .then((response) => response.json())
      .then((graph) => {
        setValue("#knowledge-panel .value", 'Tìm kiếm results for "' + query + '"');
        renderKnowledgeGraphPanel(graph, "search");
      })
      .catch(() => setValue("#knowledge-panel .value", "Unable to search graph."));
  });
  bindKnowledgeGraphInteractiveControls();
}

function setKnowledgeDrawer(drawer) {
  state.knowledgeDrawer = drawer === "list" || drawer === "inspector" ? drawer : "closed";
  const shell = document.querySelector("#knowledge-map .knowledge-map-shell");
  if (!shell) return;
  shell.dataset.knowledgeDrawer = state.knowledgeDrawer;
  const title = document.querySelector("#knowledge-drawer-title");
  if (title) title.textContent = state.knowledgeDrawer === "list" && state.selectedKnowledge?.type === "cluster" ? "Cluster detail" : state.knowledgeDrawer === "list" ? "Mục đồ thị" : "Inspector";
  const list = document.querySelector("#knowledge-drawer-list");
  if (list) list.innerHTML = renderKnowledgeDrawerList(state.knowledgeGraph ?? {});
  state.knowledgeCytoscape?.resize();
  bindKnowledgeGraphInteractiveControls();
  saveKnowledgeMapPreferences();
}

function expandKnowledgeCluster(clusterId) {
  const cluster = getKnowledgeClusterMembers(state.knowledgeGraph ?? {}, clusterId);
  if (!cluster) return;
  state.knowledgeClusterBy = "none";
  state.knowledgeRelationDensity = "all";
  state.knowledgeGraphSearch = cluster.entities.map((entity) => entity.canonicalName).slice(0, 3).join(" ");
  state.knowledgeGraphFilters = { kind: cluster.clusterBy === "kind" ? cluster.value : "all", scope: cluster.clusterBy === "scope" ? cluster.value : "all", trust: cluster.clusterBy === "trust" ? cluster.value : "all" };
  state.knowledgeConnectedOnly = false;
  state.knowledgeActiveView = "custom";
  state.selectedKnowledge = undefined;
  setKnowledgeDrawer("list");
  syncKnowledgeMapControls();
  renderKnowledgeCytoscapeGraph(state.knowledgeGraph?.entities ?? [], state.knowledgeGraph?.relations ?? []);
  applyKnowledgeGraphFilters();
  showToast("Cluster expanded on the map.", "good");
  saveKnowledgeMapPreferences();
}

function setKnowledgeOverlayCollapsed(collapsed) {
  state.knowledgeOverlayCollapsed = Boolean(collapsed);
  const shell = document.querySelector("#knowledge-map .knowledge-map-shell");
  if (!shell) return;
  shell.dataset.knowledgeOverlay = state.knowledgeOverlayCollapsed ? "collapsed" : "expanded";
  const toggle = document.querySelector("[data-knowledge-overlay-toggle]");
  if (toggle) {
    toggle.title = state.knowledgeOverlayCollapsed ? "Show map tools" : "Ẩn map tools";
    const label = toggle.querySelector("span");
    if (label) label.textContent = state.knowledgeOverlayCollapsed ? "Công cụ" : "Ẩn";
  }
  state.knowledgeCytoscape?.resize();
  saveKnowledgeMapPreferences();
}

function syncKnowledgeMapControls() {
  const filters = state.knowledgeGraphFilters ?? { kind: "all", scope: "all", trust: "all" };
  const viewSelect = document.querySelector("#knowledge-map-view");
  if (viewSelect && state.knowledgeActiveView === "custom" && !Array.from(viewSelect.options).some((item) => item.value === "custom")) {
    viewSelect.appendChild(new Option("Custom", "custom", false, true));
  }
  const values = { "#knowledge-kind-filter": filters.kind, "#knowledge-scope-filter": filters.scope, "#knowledge-map-trust-filter": filters.trust, "#knowledge-map-search": state.knowledgeGraphSearch ?? "", "#knowledge-map-view": state.knowledgeActiveView ?? "all", "#knowledge-cluster-by": state.knowledgeClusterBy ?? "none", "#knowledge-relation-density": state.knowledgeRelationDensity ?? "all", "#knowledge-motion": state.knowledgeMotion ?? "subtle" };
  Object.entries(values).forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element && element.value !== undefined) element.value = value;
  });
  const connectedOnly = document.querySelector("#knowledge-connected-only");
  if (connectedOnly) connectedOnly.checked = Boolean(state.knowledgeConnectedOnly);
  updateKnowledgeMapSearchResults();
}

function applyKnowledgeMapView(view) {
  const selectedView = view || "all";
  const saved = selectedView === "saved" ? state.knowledgeSavedView : undefined;
  state.knowledgeActiveView = selectedView;
  state.knowledgeConnectedOnly = false;
  if (selectedView === "all") {
    clearKnowledgeGraphFocus({ closeDrawer: true, save: false });
    state.knowledgeGraphFilters = { kind: "all", scope: "all", trust: "all" };
    state.knowledgeGraphSearch = "";
    state.knowledgeClusterBy = "none";
    state.knowledgeRelationDensity = "all";
    setKnowledgeDrawer("closed");
  } else if (selectedView === "review") {
    state.knowledgeGraphFilters = { kind: "all", scope: "all", trust: "low" };
    state.knowledgeGraphSearch = "";
    state.knowledgeClusterBy = "trust";
    state.knowledgeRelationDensity = "balanced";
    setKnowledgeDrawer("list");
    setKnowledgeOverlayCollapsed(false);
  } else if (selectedView === "high-trust") {
    state.knowledgeGraphFilters = { kind: "all", scope: "all", trust: "high" };
    state.knowledgeGraphSearch = "";
    state.knowledgeClusterBy = "kind";
    state.knowledgeRelationDensity = "strong";
    setKnowledgeDrawer("closed");
  } else if (selectedView === "focused") {
    if (state.selectedKnowledge?.type === "entity" || state.selectedKnowledge?.type === "relation") {
      state.knowledgeConnectedOnly = true;
      state.knowledgeClusterBy = "none";
      setKnowledgeDrawer("inspector");
      focusKnowledgeGraphViewport(state.selectedKnowledge.type, state.selectedKnowledge.id);
    } else {
      showToast("Select a node or relation before using Tập trung view.", "warn");
      state.knowledgeActiveView = "all";
    }
  } else if (saved) {
    state.knowledgeGraphFilters = saved.filters ?? { kind: "all", scope: "all", trust: "all" };
    state.knowledgeGraphSearch = saved.search ?? "";
    state.knowledgeConnectedOnly = Boolean(saved.connectedOnly);
    state.knowledgeClusterBy = saved.clusterBy ?? "none";
    state.knowledgeRelationDensity = saved.relationDensity ?? "all";
    state.selectedKnowledge = saved.selected ?? state.selectedKnowledge;
    setKnowledgeOverlayCollapsed(Boolean(saved.overlayCollapsed));
    setKnowledgeDrawer(saved.drawer ?? "closed");
  }
  syncKnowledgeMapControls();
  renderKnowledgeCytoscapeGraph(state.knowledgeGraph?.entities ?? [], state.knowledgeGraph?.relations ?? []);
  applyKnowledgeGraphFilters();
  saveKnowledgeMapPreferences();
}

function saveCurrentKnowledgeMapView() {
  state.knowledgeSavedView = captureKnowledgeMapView();
  state.knowledgeActiveView = "saved";
  saveKnowledgeMapPreferences();
  renderKnowledgeGraphPanel(state.knowledgeGraph ?? {}, "map");
  showToast("Knowledge graph view saved.", "good");
}

function runKnowledgeGraphMapAction(action) {
  const cy = state.knowledgeCytoscape;
  if (!cy) return;
  if (action === "fit") {
    fitKnowledgeGraph(cy.elements().not(".filtered"), 32);
  } else if (action === "reset") {
    cy.layout(knowledgeGraphLayoutOptions(32)).run();
  } else if (action === "zoom-in" || action === "zoom-out") {
    const nextZoom = cy.zoom() * (action === "zoom-in" ? 1.18 : 0.84);
    const zoom = { level: Math.max(0.42, Math.min(2.2, nextZoom)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } };
    if (knowledgeMotionEnabled()) cy.animate({ zoom }, { duration: 160 });
    else cy.zoom(zoom);
  } else if (action === "clear-filters") {
    clearKnowledgeGraphFocus({ closeDrawer: true, save: false });
    state.knowledgeGraphFilters = { kind: "all", scope: "all", trust: "all" };
    state.knowledgeConnectedOnly = false;
    state.knowledgeGraphSearch = "";
    state.knowledgeActiveView = "all";
    state.knowledgeClusterBy = "none";
    state.knowledgeRelationDensity = "all";
    ["#knowledge-kind-filter", "#knowledge-scope-filter", "#knowledge-map-trust-filter"].forEach((selector) => {
      const select = document.querySelector(selector);
      if (select) select.value = "all";
    });
    const connectedOnly = document.querySelector("#knowledge-connected-only");
    if (connectedOnly) connectedOnly.checked = false;
    const search = document.querySelector("#knowledge-map-search");
    if (search) search.value = "";
    syncKnowledgeMapControls();
    setKnowledgeDrawer("closed");
    applyKnowledgeGraphFilters();
    saveKnowledgeMapPreferences();
  } else if (action === "unfocus") {
    clearKnowledgeGraphFocus({ closeDrawer: true, save: true });
    applyKnowledgeGraphFilters();
  } else if (action === "focus-search") {
    focusKnowledgeGraphSearchResult(document.querySelector("#knowledge-map-search-result")?.value ?? "");
  }
}

function clearKnowledgeGraphFocus(options = {}) {
  state.selectedKnowledge = undefined;
  state.knowledgeConnectedOnly = false;
  if (options.closeDrawer) state.knowledgeDrawer = "closed";
  if (state.knowledgeActiveView === "focused") state.knowledgeActiveView = "custom";
  const connectedOnly = document.querySelector("#knowledge-connected-only");
  if (connectedOnly) connectedOnly.checked = false;
  state.knowledgeCytoscape?.elements().removeClass("highlighted dimmed").unselect();
  renderKnowledgeInspectorTargets(state.knowledgeGraph ?? {});
  syncKnowledgeMapControls();
  if (options.closeDrawer) setKnowledgeDrawer("closed");
  if (options.save) saveKnowledgeMapPreferences();
}

function focusKnowledgeGraphSearchResult(value) {
  if (!value) return;
  const [type, idText] = String(value).split(":");
  const id = Number(idText);
  if ((type !== "entity" && type !== "relation") || !Number.isFinite(id)) return;
  state.knowledgeConnectedOnly = true;
  state.knowledgeActiveView = "focused";
  const connectedOnly = document.querySelector("#knowledge-connected-only");
  if (connectedOnly) connectedOnly.checked = true;
  selectKnowledgeGraphById(type, id);
  applyKnowledgeGraphFilters();
  focusKnowledgeGraphViewport(type, id);
  saveKnowledgeMapPreferences();
}

function focusKnowledgeGraphViewport(type, id) {
  const cy = state.knowledgeCytoscape;
  if (!cy) return;
  const item = cy.$id((type === "entity" ? "entity-" : "relation-") + id);
  if (!item.length) return;
  const neighborhood = type === "entity" ? item.closedNeighborhood().not(".filtered") : item.union(item.connectedNodes()).not(".filtered");
  fitKnowledgeGraph(neighborhood.length ? neighborhood : item, 72);
}

function knowledgeMotionEnabled() {
  return state.knowledgeMotion !== "off" && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function startKnowledgeAmbientMotion(cy) {
  stopKnowledgeAmbientMotion();
  if (!cy || !knowledgeMotionEnabled()) return;
  const token = (state.knowledgeAmbientMotionToken ?? 0) + 1;
  state.knowledgeAmbientMotionToken = token;
  cy.nodes().forEach((node) => node.scratch("knowledgeAmbientBase", { ...node.position() }));
  let index = 0;
  const tick = () => {
    if (state.knowledgeAmbientMotionToken !== token || state.knowledgeCytoscape !== cy || !knowledgeMotionEnabled()) return;
    if (Date.now() - Number(state.knowledgeLastGraphInteraction ?? 0) < 1800) {
      state.knowledgeAmbientMotionTimer = window.setTimeout(tick, 1600);
      return;
    }
    const phase = index % 4;
    index += 1;
    cy.nodes().not(".filtered").slice(0, 48).forEach((node, nodeIndex) => {
      const base = node.scratch("knowledgeAmbientBase") ?? node.position();
      const angle = ((nodeIndex % 11) / 11) * Math.PI * 2 + phase * 0.72;
      const radius = 2.8 + (nodeIndex % 4) * 0.9;
      node.stop(true, false);
      node.animate({ position: { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius } }, { duration: 1800, easing: "ease-in-out-cubic" });
    });
    state.knowledgeAmbientMotionTimer = window.setTimeout(tick, 2800);
  };
  state.knowledgeAmbientMotionTimer = window.setTimeout(tick, 900);
}

function stopKnowledgeAmbientMotion() {
  state.knowledgeAmbientMotionToken = (state.knowledgeAmbientMotionToken ?? 0) + 1;
  if (state.knowledgeAmbientMotionTimer) window.clearTimeout(state.knowledgeAmbientMotionTimer);
  state.knowledgeAmbientMotionTimer = undefined;
  state.knowledgeCytoscape?.nodes?.().stop(true, false);
}

function knowledgeGraphLayoutOptions(padding) {
  return { name: "cose", animate: false, fit: true, padding, nodeRepulsion: 5200, idealEdgeLength: 128, edgeElasticity: 86, gravity: 0.28, numIter: 900 };
}

function fitKnowledgeGraph(elements, padding) {
  const cy = state.knowledgeCytoscape;
  if (!cy) return;
  if (knowledgeMotionEnabled()) cy.animate({ fit: { eles: elements, padding } }, { duration: 220 });
  else cy.fit(elements, padding);
}

function applyKnowledgeGraphFilters() {
  const cy = state.knowledgeCytoscape;
  if (!cy) return;
  const filters = state.knowledgeGraphFilters ?? { kind: "all", scope: "all", trust: "all" };
  const densityThreshold = knowledgeRelationDensityThreshold();
  cy.nodes().forEach((node) => {
    const hidden = !knowledgeNodeMatchesFilter(node, filters);
    node.toggleClass("filtered", hidden);
  });
  cy.edges().forEach((edge) => {
    const hidden = edge.source().hasClass("filtered") || edge.target().hasClass("filtered") || Number(edge.data("confidence") ?? 0.55) < densityThreshold || (filters.scope !== "all" && edge.data("scope") !== filters.scope) || (filters.trust !== "all" && edge.data("trust") !== filters.trust);
    edge.toggleClass("filtered", hidden);
  });
  applyKnowledgeConnectedOnlyFilter();
  const visibleNodes = cy.nodes().not(".filtered").length;
  const visibleEdges = cy.edges().not(".filtered").length;
  const count = document.querySelector("#knowledge-visible-count");
  if (count) count.textContent = visibleNodes + " nodes / " + visibleEdges + " edges" + ((state.knowledgeClusterBy ?? "none") === "none" ? "" : " / " + state.knowledgeClusterBy + " clusters");
  applyKnowledgeGraphSelectionHighlight();
  cy.fit(cy.elements().not(".filtered"), 32);
}

function knowledgeRelationDensityThreshold() {
  if (state.knowledgeRelationDensity === "strong") return 0.7;
  if (state.knowledgeRelationDensity === "balanced") return 0.5;
  return 0;
}

function knowledgeNodeMatchesFilter(node, filters) {
  const hasMember = (key, value) => Array.isArray(node.data(key)) && node.data(key).includes(value);
  if (filters.kind !== "all" && node.data("kind") !== filters.kind && !hasMember("memberKinds", filters.kind)) return false;
  if (filters.scope !== "all" && node.data("scope") !== filters.scope && !hasMember("memberScopes", filters.scope)) return false;
  if (filters.trust !== "all" && node.data("trust") !== filters.trust && !hasMember("memberTrusts", filters.trust)) return false;
  return true;
}

function applyKnowledgeConnectedOnlyFilter() {
  const cy = state.knowledgeCytoscape;
  const selected = state.selectedKnowledge;
  if (!cy || !state.knowledgeConnectedOnly || !selected || (selected.type !== "entity" && selected.type !== "relation")) return;
  const item = cy.$id((selected.type === "entity" ? "entity-" : "relation-") + selected.id);
  if (!item.length) return;
  const neighborhood = selected.type === "entity" ? item.closedNeighborhood() : item.union(item.connectedNodes());
  cy.elements().not(neighborhood).addClass("filtered");
}

function applyKnowledgeGraphSelectionHighlight() {
  const cy = state.knowledgeCytoscape;
  if (!cy) return;
  cy.elements().removeClass("highlighted dimmed").unselect();
  const selected = state.selectedKnowledge;
  if (!selected) return;
  if (selected.type === "cluster") {
    const cluster = cy.$id(String(selected.id));
    if (!cluster.length || cluster.hasClass("filtered")) return;
    cy.elements().not(cluster.closedNeighborhood()).not(".filtered").addClass("dimmed");
    cluster.closedNeighborhood().not(".filtered").addClass("highlighted");
    cluster.select();
    return;
  }
  if (selected.type !== "entity" && selected.type !== "relation") return;
  const item = cy.$id((selected.type === "entity" ? "entity-" : "relation-") + selected.id);
  if (!item.length || item.hasClass("filtered")) return;
  const neighborhood = selected.type === "entity" ? item.closedNeighborhood().not(".filtered") : item.union(item.connectedNodes()).not(".filtered");
  cy.elements().not(neighborhood).not(".filtered").addClass("dimmed");
  neighborhood.addClass("highlighted");
  item.select();
}

function bindKnowledgeGraphInteractiveControls() {
  document.querySelectorAll("[data-knowledge-view-apply]").forEach((button) => {
    if (button.dataset.knowledgeViewBound === "true") return;
    button.dataset.knowledgeViewBound = "true";
    button.addEventListener("click", () => applyKnowledgeMapView(document.querySelector("#knowledge-map-view")?.value ?? "all"));
  });
  document.querySelectorAll("[data-knowledge-view-save]").forEach((button) => {
    if (button.dataset.knowledgeViewBound === "true") return;
    button.dataset.knowledgeViewBound = "true";
    button.addEventListener("click", () => saveCurrentKnowledgeMapView());
  });
  document.querySelectorAll("#knowledge-map-view").forEach((select) => {
    if (select.dataset.knowledgeViewBound === "true") return;
    select.dataset.knowledgeViewBound = "true";
    select.addEventListener("change", (event) => applyKnowledgeMapView(event.target.value));
  });
  document.querySelectorAll("#knowledge-cluster-by").forEach((select) => {
    if (select.dataset.knowledgeClusterBound === "true") return;
    select.dataset.knowledgeClusterBound = "true";
    select.addEventListener("change", (event) => {
      state.knowledgeClusterBy = event.target.value;
      state.knowledgeActiveView = "custom";
      syncKnowledgeMapControls();
      renderKnowledgeCytoscapeGraph(state.knowledgeGraph?.entities ?? [], state.knowledgeGraph?.relations ?? []);
      saveKnowledgeMapPreferences();
    });
  });
  document.querySelectorAll("#knowledge-relation-density").forEach((select) => {
    if (select.dataset.knowledgeDensityBound === "true") return;
    select.dataset.knowledgeDensityBound = "true";
    select.addEventListener("change", (event) => {
      state.knowledgeRelationDensity = event.target.value;
      state.knowledgeActiveView = "custom";
      syncKnowledgeMapControls();
      applyKnowledgeGraphFilters();
      saveKnowledgeMapPreferences();
    });
  });
  document.querySelectorAll("#knowledge-motion").forEach((select) => {
    if (select.dataset.knowledgeMotionBound === "true") return;
    select.dataset.knowledgeMotionBound = "true";
    select.addEventListener("change", (event) => {
      state.knowledgeMotion = event.target.value;
      state.knowledgeActiveView = "custom";
      syncKnowledgeMapControls();
      state.knowledgeCytoscape?.layout(knowledgeGraphLayoutOptions(32)).run();
      if (knowledgeMotionEnabled()) startKnowledgeAmbientMotion(state.knowledgeCytoscape);
      else stopKnowledgeAmbientMotion();
      saveKnowledgeMapPreferences();
    });
  });
  document.querySelectorAll("[data-knowledge-cluster-expand]").forEach((button) => {
    if (button.dataset.knowledgeClusterExpandBound === "true") return;
    button.dataset.knowledgeClusterExpandBound = "true";
    button.addEventListener("click", () => expandKnowledgeCluster(button.dataset.knowledgeClusterExpand));
  });
  document.querySelectorAll("[data-knowledge-overlay-toggle]").forEach((button) => {
    if (button.dataset.knowledgeOverlayBound === "true") return;
    button.dataset.knowledgeOverlayBound = "true";
    button.addEventListener("click", () => setKnowledgeOverlayCollapsed(!state.knowledgeOverlayCollapsed));
  });
  document.querySelectorAll("[data-knowledge-graph-action]").forEach((button) => {
    if (button.dataset.knowledgeGraphActionBound === "true") return;
    button.dataset.knowledgeGraphActionBound = "true";
    button.addEventListener("click", () => runKnowledgeGraphMapAction(button.dataset.knowledgeGraphAction));
  });
  ["#knowledge-kind-filter", "#knowledge-scope-filter", "#knowledge-map-trust-filter"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", () => {
      state.knowledgeGraphFilters = {
        kind: document.querySelector("#knowledge-kind-filter")?.value ?? "all",
        scope: document.querySelector("#knowledge-scope-filter")?.value ?? "all",
        trust: document.querySelector("#knowledge-map-trust-filter")?.value ?? "all",
      };
      state.knowledgeActiveView = "custom";
      applyKnowledgeGraphFilters();
      syncKnowledgeMapControls();
      saveKnowledgeMapPreferences();
    });
  });
  document.querySelector("#knowledge-map-search")?.addEventListener("input", (event) => {
    state.knowledgeGraphSearch = event.target.value;
    state.knowledgeActiveView = "custom";
    updateKnowledgeMapSearchResults();
    syncKnowledgeMapControls();
    saveKnowledgeMapPreferences();
  });
  document.querySelector("#knowledge-map-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusKnowledgeGraphSearchResult(document.querySelector("#knowledge-map-search-result")?.value ?? "");
    }
  });
  document.querySelector("#knowledge-map-search-result")?.addEventListener("change", (event) => focusKnowledgeGraphSearchResult(event.target.value));
  document.querySelector("#knowledge-connected-only")?.addEventListener("change", (event) => {
    state.knowledgeConnectedOnly = Boolean(event.target.checked);
    state.knowledgeActiveView = "custom";
    if (!state.knowledgeConnectedOnly) clearKnowledgeGraphFocus({ closeDrawer: true, save: false });
    applyKnowledgeGraphFilters();
    if (state.knowledgeConnectedOnly && (state.selectedKnowledge?.type === "entity" || state.selectedKnowledge?.type === "relation")) focusKnowledgeGraphViewport(state.selectedKnowledge.type, state.selectedKnowledge.id);
    syncKnowledgeMapControls();
    saveKnowledgeMapPreferences();
  });
  document.querySelectorAll("[data-knowledge-drawer-open]").forEach((button) => {
    if (button.dataset.knowledgeDrawerBound === "true") return;
    button.dataset.knowledgeDrawerBound = "true";
    button.addEventListener("click", () => setKnowledgeDrawer(button.dataset.knowledgeDrawerOpen));
  });
  document.querySelectorAll("[data-knowledge-drawer-close]").forEach((button) => {
    if (button.dataset.knowledgeDrawerBound === "true") return;
    button.dataset.knowledgeDrawerBound = "true";
    button.addEventListener("click", () => setKnowledgeDrawer("closed"));
  });
  document.querySelectorAll("[data-knowledge-jump-type]").forEach((button) => {
    if (button.dataset.knowledgeJumpBound === "true") return;
    button.dataset.knowledgeJumpBound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedKnowledge = { type: button.dataset.knowledgeJumpType, id: Number(button.dataset.knowledgeJumpId) };
      setKnowledgeDrawer("inspector");
      renderKnowledgeInspectorTargets(state.knowledgeGraph);
    });
  });
  document.querySelectorAll("[data-knowledge-source-session]").forEach((button) => {
    if (button.dataset.knowledgeSourceBound === "true") return;
    button.dataset.knowledgeSourceBound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      jumpToKnowledgeSource({
        chatSessionId: Number(button.dataset.knowledgeSourceSession),
        chatMessageId: Number(button.dataset.knowledgeSourceMessage || 0) || undefined,
        chatRunId: Number(button.dataset.knowledgeSourceRun || 0) || undefined,
      });
    });
  });
  document.querySelectorAll("[data-knowledge-action]").forEach((button) => {
    if (button.dataset.knowledgeActionBound === "true") return;
    button.dataset.knowledgeActionBound = "true";
    button.addEventListener("click", (event) => { event.stopPropagation(); runKnowledgeGraphAction(button); });
  });
  document.querySelectorAll("[data-knowledge-select]").forEach((element) => {
    if (element.dataset.knowledgeSelectBound === "true") return;
    element.dataset.knowledgeSelectBound = "true";
    element.addEventListener("click", () => selectKnowledgeGraphItem(element));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectKnowledgeGraphItem(element);
      }
    });
  });
}

function updateKnowledgeMapSearchResults() {
  const graph = state.knowledgeGraph ?? {};
  const select = document.querySelector("#knowledge-map-search-result");
  if (!select) return;
  select.innerHTML = renderKnowledgeMapSearchOptions(graph.entities ?? [], graph.relations ?? [], state.knowledgeGraphSearch ?? "");
}

function selectKnowledgeGraphItem(element) {
  const type = element.dataset.knowledgeSelect;
  const id = type === "entity" ? Number(element.dataset.entityId) : type === "relation" ? Number(element.dataset.relationId) : type === "pending" ? Number(element.dataset.pendingId) : Number(element.dataset.suggestionIndex);
  selectKnowledgeGraphById(type, id);
}

function selectKnowledgeGraphById(type, id) {
  state.selectedKnowledge = { type, id };
  setKnowledgeDrawer("inspector");
  renderKnowledgeInspectorTargets(state.knowledgeGraph);
}

function renderKnowledgeInspectorTargets(graph) {
  const html = renderKnowledgeInspector(graph ?? state.knowledgeGraph ?? {});
  ["#knowledge-inspector", "#knowledge-review-inspector", "#knowledge-trust-inspector", "#knowledge-search-inspector"].forEach((selector) => {
    const target = document.querySelector(selector);
    if (target) target.innerHTML = html;
  });
  const provenance = document.querySelector("#knowledge-provenance-overlay");
  if (provenance) {
    const provenanceHtml = renderKnowledgeProvenanceOverlay(graph ?? state.knowledgeGraph ?? {});
    provenance.innerHTML = provenanceHtml;
    provenance.classList.toggle("is-empty", !provenanceHtml);
  }
  document.querySelectorAll("[data-knowledge-select]").forEach((element) => {
    const type = element.dataset.knowledgeSelect;
    const id = type === "entity" ? Number(element.dataset.entityId) : type === "relation" ? Number(element.dataset.relationId) : type === "pending" ? Number(element.dataset.pendingId) : Number(element.dataset.suggestionIndex);
    element.classList.toggle("selected", state.selectedKnowledge?.type === type && Number(state.selectedKnowledge?.id) === id);
  });
  applyKnowledgeGraphSelectionHighlight();
  bindKnowledgeGraphInteractiveControls();
}

function getSelectedKnowledgeItem(graph) {
  const selected = state.selectedKnowledge;
  if (!selected) return undefined;
  if (selected.type === "entity") {
    const entity = (graph.entities ?? []).find((candidate) => Number(candidate.id) === Number(selected.id));
    if (!entity) return undefined;
    const relations = (graph.relations ?? []).filter((relation) => Number(relation.sourceEntityId) === Number(entity.id) || Number(relation.targetEntityId) === Number(entity.id));
    return { type: "entity", item: entity, relations };
  }
  if (selected.type === "relation") {
    const relation = (graph.relations ?? []).find((candidate) => Number(candidate.id) === Number(selected.id));
    return relation ? { type: "relation", item: relation } : undefined;
  }
  if (selected.type === "cluster") {
    const cluster = getKnowledgeClusterMembers(graph, String(selected.id));
    return cluster ? { type: "cluster", item: cluster } : undefined;
  }
  return undefined;
}

function renderKnowledgeProvenanceOverlay(graph) {
  const selected = getSelectedKnowledgeItem(graph ?? state.knowledgeGraph ?? {});
  if (!selected) return "";
  if (selected.type === "entity") {
    const entity = selected.item;
    const relations = selected.relations ?? [];
    const trust = entity.trust;
    return '<div class="knowledge-provenance-head"><div><div class="label">Provenance</div><div class="value">Entity #' + escapeHtml(entity.id) + ' ' + escapeHtml(entity.canonicalName) + '</div></div>' + renderKnowledgeProvenanceTrust(trust) + '</div>'
      + '<div class="knowledge-provenance-grid">'
      + row("Source", renderKnowledgeSource(entity), trust?.needsSource ? "warn" : "good")
      + row("Why", makeEntityWhy(entity, relations), "")
      + row("Updated", entity.updatedAt ?? entity.createdAt ?? "unknown", trust?.stale ? "warn" : "")
      + row("Relations", relations.length ? relations.length + ' connected' : 'none', relations.length ? "good" : "warn")
      + '</div>'
      + renderKnowledgeAuditTimeline(entity, [
        { label: "Created", value: entity.createdAt },
        { label: "Updated", value: entity.updatedAt },
        { label: "Source", value: renderKnowledgeSource(entity) },
      ])
      + renderKnowledgeProvenanceActions(renderKnowledgeSourceJump(entity));
  }
  if (selected.type === "relation") {
    const relation = selected.item;
    const trust = relation.trust;
    return '<div class="knowledge-provenance-head"><div><div class="label">Provenance</div><div class="value">Relation #' + escapeHtml(relation.id) + ' ' + escapeHtml(relation.relationType) + '</div></div>' + renderKnowledgeProvenanceTrust(trust) + '</div>'
      + '<div class="knowledge-provenance-grid">'
      + row("Source", '#' + relation.sourceEntityId + ' ' + relation.sourceName, "")
      + row("Target", '#' + relation.targetEntityId + ' ' + relation.targetName, "")
      + row("Evidence", relation.evidence || makeRelationWhy(relation), relation.confidence < 0.5 ? "warn" : "")
      + row("Origin", renderKnowledgeSource(relation), trust?.needsSource ? "warn" : "good")
      + '</div>'
      + renderKnowledgeAuditTimeline(relation, [
        { label: "Created", value: relation.createdAt },
        { label: "Updated", value: relation.updatedAt },
        { label: "Source", value: renderKnowledgeSource(relation) },
      ])
      + renderKnowledgeProvenanceActions(renderKnowledgeSourceJump(relation));
  }
  const cluster = selected.item;
  return '<div class="knowledge-provenance-head"><div><div class="label">Provenance</div><div class="value">Cluster ' + escapeHtml(cluster.label) + '</div></div><span class="pill">' + escapeHtml(cluster.clusterBy) + '</span></div>'
    + '<div class="knowledge-provenance-grid">'
    + row("Cluster by", cluster.clusterBy + ' / ' + cluster.value, "")
    + row("Entities", cluster.entities.length, cluster.entities.length ? "good" : "warn")
    + row("Relations", cluster.relations.length, "")
    + row("Timeline", "Grouped from current filtered graph view", "")
    + '</div>'
    + renderKnowledgeProvenanceActions('<button data-knowledge-cluster-expand="' + escapeHtml(cluster.id) + '" type="button">' + icon("layers") + '<span>Mở cụm</span></button>');
}

function renderKnowledgeProvenanceTrust(trust) {
  if (!trust) return '<span class="pill">Trust n/a</span>';
  const tone = trust.level === "high" ? "good" : trust.level === "low" ? "warn" : "";
  return '<span class="pill ' + tone + '">Trust ' + escapeHtml(trust.score) + ' / ' + escapeHtml(trust.level) + '</span>';
}

function renderKnowledgeProvenanceActions(actions) {
  return actions ? '<div class="actions inline-actions knowledge-provenance-actions">' + actions + '</div>' : "";
}

function renderKnowledgeInspector(graph) {
  const selected = state.selectedKnowledge;
  if (!selected) {
    return '<div class="label">Chi tiết</div><div class="value">Select a graph item</div><p class="subvalue">Click a node, relation, review item, or pending graph write to inspect details.</p>';
  }
  if (selected.type === "entity") {
    const entity = (graph.entities ?? []).find((candidate) => Number(candidate.id) === Number(selected.id));
    if (!entity) return renderKnowledgeInspectorMissing();
    const relations = (graph.relations ?? []).filter((relation) => Number(relation.sourceEntityId) === Number(entity.id) || Number(relation.targetEntityId) === Number(entity.id));
    return '<div class="label">Entity</div><div class="value">#' + escapeHtml(entity.id) + ' ' + escapeHtml(entity.canonicalName) + '</div>'
      + row("Kind", entity.kind, "")
      + row("Scope", entity.scope, "")
      + row("Confidence", entity.confidence, entity.confidence >= 0.7 ? "good" : entity.confidence < 0.5 ? "warn" : "")
      + row("Sensitivity", entity.sensitivity, entity.sensitivity === "sensitive" ? "warn" : "good")
      + '<div class="subvalue">Aliases: ' + escapeHtml(entity.aliases?.length ? entity.aliases.join(", ") : "none") + '</div>'
      + '<div class="subvalue">Why this exists: ' + escapeHtml(makeEntityWhy(entity, relations)) + '</div>'
      + renderKnowledgeTrustDetails(entity.trust)
      + renderKnowledgeAuditTimeline(entity, [
        { label: "Created", value: entity.createdAt },
        { label: "Updated", value: entity.updatedAt },
        { label: "Source", value: renderKnowledgeSource(entity) },
        { label: "Review", value: relations.length ? relations.length + ' connected relations' : 'No active one-hop relations', tone: relations.length ? "good" : "warn" },
      ])
      + '<div class="actions inline-actions">' + renderKnowledgeSourceJump(entity) + iconButton("x", "Forget", 'data-knowledge-action="forget_entity" data-entity-id="' + escapeHtml(entity.id) + '"') + '</div>'
      + '<div class="tool-section"><div class="label">Connected relations</div>' + (relations.slice(0, 6).map(renderKnowledgeRelation).join("") || row("Relations", "none", "")) + '</div>';
  }
  if (selected.type === "relation") {
    const relation = (graph.relations ?? []).find((candidate) => Number(candidate.id) === Number(selected.id));
    if (!relation) return renderKnowledgeInspectorMissing();
    return '<div class="label">Relation</div><div class="value">#' + escapeHtml(relation.id) + ' ' + escapeHtml(relation.relationType) + '</div>'
      + row("Source", '#' + relation.sourceEntityId + ' ' + relation.sourceName, "")
      + row("Target", '#' + relation.targetEntityId + ' ' + relation.targetName, "")
      + row("Scope", relation.scope, "")
      + row("Confidence", relation.confidence, relation.confidence >= 0.7 ? "good" : relation.confidence < 0.5 ? "warn" : "")
      + row("Sensitivity", relation.sensitivity, relation.sensitivity === "sensitive" ? "warn" : "good")
      + '<div class="subvalue">Evidence: ' + escapeHtml(relation.evidence || "none") + '</div>'
      + '<div class="subvalue">Why this exists: ' + escapeHtml(makeRelationWhy(relation)) + '</div>'
      + renderKnowledgeTrustDetails(relation.trust)
      + renderKnowledgeAuditTimeline(relation, [
        { label: "Created", value: relation.createdAt },
        { label: "Updated", value: relation.updatedAt },
        { label: "Source", value: renderKnowledgeSource(relation) },
        { label: "Review", value: relation.confidence < 0.5 ? "Low confidence" : relation.confidence >= 0.7 ? "High confidence" : "Medium confidence", tone: relation.confidence < 0.5 ? "warn" : "good" },
      ])
      + '<div class="actions inline-actions">' + renderKnowledgeSourceJump(relation) + iconButton("sliders", "Update", 'data-knowledge-action="update_relation" data-relation-id="' + escapeHtml(relation.id) + '" data-confidence="' + escapeHtml(relation.confidence) + '"') + iconButton("x", "Forget", 'data-knowledge-action="forget_relation" data-relation-id="' + escapeHtml(relation.id) + '"') + '</div>';
  }
  if (selected.type === "pending") {
    const pending = (graph.pending ?? []).find((candidate) => Number(candidate.id) === Number(selected.id));
    if (!pending) return renderKnowledgeInspectorMissing();
    return '<div class="label">Pending graph write</div><div class="value">Pending #' + escapeHtml(pending.id) + '</div>'
      + '<div class="subvalue">' + escapeHtml(pending.payloadSummary) + '</div>'
      + row("Source", renderKnowledgeSource(pending), "")
      + row("Consent", pending.explicitConsent ? "explicit" : "review", pending.explicitConsent ? "good" : "warn")
      + '<div class="subvalue">Reason: ' + escapeHtml(pending.reason || "No reason provided.") + '</div>'
      + '<div class="subvalue">Why this exists: Pending owner review before graph storage.</div>'
      + renderKnowledgeAuditTimeline(pending, [
        { label: "Queued", value: pending.createdAt },
        { label: "Source", value: renderKnowledgeSource(pending) },
        { label: "Policy", value: pending.explicitConsent ? "Explicit consent present" : "Approval required", tone: pending.explicitConsent ? "good" : "warn" },
      ])
      + '<div class="actions inline-actions">' + renderKnowledgeSourceJump(pending) + iconButton("sliders", "Sanitize", 'data-knowledge-action="sanitize_pending" data-pending-id="' + escapeHtml(pending.id) + '"') + iconButton("check", "Approve", 'data-knowledge-action="approve_pending" data-pending-id="' + escapeHtml(pending.id) + '"') + iconButton("x", "Reject", 'data-knowledge-action="reject_pending" data-pending-id="' + escapeHtml(pending.id) + '"') + '</div>';
  }
  const suggestion = (graph.review?.suggestions ?? [])[Number(selected.id)];
  if (!suggestion) return renderKnowledgeInspectorMissing();
  const args = suggestion.toolCall?.arguments ?? {};
  const mergeAction = suggestion.action === "merge_entity" && args.primaryId && args.duplicateId ? iconButton("layers", "Merge", 'data-knowledge-action="merge_entity" data-primary-id="' + escapeHtml(args.primaryId) + '" data-duplicate-id="' + escapeHtml(args.duplicateId) + '" data-reason="' + escapeHtml(suggestion.reason) + '"') : "";
  const suggestionActions = mergeAction || renderKnowledgeSuggestionActions(suggestion, graph);
  return '<div class="label">Review suggestion</div><div class="value">' + escapeHtml(suggestion.title) + '</div>'
    + row("Priority", suggestion.priority, suggestion.priority === "high" ? "warn" : suggestion.priority === "medium" ? "good" : "")
    + row("Action", suggestion.action, "")
    + '<div class="subvalue">' + escapeHtml(suggestion.reason) + '</div>'
    + '<div class="subvalue">Why this exists: Generated from the current graph hygiene analysis.</div>'
    + '<div class="subvalue">Command: ' + escapeHtml(suggestion.command) + '</div>'
    + renderKnowledgeSuggestionPreview(suggestion, graph)
    + renderKnowledgeTimeline([
      { label: "Generated", value: "Current review plan" },
      { label: "Priority", value: suggestion.priority, tone: suggestion.priority === "high" ? "warn" : suggestion.priority === "medium" ? "good" : "" },
      { label: "Tool", value: suggestion.toolCall?.tool ?? "inspect only" },
    ])
    + (suggestionActions ? '<div class="actions inline-actions">' + suggestionActions + '</div>' : '');
}

function renderKnowledgeInspectorMissing() {
  return '<div class="label">Chi tiết</div><div class="value">Selection unavailable</div><p class="subvalue">The graph changed since this item was selected.</p>';
}

function renderKnowledgeTimeline(events) {
  return '<div class="knowledge-timeline"><div class="label">Timeline</div>' + events.filter((event) => event.value !== undefined && event.value !== null && event.value !== "").map((event) => '<div class="knowledge-timeline-row"><span class="dot ' + (event.tone ?? "") + '"></span><div><strong>' + escapeHtml(event.label) + '</strong><div class="subvalue">' + escapeHtml(event.value) + '</div></div></div>').join("") + '</div>';
}

function renderKnowledgeAuditTimeline(item, fallbackEvents) {
  const auditEvents = item.auditTrail ?? [];
  if (!auditEvents.length) return renderKnowledgeTimeline(fallbackEvents);
  return renderKnowledgeTimeline(auditEvents.map((event) => ({
    label: event.eventType,
    value: [event.createdAt, event.actor ? 'actor ' + event.actor : undefined, event.channel ? 'via ' + event.channel : undefined, event.reason, event.payloadSummary].filter(Boolean).join(' / '),
    tone: event.eventType === "rejected" || event.eventType === "forgotten" ? "warn" : event.eventType === "created" || event.eventType === "approved" ? "good" : "",
  })));
}

function renderKnowledgeSource(item) {
  if (item.source?.label) return item.source.label;
  if (item.sourceAttribution?.label) return item.sourceAttribution.label;
  const parts = [];
  if (item.sourceMemoryId !== undefined) parts.push('memory #' + item.sourceMemoryId);
  if (item.sourceMessageId !== undefined) parts.push('message ' + item.sourceMessageId);
  return parts.join(' / ') || "manual or inferred";
}

function renderKnowledgeSourceJump(item) {
  const source = item.source?.kind === "ui_chat" ? item.source : item.sourceAttribution?.kind === "ui_chat" ? item.sourceAttribution : undefined;
  if (!source?.chatSessionId) return "";
  return iconButton("terminal", "Open source", 'data-knowledge-source-session="' + escapeHtml(source.chatSessionId) + '" data-knowledge-source-message="' + escapeHtml(source.chatMessageId ?? "") + '" data-knowledge-source-run="' + escapeHtml(source.chatRunId ?? "") + '"');
}

function renderKnowledgeTrustDetails(trust) {
  if (!trust) return "";
  const tone = trust.level === "high" ? "good" : trust.level === "low" ? "warn" : "";
  return '<div class="tool-section knowledge-trust-details"><div class="label">Độ tin cậy</div>'
    + row("Score", trust.score + ' / ' + trust.level, tone)
    + row("Source", trust.sourceKind + ' / quality ' + trust.sourceQuality, trust.needsSource ? "warn" : "good")
    + row("Age", trust.ageDays + ' day' + (trust.ageDays === 1 ? "" : "s"), trust.stale ? "warn" : "good")
    + row("Signals", (trust.signals ?? []).join(' / ') || "none", "")
    + row("Warnings", (trust.warnings ?? []).join(' / ') || "none", trust.warnings?.length ? "warn" : "good")
    + '</div>';
}

function renderKnowledgeSuggestionPreview(suggestion, graph) {
  const target = getKnowledgeSuggestionTarget(suggestion);
  let impact = "Inspect the highlighted graph item before changing stored knowledge.";
  let safety = "No write occurs until you use an action and pass the confirmation or approval gate.";
  if (suggestion.action === "merge_entity") {
    const args = suggestion.toolCall?.arguments ?? {};
    impact = 'Would merge duplicate entity #' + text(args.duplicateId) + ' into #' + text(args.primaryId) + ', preserving relations on the primary entity.';
    safety = "Merge is permission-gated and can require approval based on local tool policy.";
  } else if (suggestion.action === "inspect_pending") {
    impact = 'Would review pending graph write #' + text(target?.id) + ' before approving or rejecting storage.';
  } else if (suggestion.action === "inspect_low_confidence") {
    const relation = (graph.relations ?? []).find((candidate) => Number(candidate.id) === Number(target?.id));
    impact = relation ? 'Would update confidence or evidence for ' + relation.sourceName + ' --' + relation.relationType + '--> ' + relation.targetName + '.' : 'Would inspect a low-confidence relation before trusting it.';
  } else if (suggestion.action === "inspect_conflict") {
    impact = "Would inspect a conflicting relation pair before deciding which edge should remain trusted.";
  } else if (suggestion.action === "inspect_orphan") {
    impact = 'Would inspect orphan entity #' + text(target?.id) + ' and decide whether to connect, merge, or forget it.';
  }
  return '<div class="tool-section knowledge-impact"><div class="label">Impact preview</div>' + row("Target", target ? target.type + ' #' + target.id : "review item", "") + row("Change", impact, suggestion.priority === "high" ? "warn" : "") + row("Safety", safety, "good") + '</div>';
}

function makeEntityWhy(entity, relations) {
  if (entity.sourceMemoryId !== undefined) return 'Linked to memory #' + entity.sourceMemoryId + '.';
  if (entity.source?.kind === "ui_chat") return 'Captured from ' + entity.source.label + '.';
  if (entity.sourceMessageId !== undefined) return 'Linked to ' + renderKnowledgeSource(entity) + '.';
  if (relations.length) return 'Referenced by active graph relations.';
  return 'Stored as a durable local graph entity.';
}

function makeRelationWhy(relation) {
  if (relation.evidence) return relation.evidence;
  if (relation.sourceMemoryId !== undefined) return 'Linked to memory #' + relation.sourceMemoryId + '.';
  if (relation.source?.kind === "ui_chat") return 'Captured from ' + relation.source.label + '.';
  if (relation.sourceMessageId !== undefined) return 'Linked to ' + renderKnowledgeSource(relation) + '.';
  return 'Stored as an approved local graph relation.';
}

function runKnowledgeGraphAction(button) {
  const action = button.dataset.knowledgeAction;
  const body = { action, confirm: true };
  let title = "Update knowledge graph?";
  let message = action;
  let beforeConfirm = Promise.resolve(true);
  if (action === "merge_entity") {
    body.primaryId = Number(button.dataset.primaryId);
    body.duplicateId = Number(button.dataset.duplicateId);
    body.reason = button.dataset.reason || "Merge duplicate graph entities from UI review.";
    title = "Merge graph entities?";
    message = '#' + body.primaryId + ' <- #' + body.duplicateId;
  } else if (action === "forget_entity") {
    body.id = Number(button.dataset.entityId);
    body.reason = "Forget entity from Bestie UI graph review.";
    title = "Forget graph entity?";
    message = 'Entity #' + body.id;
  } else if (action === "forget_relation") {
    body.id = Number(button.dataset.relationId);
    body.reason = "Forget relation from Bestie UI graph review.";
    title = "Forget graph relation?";
    message = 'Relation #' + body.id;
  } else if (action === "update_relation") {
    body.id = Number(button.dataset.relationId);
    body.reason = "Update relation confidence from Bestie UI graph review.";
    title = "Update relation confidence?";
    message = 'Relation #' + body.id;
    beforeConfirm = inputAction({ label: "Graph relation", title: "Confidence 0-1", message: "Set the reviewed relation confidence.", value: button.dataset.confidence ?? "0.7", confirmLabel: "Use value" }).then((value) => {
      if (value === undefined) return false;
      const confidence = Number(value);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        showToast("Confidence must be between 0 and 1.", "bad");
        return false;
      }
      body.confidence = confidence;
      return true;
    });
  } else if (action === "approve_pending" || action === "reject_pending" || action === "sanitize_pending") {
    body.id = Number(button.dataset.pendingId);
    title = action === "approve_pending" ? "Approve graph write?" : action === "sanitize_pending" ? "Sanitize graph write?" : "Reject graph write?";
    message = 'Pending #' + body.id;
  } else {
    showToast("Unknown graph action.", "bad");
    return;
  }
  beforeConfirm.then((ready) => {
    if (!ready) return undefined;
    return requireConfirm(title, message, () => withLoading("#knowledge-panel .value", "Updating graph...", () => postJson("/api/knowledge-graph/action", body).then((result) => {
      state.knowledgeGraph = result;
      renderKnowledgeGraphPanel(result, "graph");
      loadApprovals();
      showToast(result.actionStatus === "queued" ? "Graph approval queued." : "Graph updated.", result.actionStatus === "queued" ? "warn" : "good");
    })));
  }).catch(() => setValue("#knowledge-panel .value", "Unable to update graph."));
}

function loadChannels() {
  const activeSegment = document.querySelector("#channel-panel .segment.active")?.id ?? "channel-daemons";
  fetch("/api/channels")
    .then((response) => response.json())
    .then((summary) => {
      const activeChannels = summary.channels?.filter((channel) => channel.enabled).length ?? 0;
      state.firstCron = summary.cron?.schedules?.[0] ?? null;
      setValue("#channel-panel .value", 'Kênh ' + text(activeChannels) + ' / Cron ' + text(summary.cron?.counts?.total));
      const channelRows = (summary.channels ?? []).map((channel) => '<div class="action-row"><span><strong>' + escapeHtml(channel.displayName) + '</strong> <span class="pill ' + pillClass(channel.daemon?.state) + '">' + escapeHtml(channel.daemon?.state ?? "stopped") + '</span> <span class="pill ' + (channel.secretPresent ? "good" : "bad") + '">' + (channel.secretPresent ? "có secret" : "no có secret") + '</span></span><span>' + iconButton("activity", "Bắt đầu", 'data-channel-action="daemon_start" data-channel="' + escapeHtml(channel.id) + '"') + iconButton("x", "Stop", 'data-channel-action="daemon_stop" data-channel="' + escapeHtml(channel.id) + '"') + iconButton("refresh", "Khởi động lại", 'data-channel-action="daemon_restart" data-channel="' + escapeHtml(channel.id) + '"') + '</span></div>');
      const cronRows = (summary.cron?.schedules ?? []).map(renderCronScheduleRow);
      const cronLogRows = (summary.cron?.logs ?? []).map(renderCronLogRow);
      setBody("#channel-panel", [
        '<div class="segmented" role="tablist" aria-label="Các chế độ kênh"><button class="active" data-segment-target="channel-daemons" type="button">Daemon</button><button data-segment-target="channel-cron" type="button">Cron</button><button data-segment-target="channel-cron-logs" type="button">Nhật ký</button></div>',
        '<div class="segment active" id="channel-daemons">' + (channelRows.join("") || row("Daemons", "none", "")) + '</div>',
        '<div class="segment" id="channel-cron">' + [row("Cron bật", summary.cron?.counts?.enabled ?? 0, "good"), renderCronCreateForm(), ...(cronRows.length ? cronRows : [row("Schedules", "none", "")])].join("") + '</div>',
        '<div class="segment" id="channel-cron-logs">' + (cronLogRows.join("") || row("Logs", "none", "")) + '</div>',
      ].join(""));
      bindChannelControls();
      activateSegment("#channel-panel", document.getElementById(activeSegment) ? activeSegment : "channel-daemons");
    })
    .catch(() => setValue("#channel-panel .value", "Không thể tải kênh."));
}

function bindChannelControls() {
  document.querySelectorAll("#channel-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#channel-panel", button.dataset.segmentTarget)));
  document.querySelectorAll("[data-channel-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.channelAction;
    const channel = button.dataset.channel;
    requireConfirm("Cập nhật daemon kênh?", action + ' / ' + channel, () => withLoading("#channel-panel .value", "Đang cập nhật kênh...", () => postJson("/api/channels/action", { action, channel, confirm: true }).then(loadChannels).then(() => showToast("Đã cập nhật kênh.", "good")))).catch(() => setValue("#channel-panel .value", "Không thể cập nhật kênh."));
  }));
  document.querySelectorAll("[data-cron-id]").forEach((button) => button.addEventListener("click", () => {
    const id = Number(button.dataset.cronId);
    const enabled = button.dataset.cronEnabled !== "true";
    requireConfirm("Bật/tắt lịch cron?", String(id), () => withLoading("#channel-panel .value", "Đang cập nhật cron...", () => postJson("/api/channels/action", { action: "cron_toggle", id, enabled, confirm: true }).then(loadChannels).then(() => showToast("Đã cập nhật lịch cron.", "good")))).catch(() => setValue("#channel-panel .value", "Không thể cập nhật lịch cron."));
  }));
  document.querySelectorAll("[data-cron-view]").forEach((button) => button.addEventListener("click", () => document.querySelector('[data-cron-detail="' + button.dataset.cronView + '"]')?.classList.toggle("hidden")));
  document.querySelectorAll("[data-cron-edit]").forEach((button) => button.addEventListener("click", () => document.querySelector('[data-cron-form="' + button.dataset.cronEdit + '"]')?.classList.toggle("hidden")));
  document.querySelectorAll("[data-cron-delete]").forEach((button) => button.addEventListener("click", () => {
    const id = Number(button.dataset.cronDelete);
    requireConfirm("Xóa lịch cron?", String(id), () => withLoading("#channel-panel .value", "Đang xóa cron...", () => postJson("/api/channels/action", { action: "cron_delete", id, confirm: true }).then(loadChannels).then(() => showToast("Đã xóa lịch cron.", "good")))).catch(() => setValue("#channel-panel .value", "Không thể xóa lịch cron."));
  }));
  document.querySelectorAll("[data-cron-trigger]").forEach((button) => button.addEventListener("click", () => {
    const id = Number(button.dataset.cronTrigger);
    requireConfirm("Kích hoạt cron ngay?", String(id), () => withLoading("#channel-panel .value", "Đang kích hoạt cron...", () => postJson("/api/channels/action", { action: "cron_trigger", id, confirm: true }).then(loadChannels).then(() => showToast("Đã kích hoạt cron.", "good")))).catch(() => setValue("#channel-panel .value", "Không thể kích hoạt lịch cron."));
  }));
  document.querySelectorAll("[data-cron-update-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCronWriteForm(event.currentTarget, "cron_update", Number(event.currentTarget.dataset.cronUpdateForm));
  }));
  document.querySelector("#cron-create-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCronWriteForm(event.currentTarget, "cron_add");
  });
}

function submitCronWriteForm(formElement, action, id) {
  const formData = new FormData(formElement);
  const body = {
    action,
    ...(id !== undefined ? { id } : {}),
    name: text(formData.get("name")).trim(),
    scheduleType: text(formData.get("scheduleType")).trim(),
    scheduleValue: text(formData.get("scheduleValue")).trim(),
    prompt: text(formData.get("prompt")).trim(),
    channel: text(formData.get("channel")).trim(),
    enabled: formData.get("enabled") === "on",
    confirm: true,
  };
  const verb = action === "cron_add" ? "Create" : "Save";
  requireConfirm(verb + " cron schedule?", body.name, () => withLoading("#channel-panel .value", "Đang lưu cron...", () => postJson("/api/channels/action", body).then(loadChannels).then(() => showToast("Đã lưu lịch cron.", "good")))).catch(() => setValue("#channel-panel .value", "Không thể lưu lịch cron."));
}

function renderCronCreateForm() {
  const typeOptions = scheduleTypes.map((type) => option(type, type, type === "interval")).join("");
  return '<details class="tool-section"><summary class="label">Thêm cron</summary><form id="cron-create-form" class="stack"><div class="control-grid"><label>Tên<input name="name" value="Lịch mới"></label><label>Loại<select name="scheduleType">' + typeOptions + '</select></label><label>Lịch<input name="scheduleValue" value="1h"></label><label>Kênh<input name="channel" placeholder="telegram:111"></label><label class="check"><input name="enabled" type="checkbox" checked> Enabled</label><button type="submit">' + icon("check") + '<span>Tạo</span></button></div><label class="stack">Prompt<textarea name="prompt" spellcheck="false">Gửi một cập nhật ngắn.</textarea></label></form></details>';
}

function renderCronScheduleRow(schedule) {
  const detail = [
    row("Lần chạy tới", schedule.nextRunAt, ""),
    row("Kết quả cuối", schedule.lastResult ?? "none", schedule.lastResult === "ok" ? "good" : schedule.lastResult ? "bad" : ""),
    row("Số lần chạy", schedule.runCount ?? 0, ""),
    row("Channel", schedule.channel ?? "none", schedule.channel ? "good" : ""),
    '<div class="tool-section"><div class="label">Prompt</div><div>' + escapeHtml(schedule.prompt ?? "") + '</div></div>',
  ].join("");
  const typeOptions = scheduleTypes.map((type) => option(type, type, schedule.scheduleType === type)).join("");
  const form = '<form class="stack hidden" data-cron-form="' + schedule.id + '" data-cron-update-form="' + schedule.id + '"><div class="control-grid"><label>Tên<input name="name" value="' + escapeHtml(schedule.name) + '"></label><label>Loại<select name="scheduleType">' + typeOptions + '</select></label><label>Lịch<input name="scheduleValue" value="' + escapeHtml(schedule.scheduleValue) + '"></label><label>Kênh<input name="channel" value="' + escapeHtml(schedule.channel ?? "") + '" placeholder="telegram:111"></label><label class="check"><input name="enabled" type="checkbox"' + (schedule.enabled ? ' checked' : '') + '> Enabled</label><button type="submit">' + icon("check") + '<span>Lưu</span></button></div><label class="stack">Prompt<textarea name="prompt" spellcheck="false">' + escapeHtml(schedule.prompt ?? "") + '</textarea></label></form>';
  return '<div class="cron-card"><div class="action-row"><span><strong>' + escapeHtml(schedule.name) + '</strong> ' + escapeHtml(schedule.scheduleType) + ' ' + escapeHtml(schedule.scheduleValue) + ' <span class="pill ' + (schedule.enabled ? "good" : "bad") + '">' + (schedule.enabled ? "enabled" : "disabled") + '</span></span><span>' + iconButton("activity", "View", 'data-cron-view="' + schedule.id + '"') + iconButton("sliders", "Edit", 'data-cron-edit="' + schedule.id + '"') + iconButton("terminal", "Trigger", 'data-cron-trigger="' + schedule.id + '"') + iconButton(schedule.enabled ? "x" : "check", schedule.enabled ? "Disable" : "Enable", 'data-cron-id="' + schedule.id + '" data-cron-enabled="' + schedule.enabled + '"') + iconButton("x", "Delete", 'data-cron-delete="' + schedule.id + '"') + '</span></div><div class="tool-section hidden" data-cron-detail="' + schedule.id + '">' + detail + '</div>' + form + '</div>';
}

function renderCronLogRow(log) {
  const status = log.result ?? "running";
  const detail = [log.output, log.error].filter(Boolean).join(" / ");
  return '<div class="memory-row"><div><strong>Log #' + escapeHtml(log.id) + '</strong><div class="subvalue">schedule ' + escapeHtml(log.scheduleId) + ' / started ' + escapeHtml(log.startedAt) + '</div><div>' + escapeHtml(detail || log.finishedAt || "in progress") + '</div></div><span><span class="pill ' + pillClass(status) + '">' + escapeHtml(status) + '</span></span></div>';
}

function loadApprovals() {
  fetch("/api/approvals")
    .then((response) => response.json())
    .then((summary) => {
      state.firstApproval = summary.approvals?.[0] ?? null;
      setValue("#approvals-panel .value", 'Pending ' + text(summary.count));
      const approvalRows = (summary.approvals ?? []).slice(0, 8).map((approval) => {
        const detail = [approval.channel, approval.category, approval.target].filter(Boolean).join(' / ');
        const reason = approval.proposedReason ?? approval.reason ?? 'No reason provided.';
        return '<div class="approval-row"><div><strong>' + escapeHtml(approval.action) + '</strong><div class="subvalue">' + escapeHtml(detail) + '</div><div class="subvalue">' + escapeHtml(reason) + '</div></div><span>' + iconButton("check", "Approve", 'data-approval-action="approve" data-approval-id="' + approval.id + '"') + iconButton("x", "Deny", 'data-approval-action="deny" data-approval-id="' + approval.id + '"') + '</span></div>';
      });
      setBody("#approvals-panel", [
        '<div class="segmented" role="tablist" aria-label="Approval views"><button class="active" data-segment-target="approvals-pending" type="button">Đang chờ</button><button data-segment-target="approvals-history" type="button">History</button></div>',
        '<div class="segment active" id="approvals-pending">' + (approvalRows.join("") || row("Approvals", "none pending", "good")) + '</div>',
        '<div class="segment" id="approvals-history"><div class="notice">Approval history is not stored by the current local API yet.</div>' + row("Audit trail", "planned", "warn") + '</div>',
      ].join(""));
      bindApprovalControls();
    })
    .catch(() => setValue("#approvals-panel .value", "Unable to load approvals."));
}

function bindApprovalControls() {
  document.querySelectorAll("#approvals-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#approvals-panel", button.dataset.segmentTarget)));
  document.querySelectorAll("[data-approval-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.approvalAction;
    const id = Number(button.dataset.approvalId);
    submitApprovalDecision(action, id, String(id));
  }));
}

function submitApprovalDecision(action, id, message) {
  return requireConfirm((action === "approve" ? "Approve pending action?" : "Deny pending action?"), message, () => withLoading("#approvals-panel .value", "Updating approval...", () => postJson("/api/approvals/action", { action, id, confirm: true }).then((result) => {
    loadApprovals();
    if (result.execution) loadKnowledgeGraph();
    showToast(result.execution?.shortText ?? "Approval updated.", result.execution?.status === "invalid" ? "bad" : "good");
  }))).catch(() => setValue("#approvals-panel .value", "Unable to update approval."));
}

function loadMcp() {
  fetch("/api/mcp")
    .then((response) => response.json())
    .then((summary) => {
      setValue("#mcp-panel .value", 'Servers ' + text(summary.counts?.enabled) + '/' + text(summary.counts?.total) + ' / Tools ' + text(summary.counts?.tools));
      const servers = summary.servers ?? [];
      setBody("#mcp-panel", [
        '<div class="summary-strip" data-mcp-summary><span><strong>' + escapeHtml(summary.counts?.enabled ?? 0) + '</strong><small>enabled</small></span><span><strong>' + escapeHtml(summary.counts?.disabled ?? 0) + '</strong><small>disabled</small></span><span><strong>' + escapeHtml(summary.counts?.tools ?? 0) + '</strong><small>tools</small></span><span><strong>' + escapeHtml(summary.counts?.total ?? 0) + '</strong><small>servers</small></span></div>',
        '<div class="segmented" role="tablist" aria-label="MCP views"><button class="active" data-segment-target="mcp-servers" type="button">Servers</button><button data-segment-target="mcp-tools" type="button">Công cụ</button><button data-segment-target="mcp-auth" type="button">Auth</button></div>',
        '<div class="segment active" id="mcp-servers">' + (servers.map(renderMcpServerCard).join("") || row("MCP", "not configured", "")) + '</div>',
        '<div class="segment" id="mcp-tools">' + (servers.map(renderMcpToolSection).join("") || row("Công cụ", "none", "")) + '</div>',
        '<div class="segment" id="mcp-auth">' + (servers.map(renderMcpAuthSection).join("") || row("Auth", "none", "")) + '</div>',
      ].join("") || row("MCP", "not configured", ""));
      bindMcpControls();
    })
    .catch(() => setValue("#mcp-panel .value", "Unable to load MCP."));
}

function bindMcpControls() {
  document.querySelectorAll("#mcp-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#mcp-panel", button.dataset.segmentTarget)));
}

function renderMcpServerCard(server) {
  const auth = server.auth ? 'OAuth ' + text(server.auth.envVar) + (server.auth.headerName ? ' / ' + server.auth.headerName : '') : 'none';
  const config = [
    row("Command", server.commandConfigured ? 'configured / ' + text(server.argCount) + ' args' : "not configured", server.commandConfigured ? "good" : "warn"),
    row("URL", server.urlConfigured ? "configured" : "not configured", server.urlConfigured ? "good" : "warn"),
    row("Env keys", (server.envKeys ?? []).join(", ") || "none", ""),
    row("Header env", (server.headerEnvNames ?? []).join(", ") || "none", ""),
    row("Auth", auth, server.auth ? "good" : ""),
  ].join("");
  const categories = (server.tools?.categories ?? []).map((category) => '<span class="pill warn mcp-chip" title="' + escapeHtml(category) + '">' + escapeHtml(category) + '</span>').join("") || '<span class="pill mcp-chip">none</span>';
  const names = (server.tools?.names ?? []).slice(0, 8).map((name) => '<span class="pill mcp-chip mcp-tool-chip" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>').join("") || '<span class="pill mcp-chip">none</span>';
  return '<article class="mcp-server-card" data-mcp-server="' + escapeHtml(server.name) + '"><div class="mcp-server-head"><div><strong>' + escapeHtml(server.name) + '</strong><div class="subvalue">' + escapeHtml(server.transport) + ' transport</div></div><span class="pill ' + (server.enabled ? "good" : "bad") + '">' + (server.enabled ? "enabled" : "disabled") + '</span></div><div class="tool-section">' + config + '</div><div class="pill-row" data-mcp-categories>' + categories + '</div><div class="pill-row" data-mcp-tools>' + names + '</div></article>';
}

function renderMcpToolSection(server) {
  const categories = (server.tools?.categories ?? []).map((category) => '<span class="pill warn mcp-chip" title="' + escapeHtml(category) + '">' + escapeHtml(category) + '</span>').join("") || '<span class="pill mcp-chip">none</span>';
  const names = (server.tools?.names ?? []).slice(0, 12).map((name) => '<span class="pill mcp-chip mcp-tool-chip" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>').join("") || '<span class="pill mcp-chip">none</span>';
  return '<div class="tool-section"><div class="label">' + escapeHtml(server.name) + '</div><div class="pill-row">' + categories + '</div><div class="pill-row">' + names + '</div></div>';
}

function renderMcpAuthSection(server) {
  const auth = server.auth ? 'OAuth ' + text(server.auth.envVar) + (server.auth.headerName ? ' / ' + server.auth.headerName : '') : 'none';
  return '<div class="tool-section"><div class="label">' + escapeHtml(server.name) + '</div>' + [
    row("Transport", server.transport, ""),
    row("Header env", (server.headerEnvNames ?? []).join(", ") || "none", (server.headerEnvNames ?? []).length ? "good" : ""),
    row("Env keys", (server.envKeys ?? []).join(", ") || "none", (server.envKeys ?? []).length ? "good" : ""),
    row("Auth", auth, server.auth ? "good" : ""),
  ].join("") + '</div>';
}

function loadTools() {
  fetch("/api/tools")
    .then((response) => response.json())
    .then((summary) => {
      setValue("#tools-panel .value", 'Policies ' + text(summary.policies?.count) + ' / External paths ' + text(summary.workspace?.externalPathCount));
      const policyRows = (summary.policies?.entries ?? []).map(renderToolPolicyRow);
      const workspaceRows = [
        row("Default workspace", summary.workspace?.defaultPath ?? "not set", summary.workspace?.defaultPath ? "good" : "warn"),
        ...(summary.workspace?.externalPaths ?? []).map((path) => '<div class="path-row"><span>' + escapeHtml(path) + '</span><span class="pill warn">external</span></div>'),
      ];
      setBody("#tools-panel", [
        '<div class="summary-strip" data-tools-summary><span><strong>' + escapeHtml(summary.policies?.allow ?? 0) + '</strong><small>allow</small></span><span><strong>' + escapeHtml(summary.policies?.ask ?? 0) + '</strong><small>ask</small></span><span><strong>' + escapeHtml(summary.policies?.deny ?? 0) + '</strong><small>deny</small></span><span><strong>' + escapeHtml(summary.exec?.timeoutMs ?? "default") + '</strong><small>exec timeout</small></span></div>',
        '<div class="segmented" role="tablist" aria-label="Tool views"><button class="active" data-segment-target="tools-policies" type="button">Policies</button><button data-segment-target="tools-workspace" type="button">Workspace</button><button data-segment-target="tools-execution" type="button">Execution</button></div>',
        '<div class="segment active" id="tools-policies"><div class="tool-section"><div class="label">Tool policies</div>' + (policyRows.join("") || row("Policies", "none configured", "warn")) + '</div></div>',
        '<div class="segment" id="tools-workspace"><div class="tool-section"><div class="label">Workspace access</div>' + workspaceRows.join("") + '</div></div>',
        '<div class="segment" id="tools-execution"><div class="tool-section"><div class="label">Execution limits</div>' + [row("Timeout", summary.exec?.timeoutMs ?? "default", ""), row("Policy count", summary.policies?.count ?? 0, ""), row("External paths", summary.workspace?.externalPathCount ?? 0, summary.workspace?.externalPathCount ? "warn" : "good")].join("") + '</div></div>',
      ].join(""));
      bindToolsControls();
    })
    .catch(() => setValue("#tools-panel .value", "Unable to load tools."));
}

function bindToolsControls() {
  document.querySelectorAll("#tools-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#tools-panel", button.dataset.segmentTarget)));
  document.querySelectorAll("[data-tool-policy-select]").forEach((select) => select.addEventListener("change", () => updateToolPolicy(select.dataset.toolPolicySelect, select.value, select)));
}

function renderToolPolicyRow(entry) {
  return '<div class="tool-policy-row" data-tool-policy="' + escapeHtml(entry.tool) + '"><div><strong>' + escapeHtml(entry.tool) + '</strong><div class="subvalue">internal tool execution policy</div></div><label class="tool-policy-select"><span>Policy</span><select data-tool-policy-select="' + escapeHtml(entry.tool) + '">' + ["allow", "ask", "deny"].map((policy) => option(policy, policy, entry.policy === policy)).join("") + '</select></label></div>';
}

function updateToolPolicy(tool, policy, select) {
  if (!tool || !["allow", "ask", "deny"].includes(policy)) return;
  select.disabled = true;
  withLoading("#tools-panel .value", "Saving " + tool + " policy...", () => putJson("/api/tools/policy", { tool, policy }).then((summary) => {
    setValue("#tools-panel .value", 'Policies ' + text(summary.policies?.count) + ' / External paths ' + text(summary.workspace?.externalPathCount));
    loadTools();
    showToast("Tool policy saved.", "good");
  })).catch(() => setValue("#tools-panel .value", "Unable to update tool policy.")).finally(() => { select.disabled = false; });
}

function loadSettings() {
  fetch("/api/settings")
    .then((response) => response.json())
    .then((summary) => {
      state.settings = summary;
      setValue("#settings-panel .value", text(summary.agent?.name) + ' / Tone ' + text(summary.agent?.toneIntensity) + ' / Memory ' + text(summary.memory?.writePolicy));
      setBody("#settings-panel", [
        row("Owner", summary.agent?.ownerName, ""),
        row("Language", summary.agent?.language, ""),
        row("Primary", summary.llm?.primary, ""),
        '<form id="settings-form" class="stack"><div class="control-grid"><label>Tên<input name="name" value="' + escapeHtml(summary.agent?.name) + '"></label><label>Owner<input name="ownerName" value="' + escapeHtml(summary.agent?.ownerName) + '"></label><label>Language<input name="language" value="' + escapeHtml(summary.agent?.language) + '"></label><label>Memory policy<select name="writePolicy">' + ["ask", "allow", "deny"].map((policy) => option(policy, policy, summary.memory?.writePolicy === policy)).join("") + '</select></label><label>Tone<input name="toneIntensity" type="range" min="0" max="10" value="' + escapeHtml(summary.agent?.toneIntensity ?? 7) + '"></label><button type="submit">Save settings</button></div></form>',
      ].join(""));
      bindSettingsControls();
    })
    .catch(() => setValue("#settings-panel .value", "Unable to load settings."));
}

function loadSkills() {
  return fetch("/api/skills")
    .then((response) => response.json())
    .then((summary) => {
      state.skills = summary.skills ?? [];
      setValue("#skills-panel .value", 'Skills ' + text(summary.count));
      const selected = state.skills.find((skill) => skill.name === state.activeSkillName) ?? state.skills[0];
      setBody("#skills-panel", [
        '<div class="skills-layout"><aside class="skills-rail"><div class="skills-rail-head"><div><div class="label">Installed skills</div><strong>' + escapeHtml(summary.count) + ' local</strong></div>' + iconButton("layers", "New", 'id="skill-new-inline"') + '</div><label class="skill-search"><span>Tìm kiếm</span><input id="skill-search" value="' + escapeHtml(state.skillFilter ?? "") + '" placeholder="Filter by name or content"></label><div id="skill-list" class="skill-list">' + renderSkillList(selected?.name) + '</div><div class="notice compact">Stored in ' + escapeHtml(summary.skillsDir) + '</div></aside>' + renderSkillEditor(selected) + '</div>',
      ].join(""));
      bindSkillControls();
      if (selected?.name) return loadSkillItem(selected.name);
      return undefined;
    })
    .catch(() => setValue("#skills-panel .value", "Unable to load skills."));
}

function renderSkillList(activeName) {
  const filter = String(state.skillFilter ?? "").trim().toLowerCase();
  const skills = (state.skills ?? []).filter((skill) => !filter || skill.name.toLowerCase().includes(filter) || String(skill.preview ?? "").toLowerCase().includes(filter));
  if (skills.length === 0) return '<div class="skill-empty"><strong>No skills found</strong><span>Create a new skill or clear the filter.</span></div>';
  return skills.map((skill) => renderSkillRow(skill, skill.name === activeName)).join("");
}

function renderSkillRow(skill, active) {
  return '<button class="skill-row ' + (active ? "active" : "") + '" data-skill-name="' + escapeHtml(skill.name) + '" type="button"><span class="skill-row-main"><strong>' + escapeHtml(skill.name) + '</strong><small>' + escapeHtml(skill.preview || "No description yet.") + '</small></span><span class="pill">' + escapeHtml(skill.bytes) + ' bytes</span></button>';
}

function renderSkillEditor(skill) {
  const isNew = !skill;
  const content = isNew ? "# Skill\\n\\nDescribe when and how Bestie should use this skill.\\n" : "Loading...";
  return '<form id="skill-form" class="skill-editor stack"><div class="skill-editor-head"><div><div class="label">' + (isNew ? "Create" : "Edit") + '</div><strong id="skill-editor-title">' + escapeHtml(skill?.name ?? "New skill") + '</strong><span class="subvalue">' + (isNew ? "Write a SKILL.md file and save it into the local skills directory." : "Edit the selected SKILL.md file, or rename it by changing the skill name before saving.") + '</span></div><span class="skill-editor-actions">' + iconButton("layers", "New", 'id="skill-new-editor"') + iconButton("x", "Delete", 'id="skill-delete" ' + (isNew ? "disabled" : "")) + '</span></div><div class="control-grid"><label>Skill name<input id="skill-name" name="name" value="' + escapeHtml(skill?.name ?? "") + '" placeholder="my-skill" autocomplete="off"></label><label>Status<input id="skill-status" value="' + (isNew ? "New skill" : "Editing") + '" disabled></label></div><label class="stack skill-content-label">SKILL.md<textarea id="skill-content" spellcheck="false">' + escapeHtml(content) + '</textarea></label><div class="skill-help"><span>Use a short lowercase name. Saving creates or updates <strong>SKILL.md</strong>.</span><span>Deleting removes the selected skill folder after confirmation.</span></div></form>';
}

function bindSkillControls() {
  document.querySelectorAll("[data-skill-name]").forEach((button) => button.addEventListener("click", () => loadSkillItem(button.dataset.skillName)));
  document.querySelector("#skill-search")?.addEventListener("input", (event) => {
    state.skillFilter = event.currentTarget.value;
    const list = document.querySelector("#skill-list");
    if (list) list.innerHTML = renderSkillList(state.activeSkillName);
    document.querySelectorAll("[data-skill-name]").forEach((button) => button.addEventListener("click", () => loadSkillItem(button.dataset.skillName)));
  });
  document.querySelectorAll("#skill-new-inline, #skill-new-editor").forEach((button) => button.addEventListener("click", startNewSkill));
  document.querySelector("#skill-form")?.addEventListener("submit", (event) => event.preventDefault());
  document.querySelector("#skill-delete")?.addEventListener("click", () => {
    const name = document.querySelector("#skill-name")?.value ?? "";
    requireConfirm("Delete skill?", name, () => withLoading("#skills-panel .value", "Deleting skill...", () => postJson("/api/skills/delete", { name, confirm: true }).then(loadSkills).then(() => showToast("Skill deleted.", "good")))).catch(() => setValue("#skills-panel .value", "Unable to delete skill."));
  });
}

function startNewSkill() {
  state.activeSkillName = "";
  const nameInput = document.querySelector("#skill-name");
  const contentInput = document.querySelector("#skill-content");
  if (nameInput) nameInput.value = "";
  if (contentInput) contentInput.value = "# Skill\\n\\nDescribe when and how Bestie should use this skill.\\n";
  setValue("#skill-editor-title", "New skill");
  const status = document.querySelector("#skill-status");
  if (status) status.value = "New skill";
  document.querySelector("#skill-delete")?.setAttribute("disabled", "");
  document.querySelectorAll(".skill-row").forEach((row) => row.classList.remove("active"));
  nameInput?.focus();
  setValue("#skills-panel .value", "Creating new skill");
}

function loadSkillItem(name) {
  const contentInput = document.querySelector("#skill-content");
  const nameInput = document.querySelector("#skill-name");
  if (state.activeSkillName === name && (contentInput === document.activeElement || nameInput === document.activeElement)) return Promise.resolve();
  return fetch("/api/skills/item?name=" + encodeURIComponent(name))
    .then((response) => response.json())
    .then((skill) => {
      state.activeSkillName = skill.name;
      if (document.querySelector("#skill-name") !== document.activeElement) document.querySelector("#skill-name").value = skill.name;
      if (document.querySelector("#skill-content") !== document.activeElement) document.querySelector("#skill-content").value = skill.content;
      setValue("#skill-editor-title", skill.name);
      const status = document.querySelector("#skill-status");
      if (status) status.value = "Editing";
      document.querySelector("#skill-delete")?.removeAttribute("disabled");
      document.querySelectorAll(".skill-row").forEach((row) => row.classList.toggle("active", row.dataset.skillName === skill.name));
      setValue("#skills-panel .value", 'Editing ' + skill.name);
    })
    .catch(() => setValue("#skills-panel .value", "Unable to load skill."));
}

function bindSettingsControls() {
  document.querySelector("#settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      agent: {
        name: text(form.get("name")),
        ownerName: text(form.get("ownerName")),
        language: text(form.get("language")),
        toneIntensity: Number(form.get("toneIntensity")),
      },
      memory: { writePolicy: text(form.get("writePolicy")) },
      confirm: true,
    };
    requireConfirm("Save settings?", body.agent.name + ' / memory ' + body.memory.writePolicy, () => withLoading("#settings-panel .value", "Saving settings...", () => putJson("/api/settings", body).then(loadSettings).then(loadStatus).then(() => showToast("Settings saved.", "good")))).catch(() => setValue("#settings-panel .value", "Unable to update settings."));
  });
}

document.querySelector("#doctor-fix")?.addEventListener("click", () => requireConfirm("Run safe Doctor fixes?", "This may edit local Bestie config files.", () => withLoading("#doctor-panel .value", "Running safe fixes...", () => postJson("/api/doctor/fix", { confirm: true }).then(loadDoctor).then(() => showToast("Doctor fixes completed.", "good")))).catch(() => setValue("#doctor-panel .value", "Unable to run safe fixes.")));
document.querySelector("#provider-refresh")?.addEventListener("click", loadProviders);
document.querySelector("#provider-test")?.addEventListener("click", () => withLoading("#provider-panel .value", "Testing provider...", () => postJson("/api/providers/test", {}).then((result) => { setValue("#provider-panel .value", result.ok ? "Provider test passed." : "Provider test failed."); showToast(result.ok ? "Provider test passed." : "Provider test failed.", result.ok ? "good" : "bad"); })).catch(() => setValue("#provider-panel .value", "Unable to test provider.")));
document.querySelector("#command-palette-input")?.addEventListener("input", renderCommandPalette);
document.querySelector("#command-palette-input")?.addEventListener("keydown", (event) => {
  const rows = [...document.querySelectorAll("#command-palette-list .palette-row")];
  const current = rows.findIndex((row) => row.classList.contains("active"));
  if (event.key === "Enter") {
    event.preventDefault();
    rows[Math.max(0, current)]?.click();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, current + 1) : Math.max(0, current - 1);
    rows.forEach((row, index) => row.classList.toggle("active", index === next));
  }
});
document.querySelector("#chat-import-text")?.addEventListener("input", updateChatImportPreview);
document.querySelector("#chat-import-file")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  file.text().then((content) => {
    const textArea = document.querySelector("#chat-import-text");
    if (textArea) textArea.value = content;
    updateChatImportPreview();
  }).catch(() => showToast("Unable to read import file.", "bad"));
});
document.querySelectorAll("[data-import-tab]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-import-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
  document.querySelector("#chat-import-dialog")?.classList.toggle("file-mode", button.dataset.importTab === "file");
}));
document.querySelectorAll("[data-export-format]").forEach((button) => button.addEventListener("click", () => {
  state.chatExportFormat = button.dataset.exportFormat;
  renderChatExportDialog();
}));
document.querySelector("#chat-import-confirm")?.addEventListener("click", () => {
  const raw = document.querySelector("#chat-import-text")?.value.trim();
  if (raw) submitChatImport(raw);
});
document.querySelector("#chat-export-copy")?.addEventListener("click", copyChatExport);
document.querySelector("#chat-export-download")?.addEventListener("click", downloadChatExport);
document.querySelector("#character-reload")?.addEventListener("click", loadCharacter);
document.querySelector("#character-save")?.addEventListener("click", () => {
  const characterText = document.querySelector("#character-json")?.value;
  const promptText = document.querySelector("#character-prompt")?.value;
  requireConfirm("Save character files?", "This updates character.json and system-prompt.md.", () => withLoading("#character-panel .value", "Saving character...", () => putJson("/api/character", { characterText, promptText }).then(loadCharacter).then(() => showToast("Character saved.", "good")))).catch(() => setValue("#character-panel .value", "Unable to save character."));
});
document.querySelector("#memory-refresh")?.addEventListener("click", loadMemory);
document.querySelector("#knowledge-refresh")?.addEventListener("click", loadKnowledgeGraph);
document.querySelector("#channel-refresh")?.addEventListener("click", loadChannels);
document.querySelector("#channel-stop-cron")?.addEventListener("click", () => requireConfirm("Stop cron daemon?", "This requests the local cron daemon to stop.", () => withLoading("#channel-panel .value", "Stopping cron...", () => postJson("/api/channels/action", { action: "daemon_stop", channel: "cron", confirm: true }).then((summary) => { setValue("#channel-panel .value", text(summary.messages?.[0] ?? "Cron daemon stop requested.")); loadChannels(); showToast("Cron stop requested.", "good"); }))).catch(() => setValue("#channel-panel .value", "Unable to stop cron daemon.")));
document.querySelector("#cron-toggle")?.addEventListener("click", () => {
  if (!state.firstCron) { setValue("#channel-panel .value", "No cron schedule found."); return; }
  requireConfirm("Bật/tắt lịch cron?", state.firstCron.name ?? String(state.firstCron.id), () => withLoading("#channel-panel .value", "Đang cập nhật cron...", () => postJson("/api/channels/action", { action: "cron_toggle", id: state.firstCron.id, enabled: !state.firstCron.enabled, confirm: true }).then(loadChannels).then(() => showToast("Đã cập nhật lịch cron.", "good")))).catch(() => setValue("#channel-panel .value", "Không thể cập nhật lịch cron."));
});
document.querySelector("#approvals-refresh")?.addEventListener("click", loadApprovals);
document.querySelector("#approval-approve")?.addEventListener("click", () => decideApproval("approve"));
document.querySelector("#approval-deny")?.addEventListener("click", () => decideApproval("deny"));
document.querySelector("#mcp-refresh")?.addEventListener("click", loadMcp);
document.querySelector("#tools-refresh")?.addEventListener("click", loadTools);
document.querySelector("#skills-refresh")?.addEventListener("click", loadSkills);
document.querySelector("#skill-new")?.addEventListener("click", startNewSkill);
document.querySelector("#skill-save")?.addEventListener("click", () => {
  const name = document.querySelector("#skill-name")?.value ?? "";
  const content = document.querySelector("#skill-content")?.value ?? "";
  const previousName = state.activeSkillName || undefined;
  requireConfirm("Save skill?", name, () => withLoading("#skills-panel .value", "Saving skill...", () => putJson("/api/skills/item", { name, content, previousName }).then(() => { state.activeSkillName = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-"); return loadSkills(); }).then(() => loadSkillItem(state.activeSkillName)).then(() => showToast("Skill saved.", "good")))).catch(() => setValue("#skills-panel .value", "Unable to save skill."));
});
document.querySelector("#chat-send")?.addEventListener("click", sendChatMessage);
document.querySelector("#chat-clear")?.addEventListener("click", () => { state.chatHistory = []; loadChat(); showToast("Chat cleared.", "good"); });
document.querySelector("#settings-refresh")?.addEventListener("click", loadSettings);
document.querySelector("#settings-tone")?.addEventListener("click", () => {
  const current = state.settings?.agent?.toneIntensity ?? 7;
  const next = current >= 10 ? 1 : current + 1;
  requireConfirm("Update tone?", 'Tone intensity ' + next, () => withLoading("#settings-panel .value", "Updating settings...", () => putJson("/api/settings", { agent: { toneIntensity: next }, confirm: true }).then(loadSettings).then(() => showToast("Settings updated.", "good")))).catch(() => setValue("#settings-panel .value", "Unable to update settings."));
});

function decideApproval(action) {
  if (!state.firstApproval) { setValue("#approvals-panel .value", "No pending approvals."); return; }
  submitApprovalDecision(action, state.firstApproval.id, state.firstApproval.action);
}

loadStatus();
loadChat();
loadDoctor();
loadProviders();
loadCharacter();
loadMemory();
loadKnowledgeGraph();
loadChannels();
loadApprovals();
loadMcp();
loadTools();
loadSkills();
loadSettings();`;
