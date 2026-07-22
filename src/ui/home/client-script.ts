export const HOME_PAGE_CLIENT_SCRIPT = `const state = {};
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
const row = (label, value, tone) => '<div class="row"><span>' + icon(tone === "good" ? "check" : tone === "bad" ? "x" : "activity") + escapeHtml(label) + '</span><span class="pill ' + (tone ?? "") + '">' + escapeHtml(value) + '</span></div>';
const option = (value, label, selected) => '<option value="' + escapeHtml(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
function renderMarkdown(value) {
  const escaped = escapeHtml(value);
  const fence = String.fromCharCode(96).repeat(3);
  const codeBlocks = [];
  const withCodeBlocks = escaped.replace(new RegExp(fence + "([\\\\s\\\\S]*?)" + fence, "g"), (_match, code) => {
    const token = "BESTIE_CODE_BLOCK_" + codeBlocks.length;
    codeBlocks.push('<div class="code-block"><button class="copy-code" type="button">Copy</button><pre><code>' + code.trim() + '</code></pre></div>');
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
  { id: "chat-search", title: "Search Sessions", hint: "Focus session search", run: () => document.querySelector("#chat-session-search")?.focus() },
];

function providerSetupNote(provider) {
  if (provider === "gemini") return "Gemini uses the native SDK endpoint; baseUrl is ignored.";
  if (provider === "ollama") return "Ollama runs locally and does not need an API key.";
  return "Setup may write the provided secret to the local .env file.";
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
  setComposerStatus(active ? "Streaming..." : "Ready");
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
  setValue("#chat-panel .value", state.activeChatSession ? 'Session #' + state.activeChatSession.id : "Ready");
  setBody("#chat-panel", [
    '<div class="chat-layout ' + (state.chatSideOpen ? '' : 'chat-side-hidden') + '"><aside class="chat-sessions"><div class="chat-session-tools"><strong>Sessions</strong><span><button id="chat-new-session" type="button" title="New chat" aria-label="New chat">' + icon("check") + '</button><button id="chat-rename-session" type="button" title="Rename chat" aria-label="Rename chat">' + icon("refresh") + '</button><button id="chat-export-session" type="button" title="Export chat" aria-label="Export chat">' + icon("cloud") + '</button><button id="chat-import-session" type="button" title="Import chat" aria-label="Import chat">' + icon("database") + '</button><button id="chat-delete-session" type="button" title="Delete chat" aria-label="Delete chat">' + icon("x") + '</button></span></div><div class="chat-search"><input id="chat-session-search" placeholder="Search" value="' + escapeHtml(state.chatSearchQuery ?? "") + '"><select id="chat-session-filter"><option value="all">All</option><option value="approval">Approval</option><option value="cancelled">Cancelled</option><option value="error">Error</option><option value="fork">Fork</option><option value="retry">Retry</option></select></div><div id="chat-session-list" class="stack">' + row("Sessions", "loading", "") + '</div></aside><div id="chat-transcript" class="chat-transcript">' + renderChatTranscript() + '</div><button id="chat-side-toggle" class="chat-side-toggle" type="button" aria-expanded="' + (state.chatSideOpen ? 'true' : 'false') + '">' + icon("sliders") + '<span>' + (state.chatSideOpen ? 'Hide' : 'Details') + '</span></button><aside class="chat-side"><div class="summary-strip"><span><strong>Tools</strong><small>agent loop</small></span><span><strong>Memory</strong><small>optional</small></span><span><strong>Fallbacks</strong><small>provider aware</small></span></div><div id="chat-inspector" class="tool-section"><div class="label">Run inspector</div>' + renderChatInspector() + '</div><div id="chat-preferences" class="tool-section"><div class="label">Preferences</div>' + renderChatPreferences() + '</div><div id="chat-branch" class="tool-section"><div class="label">Branches</div>' + renderChatBranchNavigator() + '</div><div id="chat-timeline" class="tool-section"><div class="label">Run timeline</div>' + renderChatTimeline() + '</div></aside></div>',
    '<form id="chat-form" class="chat-composer"><div class="composer-field"><div class="composer-toolbar"><span id="chat-composer-status">Ready</span><span id="chat-composer-context">Tools + Memory</span></div><textarea id="chat-input" placeholder="Nhắn với Bestie..." spellcheck="false" rows="1"></textarea><input id="chat-attachment-input" type="file" accept=".txt,.md,.markdown,.json,.csv,text/*,application/json" multiple hidden><div id="chat-attachment-preview" class="attachment-preview"></div><div class="composer-tools"><button id="chat-attach" type="button">' + icon("clip") + '<span>Attach</span></button><button id="chat-context" type="button">' + icon("sliders") + '<span>Context</span></button></div></div><button type="submit" data-chat-send>' + icon("check") + '<span>Send</span></button><button id="chat-stop" type="button" disabled>' + icon("square") + '<span>Stop</span></button></form>',
  ].join(""));
  bindChatControls();
  const filter = document.querySelector("#chat-session-filter");
  if (filter) filter.value = state.chatSessionFilter ?? "all";
  loadChatSessions();
}

function renderChatTranscript() {
  if (!state.chatHistory?.length) return '<div class="notice">No messages yet.</div>';
  return state.chatHistory.map((message, index) => {
    const messageId = Number(message.id ?? 0);
    const actions = ['<button class="message-menu-item" data-chat-copy-message="' + index + '" type="button">' + icon("check") + '<span>Copy</span></button>'];
    if (messageId && message.role === "user") actions.push('<button class="message-menu-item" data-chat-retry-message="' + messageId + '" type="button">' + icon("refresh") + '<span>Retry</span></button>');
    if (message.runId && message.role === "assistant") actions.push('<button class="message-menu-item" data-chat-inspect-run="' + message.runId + '" type="button">' + icon("activity") + '<span>Inspect run</span></button>');
    if (messageId) actions.push('<button class="message-menu-item" data-chat-fork="' + messageId + '" type="button">' + icon("layers") + '<span>Fork</span></button>');
    const menu = '<details class="message-menu"><summary aria-label="Message actions">' + icon("dots") + '</summary><div class="message-menu-popover">' + actions.join("") + '</div></details>';
    return '<div class="chat-message ' + escapeHtml(message.role) + '">' +
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
  return '<div class="chat-message-meta"><span title="Message time">' + icon("activity") + escapeHtml(time) + '</span><span title="Total context">' + icon("brain") + escapeHtml(context) + '</span><span class="pill ' + pillClass(status) + '" title="Message status">' + escapeHtml(formatChatStatus(status)) + '</span></div>';
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
  if (status === "done") return "sent";
  if (status === "error") return "error";
  if (status === "cancelled") return "cancelled";
  if (status === "running") return "running";
  return status || "saved";
}

function chatDisplayName(role) {
  const parsed = state.character?.character?.parsed;
  if (role === "user") return parsed?.ownerName || "You";
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
  document.querySelector("#chat-session-search")?.addEventListener("input", (event) => { state.chatSearchQuery = event.target.value; loadChatSessions(); });
  document.querySelector("#chat-session-filter")?.addEventListener("change", (event) => { state.chatSessionFilter = event.target.value; loadChatSessions(); });
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
    if (label) label.textContent = state.chatSideOpen ? "Hide" : "Details";
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
  const tools = document.querySelector("#chat-tools")?.checked !== false ? "Tools" : "No tools";
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
    target.innerHTML = '<div class="label">Preferences</div>' + renderChatPreferences();
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
    target.innerHTML = '<div class="label">Run inspector</div>' + renderChatInspector();
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
    + row("Tools", String(toolCalls.length), toolCalls.length ? "warn" : "")
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
    + row("Tools", String(diff.toolDelta), diff.toolDelta ? "warn" : "")
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

function loadChatSessions() {
  const query = state.chatSearchQuery ?? "";
  const filter = state.chatSessionFilter ?? "all";
  const url = query || filter !== "all" ? "/api/chat/search?q=" + encodeURIComponent(query) + "&filter=" + encodeURIComponent(filter) : "/api/chat/sessions";
  fetch(url)
    .then((response) => response.json())
    .then((summary) => {
      state.chatSessions = summary.sessions ?? [];
      renderChatSessions();
      if (!state.activeChatSession && state.chatSessions[0]) loadChatSession(state.chatSessions[0].id);
    })
    .catch(() => { document.querySelector("#chat-session-list").innerHTML = row("Sessions", "unable to load", "bad"); });
}

function renderChatSessions() {
  const list = document.querySelector("#chat-session-list");
  if (!list) return;
  if (!state.chatSessions?.length) {
    list.innerHTML = row("Sessions", "none", "");
    return;
  }
  list.innerHTML = state.chatSessions.map((session) => '<div class="chat-session-row ' + (state.activeChatSession?.id === session.id ? "active" : "") + '"><button class="chat-session-open" data-chat-session="' + session.id + '" type="button"><strong>' + escapeHtml(session.title) + '</strong><span>' + escapeHtml(session.messageCount) + ' messages</span>' + renderChatSessionBadges(session) + '</button><button class="pin-session" data-chat-pin="' + session.id + '" data-pinned="' + (session.pinnedAt ? "true" : "false") + '" type="button">' + (session.pinnedAt ? "Pinned" : "Pin") + '</button></div>').join("");
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
  postJson("/api/chat/sessions", { title: "New chat" })
    .then((result) => {
      state.activeChatSession = result.session;
      state.chatHistory = [];
      state.chatTimeline = [];
      state.chatRuns = [];
      state.chatApprovals = {};
      state.chatBranch = result.branch ?? { children: [] };
      state.chatRun = undefined;
      setValue("#chat-panel .value", 'Session #' + result.session.id);
      renderChatTranscriptIntoPanel();
      renderChatBranchIntoPanel();
      renderChatTimelineIntoPanel();
      loadChatSessions();
    })
    .catch((error) => setValue("#chat-panel .value", error?.message ?? "Unable to create session."));
}

function loadChatSession(id) {
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
      renderChatSessions();
    })
    .catch((error) => setValue("#chat-panel .value", error?.message ?? "Unable to load session."));
}

function deleteActiveChatSession() {
  if (!state.activeChatSession) return;
  requireConfirm("Delete chat session?", state.activeChatSession.title, () => postJson("/api/chat/sessions/delete", { id: state.activeChatSession.id, confirm: true }).then((summary) => {
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
    renderChatSessions();
    if (state.chatSessions[0]) loadChatSession(state.chatSessions[0].id);
    setValue("#chat-panel .value", state.chatSessions[0] ? 'Session #' + state.chatSessions[0].id : "Ready");
    showToast("Chat session deleted.", "good");
  })).catch(() => setValue("#chat-panel .value", "Unable to delete session."));
}

function renameActiveChatSession() {
  if (!state.activeChatSession) return;
  inputAction({ label: "Rename chat", title: "Session title", message: state.activeChatSession.title ?? "New chat", value: state.activeChatSession.title ?? "New chat", confirmLabel: "Rename" }).then((title) => {
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
    loadChatSessions();
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
    loadChatSessions();
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
      loadChatSessions();
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
    loadChatSessions();
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
      renderChatSessions();
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
    target.innerHTML = '<div class="label">Run timeline</div>' + renderChatTimeline();
    bindChatApprovalControls();
    bindChatContinueControls();
  }
  renderChatInspectorIntoPanel();
}

function renderChatBranchIntoPanel() {
  const target = document.querySelector("#chat-branch");
  if (target) {
    target.innerHTML = '<div class="label">Branches</div>' + renderChatBranchNavigator();
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
        state.chatTimeline = [...(state.chatTimeline ?? []), { type: "approval_approved", label: "Approval ready to continue", payload: { approvalId: id } }];
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
      loadChatSessions();
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
  return type === "done" || type === "tool_finish" || type === "approval_approved" ? "good" : type === "error" ? "bad" : type === "thinking" || type === "approval_required" || type === "cancelled" ? "warn" : "";
}

function renderMetrics(status) {
  setValue("#runtime-card .value", status.ok ? "Ready" : text(status.error?.code));
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
      const profileRows = (providers.profiles ?? []).slice(0, 4).map((profile) => row(profile.id, profile.secretPresent ? profile.provider + ' ready' : profile.provider + ' missing secret', profile.secretPresent ? "good" : "bad"));
      setBody("#provider-panel", [
        '<div class="segmented" role="tablist" aria-label="Provider views"><button class="active" data-segment-target="provider-overview" type="button">Overview</button><button data-segment-target="provider-configure" type="button">Configure</button><button data-segment-target="provider-profiles" type="button">Profiles</button></div>',
        '<div class="segment active" id="provider-overview">' + [row("Auth profile", providers.primary?.authProfile, ""), row("Secret", providers.primary?.secretPresent ? "present" : "missing", providers.primary?.secretPresent ? "good" : "bad"), row("Fallbacks", providers.fallbacks?.length ?? 0, "")].join("") + '</div>',
        '<div class="segment" id="provider-configure"><div class="preset-row"><button data-provider-preset="anthropic" type="button">' + icon("brain") + '<span>Claude</span></button><button data-provider-preset="openai" type="button">' + icon("spark") + '<span>ChatGPT</span></button><button data-provider-preset="gemini" type="button">' + icon("spark") + '<span>Gemini</span></button><button data-provider-preset="groq" type="button">' + icon("activity") + '<span>Groq</span></button><button data-provider-preset="openrouter" type="button">' + icon("cloud") + '<span>OpenRouter</span></button><button data-provider-preset="ollama" type="button">' + icon("terminal") + '<span>Ollama</span></button></div><div class="control-grid"><label>Primary model<select id="provider-primary-select">' + modelOptions + '</select></label>' + iconButton("check", "Set primary", 'id="provider-primary-set"') + '</div><div class="control-grid"><label>Fallback<select id="provider-fallback-select">' + fallbackOptions + '</select></label>' + iconButton("check", "Add", 'id="provider-fallback-add"') + iconButton("x", "Remove", 'id="provider-fallback-remove"') + '</div><form id="provider-setup-form" class="stack"><div class="control-grid"><label>Provider<input name="provider" value="gemini"></label><label>Model<input name="model" value="gemini-2.5-flash"></label><label data-provider-field="baseUrl">Base URL<input name="baseUrl" placeholder="SDK default for Gemini"></label><label data-provider-field="apiKeyEnv">API key env<input name="apiKeyEnv" value="GEMINI_API_KEY"></label><label data-provider-field="secret">Secret<input name="secret" type="password" placeholder="optional"></label><label class="check"><input name="setDefault" type="checkbox"> Set default</label><button type="submit">' + icon("check") + '<span>Setup</span></button></div><div class="notice" id="provider-setup-note">' + escapeHtml(providerSetupNote("gemini")) + '</div></form></div>',
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
        '<form id="character-form" class="stack"><div class="control-grid"><label>Name<input name="name" value="' + escapeHtml(parsed?.name) + '"></label><label>Owner<input name="ownerName" value="' + escapeHtml(parsed?.ownerName) + '"></label><label>Language<input name="language" value="' + escapeHtml(parsed?.language) + '"></label></div><div class="slider-grid"><label>Roast<input name="roastLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.roastLevel ?? 0) + '"></label><label>Warmth<input name="warmthLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.warmthLevel ?? 0) + '"></label><label>Bluntness<input name="bluntnessLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.bluntnessLevel ?? 0) + '"></label><label>Chaos<input name="chaosLevel" type="range" min="0" max="10" value="' + escapeHtml(tone.chaosLevel ?? 0) + '"></label></div></form>',
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
      setValue("#memory-panel .value", 'Active ' + text(memory.counts?.active) + ' / Pending ' + text(memory.counts?.pending));
      const memories = (memory.memories ?? []).slice(0, 6).map(renderMemoryItem);
      const pending = (memory.pending ?? []).slice(0, 6).map(renderPendingMemoryItem);
      setBody("#memory-panel", [
        '<div class="segmented" role="tablist" aria-label="Memory views"><button class="active" data-segment-target="memory-active" type="button">Active</button><button data-segment-target="memory-pending" type="button">Pending</button><button data-segment-target="memory-search-view" type="button">Search</button></div>',
        '<div class="segment active" id="memory-active">' + (memories.join("") || row("Active", "empty", "")) + '</div>',
        '<div class="segment" id="memory-pending">' + (pending.join("") || row("Pending", "empty", "")) + '</div>',
        '<div class="segment" id="memory-search-view"><div class="control-grid"><input id="memory-search" placeholder="Search memories"><button id="memory-search-run" type="button">Search</button></div><div id="memory-search-results" class="stack">' + row("Search", "ready", "") + '</div></div>',
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
  const meta = [item.reason, item.source, item.explicitConsent ? "explicit consent" : "needs review"].filter(Boolean).join(' / ');
  return '<div class="memory-row"><div><strong>Pending ' + escapeHtml(item.type) + '</strong><div>' + escapeHtml(item.content) + '</div><div class="subvalue">' + escapeHtml(meta || item.createdAt) + '</div></div><span>' + iconButton("check", "Approve", 'data-memory-action="approve_pending" data-memory-id="' + item.id + '"') + iconButton("x", "Reject", 'data-memory-action="reject_pending" data-memory-id="' + item.id + '"') + '</span></div>';
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
  root.querySelectorAll("[data-segment-target]").forEach((button) => button.classList.toggle("active", button.dataset.segmentTarget === segmentId));
  root.querySelectorAll(".segment").forEach((segment) => segment.classList.toggle("active", segment.id === segmentId));
}

function updateProviderSetupFields(provider) {
  const normalized = text(provider).trim().toLowerCase();
  const isGemini = normalized === "gemini";
  const isOllama = normalized === "ollama";
  document.querySelector('[data-provider-field="baseUrl"]')?.classList.toggle("hidden", isGemini);
  document.querySelector('[data-provider-field="apiKeyEnv"]')?.classList.toggle("hidden", isOllama);
  document.querySelector('[data-provider-field="secret"]')?.classList.toggle("hidden", isOllama);
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
        setValue("#memory-panel .value", 'Search results for "' + query + '"');
        document.querySelector("#memory-search-results").innerHTML = results.join("") || row("Search", "no results", "");
        activateSegment("#memory-panel", "memory-search-view");
      })
      .catch(() => setValue("#memory-panel .value", "Unable to search memory."));
  });
  document.querySelectorAll("[data-memory-action]").forEach((button) => button.addEventListener("click", () => {
    requireConfirm("Update memory?", button.dataset.memoryAction, () => withLoading("#memory-panel .value", "Updating memory...", () => postJson("/api/memory/action", { action: button.dataset.memoryAction, id: Number(button.dataset.memoryId), confirm: true }).then(loadMemory).then(() => showToast("Memory updated.", "good")))).catch(() => setValue("#memory-panel .value", "Unable to update memory."));
  }));
}

function loadChannels() {
  const activeSegment = document.querySelector("#channel-panel .segment.active")?.id ?? "channel-daemons";
  fetch("/api/channels")
    .then((response) => response.json())
    .then((summary) => {
      const activeChannels = summary.channels?.filter((channel) => channel.enabled).length ?? 0;
      state.firstCron = summary.cron?.schedules?.[0] ?? null;
      setValue("#channel-panel .value", 'Channels ' + text(activeChannels) + ' / Cron ' + text(summary.cron?.counts?.total));
      const channelRows = (summary.channels ?? []).map((channel) => '<div class="action-row"><span><strong>' + escapeHtml(channel.displayName) + '</strong> <span class="pill ' + pillClass(channel.daemon?.state) + '">' + escapeHtml(channel.daemon?.state ?? "stopped") + '</span> <span class="pill ' + (channel.secretPresent ? "good" : "bad") + '">' + (channel.secretPresent ? "secret" : "no secret") + '</span></span><span>' + iconButton("activity", "Start", 'data-channel-action="daemon_start" data-channel="' + escapeHtml(channel.id) + '"') + iconButton("x", "Stop", 'data-channel-action="daemon_stop" data-channel="' + escapeHtml(channel.id) + '"') + iconButton("refresh", "Restart", 'data-channel-action="daemon_restart" data-channel="' + escapeHtml(channel.id) + '"') + '</span></div>');
      const cronRows = (summary.cron?.schedules ?? []).map(renderCronScheduleRow);
      const cronLogRows = (summary.cron?.logs ?? []).map(renderCronLogRow);
      setBody("#channel-panel", [
        '<div class="segmented" role="tablist" aria-label="Channel views"><button class="active" data-segment-target="channel-daemons" type="button">Daemons</button><button data-segment-target="channel-cron" type="button">Cron</button><button data-segment-target="channel-cron-logs" type="button">Logs</button></div>',
        '<div class="segment active" id="channel-daemons">' + (channelRows.join("") || row("Daemons", "none", "")) + '</div>',
        '<div class="segment" id="channel-cron">' + [row("Cron enabled", summary.cron?.counts?.enabled ?? 0, "good"), renderCronCreateForm(), ...(cronRows.length ? cronRows : [row("Schedules", "none", "")])].join("") + '</div>',
        '<div class="segment" id="channel-cron-logs">' + (cronLogRows.join("") || row("Logs", "none", "")) + '</div>',
      ].join(""));
      bindChannelControls();
      activateSegment("#channel-panel", document.getElementById(activeSegment) ? activeSegment : "channel-daemons");
    })
    .catch(() => setValue("#channel-panel .value", "Unable to load channels."));
}

function bindChannelControls() {
  document.querySelectorAll("#channel-panel [data-segment-target]").forEach((button) => button.addEventListener("click", () => activateSegment("#channel-panel", button.dataset.segmentTarget)));
  document.querySelectorAll("[data-channel-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.channelAction;
    const channel = button.dataset.channel;
    requireConfirm("Update channel daemon?", action + ' / ' + channel, () => withLoading("#channel-panel .value", "Updating channel...", () => postJson("/api/channels/action", { action, channel, confirm: true }).then(loadChannels).then(() => showToast("Channel action completed.", "good")))).catch(() => setValue("#channel-panel .value", "Unable to update channel."));
  }));
  document.querySelectorAll("[data-cron-id]").forEach((button) => button.addEventListener("click", () => {
    const id = Number(button.dataset.cronId);
    const enabled = button.dataset.cronEnabled !== "true";
    requireConfirm("Toggle cron schedule?", String(id), () => withLoading("#channel-panel .value", "Updating cron...", () => postJson("/api/channels/action", { action: "cron_toggle", id, enabled, confirm: true }).then(loadChannels).then(() => showToast("Cron schedule updated.", "good")))).catch(() => setValue("#channel-panel .value", "Unable to update cron schedule."));
  }));
  document.querySelectorAll("[data-cron-view]").forEach((button) => button.addEventListener("click", () => document.querySelector('[data-cron-detail="' + button.dataset.cronView + '"]')?.classList.toggle("hidden")));
  document.querySelectorAll("[data-cron-edit]").forEach((button) => button.addEventListener("click", () => document.querySelector('[data-cron-form="' + button.dataset.cronEdit + '"]')?.classList.toggle("hidden")));
  document.querySelectorAll("[data-cron-delete]").forEach((button) => button.addEventListener("click", () => {
    const id = Number(button.dataset.cronDelete);
    requireConfirm("Delete cron schedule?", String(id), () => withLoading("#channel-panel .value", "Deleting cron...", () => postJson("/api/channels/action", { action: "cron_delete", id, confirm: true }).then(loadChannels).then(() => showToast("Cron schedule deleted.", "good")))).catch(() => setValue("#channel-panel .value", "Unable to delete cron schedule."));
  }));
  document.querySelectorAll("[data-cron-trigger]").forEach((button) => button.addEventListener("click", () => {
    const id = Number(button.dataset.cronTrigger);
    requireConfirm("Trigger cron now?", String(id), () => withLoading("#channel-panel .value", "Triggering cron...", () => postJson("/api/channels/action", { action: "cron_trigger", id, confirm: true }).then(loadChannels).then(() => showToast("Cron schedule triggered.", "good")))).catch(() => setValue("#channel-panel .value", "Unable to trigger cron schedule."));
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
  requireConfirm(verb + " cron schedule?", body.name, () => withLoading("#channel-panel .value", "Saving cron...", () => postJson("/api/channels/action", body).then(loadChannels).then(() => showToast("Cron schedule saved.", "good")))).catch(() => setValue("#channel-panel .value", "Unable to save cron schedule."));
}

function renderCronCreateForm() {
  const typeOptions = scheduleTypes.map((type) => option(type, type, type === "interval")).join("");
  return '<details class="tool-section"><summary class="label">Add cron</summary><form id="cron-create-form" class="stack"><div class="control-grid"><label>Name<input name="name" value="New schedule"></label><label>Type<select name="scheduleType">' + typeOptions + '</select></label><label>Schedule<input name="scheduleValue" value="1h"></label><label>Channel<input name="channel" placeholder="telegram:111"></label><label class="check"><input name="enabled" type="checkbox" checked> Enabled</label><button type="submit">' + icon("check") + '<span>Create</span></button></div><label class="stack">Prompt<textarea name="prompt" spellcheck="false">Send a short update.</textarea></label></form></details>';
}

function renderCronScheduleRow(schedule) {
  const detail = [
    row("Next run", schedule.nextRunAt, ""),
    row("Last result", schedule.lastResult ?? "none", schedule.lastResult === "ok" ? "good" : schedule.lastResult ? "bad" : ""),
    row("Run count", schedule.runCount ?? 0, ""),
    row("Channel", schedule.channel ?? "none", schedule.channel ? "good" : ""),
    '<div class="tool-section"><div class="label">Prompt</div><div>' + escapeHtml(schedule.prompt ?? "") + '</div></div>',
  ].join("");
  const typeOptions = scheduleTypes.map((type) => option(type, type, schedule.scheduleType === type)).join("");
  const form = '<form class="stack hidden" data-cron-form="' + schedule.id + '" data-cron-update-form="' + schedule.id + '"><div class="control-grid"><label>Name<input name="name" value="' + escapeHtml(schedule.name) + '"></label><label>Type<select name="scheduleType">' + typeOptions + '</select></label><label>Schedule<input name="scheduleValue" value="' + escapeHtml(schedule.scheduleValue) + '"></label><label>Channel<input name="channel" value="' + escapeHtml(schedule.channel ?? "") + '" placeholder="telegram:111"></label><label class="check"><input name="enabled" type="checkbox"' + (schedule.enabled ? ' checked' : '') + '> Enabled</label><button type="submit">' + icon("check") + '<span>Save</span></button></div><label class="stack">Prompt<textarea name="prompt" spellcheck="false">' + escapeHtml(schedule.prompt ?? "") + '</textarea></label></form>';
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
        '<div class="segmented" role="tablist" aria-label="Approval views"><button class="active" data-segment-target="approvals-pending" type="button">Pending</button><button data-segment-target="approvals-history" type="button">History</button></div>',
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
    requireConfirm((action === "approve" ? "Approve pending action?" : "Deny pending action?"), String(id), () => withLoading("#approvals-panel .value", "Updating approval...", () => postJson("/api/approvals/action", { action, id, confirm: true }).then(loadApprovals).then(() => showToast("Approval updated.", "good")))).catch(() => setValue("#approvals-panel .value", "Unable to update approval."));
  }));
}

function loadMcp() {
  fetch("/api/mcp")
    .then((response) => response.json())
    .then((summary) => {
      setValue("#mcp-panel .value", 'Servers ' + text(summary.counts?.enabled) + '/' + text(summary.counts?.total) + ' / Tools ' + text(summary.counts?.tools));
      const servers = summary.servers ?? [];
      setBody("#mcp-panel", [
        '<div class="summary-strip" data-mcp-summary><span><strong>' + escapeHtml(summary.counts?.enabled ?? 0) + '</strong><small>enabled</small></span><span><strong>' + escapeHtml(summary.counts?.disabled ?? 0) + '</strong><small>disabled</small></span><span><strong>' + escapeHtml(summary.counts?.tools ?? 0) + '</strong><small>tools</small></span><span><strong>' + escapeHtml(summary.counts?.total ?? 0) + '</strong><small>servers</small></span></div>',
        '<div class="segmented" role="tablist" aria-label="MCP views"><button class="active" data-segment-target="mcp-servers" type="button">Servers</button><button data-segment-target="mcp-tools" type="button">Tools</button><button data-segment-target="mcp-auth" type="button">Auth</button></div>',
        '<div class="segment active" id="mcp-servers">' + (servers.map(renderMcpServerCard).join("") || row("MCP", "not configured", "")) + '</div>',
        '<div class="segment" id="mcp-tools">' + (servers.map(renderMcpToolSection).join("") || row("Tools", "none", "")) + '</div>',
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
        '<form id="settings-form" class="stack"><div class="control-grid"><label>Name<input name="name" value="' + escapeHtml(summary.agent?.name) + '"></label><label>Owner<input name="ownerName" value="' + escapeHtml(summary.agent?.ownerName) + '"></label><label>Language<input name="language" value="' + escapeHtml(summary.agent?.language) + '"></label><label>Memory policy<select name="writePolicy">' + ["ask", "allow", "deny"].map((policy) => option(policy, policy, summary.memory?.writePolicy === policy)).join("") + '</select></label><label>Tone<input name="toneIntensity" type="range" min="0" max="10" value="' + escapeHtml(summary.agent?.toneIntensity ?? 7) + '"></label><button type="submit">Save settings</button></div></form>',
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
        '<div class="skills-layout"><aside class="skills-rail"><div class="skills-rail-head"><div><div class="label">Installed skills</div><strong>' + escapeHtml(summary.count) + ' local</strong></div>' + iconButton("layers", "New", 'id="skill-new-inline"') + '</div><label class="skill-search"><span>Search</span><input id="skill-search" value="' + escapeHtml(state.skillFilter ?? "") + '" placeholder="Filter by name or content"></label><div id="skill-list" class="skill-list">' + renderSkillList(selected?.name) + '</div><div class="notice compact">Stored in ' + escapeHtml(summary.skillsDir) + '</div></aside>' + renderSkillEditor(selected) + '</div>',
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
document.querySelector("#channel-refresh")?.addEventListener("click", loadChannels);
document.querySelector("#channel-stop-cron")?.addEventListener("click", () => requireConfirm("Stop cron daemon?", "This requests the local cron daemon to stop.", () => withLoading("#channel-panel .value", "Stopping cron...", () => postJson("/api/channels/action", { action: "daemon_stop", channel: "cron", confirm: true }).then((summary) => { setValue("#channel-panel .value", text(summary.messages?.[0] ?? "Cron daemon stop requested.")); loadChannels(); showToast("Cron stop requested.", "good"); }))).catch(() => setValue("#channel-panel .value", "Unable to stop cron daemon.")));
document.querySelector("#cron-toggle")?.addEventListener("click", () => {
  if (!state.firstCron) { setValue("#channel-panel .value", "No cron schedule found."); return; }
  requireConfirm("Toggle cron schedule?", state.firstCron.name ?? String(state.firstCron.id), () => withLoading("#channel-panel .value", "Updating cron...", () => postJson("/api/channels/action", { action: "cron_toggle", id: state.firstCron.id, enabled: !state.firstCron.enabled, confirm: true }).then(loadChannels).then(() => showToast("Cron schedule updated.", "good")))).catch(() => setValue("#channel-panel .value", "Unable to update cron schedule."));
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
  requireConfirm((action === "approve" ? "Approve pending action?" : "Deny pending action?"), state.firstApproval.action, () => withLoading("#approvals-panel .value", "Updating approval...", () => postJson("/api/approvals/action", { action, id: state.firstApproval.id, confirm: true }).then(loadApprovals).then(() => showToast("Approval updated.", "good")))).catch(() => setValue("#approvals-panel .value", "Unable to update approval."));
}

loadStatus();
loadChat();
loadDoctor();
loadProviders();
loadCharacter();
loadMemory();
loadChannels();
loadApprovals();
loadMcp();
loadTools();
loadSkills();
loadSettings();`;
