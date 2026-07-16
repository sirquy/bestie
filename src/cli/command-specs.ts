import { runChannelsCommand } from "./commands/channels.js";
import { runChatCommand } from "./commands/chat.js";
import { runCronCommand } from "./commands/cron.js";
import { runDaemonCommand } from "./commands/daemon.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runLogsCommand } from "./commands/logs.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runMemoryCommand } from "./commands/memory.js";
import { runOnboardCommand } from "./commands/onboard.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runStatusCommand } from "./commands/status.js";
import { runToolsCommand } from "./commands/tools.js";
import { runUpdateCommand } from "./commands/update.js";
import { runVoiceCommand } from "./commands/voice.js";
import type { CliCommandSpec } from "./command-router.js";

export const cliHelpDetails = `
Tùy chọn onboard:
  --skip-provider-test  Lưu file local mà không gọi provider đã cấu hình

Tùy chọn doctor:
  --json  In chẩn đoán dạng máy đọc được
  --fix  Sửa các vấn đề an toàn về filesystem, quyền, và SQLite local
  --telegram-connect  Kiểm tra danh tính bot Telegram đã bật bằng network call
  --zalo-connect  Kiểm tra danh tính bot Zalo đã bật bằng network call
  --telegram-speech-test  Tạo và chuyển đổi một mẫu voice Telegram local

Tùy chọn MCP:
  Chạy bestie mcp --help để xem lệnh MCP server.

Tùy chọn kênh:
  Chạy bestie channels --help để xem channel adapter và chẩn đoán.

Tùy chọn daemon:
  start [--channel telegram|zalo|cron|all]    Khởi động runtime daemon trong nền
  stop [--channel telegram|zalo|cron|all]     Dừng runtime daemon
  restart [--channel telegram|zalo|cron|all]  Dừng rồi khởi động lại runtime daemon
  status [--channel telegram|zalo|cron|all]   Xem trạng thái runtime daemon
  install                                    Cài và khởi động user systemd service
  uninstall                                  Dừng và gỡ user systemd service

Tùy chọn tools:
  logs --lines N  Đọc log app đã redact gần đây qua permission gate
  memories --limit N  Đọc memory local đang active qua permission gate
  attachments cleanup --older-than 7d --kinds voice,audio --confirm
    Xóa file attachment Telegram cũ; bỏ --confirm để chạy thử

Tùy chọn update:
  --apply  Chạy npm install -g bestie-agent@latest sau khi tìm thấy bản mới

Tùy chọn cron:
  list           Liệt kê toàn bộ lịch cron
  add            Tạo lịch cron mới (interactive hoặc dùng --name --type --schedule --prompt)
  remove <id>    Xóa lịch cron theo ID
  toggle <id>    Bật/tắt một lịch cron
  logs [id]      Xem log chạy cron gần đây
  run            Chạy scheduler cron cho tới khi bị dừng

Tùy chọn voice:
  setup-local       Cấu hình transcription local bằng whisper.cpp
  setup-elevenlabs  Cấu hình speech và transcription bằng ElevenLabs
  models            Liệt kê model whisper.cpp local
  download-model    Tải một model whisper.cpp local
`;

export const cliCommandSpecs: CliCommandSpec[] = [
  { name: "onboard", description: "Tạo cấu hình .bestie và file tính cách local", handler: runOnboardCommand },
  { name: "chat", description: "Bắt đầu chat terminal sau khi onboard", handler: runChatCommand },
  { name: "status", description: "Xem trạng thái thiết lập local", handler: runStatusCommand },
  {
    name: "daemon",
    description: "Khởi động, dừng, kiểm tra, hoặc cài daemon nền local",
    handler: runDaemonCommand,
    children: [
      { name: "start", description: "Khởi động runtime daemon", handler: runDaemonCommand },
      { name: "stop", description: "Dừng runtime daemon", handler: runDaemonCommand },
      { name: "restart", description: "Khởi động lại runtime daemon", handler: runDaemonCommand },
      { name: "status", description: "Xem trạng thái runtime daemon", handler: runDaemonCommand },
      { name: "install", description: "Cài và khởi động user systemd service", handler: runDaemonCommand },
      { name: "uninstall", description: "Dừng và gỡ user systemd service", handler: runDaemonCommand },
      { name: "install-service", description: "Alias của install", handler: runDaemonCommand, hidden: true },
      { name: "uninstall-service", description: "Alias của uninstall", handler: runDaemonCommand, hidden: true },
    ],
  },
  { name: "logs", description: "Xem log vận hành gần đây đã redact", handler: runLogsCommand },
  { name: "doctor", description: "Chẩn đoán vấn đề thiết lập local", handler: runDoctorCommand },
  { name: "memory", description: "Xem hoặc thêm memory local thủ công", handler: runMemoryCommand },
  {
    name: "mcp",
    description: "Liệt kê, xem, phân loại, hoặc gọi MCP server đã cấu hình",
    handler: runMcpCommand,
    children: [
      { name: "list", description: "Liệt kê MCP server đã cấu hình mà không khởi động", handler: runMcpCommand },
      { name: "show <name>", description: "Xem một MCP server, không in giá trị env", handler: runMcpCommand },
      { name: "test <name>", description: "Kiểm tra cấu hình, hoặc thêm --connect để khởi động ngắn", handler: runMcpCommand },
      { name: "tools <name>", description: "Liệt kê metadata tool; thêm --connect để khởi động server", handler: runMcpCommand },
      { name: "classify <server> <tool>", description: "Cập nhật phân loại tool MCP local", handler: runMcpCommand },
      { name: "call <server> <tool>", description: "Gọi tool MCP read-only qua permission gate", handler: runMcpCommand },
    ],
  },
  createChannelsCommandSpec("channels", false),
  createChannelsCommandSpec("channel", true),
  { name: "skills", description: "Liệt kê skill đã cài từ .bestie/skills", handler: runSkillsCommand },
  { name: "tools", description: "Chạy tool local qua permission gate", handler: runToolsCommand },
  {
    name: "voice",
    description: "Cấu hình voice input và speech output dùng chung",
    handler: runVoiceCommand,
    children: [
      { name: "setup-local", description: "Cấu hình transcription local bằng whisper.cpp", handler: runVoiceCommand },
      { name: "setup-elevenlabs", description: "Cấu hình hỗ trợ voice bằng ElevenLabs", handler: runVoiceCommand },
      { name: "models", description: "Liệt kê model whisper.cpp local", handler: runVoiceCommand },
      { name: "download-model <model>", description: "Tải model whisper.cpp local", handler: runVoiceCommand },
    ],
  },
  {
    name: "cron",
    description: "Quản lý cron job đã lên lịch cho agent",
    handler: runCronCommand,
    children: [
      { name: "list", description: "Liệt kê toàn bộ lịch cron", handler: runCronCommand },
      { name: "add", description: "Tạo lịch cron", handler: runCronCommand },
      { name: "remove <id>", description: "Xóa lịch cron", handler: runCronCommand },
      { name: "toggle <id>", description: "Bật/tắt lịch cron", handler: runCronCommand },
      { name: "logs [id]", description: "Xem log chạy cron", handler: runCronCommand },
      { name: "run", description: "Chạy scheduler cron cho tới khi bị dừng", handler: runCronCommand },
    ],
  },
  { name: "update", description: "Kiểm tra bản Bestie mới trên npm, hoặc cài bằng --apply", handler: runUpdateCommand },
];

function createChannelsCommandSpec(name: "channel" | "channels", hidden: boolean): CliCommandSpec {
  return {
    name,
    description: hidden ? "Alias của channels" : "Khởi động, cấu hình, hoặc kiểm tra channel adapter",
    handler: runChannelsCommand,
    hidden,
    children: [
      { name: "list", description: "Xem kênh đã cấu hình và trạng thái daemon", handler: runChannelsCommand },
      { name: "status", description: "Alias của list", handler: runChannelsCommand },
      { name: "doctor", description: "Chạy chẩn đoán tập trung vào kênh", handler: runChannelsCommand },
      {
        name: "telegram",
        description: "Khởi động hoặc cấu hình channel adapter Telegram",
        handler: runChannelsCommand,
        children: [
          { name: "setup", description: "Cấu hình Telegram owner id/username và bot token", handler: runChannelsCommand },
          { name: "whoami", description: "Xem id và username từ tin nhắn Telegram bot gần nhất", handler: runChannelsCommand },
          { name: "voice", description: "Alias cho lệnh voice dùng chung", handler: runChannelsCommand },
        ],
      },
      {
        name: "zalo",
        description: "Khởi động hoặc cấu hình channel adapter Zalo",
        handler: runChannelsCommand,
        children: [{ name: "setup", description: "Cấu hình Zalo owner id và bot token", handler: runChannelsCommand }],
      },
    ],
  };
}
