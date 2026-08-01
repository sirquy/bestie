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
  { id: "chat-panel", icon: "message", nav: "Trò chuyện", title: "Trò chuyện", subtitle: "Phiên agent cục bộ với tools, ngữ cảnh trí nhớ và fallback provider.", actions: `${button("check", "chat-send", "Gửi")}${button("refresh", "chat-retry", "Thử lại")}${button("refresh", "chat-clear", "Xóa")}`, body: "Sẵn sàng trò chuyện." },
  { id: "doctor-panel", icon: "shield", nav: "Kiểm tra", title: "Doctor", subtitle: "Kiểm tra trạng thái cục bộ và sửa lỗi an toàn.", actions: button("wrench", "doctor-fix", "Chạy sửa lỗi an toàn"), body: "Đang tải chẩn đoán..." },
  { id: "provider-panel", icon: "plug", nav: "Provider", title: "Trung tâm Provider", subtitle: "Model chính, fallback, thiết lập và kiểm tra kết nối nhanh.", actions: `${button("activity", "provider-test", "Kiểm tra model chính")}${button("refresh", "provider-refresh", "Làm mới")}`, body: "Đang tải provider..." },
  { id: "character-panel", icon: "user", nav: "Nhân vật", title: "Studio Nhân vật", subtitle: "Chỉnh character JSON và system prompt ngay trên máy.", actions: `${button("check", "character-save", "Lưu nhân vật")}${button("refresh", "character-reload", "Tải lại")}`, body: "Đang tải nhân vật..." },
  { id: "memory-panel", icon: "database", nav: "Trí nhớ", title: "Trung tâm Trí nhớ", subtitle: "Tìm trí nhớ đã lưu và duyệt các ghi nhớ đang chờ.", actions: button("refresh", "memory-refresh", "Làm mới"), body: "Đang tải trí nhớ..." },
  { id: "knowledge-panel", icon: "brain", nav: "Đồ thị", title: "Đồ thị Tri thức", subtitle: "Kiểm tra entity, relation và gợi ý review đồ thị cục bộ.", actions: button("refresh", "knowledge-refresh", "Làm mới"), body: "Đang tải đồ thị..." },
  { id: "channel-panel", icon: "globe", nav: "Kênh", title: "Trung tâm Kênh", subtitle: "Telegram, Zalo, trạng thái daemon và cron schedules.", actions: `${button("refresh", "channel-refresh", "Làm mới")}${button("terminal", "channel-stop-cron", "Dừng cron")}${button("activity", "cron-toggle", "Bật/tắt cron đầu tiên")}`, body: "Đang tải kênh..." },
  { id: "approvals-panel", icon: "key", nav: "Phê duyệt", title: "Phê duyệt", subtitle: "Các quyết định quyền đang chờ với lớp thực thi được bảo vệ.", actions: `${button("refresh", "approvals-refresh", "Làm mới")}${button("check", "approval-approve", "Duyệt mục đầu")}${button("shield", "approval-deny", "Từ chối mục đầu")}`, body: "Đang tải phê duyệt..." },
  { id: "mcp-panel", icon: "brain", nav: "MCP", title: "Trung tâm MCP", subtitle: "Server, transport, auth metadata và tools đã cấu hình.", actions: button("refresh", "mcp-refresh", "Làm mới"), body: "Đang tải MCP..." },
  { id: "tools-panel", icon: "terminal", nav: "Tools", title: "Tools & Quyền", subtitle: "Chính sách tool nội bộ và ranh giới workspace.", actions: button("refresh", "tools-refresh", "Làm mới"), body: "Đang tải tools..." },
  { id: "skills-panel", icon: "layers", nav: "Skills", title: "Quản lý Skills", subtitle: "Tạo, sửa, kiểm tra và xóa skills cục bộ trong .bestie.", actions: `${button("layers", "skill-new", "Skill mới")}${button("check", "skill-save", "Lưu skill")}${button("refresh", "skills-refresh", "Làm mới")}`, body: "Đang tải skills..." },
  { id: "settings-panel", icon: "sliders", nav: "Cài đặt", title: "Cài đặt", subtitle: "Thiết lập agent và trí nhớ có rủi ro thấp.", actions: `${button("refresh", "settings-refresh", "Làm mới")}${button("sliders", "settings-tone", "Tone +1")}`, body: "Đang tải cài đặt..." },
];

export function renderHomePage(): string {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#171c62">
    <title>Bestie UI</title>
    <link rel="icon" href="/assets/bestie-app-icon.ico" sizes="any">
    <link rel="icon" href="/assets/bestie-app-icon.png" type="image/png">
    <link rel="apple-touch-icon" href="/assets/bestie-app-icon.png">
    <link rel="manifest" href="/manifest.webmanifest">
    <style>${HOME_PAGE_STYLES}</style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar" aria-label="Điều hướng Bestie">
        <div class="brand"><span class="brand-mark"><img src="/assets/bestie-app-icon.png" alt="" loading="eager"></span><span class="brand-copy"><strong>Bestie</strong><small>Bảng điều khiển cục bộ</small></span></div>
        <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-pressed="false" aria-label="Thu gọn sidebar">${icon("sliders")}<span>Gọn</span></button>
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
        <div class="label">Xác nhận thao tác</div>
        <div class="value" id="confirm-title">Tiếp tục?</div>
        <p id="confirm-message">Thao tác này thay đổi trạng thái Bestie cục bộ.</p>
        <div class="actions"><button value="cancel" type="submit">Hủy</button><button value="confirm" type="submit">Xác nhận</button></div>
      </form>
    </dialog>
    <dialog id="input-dialog">
      <form method="dialog" class="confirm-card">
        <div class="label" id="input-label">Nhập liệu</div>
        <div class="value" id="input-title">Nhập giá trị</div>
        <input id="input-value" autocomplete="off">
        <p id="input-message">Thao tác này cập nhật trạng thái Bestie cục bộ.</p>
        <div class="actions"><button value="cancel" type="submit">Hủy</button><button id="input-confirm" value="confirm" type="submit">Lưu</button></div>
      </form>
    </dialog>
    <dialog id="chat-import-dialog">
      <form method="dialog" class="confirm-card import-card">
        <div class="label">Nhập chat</div>
        <div class="value">Dán hoặc chọn file JSON đã xuất</div>
        <div class="import-tabs"><button class="active" data-import-tab="paste" type="button">Dán</button><button data-import-tab="file" type="button">File</button></div>
        <textarea id="chat-import-text" placeholder="Dán JSON chat đã xuất" spellcheck="false"></textarea>
        <input id="chat-import-file" type="file" accept="application/json,.json">
        <p id="chat-import-preview">Đang chờ JSON đã xuất.</p>
        <div class="actions"><button value="cancel" type="submit">Hủy</button><button id="chat-import-confirm" value="confirm" type="button" disabled>Nhập JSON</button></div>
      </form>
    </dialog>
    <dialog id="chat-export-dialog">
      <form method="dialog" class="confirm-card import-card">
        <div class="label">Xuất chat</div>
        <div class="value" id="chat-export-title">Phiên hiện tại</div>
        <div class="import-tabs"><button class="active" data-export-format="json" type="button">JSON</button><button data-export-format="markdown" type="button">Markdown</button></div>
        <textarea id="chat-export-preview" readonly spellcheck="false"></textarea>
        <p id="chat-export-summary">Đang chờ dữ liệu xuất.</p>
        <div class="actions"><button value="cancel" type="submit">Đóng</button><button id="chat-export-copy" type="button">Sao chép</button><button id="chat-export-download" type="button">Tải xuống</button></div>
      </form>
    </dialog>
    <dialog id="command-palette-dialog">
      <form method="dialog" class="confirm-card palette-card">
        <div class="label">Bảng lệnh</div>
        <input id="command-palette-input" placeholder="Tìm lệnh Chat" autocomplete="off">
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
