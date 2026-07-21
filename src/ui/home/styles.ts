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
  font: 700 0.82rem "Trebuchet MS", Verdana, sans-serif;
  gap: 7px;
  min-height: 36px;
  padding: 8px 10px;
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
.icon { display: inline-block; fill: none; flex: 0 0 auto; height: 17px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; width: 17px; }
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
.topbar {
  align-items: center;
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
  min-height: 74px;
}
.eyebrow, .label { align-items: center; color: var(--muted); display: inline-flex; font: 800 0.74rem "Trebuchet MS", Verdana, sans-serif; gap: 7px; letter-spacing: 0; margin: 0 0 8px; text-transform: uppercase; }
h1 { font-size: clamp(1.6rem, 4vw, 2.4rem); line-height: 1; margin: 0; }
.runtime-card, .metric-card, .panel {
  background: var(--paper-soft);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
}
.runtime-card { min-height: 74px; padding: 14px; }
.metric-grid { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(160px, 1fr)); }
.metric-card { align-items: center; display: grid; gap: 10px; grid-template-columns: 84px minmax(0, 1fr); min-height: 58px; padding: 10px 12px; position: relative; overflow: hidden; }
.metric-card::after { background: linear-gradient(180deg, var(--gold), var(--teal)); bottom: 10px; content: ""; left: 0; opacity: 0.86; position: absolute; top: 10px; width: 3px; }
.value { font: 700 1rem "Trebuchet MS", Verdana, sans-serif; overflow-wrap: anywhere; }
.subvalue { color: var(--muted); font: 0.78rem/1.25 "Trebuchet MS", Verdana, sans-serif; margin-top: 2px; }
.panel-grid { display: block; }
.panel { display: none; min-height: 520px; padding: 20px; }
.panel.active { display: block; }
.panel-head { align-items: start; display: flex; gap: 12px; justify-content: space-between; }
.panel-head p { color: var(--muted); font: 0.88rem/1.4 "Trebuchet MS", Verdana, sans-serif; margin: 0; max-width: 430px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.panel-body { display: grid; gap: 10px; margin-top: 14px; }
.control-grid { align-items: end; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.preset-row, .slider-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
.segmented { background: rgba(8, 13, 11, 0.42); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 8px; display: grid; gap: 4px; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 4px; }
.segmented button { background: transparent; color: var(--muted); justify-content: center; min-height: 32px; }
.segmented button.active { background: rgba(238, 246, 237, 0.12); color: var(--ink); }
.segment { display: none; }
.segment.active { display: grid; gap: 10px; }
.stack { display: grid; gap: 8px; }
.hidden { display: none !important; }
.notice { background: rgba(94, 212, 196, 0.1); border: 1px solid rgba(94, 212, 196, 0.24); border-radius: 6px; color: #b8fff3; font: 0.84rem/1.35 "Trebuchet MS", Verdana, sans-serif; padding: 9px; }
.row, .pill-row { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
.row span:first-child { align-items: center; display: inline-flex; gap: 8px; }
.row { border-top: 1px solid rgba(238, 246, 237, 0.1); font: 0.88rem/1.35 "Trebuchet MS", Verdana, sans-serif; padding-top: 8px; }
.action-row, .approval-row, .memory-row, .path-row, .tool-policy-row { align-items: center; border-top: 1px solid rgba(238, 246, 237, 0.1); display: grid; font: 0.88rem/1.35 "Trebuchet MS", Verdana, sans-serif; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; padding-top: 8px; }
.action-row span:last-child, .approval-row span:last-child, .memory-row span:last-child { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.action-row strong, .approval-row strong, .memory-row strong, .tool-policy-row strong { font-weight: 800; }
.mcp-server-card { background: rgba(8, 13, 11, 0.38); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 8px; display: grid; gap: 10px; padding: 12px; }
.mcp-server-head { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
.mcp-server-head strong { font: 800 1rem "Trebuchet MS", Verdana, sans-serif; }
.summary-strip { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
.summary-strip span { background: rgba(8, 13, 11, 0.44); border: 1px solid rgba(238, 246, 237, 0.1); border-radius: 6px; display: grid; gap: 2px; padding: 10px; }
.summary-strip strong { font: 800 1.08rem "Trebuchet MS", Verdana, sans-serif; overflow-wrap: anywhere; }
.summary-strip small { color: var(--muted); font: 800 0.7rem "Trebuchet MS", Verdana, sans-serif; text-transform: uppercase; }
.tool-section { background: rgba(8, 13, 11, 0.34); border: 1px solid rgba(238, 246, 237, 0.08); border-radius: 8px; display: grid; gap: 8px; padding: 12px; }
.check { align-items: center; display: flex; gap: 8px; min-height: 36px; }
.check input { width: auto; }
.pill { background: rgba(238, 246, 237, 0.1); border-radius: 999px; color: #d8e6d8; font: 800 0.72rem "Trebuchet MS", Verdana, sans-serif; padding: 4px 8px; text-transform: uppercase; }
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
.confirm-card p { color: var(--muted); font: 0.92rem/1.4 "Trebuchet MS", Verdana, sans-serif; margin: 0; }
@media (max-width: 920px) {
  .shell { grid-template-columns: 1fr; }
  body.sidebar-compact .shell { grid-template-columns: 1fr; }
  .sidebar { height: auto; position: static; }
  body.sidebar-compact .sidebar { padding: 24px 18px; }
  body.sidebar-compact .brand { justify-content: start; margin-bottom: 28px; }
  body.sidebar-compact .brand-copy, body.sidebar-compact nav a span, body.sidebar-compact .sidebar-toggle span { display: block; }
  body.sidebar-compact nav a, body.sidebar-compact .sidebar-toggle { justify-content: start; padding: 9px 10px; }
  nav { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .topbar { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  main { padding: 20px; }
  nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-grid { grid-template-columns: 1fr; }
  .panel-head { display: grid; }
  .actions { justify-content: start; }
}`;
