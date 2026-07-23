import { HOME_PAGE_STYLES } from "./home/styles.js";

const ICONS = {
  activity: "M4 12h3l2-7 4 14 2-7h5",
  brain: "M8 5a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 3 3m8-14a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-3 3M8 5v14m8-14v14M8 9H6m12 0h-2M8 15H6m12 0h-2",
  check: "M20 6 9 17l-5-5",
  database: "M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3Zm0 0v6c0 2 4 3 8 3s8-1 8-3V6M4 12v6c0 2 4 3 8 3s8-1 8-3v-6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z",
  key: "M15 7a4 4 0 1 0-3.1 3.9L3 20v1h4v-2h2v-2h2l2.1-2.1A4 4 0 0 0 15 7Zm0 0h.01",
  message: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z",
  plug: "M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-5 5v5m-3 0h6",
  refresh: "M20 11a8 8 0 0 0-14.9-4M4 5v5h5m-5 3a8 8 0 0 0 14.9 4M20 19v-5h-5",
  shield: "M12 3 20 7v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4Z",
  sliders: "M4 7h10m4 0h2M4 17h2m4 0h10M7 4v6m10 4v6",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z",
  terminal: "M4 17l6-5-6-5m8 10h8",
  layers: "M12 2 3 7l9 5 9-5-9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5",
  user: "M20 21a8 8 0 0 0-16 0m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  wrench: "M14.7 6.3a4 4 0 0 0 5 5L11 20H6v-5l8.7-8.7ZM17 3l4 4",
} as const;

type IconName = keyof typeof ICONS;

interface HomePanel {
  id: string;
  icon: IconName;
  nav: string;
  title: string;
  subtitle: string;
  actions: string;
  body: string;
}

const PANELS: HomePanel[] = [
  { id: "chat-panel", icon: "message", nav: "Chat", title: "Chat", subtitle: "Local agent session with tools, memory context, and provider fallbacks.", actions: `${button("check", "chat-send", "Send")}${button("refresh", "chat-retry", "Retry")}${button("refresh", "chat-clear", "Clear")}`, body: "Ready to chat." },
  { id: "doctor-panel", icon: "shield", nav: "Doctor", title: "Doctor", subtitle: "Local readiness checks and safe fixes.", actions: button("wrench", "doctor-fix", "Run safe fixes"), body: "Loading diagnostics..." },
  { id: "provider-panel", icon: "plug", nav: "Providers", title: "Provider Hub", subtitle: "Primary model, fallbacks, setup, and quick connection check.", actions: `${button("activity", "provider-test", "Test primary")}${button("refresh", "provider-refresh", "Refresh")}`, body: "Loading providers..." },
  { id: "character-panel", icon: "user", nav: "Character", title: "Character Studio", subtitle: "Edit character JSON and system prompt locally.", actions: `${button("check", "character-save", "Save character")}${button("refresh", "character-reload", "Reload")}`, body: "Loading character..." },
  { id: "memory-panel", icon: "database", nav: "Memory", title: "Memory Center", subtitle: "Search active memories and approve pending writes.", actions: button("refresh", "memory-refresh", "Refresh"), body: "Loading memory..." },
  { id: "knowledge-panel", icon: "brain", nav: "Graph", title: "Knowledge Graph", subtitle: "Inspect local entities, relations, and graph review suggestions.", actions: button("refresh", "knowledge-refresh", "Refresh"), body: "Loading graph..." },
  { id: "channel-panel", icon: "globe", nav: "Channels", title: "Channel Hub", subtitle: "Telegram, Zalo, daemon state, and cron schedules.", actions: `${button("refresh", "channel-refresh", "Refresh")}${button("terminal", "channel-stop-cron", "Stop cron")}${button("activity", "cron-toggle", "Toggle first cron")}`, body: "Loading channels..." },
  { id: "approvals-panel", icon: "key", nav: "Approvals", title: "Approvals", subtitle: "Pending permission decisions with guarded execution for UI actions.", actions: `${button("refresh", "approvals-refresh", "Refresh")}${button("check", "approval-approve", "Approve first")}${button("shield", "approval-deny", "Deny first")}`, body: "Loading approvals..." },
  { id: "mcp-panel", icon: "brain", nav: "MCP", title: "MCP Hub", subtitle: "Configured servers, transports, auth metadata, and tools.", actions: button("refresh", "mcp-refresh", "Refresh"), body: "Loading MCP..." },
  { id: "tools-panel", icon: "terminal", nav: "Tools", title: "Tools & Permissions", subtitle: "Internal tool policies and workspace boundaries.", actions: button("refresh", "tools-refresh", "Refresh"), body: "Loading tools..." },
  { id: "skills-panel", icon: "layers", nav: "Skills", title: "Quản lý Skills", subtitle: "Create, edit, inspect, and delete local .bestie skills.", actions: `${button("layers", "skill-new", "New skill")}${button("check", "skill-save", "Save skill")}${button("refresh", "skills-refresh", "Refresh")}`, body: "Loading skills..." },
  { id: "settings-panel", icon: "sliders", nav: "Settings", title: "Settings", subtitle: "Low-risk agent and memory settings.", actions: `${button("refresh", "settings-refresh", "Refresh")}${button("sliders", "settings-tone", "Tone +1")}`, body: "Loading settings..." },
];

export function renderHomePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bestie UI</title>
    <style>${HOME_PAGE_STYLES}</style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar" aria-label="Bestie navigation">
        <div class="brand"><span class="brand-mark">${icon("spark")}</span><span class="brand-copy"><strong>Bestie</strong><small>Local Console</small></span></div>
        <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-pressed="false" aria-label="Collapse sidebar">${icon("sliders")}<span>Compact</span></button>
        <nav>${PANELS.map((panel, index) => `<a href="#${panel.id}" data-panel-target="${panel.id}"${index === 0 ? " class=\"active\"" : ""}>${icon(panel.icon)}<span>${panel.nav}</span></a>`).join("")}</nav>
      </aside>
      <main>
        <section class="panel-grid" data-active-panel="chat-panel">
          ${PANELS.map(renderPanel).join("")}
        </section>
      </main>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <dialog id="confirm-dialog">
      <form method="dialog" class="confirm-card">
        <div class="label">Confirm action</div>
        <div class="value" id="confirm-title">Continue?</div>
        <p id="confirm-message">This changes local Bestie state.</p>
        <div class="actions"><button value="cancel" type="submit">Cancel</button><button value="confirm" type="submit">Confirm</button></div>
      </form>
    </dialog>
    <dialog id="input-dialog">
      <form method="dialog" class="confirm-card">
        <div class="label" id="input-label">Input</div>
        <div class="value" id="input-title">Enter value</div>
        <input id="input-value" autocomplete="off">
        <p id="input-message">This updates local Bestie state.</p>
        <div class="actions"><button value="cancel" type="submit">Cancel</button><button id="input-confirm" value="confirm" type="submit">Save</button></div>
      </form>
    </dialog>
    <dialog id="chat-import-dialog">
      <form method="dialog" class="confirm-card import-card">
        <div class="label">Import chat</div>
        <div class="value">Paste or choose exported JSON</div>
        <div class="import-tabs"><button class="active" data-import-tab="paste" type="button">Paste</button><button data-import-tab="file" type="button">File</button></div>
        <textarea id="chat-import-text" placeholder="Paste exported chat JSON" spellcheck="false"></textarea>
        <input id="chat-import-file" type="file" accept="application/json,.json">
        <p id="chat-import-preview">Waiting for export JSON.</p>
        <div class="actions"><button value="cancel" type="submit">Cancel</button><button id="chat-import-confirm" value="confirm" type="button" disabled>Import JSON</button></div>
      </form>
    </dialog>
    <dialog id="chat-export-dialog">
      <form method="dialog" class="confirm-card import-card">
        <div class="label">Export chat</div>
        <div class="value" id="chat-export-title">Current session</div>
        <div class="import-tabs"><button class="active" data-export-format="json" type="button">JSON</button><button data-export-format="markdown" type="button">Markdown</button></div>
        <textarea id="chat-export-preview" readonly spellcheck="false"></textarea>
        <p id="chat-export-summary">Waiting for export data.</p>
        <div class="actions"><button value="cancel" type="submit">Close</button><button id="chat-export-copy" type="button">Copy</button><button id="chat-export-download" type="button">Download</button></div>
      </form>
    </dialog>
    <dialog id="command-palette-dialog">
      <form method="dialog" class="confirm-card palette-card">
        <div class="label">Command palette</div>
        <input id="command-palette-input" placeholder="Search Chat commands" autocomplete="off">
        <div id="command-palette-list" class="palette-list"></div>
      </form>
    </dialog>
    <script src="/assets/cytoscape.min.js"></script>
    <script src="/assets/home.js"></script>
  </body>
</html>`;
}

function renderPanel(panel: (typeof PANELS)[number]): string {
  return `<section class="panel${panel.id === "chat-panel" ? " active" : ""}" id="${panel.id}" aria-live="polite" data-panel="${panel.id}">
    <div class="panel-head">
      <div><div class="label">${icon(panel.icon)} ${panel.title}</div><p>${panel.subtitle}</p></div>
      <div class="actions">${panel.actions}</div>
    </div>
    <div class="value">${panel.body}</div>
    <div class="panel-body"></div>
  </section>`;
}

function button(iconName: IconName, id: string, label: string): string {
  return `<button id="${id}" type="button">${icon(iconName)}<span>${label}</span></button>`;
}

function icon(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}
