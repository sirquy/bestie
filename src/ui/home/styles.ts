export const HOME_PAGE_STYLES = `:root {
  --ink: #eef6ed;
  --muted: #9cae9d;
  --paper: #131b17;
  --paper-soft: rgba(20, 29, 24, 0.82);
  --rail: #0b110e;
  --gold: #e0b257;
  --green: #64d487;
  --teal: #5ed4c4;
  --red: #ff8b8b;
  --amber: #f0b35d;
  --line: rgba(238, 246, 237, 0.13);
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
  --chat-font: Aptos, "Segoe UI", "Trebuchet MS", Verdana, sans-serif;
  color: var(--ink);
  background: #0d1411;
  font-family: Georgia, "Times New Roman", serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(900px 520px at 18% 8%, rgba(224, 178, 87, 0.16), transparent 62%),
    radial-gradient(720px 460px at 82% 10%, rgba(94, 212, 196, 0.13), transparent 58%),
    linear-gradient(120deg, rgba(100, 212, 135, 0.12), transparent 34%),
    repeating-linear-gradient(90deg, rgba(238, 246, 237, 0.035) 0 1px, transparent 1px 32px),
    #0d1411;
}
button {
  align-items: center;
  background: #e8f2e6;
  border: 1px solid rgba(232, 242, 230, 0.16);
  border-radius: 6px;
  color: #0d1411;
  cursor: pointer;
  display: inline-flex;
  font: 700 0.78rem "Trebuchet MS", Verdana, sans-serif;
  gap: 6px;
  min-height: 32px;
  padding: 6px 8px;
}
button:hover { background: #ffffff; transform: translateY(-1px); }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
button[value="cancel"] { background: transparent; color: var(--ink); }
input, select, textarea {
  background: rgba(10, 16, 13, 0.78);
  border: 1px solid rgba(238, 246, 237, 0.18);
  border-radius: 6px;
  color: var(--ink);
  font: 0.88rem "Trebuchet MS", Verdana, sans-serif;
  padding: 8px;
  width: 100%;
}
input[type="range"] { accent-color: var(--green); padding: 0; }
textarea { min-height: 160px; resize: vertical; }
label { color: #c8d8c8; font: 800 0.74rem "Trebuchet MS", Verdana, sans-serif; text-transform: uppercase; }
.icon { display: inline-block; fill: none; flex: 0 0 auto; height: 15px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; width: 15px; }
.shell { display: grid; grid-template-columns: 250px 1fr; min-height: 100vh; transition: grid-template-columns 180ms ease; }
body.sidebar-compact .shell { grid-template-columns: 72px 1fr; }
.sidebar {
  background:
    linear-gradient(180deg, rgba(224, 178, 87, 0.1), transparent 32%),
    var(--rail);
  color: var(--paper);
  padding: 24px 18px;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand { align-items: center; display: flex; font-weight: 700; gap: 10px; margin-bottom: 28px; }
.brand strong, .brand small { display: block; }
.brand strong { color: var(--ink); }
.brand small { color: rgba(238, 246, 237, 0.62); font: 800 0.68rem "Trebuchet MS", Verdana, sans-serif; text-transform: uppercase; }
.brand-mark { background: var(--gold); border-radius: 7px; color: var(--ink); display: inline-grid; height: 38px; place-items: center; width: 38px; }
.brand-mark .icon { height: 20px; width: 20px; }
.sidebar-toggle { background: rgba(238, 246, 237, 0.08); color: var(--ink); margin: 0 0 14px; width: 100%; }
.sidebar-toggle:hover { background: rgba(238, 246, 237, 0.16); color: var(--ink); }
nav { display: grid; gap: 6px; }
nav a { align-items: center; border: 1px solid transparent; border-radius: 7px; color: #dceadc; display: flex; font: 700 0.9rem "Trebuchet MS", Verdana, sans-serif; gap: 10px; padding: 9px 10px; text-decoration: none; }
nav a:hover, nav a.active { background: rgba(238, 246, 237, 0.12); border-color: rgba(238, 246, 237, 0.14); color: var(--ink); }
nav a.active { box-shadow: inset 3px 0 0 var(--gold); }
body.sidebar-compact .sidebar { padding: 24px 12px; }
body.sidebar-compact .brand { justify-content: center; margin-bottom: 18px; }
body.sidebar-compact .brand-copy, body.sidebar-compact nav a span, body.sidebar-compact .sidebar-toggle span { display: none; }
body.sidebar-compact nav a, body.sidebar-compact .sidebar-toggle { justify-content: center; padding: 9px; }
main { display: grid; gap: 20px; padding: 34px; }
.eyebrow, .label { align-items: center; color: var(--muted); display: inline-flex; font: 800 0.74rem "Trebuchet MS", Verdana, sans-serif; gap: 7px; letter-spacing: 0; margin: 0 0 8px; text-transform: uppercase; }
h1 { font-size: clamp(1.6rem, 4vw, 2.4rem); line-height: 1; margin: 0; }
.panel {
  background: var(--paper-soft);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
}
.value { font: 700 1rem "Trebuchet MS", Verdana, sans-serif; overflow-wrap: anywhere; }
.subvalue { color: var(--muted); font: 0.78rem/1.25 "Trebuchet MS", Verdana, sans-serif; margin-top: 2px; }
.panel-grid { display: block; }
.panel { display: none; min-height: 520px; padding: 20px; }
.panel.active { display: block; }
.panel-head { align-items: start; display: flex; gap: 12px; justify-content: space-between; }
.panel-head p { color: var(--muted); font: 0.88rem/1.4 "Trebuchet MS", Verdana, sans-serif; margin: 0; max-width: 430px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.panel-body { display: grid; gap: 10px; margin-top: 14px; position: relative; }
.control-grid { align-items: end; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.preset-row, .slider-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
.segmented { background: rgba(8, 13, 11, 0.42); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 8px; display: grid; gap: 4px; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 4px; }
.segmented button { background: transparent; color: var(--muted); justify-content: center; min-height: 28px; padding: 5px 7px; }
.segmented button.active { background: rgba(238, 246, 237, 0.12); color: var(--ink); }
.segment { display: none; }
.segment.active { display: grid; gap: 10px; }
.stack { display: grid; gap: 8px; }
.hidden { display: none !important; }
.notice { background: rgba(94, 212, 196, 0.1); border: 1px solid rgba(94, 212, 196, 0.24); border-radius: 6px; color: #b8fff3; font: 0.84rem/1.35 "Trebuchet MS", Verdana, sans-serif; padding: 9px; }
.row { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
.pill-row { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-start; min-width: 0; }
.row span:first-child { align-items: center; display: inline-flex; gap: 8px; }
.row { border-top: 1px solid rgba(238, 246, 237, 0.1); font: 0.88rem/1.35 "Trebuchet MS", Verdana, sans-serif; padding-top: 8px; }
.action-row, .approval-row, .memory-row, .knowledge-row, .path-row, .tool-policy-row { align-items: center; border-top: 1px solid rgba(238, 246, 237, 0.1); display: grid; font: 0.88rem/1.35 "Trebuchet MS", Verdana, sans-serif; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; padding-top: 8px; }
.action-row span:last-child:not(.pill), .approval-row span:last-child:not(.pill), .memory-row span:last-child:not(.pill), .knowledge-row span:last-child:not(.pill) { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.action-row strong, .approval-row strong, .memory-row strong, .knowledge-row strong, .tool-policy-row strong { font-weight: 800; overflow-wrap: anywhere; }
.tool-policy-select { align-items: end; display: grid; gap: 4px; min-width: 116px; text-transform: uppercase; }
.tool-policy-select span { color: var(--muted); font-size: 0.62rem; }
.tool-policy-select select { background: rgba(238, 246, 237, 0.08); border-color: rgba(238, 246, 237, 0.16); color: var(--ink); font-weight: 800; min-height: 32px; padding: 6px 28px 6px 8px; text-transform: uppercase; }
.tool-policy-select select option { background: #e8f2e6; color: #0d1411; }
.mcp-server-card { background: rgba(8, 13, 11, 0.38); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 8px; display: grid; gap: 10px; padding: 12px; }
.mcp-server-head { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
.mcp-server-head strong { font: 800 1rem "Trebuchet MS", Verdana, sans-serif; }
.summary-strip { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
.summary-strip span { background: rgba(8, 13, 11, 0.44); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 6px; display: grid; gap: 2px; padding: 10px; }
.summary-strip strong { font: 800 1rem "Trebuchet MS", Verdana, sans-serif; overflow-wrap: anywhere; }
.summary-strip small { color: var(--muted); font: 800 0.66rem "Trebuchet MS", Verdana, sans-serif; text-transform: uppercase; }
.tool-section { background: rgba(8, 13, 11, 0.34); border: 1px solid rgba(238, 246, 237, 0.08); border-radius: 8px; display: grid; gap: 8px; padding: 12px; }
details.tool-section summary { cursor: pointer; }
.cron-card { border-top: 1px solid rgba(238, 246, 237, 0.1); display: grid; gap: 8px; padding-top: 8px; }
.cron-card .action-row { border-top: 0; padding-top: 0; }
.knowledge-map-shell { min-height: 100vh; position: relative; overflow: hidden; }
.knowledge-map-overlay { background: rgba(13, 20, 17, 0.84); border: 1px solid rgba(238, 246, 237, 0.12); border-radius: 8px; display: grid; gap: 5px; left: 10px; max-width: min(760px, calc(100% - 20px)); padding: 6px; position: absolute; top: 10px; z-index: 10; }
.knowledge-map-overlay-head { align-items: center; display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
.knowledge-map-overlay-head .pill { margin-right: auto; }
.knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-overlay { max-width: min(360px, calc(100% - 20px)); width: auto; }
.knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-overlay-head { flex-wrap: nowrap; }
.knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-overlay-head button span { display: none; }
.knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-summary, .knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-segments, .knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-toolbar, .knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-legend { display: none; }
.knowledge-map-summary { grid-template-columns: repeat(4, minmax(64px, 1fr)); }
.knowledge-map-overlay .knowledge-map-summary span { gap: 0; padding: 5px 7px; }
.knowledge-map-overlay .knowledge-map-summary strong { font-size: 0.86rem; }
.knowledge-map-overlay .knowledge-map-summary small { font-size: 0.58rem; }
.panel-body > .knowledge-map-summary { background: rgba(13, 20, 17, 0.82); border: 1px solid rgba(238, 246, 237, 0.12); border-radius: 8px; padding: 8px; }
#knowledge-panel[data-active-segment="knowledge-map"] .panel-body > .knowledge-map-summary { display: none; }
.knowledge-map-segments { grid-template-columns: repeat(4, minmax(0, 1fr)); }
#knowledge-panel[data-active-segment="knowledge-map"] .panel-body > .knowledge-map-segments { display: none; }
.knowledge-map-overlay .knowledge-map-segments { padding: 3px; }
.knowledge-map-overlay .knowledge-map-segments button { min-height: 25px; padding: 3px 6px; }
.knowledge-map-toolbar { align-items: center; display: grid; gap: 5px; grid-template-columns: 1fr; margin: 0; position: relative; z-index: 1; }
.knowledge-map-actions, .knowledge-map-filters, .knowledge-map-views, .knowledge-map-cluster { align-items: center; display: flex; flex-wrap: wrap; gap: 5px; }
.knowledge-map-actions { justify-content: flex-end; }
.knowledge-map-actions:first-child { justify-content: flex-start; }
.knowledge-map-views { display: grid; grid-template-columns: minmax(120px, 1fr) auto auto; }
.knowledge-map-views select { font-size: 0.78rem; min-height: 27px; min-width: 0; padding: 4px 26px 4px 7px; }
.knowledge-map-cluster { display: grid; grid-template-columns: repeat(3, minmax(112px, 1fr)); }
.knowledge-map-cluster select { font-size: 0.78rem; min-height: 27px; min-width: 0; padding: 4px 26px 4px 7px; }
.knowledge-map-search { align-items: center; display: grid; gap: 5px; grid-template-columns: minmax(130px, 1.2fr) minmax(150px, 1fr) auto auto; }
.knowledge-map-search input, .knowledge-map-search select { font-size: 0.78rem; min-height: 27px; padding-bottom: 4px; padding-top: 4px; }
.knowledge-focus-toggle { align-items: center; background: rgba(238, 246, 237, 0.07); border: 1px solid rgba(238, 246, 237, 0.12); border-radius: 6px; color: var(--ink); display: inline-flex; gap: 5px; justify-content: center; min-height: 27px; padding: 4px 7px; text-transform: none; }
.knowledge-focus-toggle input { margin: 0; padding: 0; width: auto; }
.knowledge-map-filters { display: grid; grid-template-columns: repeat(3, minmax(96px, 1fr)) auto; justify-content: stretch; }
.knowledge-map-filters select { font-size: 0.78rem; min-height: 27px; min-width: 0; padding: 4px 26px 4px 7px; }
.knowledge-legend { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin: 0; position: relative; z-index: 1; }
.knowledge-legend span { align-items: center; color: var(--muted); display: inline-flex; font: 800 0.64rem/1 "Trebuchet MS", Verdana, sans-serif; gap: 4px; text-transform: uppercase; }
.knowledge-legend i { border-radius: 999px; display: inline-block; height: 9px; width: 9px; }
.knowledge-legend i.person { background: #e0b257; }
.knowledge-legend i.project { background: #64d487; }
.knowledge-legend i.preference { background: #f0b35d; }
.knowledge-legend i.topic { background: #8aa8ff; }
.knowledge-detail-layout { align-items: start; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) minmax(250px, 0.42fr); }
.knowledge-review-toolbar { display: grid; gap: 10px; margin-bottom: 12px; }
.knowledge-canvas { background: rgba(8, 13, 11, 0.34); border: 1px solid rgba(238, 246, 237, 0.09); border-radius: 8px; min-height: 100vh; overflow: hidden; padding: 10px; position: relative; width: 100%; }
.knowledge-cytoscape { height: 100vh; min-height: 640px; outline: none; width: 100%; }
.knowledge-cytoscape canvas { outline: none; }
.knowledge-svg { display: block; height: min(48vh, 440px); min-height: 320px; width: 100%; }
.knowledge-provenance-overlay { background: rgba(13, 20, 17, 0.9); border: 1px solid rgba(238, 246, 237, 0.14); border-radius: 8px; bottom: 12px; box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28); display: grid; gap: 8px; left: 12px; max-height: min(48vh, 440px); max-width: min(460px, calc(100% - 24px)); overflow: auto; padding: 10px; position: absolute; z-index: 12; }
.knowledge-provenance-overlay:empty, .knowledge-provenance-overlay.is-empty { display: none; }
.knowledge-provenance-head { align-items: start; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; }
.knowledge-provenance-head .value { font-size: 0.96rem; line-height: 1.2; }
.knowledge-provenance-grid { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.knowledge-provenance-grid .row { gap: 4px; min-height: 0; padding: 7px; }
.knowledge-provenance-grid .row .pill { max-width: 100%; text-align: left; white-space: normal; }
.knowledge-provenance-overlay .knowledge-timeline { gap: 5px; padding: 8px; }
.knowledge-provenance-overlay .knowledge-timeline-row { gap: 6px; }
.knowledge-provenance-overlay .knowledge-timeline-row strong { font-size: 0.72rem; }
.knowledge-provenance-overlay .subvalue { font-size: 0.72rem; line-height: 1.25; }
.knowledge-provenance-actions { padding-top: 0; }
.knowledge-drawer { background: rgba(13, 20, 17, 0.96); border: 1px solid rgba(238, 246, 237, 0.12); border-radius: 8px; bottom: 10px; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34); display: grid; gap: 10px; max-width: min(420px, calc(100% - 20px)); overflow: hidden; padding: 12px; position: absolute; right: 10px; top: 10px; transform: translateX(calc(100% + 24px)); transition: transform 160ms ease, opacity 160ms ease; width: 390px; z-index: 30; opacity: 0; pointer-events: none; }
.knowledge-map-shell[data-knowledge-drawer="list"] .knowledge-drawer, .knowledge-map-shell[data-knowledge-drawer="inspector"] .knowledge-drawer { opacity: 1; pointer-events: auto; transform: translateX(0); }
.knowledge-drawer-head { align-items: center; border-bottom: 1px solid rgba(238, 246, 237, 0.09); display: flex; gap: 10px; justify-content: space-between; padding-bottom: 8px; position: relative; z-index: 31; }
.knowledge-drawer-head button { position: relative; z-index: 32; }
.knowledge-drawer-view { min-height: 0; overflow: auto; }
.knowledge-map-shell[data-knowledge-drawer="inspector"] .knowledge-drawer-list, .knowledge-map-shell[data-knowledge-drawer="list"] .knowledge-drawer-inspector, .knowledge-map-shell[data-knowledge-drawer="closed"] .knowledge-drawer-list { display: none; }
.knowledge-edge, .knowledge-node, .knowledge-row[data-knowledge-select] { cursor: pointer; }
.knowledge-edge line { stroke: rgba(238, 246, 237, 0.24); stroke-width: 1.4; }
.knowledge-edge text { fill: #b7cabc; font: 700 11px "Trebuchet MS", Verdana, sans-serif; paint-order: stroke; stroke: rgba(8, 13, 11, 0.86); stroke-width: 4px; text-anchor: middle; }
.knowledge-edge:focus line, .knowledge-edge.selected line { stroke: var(--gold); stroke-width: 2.6; }
.knowledge-node circle { fill: rgba(94, 212, 196, 0.18); stroke: var(--teal); stroke-width: 2; }
.knowledge-node.person circle { fill: rgba(224, 178, 87, 0.18); stroke: var(--gold); }
.knowledge-node.project circle { fill: rgba(100, 212, 135, 0.18); stroke: var(--green); }
.knowledge-node.preference circle { fill: rgba(240, 179, 93, 0.18); stroke: var(--amber); }
.knowledge-node text { fill: var(--ink); font: 800 12px "Trebuchet MS", Verdana, sans-serif; text-anchor: middle; }
.knowledge-node:focus circle, .knowledge-node.selected circle { stroke-width: 3.4; }
.knowledge-row { background: rgba(8, 13, 11, 0.2); border-radius: 6px; padding: 8px; }
.knowledge-row.selected { background: rgba(94, 212, 196, 0.12); border-color: rgba(94, 212, 196, 0.34); }
.knowledge-inspector { background: rgba(8, 13, 11, 0.36); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 8px; display: grid; gap: 8px; max-height: none; overflow: visible; padding: 12px; }
.knowledge-inspector .value { font-size: 1rem; line-height: 1.25; }
.knowledge-timeline { background: rgba(238, 246, 237, 0.04); border: 1px solid rgba(238, 246, 237, 0.08); border-radius: 8px; display: grid; gap: 8px; padding: 10px; }
.knowledge-timeline-row { display: grid; gap: 8px; grid-template-columns: 10px minmax(0, 1fr); }
.knowledge-timeline-row .dot { background: rgba(238, 246, 237, 0.28); border-radius: 999px; height: 8px; margin-top: 5px; width: 8px; }
.knowledge-timeline-row .dot.good { background: var(--green); }
.knowledge-timeline-row .dot.warn { background: var(--amber); }
.knowledge-timeline-row strong { font: 800 0.8rem/1.2 "Trebuchet MS", Verdana, sans-serif; }
.knowledge-impact .row .pill, .knowledge-trust-details .row .pill { max-width: 100%; text-align: left; white-space: normal; }
.knowledge-trust-row .pill { min-width: 48px; justify-content: center; }
.inline-actions { justify-content: start; }
.chat-layout { display: grid; gap: 10px; grid-template-columns: minmax(230px, 300px) minmax(0, 1fr) auto minmax(180px, 260px); height: min(62vh, 620px); min-height: 420px; }
.chat-layout.chat-side-hidden { grid-template-columns: minmax(230px, 300px) minmax(0, 1fr) auto; }
.chat-sessions, .chat-transcript, .chat-side { background: rgba(8, 13, 11, 0.34); border: 1px solid rgba(238, 246, 237, 0.08); border-radius: 8px; display: grid; gap: 8px; padding: 12px; }
.chat-sessions, .chat-side, .chat-transcript { min-height: 0; overflow: auto; }
.chat-sessions { align-content: start; gap: 7px; overflow-x: hidden; padding: 10px; }
.chat-layout.chat-side-hidden .chat-side { display: none; }
.chat-side-toggle { align-self: start; background: rgba(238, 246, 237, 0.08); color: var(--ink); min-height: 34px; padding: 7px 9px; position: sticky; top: 0; writing-mode: vertical-rl; }
.chat-side-toggle:hover { background: rgba(94, 212, 196, 0.16); color: #c9fff8; transform: none; }
.chat-session-tools { align-items: center; border-bottom: 1px solid rgba(238, 246, 237, 0.09); display: flex; gap: 8px; justify-content: space-between; padding-bottom: 8px; }
.chat-session-tools strong { font: 800 0.78rem "Trebuchet MS", Verdana, sans-serif; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.chat-session-tools span { display: grid; gap: 4px; grid-template-columns: repeat(5, 28px); }
.chat-session-tools button { background: rgba(238, 246, 237, 0.08); border-color: rgba(238, 246, 237, 0.1); color: var(--ink); display: grid; height: 28px; min-height: 28px; padding: 0; place-items: center; width: 28px; }
.chat-session-tools button:hover { background: rgba(94, 212, 196, 0.16); color: #c9fff8; transform: none; }
.chat-session-tools .icon { height: 15px; width: 15px; }
.chat-transcript { align-content: start; display: flex; flex-direction: column; gap: 10px; min-height: 0; min-width: 0; padding: 14px; }
.chat-message { display: flex; gap: 4px; min-width: 0; padding: 0; }
.chat-message.user { justify-content: flex-end; }
.chat-message.assistant { justify-content: flex-start; }
.chat-bubble { border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 8px; display: grid; font-family: var(--chat-font); gap: 8px; max-width: min(82%, 760px); min-width: 0; overflow: hidden; overflow-wrap: anywhere; padding: 12px 14px; word-break: break-word; }
.chat-message.user .chat-bubble { background: rgba(230, 180, 84, 0.16); border-color: rgba(230, 180, 84, 0.28); }
.chat-message.assistant .chat-bubble { background: rgba(94, 212, 196, 0.11); border-color: rgba(94, 212, 196, 0.22); }
.chat-message.source-highlight .chat-bubble { border-color: rgba(230, 180, 84, 0.82); box-shadow: 0 0 0 2px rgba(230, 180, 84, 0.2), 0 12px 28px rgba(230, 180, 84, 0.12); }
.chat-bubble-wrapper { align-items: start; display: grid; gap: 6px; max-width: 100%; min-width: 0; }
.chat-message.user .chat-bubble-wrapper { justify-items: end; }
.chat-message.assistant .chat-bubble-wrapper { justify-items: start; }
.chat-bubble-wrapper .chat-message-meta { margin-top: 0; }
.chat-message-head { align-items: center; display: flex; gap: 8px; justify-content: space-between; min-height: 28px; min-width: 0; }
.chat-message-meta { align-items: center; color: var(--muted); display: flex; flex-wrap: wrap; font: 800 0.66rem var(--chat-font); gap: 6px; text-transform: uppercase; }
.chat-message-meta span:not(.pill) { align-items: center; background: rgba(238, 246, 237, 0.055); border: 1px solid rgba(238, 246, 237, 0.08); border-radius: 999px; display: inline-flex; gap: 4px; max-width: 100%; min-height: 22px; overflow: hidden; padding: 3px 7px; text-overflow: ellipsis; white-space: nowrap; }
.chat-message-meta .icon { height: 13px; width: 13px; }
.chat-message-meta .pill { font-size: 0.62rem; min-height: 22px; padding: 3px 7px; }
.message-menu { position: relative; }
.message-menu summary { align-items: center; border-radius: 999px; color: var(--muted); cursor: pointer; display: inline-grid; height: 28px; list-style: none; place-items: center; width: 28px; }
.message-menu summary::-webkit-details-marker { display: none; }
.message-menu summary:hover { background: rgba(238, 246, 237, 0.08); color: var(--ink); }
.message-menu-popover { background: #e8f2e6; border: 1px solid rgba(13, 20, 17, 0.14); border-radius: 7px; box-shadow: 0 16px 36px rgba(0, 0, 0, 0.28); display: grid; gap: 2px; min-width: 124px; padding: 4px; position: absolute; right: 0; top: 32px; z-index: 6; }
.message-menu:not([open]) .message-menu-popover { display: none; }
.message-menu-item { background: transparent; border: 0; color: #0d1411; justify-content: flex-start; min-height: 30px; padding: 6px 8px; width: 100%; }
.message-menu-item:hover { background: rgba(13, 20, 17, 0.08); transform: none; }
.message-menu-item span { font-size: 0.72rem; }
.chat-message.user strong, .chat-message.assistant strong { font: 800 0.74rem var(--chat-font); text-transform: uppercase; }
.chat-message.user strong { color: #f0c779; }
.chat-message.assistant strong { color: #8fe4d8; }
.chat-message.streaming { opacity: 0.82; }
.markdown-body { color: #f3f8f1; font: 0.94rem/1.58 var(--chat-font); max-width: 100%; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.markdown-body p, .markdown-body ul, .markdown-body pre, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body .code-block { margin: 0 0 10px; }
.markdown-body p:last-child, .markdown-body ul:last-child, .markdown-body pre:last-child, .markdown-body h2:last-child, .markdown-body h3:last-child, .markdown-body h4:last-child, .markdown-body .code-block:last-child { margin-bottom: 0; }
.markdown-body ul { padding-left: 18px; }
.markdown-body .code-block { background: rgba(6, 11, 9, 0.44); border: 1px solid rgba(238, 246, 237, 0.12); border-radius: 6px; max-width: 100%; min-width: 0; overflow: hidden; }
.markdown-body .code-block pre { background: transparent; border: 0; border-radius: 0; margin: 0; max-width: 100%; min-width: 0; overflow-x: auto; padding: 12px; }
.copy-code { align-items: center; background: rgba(238, 246, 237, 0.08); border: 0; border-bottom: 1px solid rgba(238, 246, 237, 0.1); border-radius: 0; color: var(--muted); display: flex; font: 800 0.68rem "Trebuchet MS", Verdana, sans-serif; justify-content: flex-end; min-height: 28px; padding: 5px 9px; text-transform: uppercase; width: 100%; }
.copy-code:hover { background: rgba(94, 212, 196, 0.12); color: var(--teal); }
.markdown-body code { background: rgba(8, 13, 11, 0.48); border-radius: 4px; color: #f6d28b; font: 0.86em "Courier New", monospace; max-width: 100%; overflow-wrap: anywhere; padding: 1px 4px; white-space: normal; word-break: break-word; }
.markdown-body pre code { background: transparent; display: block; min-width: max-content; padding: 0; white-space: pre; word-break: normal; }
.chat-session-row { background: rgba(238, 246, 237, 0.08); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 7px; color: var(--ink); display: grid; gap: 5px; grid-template-columns: minmax(0, 1fr) auto; padding: 7px; text-align: left; width: 100%; }
.chat-session-row.active { background: rgba(94, 212, 196, 0.16); border-color: rgba(94, 212, 196, 0.32); }
.chat-session-open { background: transparent; border: 0; border-radius: 4px; color: var(--ink); display: grid; gap: 2px; justify-items: start; min-height: 0; padding: 2px; text-align: left; width: 100%; }
.chat-session-open:hover { background: rgba(238, 246, 237, 0.06); }
.chat-session-row span { color: var(--muted); font: 0.72rem "Trebuchet MS", Verdana, sans-serif; }
.pin-session { align-self: start; font-size: 0.68rem; min-height: 24px; padding: 3px 7px; }
.chat-session-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.chat-session-badges .pill { font-size: 0.62rem; padding: 3px 6px; }
.chat-search { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.chat-search input, .chat-search select { min-height: 32px; padding: 7px 8px; }
.branch-stack { display: grid; gap: 6px; }
.branch-row { background: rgba(238, 246, 237, 0.07); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 6px; color: var(--ink); display: grid; gap: 2px; justify-items: start; min-height: 0; padding: 8px; text-align: left; width: 100%; }
.branch-row:hover { background: rgba(94, 212, 196, 0.12); border-color: rgba(94, 212, 196, 0.26); }
.branch-row.muted { color: var(--muted); }
.branch-row span { color: var(--muted); font: 800 0.62rem "Trebuchet MS", Verdana, sans-serif; text-transform: uppercase; }
.branch-row strong { font: 800 0.84rem "Trebuchet MS", Verdana, sans-serif; overflow-wrap: anywhere; }
.branch-row small { color: var(--muted); font: 0.72rem "Trebuchet MS", Verdana, sans-serif; }
.timeline-row { border-top: 1px solid rgba(238, 246, 237, 0.1); padding-top: 8px; }
.timeline-row summary { align-items: center; cursor: pointer; display: grid; gap: 8px; grid-template-columns: auto minmax(0, 1fr); list-style: none; }
.timeline-row summary::-webkit-details-marker { display: none; }
.timeline-row strong { display: block; font: 800 0.82rem "Trebuchet MS", Verdana, sans-serif; overflow-wrap: anywhere; }
.timeline-detail { margin-left: 0; padding: 6px 0 0 0; }
.timeline-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.inspector-stack { display: grid; gap: 8px; }
.inspector-stack button { justify-content: center; width: 100%; }
.chat-composer { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) auto auto; }
.composer-field { background: rgba(8, 13, 11, 0.34); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 8px; display: grid; gap: 6px; padding: 8px; }
.composer-toolbar, .composer-tools { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; justify-content: space-between; }
.composer-toolbar span { color: var(--muted); font: 800 0.68rem var(--chat-font); text-transform: uppercase; }
.composer-toolbar #chat-composer-status { color: #8fe4d8; }
.chat-composer textarea { background: transparent; border: 0; font-family: var(--chat-font); font-size: 0.95rem; line-height: 1.45; max-height: 156px; min-height: 42px; overflow-y: auto; padding: 4px 2px; }
.chat-composer textarea:focus-visible { outline: 0; }
.attachment-preview { display: flex; flex-wrap: wrap; gap: 6px; }
.attachment-chip { align-items: center; background: rgba(94, 212, 196, 0.1); border: 1px solid rgba(94, 212, 196, 0.22); border-radius: 999px; color: #dff6f1; display: inline-flex; font: 800 0.7rem var(--chat-font); gap: 5px; max-width: 100%; padding: 4px 6px 4px 8px; }
.attachment-chip button { background: transparent; border: 0; color: var(--muted); min-height: 22px; padding: 2px; }
.attachment-chip button:hover { background: rgba(238, 246, 237, 0.1); color: var(--ink); transform: none; }
.composer-tools { justify-content: flex-start; }
.composer-tools button { background: rgba(238, 246, 237, 0.08); color: var(--ink); min-height: 30px; padding: 5px 8px; }
.composer-tools button:hover { background: rgba(238, 246, 237, 0.14); }
.check { align-items: center; display: flex; gap: 8px; min-height: 36px; }
.check input { width: auto; }
.pill { background: rgba(238, 246, 237, 0.1); border-radius: 999px; color: #d8e6d8; display: inline-block; font: 800 0.72rem "Trebuchet MS", Verdana, sans-serif; justify-self: end; max-width: 100%; min-width: 0; overflow: hidden; padding: 4px 8px; text-overflow: ellipsis; text-transform: uppercase; vertical-align: top; white-space: nowrap; width: fit-content; }
.mcp-chip { max-width: min(100%, 220px); }
.mcp-tool-chip { max-width: min(100%, 180px); }
.pill.good { background: rgba(22, 101, 52, 0.14); color: var(--green); }
.pill.warn { background: rgba(180, 83, 9, 0.16); color: var(--amber); }
.pill.bad { background: rgba(153, 27, 27, 0.14); color: var(--red); }
.toast {
  background: #e8f2e6;
  border-radius: 8px;
  bottom: 18px;
  box-shadow: 0 18px 42px rgba(24, 35, 29, 0.22);
  color: #0d1411;
  font: 800 0.86rem "Trebuchet MS", Verdana, sans-serif;
  opacity: 0;
  padding: 12px 14px;
  pointer-events: none;
  position: fixed;
  right: 18px;
  transform: translateY(10px);
  transition: opacity 160ms ease, transform 160ms ease;
  z-index: 20;
}
.toast.show { opacity: 1; transform: translateY(0); }
.toast.good { background: var(--green); }
.toast.warn { background: var(--amber); }
.toast.bad { background: var(--red); }
dialog { background: transparent; border: 0; padding: 0; }
dialog::backdrop { background: rgba(24, 35, 29, 0.44); }
.confirm-card {
  background: #121b16;
  border: 1px solid rgba(238, 246, 237, 0.16);
  border-radius: 8px;
  box-shadow: 0 22px 68px rgba(24, 35, 29, 0.24);
  display: grid;
  gap: 12px;
  max-width: 420px;
  padding: 18px;
}
.confirm-card .value { color: var(--ink); }
.confirm-card p { color: var(--muted); font: 0.92rem/1.4 "Trebuchet MS", Verdana, sans-serif; margin: 0; }
.import-card { max-width: min(720px, calc(100vw - 32px)); width: 680px; }
.import-card textarea { min-height: 260px; resize: vertical; }
.import-card textarea[readonly] { background: rgba(8, 13, 11, 0.54); color: #e8f2e6; }
.import-card input[type="file"] { display: none; }
.import-card.file-mode input[type="file"], #chat-import-dialog.file-mode input[type="file"] { display: block; }
.import-tabs { background: rgba(8, 13, 11, 0.4); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 7px; display: grid; gap: 4px; grid-template-columns: 1fr 1fr; padding: 4px; }
.import-tabs button { background: transparent; border-color: transparent; justify-content: center; }
.import-tabs button.active { background: rgba(94, 212, 196, 0.14); border-color: rgba(94, 212, 196, 0.28); color: var(--teal); }
#chat-import-preview, #chat-export-summary { background: rgba(238, 246, 237, 0.07); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 6px; padding: 10px; }
.palette-card { max-width: min(620px, calc(100vw - 32px)); width: 560px; }
.palette-card input { font-size: 1rem; min-height: 46px; }
.palette-list { display: grid; gap: 6px; max-height: min(420px, 56vh); overflow: auto; }
.palette-row { background: rgba(238, 246, 237, 0.07); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 7px; color: var(--ink); display: grid; gap: 3px; justify-items: start; padding: 10px; text-align: left; width: 100%; }
.palette-row.active, .palette-row:hover { background: rgba(94, 212, 196, 0.14); border-color: rgba(94, 212, 196, 0.3); }
.palette-row strong { font: 800 0.94rem "Trebuchet MS", Verdana, sans-serif; }
.palette-row span { color: var(--muted); font: 0.78rem "Trebuchet MS", Verdana, sans-serif; }
.skills-layout { display: grid; gap: 12px; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); min-height: min(68vh, 680px); }
.skills-rail, .skill-editor { background: rgba(8, 13, 11, 0.34); border: 1px solid rgba(238, 246, 237, 0.08); border-radius: 8px; min-width: 0; padding: 12px; }
.skills-rail { align-content: start; display: grid; gap: 10px; }
.skills-rail-head, .skill-editor-head { align-items: start; display: flex; gap: 10px; justify-content: space-between; }
.skills-rail-head strong, .skill-editor-head strong { display: block; font: 800 1rem "Trebuchet MS", Verdana, sans-serif; overflow-wrap: anywhere; }
.skills-rail-head button, .skill-editor-actions button { background: rgba(238, 246, 237, 0.08); color: var(--ink); min-height: 32px; padding: 6px 8px; }
.skill-editor-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.skill-search { display: grid; gap: 6px; }
.skill-search span { color: var(--muted); }
.skill-list { display: grid; gap: 7px; max-height: min(520px, 58vh); overflow: auto; padding-right: 2px; }
.skill-row { background: rgba(238, 246, 237, 0.07); border-color: rgba(238, 246, 237, 0.1); color: var(--ink); display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; justify-items: stretch; min-height: 0; padding: 10px; text-align: left; width: 100%; }
.skill-row.active, .skill-row:hover { background: rgba(94, 212, 196, 0.14); border-color: rgba(94, 212, 196, 0.3); transform: none; }
.skill-row-main { display: grid; gap: 4px; min-width: 0; }
.skill-row strong { font: 800 0.92rem "Trebuchet MS", Verdana, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-row small { color: var(--muted); display: -webkit-box; font: 0.76rem/1.35 "Trebuchet MS", Verdana, sans-serif; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.skill-row .pill { align-self: start; max-width: 78px; }
.skill-empty { background: rgba(238, 246, 237, 0.06); border: 1px dashed rgba(238, 246, 237, 0.16); border-radius: 8px; color: var(--muted); display: grid; gap: 4px; padding: 14px; }
.skill-empty strong { color: var(--ink); font: 800 0.92rem "Trebuchet MS", Verdana, sans-serif; }
.skill-editor { align-content: start; gap: 12px; }
.skill-content-label textarea { font: 0.88rem/1.5 "Courier New", monospace; min-height: min(50vh, 520px); }
.skill-help { background: rgba(224, 178, 87, 0.1); border: 1px solid rgba(224, 178, 87, 0.18); border-radius: 7px; color: #f4deb0; display: grid; font: 0.82rem/1.4 "Trebuchet MS", Verdana, sans-serif; gap: 4px; padding: 10px; }
.notice.compact { font-size: 0.78rem; overflow-wrap: anywhere; }
@media (max-width: 920px) {
  .shell { grid-template-columns: 1fr; }
  body.sidebar-compact .shell { grid-template-columns: 1fr; }
  .sidebar { height: auto; position: static; }
  body.sidebar-compact .sidebar { padding: 24px 18px; }
  body.sidebar-compact .brand { justify-content: start; margin-bottom: 28px; }
  body.sidebar-compact .brand-copy, body.sidebar-compact nav a span, body.sidebar-compact .sidebar-toggle span { display: block; }
  body.sidebar-compact nav a, body.sidebar-compact .sidebar-toggle { justify-content: start; padding: 9px 10px; }
  nav { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .chat-layout, .chat-layout.chat-side-hidden { grid-template-columns: 1fr; }
  .knowledge-detail-layout { grid-template-columns: 1fr; }
  .knowledge-map-toolbar { grid-template-columns: 1fr; }
  .knowledge-map-actions, .knowledge-legend { justify-content: flex-start; }
  .knowledge-map-views { grid-template-columns: minmax(0, 1fr) auto auto; }
  .knowledge-map-cluster { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .knowledge-map-search { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto; }
  .knowledge-map-filters { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; justify-content: stretch; }
  .knowledge-map-overlay { top: 10px; }
  .knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-overlay { max-width: min(360px, calc(100% - 20px)); }
  .knowledge-drawer { top: 10px; width: 360px; }
  .knowledge-cytoscape { height: 100vh; min-height: 560px; }
  .knowledge-svg { height: 360px; }
  .chat-layout { height: auto; max-height: none; }
  .chat-side-toggle { justify-content: center; position: static; writing-mode: horizontal-tb; }
  .chat-transcript { min-height: 360px; }
  .skills-layout { grid-template-columns: 1fr; min-height: 0; }
  .skill-list { max-height: 280px; }
}
@media (max-width: 560px) {
  main { padding: 20px; }
  nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .panel-head { display: grid; }
  .actions { justify-content: start; }
  .chat-composer { grid-template-columns: 1fr; }
  .knowledge-map-actions, .knowledge-map-filters, .knowledge-map-views, .knowledge-map-cluster { width: 100%; }
  .knowledge-map-views { grid-template-columns: 1fr auto auto; }
  .knowledge-map-cluster { grid-template-columns: 1fr; }
  .knowledge-map-search { grid-template-columns: 1fr; width: 100%; }
  .knowledge-map-overlay { left: 8px; max-width: calc(100% - 16px); right: 8px; top: 8px; }
  .knowledge-map-overlay-head { justify-content: flex-start; }
  .knowledge-map-overlay-head .pill { margin-right: 0; }
  .knowledge-map-shell[data-knowledge-overlay="collapsed"] .knowledge-map-overlay { max-width: calc(100% - 16px); right: auto; }
  .knowledge-map-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .knowledge-map-filters { grid-template-columns: 1fr; }
  .knowledge-map-filters select { min-width: 0; width: 100%; }
  .knowledge-canvas { min-height: 100svh; }
  .knowledge-cytoscape { height: 100svh; min-height: 560px; }
  .knowledge-drawer { bottom: 10px; left: 10px; max-height: min(58vh, 420px); max-width: none; right: 10px; top: auto; transform: translateY(calc(100% + 24px)); width: auto; }
  .knowledge-map-shell[data-knowledge-drawer="list"] .knowledge-drawer, .knowledge-map-shell[data-knowledge-drawer="inspector"] .knowledge-drawer { transform: translateY(0); }
  .knowledge-svg { height: 280px; min-height: 260px; }
  .knowledge-row { grid-template-columns: 1fr; }
  .skills-rail-head, .skill-editor-head { display: grid; }
  .skill-editor-actions { justify-content: start; }
}`;
