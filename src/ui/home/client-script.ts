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
  cloud: "M17.5 19H8a5 5 0 1 1 .7-10A6 6 0 0 1 20 11.5 3.5 3.5 0 0 1 17.5 19Z",
  database: "M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3Zm0 0v6c0 2 4 3 8 3s8-1 8-3V6M4 12v6c0 2 4 3 8 3s8-1 8-3v-6",
  refresh: "M20 11a8 8 0 0 0-14.9-4M4 5v5h5m-5 3a8 8 0 0 0 14.9 4M20 19v-5h-5",
  shield: "M12 3 20 7v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4Z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z",
  terminal: "M4 17l6-5-6-5m8 10h8",
  x: "M18 6 6 18M6 6l12 12",
};
const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="' + icons[name] + '"/></svg>';
const iconButton = (name, label, attrs) => '<button ' + attrs + ' type="button">' + icon(name) + '<span>' + escapeHtml(label) + '</span></button>';
const row = (label, value, tone) => '<div class="row"><span>' + icon(tone === "good" ? "check" : tone === "bad" ? "x" : "activity") + escapeHtml(label) + '</span><span class="pill ' + (tone ?? "") + '">' + escapeHtml(value) + '</span></div>';
const option = (value, label, selected) => '<option value="' + escapeHtml(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
const providerPresets = {
  anthropic: { provider: "anthropic", model: "claude-sonnet-4-5", apiKeyEnv: "ANTHROPIC_API_KEY", baseUrl: "https://api.anthropic.com/v1" },
  openai: { provider: "openai", model: "gpt-4o-mini", apiKeyEnv: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
  gemini: { provider: "gemini", model: "gemini-2.5-flash", apiKeyEnv: "GEMINI_API_KEY", baseUrl: "" },
  groq: { provider: "groq", model: "llama-3.1-8b-instant", apiKeyEnv: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1" },
  openrouter: { provider: "openrouter", model: "openai/gpt-4o-mini", apiKeyEnv: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { provider: "ollama", model: "llama3.1", apiKeyEnv: "", baseUrl: "http://127.0.0.1:11434/v1" },
};

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

function withLoading(selector, message, task) {
  setValue(selector, message);
  return Promise.resolve().then(task).catch((error) => {
    showToast(error?.message ?? "Action failed.", "bad");
    throw error;
  });
}

function confirmAction(title, message) {
  const dialog = document.querySelector("#confirm-dialog");
  if (!dialog?.showModal) return Promise.resolve(window.confirm(title));
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
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

if (location.hash) activatePanel(location.hash.slice(1));
window.addEventListener("hashchange", () => activatePanel(location.hash.slice(1)));

function renderMetrics(status) {
  const items = [
    ["Config", status.config?.exists ? "Found" : "Missing", status.config?.path],
    ["Provider", status.llm?.provider + " / " + status.llm?.modelRef, status.llm?.secretPresent ? status.llm?.apiKeyEnv + " present" : status.llm?.apiKeyEnv + " missing"],
    ["Character", status.character?.exists && status.prompt?.exists ? "Ready" : "Missing files", "fallbacks " + text(status.llm?.fallbackCount)],
  ];
  document.querySelector("#status-grid").innerHTML = items.map(([label, value, subvalue]) => '<article class="metric-card"><div class="label">' + escapeHtml(label) + '</div><div><div class="value">' + escapeHtml(value) + '</div><div class="subvalue">' + escapeHtml(subvalue) + '</div></div></article>').join("");
  setValue("#runtime-card .value", status.ok ? "Ready" : text(status.error?.code));
}

function loadStatus() {
  fetch("/api/status")
    .then((response) => response.json())
    .then(renderMetrics)
    .catch(() => {
      document.querySelector("#status-grid").innerHTML = '<article class="metric-card"><div class="label">Status</div><div class="value">Unable to load</div></article>';
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
  fetch("/api/channels")
    .then((response) => response.json())
    .then((summary) => {
      const activeChannels = summary.channels?.filter((channel) => channel.enabled).length ?? 0;
      state.firstCron = summary.cron?.schedules?.[0] ?? null;
      setValue("#channel-panel .value", 'Channels ' + text(activeChannels) + ' / Cron ' + text(summary.cron?.counts?.total));
      const channelRows = (summary.channels ?? []).map((channel) => '<div class="action-row"><span><strong>' + escapeHtml(channel.displayName) + '</strong> <span class="pill ' + pillClass(channel.daemon?.state) + '">' + escapeHtml(channel.daemon?.state ?? "stopped") + '</span> <span class="pill ' + (channel.secretPresent ? "good" : "bad") + '">' + (channel.secretPresent ? "secret" : "no secret") + '</span></span><span>' + iconButton("activity", "Start", 'data-channel-action="daemon_start" data-channel="' + escapeHtml(channel.id) + '"') + iconButton("x", "Stop", 'data-channel-action="daemon_stop" data-channel="' + escapeHtml(channel.id) + '"') + iconButton("refresh", "Restart", 'data-channel-action="daemon_restart" data-channel="' + escapeHtml(channel.id) + '"') + '</span></div>');
      const cronRows = (summary.cron?.schedules ?? []).map((schedule) => '<div class="action-row"><span><strong>' + escapeHtml(schedule.name) + '</strong> ' + escapeHtml(schedule.scheduleType) + ' ' + escapeHtml(schedule.scheduleValue) + ' <span class="pill ' + (schedule.enabled ? "good" : "bad") + '">' + (schedule.enabled ? "enabled" : "disabled") + '</span></span><span>' + iconButton(schedule.enabled ? "x" : "check", schedule.enabled ? "Disable" : "Enable", 'data-cron-id="' + schedule.id + '" data-cron-enabled="' + schedule.enabled + '"') + '</span></div>');
      setBody("#channel-panel", [
        '<div class="segmented" role="tablist" aria-label="Channel views"><button class="active" data-segment-target="channel-daemons" type="button">Daemons</button><button data-segment-target="channel-cron" type="button">Cron</button></div>',
        '<div class="segment active" id="channel-daemons">' + (channelRows.join("") || row("Daemons", "none", "")) + '</div>',
        '<div class="segment" id="channel-cron">' + [row("Cron enabled", summary.cron?.counts?.enabled ?? 0, "good"), ...(cronRows.length ? cronRows : [row("Schedules", "none", "")])].join("") + '</div>',
      ].join(""));
      bindChannelControls();
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
  const categories = (server.tools?.categories ?? []).map((category) => '<span class="pill warn">' + escapeHtml(category) + '</span>').join("") || '<span class="pill">none</span>';
  const names = (server.tools?.names ?? []).slice(0, 8).map((name) => '<span class="pill">' + escapeHtml(name) + '</span>').join("") || '<span class="pill">none</span>';
  return '<article class="mcp-server-card" data-mcp-server="' + escapeHtml(server.name) + '"><div class="mcp-server-head"><div><strong>' + escapeHtml(server.name) + '</strong><div class="subvalue">' + escapeHtml(server.transport) + ' transport</div></div><span class="pill ' + (server.enabled ? "good" : "bad") + '">' + (server.enabled ? "enabled" : "disabled") + '</span></div><div class="tool-section">' + config + '</div><div class="pill-row" data-mcp-categories>' + categories + '</div><div class="pill-row" data-mcp-tools>' + names + '</div></article>';
}

function renderMcpToolSection(server) {
  const categories = (server.tools?.categories ?? []).map((category) => '<span class="pill warn">' + escapeHtml(category) + '</span>').join("") || '<span class="pill">none</span>';
  const names = (server.tools?.names ?? []).slice(0, 12).map((name) => '<span class="pill">' + escapeHtml(name) + '</span>').join("") || '<span class="pill">none</span>';
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
}

function renderToolPolicyRow(entry) {
  return '<div class="tool-policy-row" data-tool-policy="' + escapeHtml(entry.tool) + '"><div><strong>' + escapeHtml(entry.tool) + '</strong><div class="subvalue">internal tool execution policy</div></div><span class="pill ' + pillClass(entry.policy) + '">' + escapeHtml(entry.policy) + '</span></div>';
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
loadDoctor();
loadProviders();
loadCharacter();
loadMemory();
loadChannels();
loadApprovals();
loadMcp();
loadTools();
loadSettings();`;
