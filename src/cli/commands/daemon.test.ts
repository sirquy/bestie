import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../../runtime/paths.js";
import type { AppConfig } from "../../runtime/config.js";
import { runDaemonCommand, runServiceCommand } from "./daemon.js";

const TEST_CONFIG: AppConfig = {
  version: 2,
  agent: { name: "Bestie", ownerName: "Owner", language: "vi", timeZone: "Asia/Ho_Chi_Minh", toneIntensity: 7 },
  llm: {
      primary: "openai/test-model",
      authProfile: "openai:api-key",
      profiles: {
        "openai:api-key": {
          provider: "openai-compatible",
          mode: "api-key",
          baseUrl: "https://example.test/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      modelCatalog: {
        "openai/test-model": { profile: "openai:api-key" },
      }
    },
  channels: {
    telegram: { enabled: true, botTokenEnv: "BESTIE_TELEGRAM_BOT_TOKEN", ownerUserId: "1" },
    zalo: { enabled: true, botTokenEnv: "BESTIE_ZALO_BOT_TOKEN", ownerUserId: "2" },
  },
};

test("runDaemonCommand starts, reports, and stops the daemon", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4242, 5252];
  const runningPids = new Set<number>();

  try {
    const spawnProcess = ((_command: string, args: string[]) => {
      const pid = spawnedPids.shift();
      if (pid) runningPids.add(pid);
      return { pid, args, unref: () => undefined };
    }) as never;

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "start"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess,
      isProcessRunning: (pid) => runningPids.has(pid) && !killed.includes(pid),
      killProcess: (pid) => killed.push(pid),
    });

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number; args: string[]; logPath: string };
    const uiState = JSON.parse(await readFile(resolve(paths.appDir, "daemon-ui.json"), "utf8")) as { pid: number; args: string[]; logPath: string };
    assert.equal(state.pid, 4242);
    assert.equal(uiState.pid, 5252);
    assert.deepEqual(state.args.slice(-2), ["channels", "telegram"]);
    assert.deepEqual(uiState.args.slice(-2), ["ui", "--no-open"]);
    assert.equal(state.logPath, resolve(paths.logsDir, "daemon-telegram.log"));
    assert.equal(uiState.logPath, resolve(paths.logsDir, "daemon-ui.log"));
    assert.match(output.join("\n"), /Daemon Telegram .* pid 4242/);

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "status"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => runningPids.has(pid) });
    assert.match(output.at(-2) ?? "", /Daemon Telegram .* pid 4242/);

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "stop"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => runningPids.has(pid) && !killed.includes(pid), killProcess: (pid) => killed.push(pid) });
    assert.deepEqual(killed, [4242, 5252]);
    assert.match(output.join("\n"), /Daemon Telegram .* 4242/);
    assert.match(output.join("\n"), /Web UI .* 5252/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand can manage all runtime daemons", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4242, 4343, 4444, 4545];
  const runningPids = new Set<number>();

  try {
    const spawnProcess = ((_command: string, args: string[]) => {
      const pid = spawnedPids.shift();
      if (pid) runningPids.add(pid);
      return { pid, args, unref: () => undefined };
    }) as never;

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "start", "--channel", "all"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess,
      isProcessRunning: (pid) => runningPids.has(pid) && !killed.includes(pid),
      killProcess: (pid) => killed.push(pid),
    });

    const telegram = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number; args: string[]; logPath: string };
    const zalo = JSON.parse(await readFile(resolve(paths.appDir, "daemon-zalo.json"), "utf8")) as { pid: number; args: string[]; logPath: string };
    const cron = JSON.parse(await readFile(resolve(paths.appDir, "daemon-cron.json"), "utf8")) as { pid: number; args: string[]; logPath: string };
    const ui = JSON.parse(await readFile(resolve(paths.appDir, "daemon-ui.json"), "utf8")) as { pid: number; args: string[]; logPath: string };

    assert.equal(telegram.pid, 4242);
    assert.equal(zalo.pid, 4343);
    assert.equal(cron.pid, 4444);
    assert.equal(ui.pid, 4545);
    assert.deepEqual(telegram.args.slice(-2), ["channels", "telegram"]);
    assert.deepEqual(zalo.args.slice(-2), ["channels", "zalo"]);
    assert.deepEqual(cron.args.slice(-2), ["cron", "run"]);
    assert.deepEqual(ui.args.slice(-2), ["ui", "--no-open"]);
    assert.equal(telegram.logPath, resolve(paths.logsDir, "daemon-telegram.log"));
    assert.equal(zalo.logPath, resolve(paths.logsDir, "daemon-zalo.log"));
    assert.equal(cron.logPath, resolve(paths.logsDir, "daemon-cron.log"));
    assert.equal(ui.logPath, resolve(paths.logsDir, "daemon-ui.log"));

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "status", "--channel", "all"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => runningPids.has(pid) });
    assert.match(output.join("\n"), /Daemon Telegram .* pid 4242/);
    assert.match(output.join("\n"), /Daemon Zalo .* pid 4343/);
    assert.match(output.join("\n"), /Daemon Cron .* pid 4444/);

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "stop", "--channel", "all"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => runningPids.has(pid) && !killed.includes(pid), killProcess: (pid) => killed.push(pid) });
    assert.deepEqual(killed, [4242, 4343, 4444, 4545]);
    assert.match(output.join("\n"), /Daemon Telegram .* 4242/);
    assert.match(output.join("\n"), /Daemon Zalo .* 4343/);
    assert.match(output.join("\n"), /Daemon Cron .* 4444/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runServiceCommand uninstall ignores missing systemd units", async () => {
  const paths = await createTempPaths();
  const calls: string[][] = [];
  const output: string[] = [];

  try {
    await runServiceCommand({
      argv: ["node", "bestie", "service", "uninstall"],
      paths,
      platform: "linux",
      writeLine: (message) => output.push(message),
      execFile: async (_file, args) => {
        calls.push(args);
        if (args.includes("bestie-zalo.service")) {
          throw new Error("Failed to disable unit: Unit file bestie-zalo.service does not exist.");
        }
      },
    });

    assert.deepEqual(calls, [
      ["--user", "disable", "--now", "bestie.service"],
      ["--user", "disable", "--now", "bestie-telegram.service"],
      ["--user", "disable", "--now", "bestie-zalo.service"],
      ["--user", "disable", "--now", "bestie-cron.service"],
      ["--user", "daemon-reload"],
    ]);
    assert.match(output.join("\n"), /systemd user service/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand stops legacy Telegram daemon state", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(
      resolve(paths.appDir, "daemon.json"),
      `${JSON.stringify({ pid: 4242, command: process.execPath, args: ["/old/bestie", "channels", "telegram"], startedAt: new Date().toISOString(), logPath: resolve(paths.logsDir, "daemon.log") }, null, 2)}\n`,
      { mode: 0o600 },
    );

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "stop"],
      paths,
      writeLine: (message) => output.push(message),
      isProcessRunning: (pid) => pid === 4242 && !killed.includes(pid),
      killProcess: (pid) => killed.push(pid),
    });

    await assert.rejects(() => readFile(resolve(paths.appDir, "daemon.json"), "utf8"), /ENOENT/);
    assert.deepEqual(killed, [4242]);
    assert.match(output.join("\n"), /Daemon Telegram .* 4242/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand restarts the daemon", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4242, 5252, 4343, 5353];
  const runningPids = new Set<number>();

  try {
    const spawnProcess = (() => {
      const pid = spawnedPids.shift();
      if (pid) runningPids.add(pid);
      return { pid, unref: () => undefined };
    }) as never;

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "start"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess,
      isProcessRunning: (pid) => runningPids.has(pid),
      killProcess: (pid) => {
        killed.push(pid);
        runningPids.delete(pid);
      },
    });

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "restart"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess,
      isProcessRunning: (pid) => runningPids.has(pid),
      killProcess: (pid) => {
        killed.push(pid);
        runningPids.delete(pid);
      },
    });

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number; args: string[]; logPath: string };
    const uiState = JSON.parse(await readFile(resolve(paths.appDir, "daemon-ui.json"), "utf8")) as { pid: number };
    assert.equal(state.pid, 4343);
    assert.equal(uiState.pid, 5353);
    assert.deepEqual(killed, [4242, 5252]);
    assert.match(output.join("\n"), /Daemon Telegram .* 4242/);
    assert.match(output.join("\n"), /Daemon Telegram .* pid 4343/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand does not kill a reused stale daemon pid", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4343, 5353];

  try {
    await mkdir(paths.appDir, { recursive: true });
    await writeFile(
      resolve(paths.appDir, "daemon-telegram.json"),
      `${JSON.stringify({ pid: 4242, command: process.execPath, args: ["/old/bestie", "channels", "telegram"], startedAt: new Date().toISOString(), logPath: resolve(paths.logsDir, "daemon-telegram.log") }, null, 2)}\n`,
      { mode: 0o600 },
    );

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "restart"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess: (() => ({ pid: spawnedPids.shift(), unref: () => undefined })) as never,
      isProcessRunning: (pid) => pid === 4242 || pid === 4343 || pid === 5353,
      killProcess: (pid) => killed.push(pid),
      getProcessCommandLine: () => [process.execPath, "/unrelated/service"],
    });

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number };
    assert.equal(state.pid, 4343);
    assert.deepEqual(killed, []);
    assert.match(output.join("\n"), /daemon Telegram/);
    assert.match(output.join("\n"), /Daemon Telegram .* pid 4343/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand restarts when the old daemon exits before SIGTERM", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const spawnedPids = [4242, 5252, 4343, 5353];
  const runningPids = new Set<number>();

  try {
    const spawnProcess = (() => {
      const pid = spawnedPids.shift();
      if (pid) runningPids.add(pid);
      return { pid, unref: () => undefined };
    }) as never;

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "start"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess,
      isProcessRunning: (pid) => runningPids.has(pid),
    });

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "restart"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess,
      isProcessRunning: (pid) => runningPids.has(pid),
      killProcess: (pid) => {
        runningPids.delete(pid);
        const error = new Error("No such process") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      },
    });

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number };
    assert.equal(state.pid, 4343);
    assert.match(output.join("\n"), /Daemon Telegram .* 4242/);
    assert.match(output.join("\n"), /Daemon Telegram .* pid 4343/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand does not restart when the old daemon stays alive", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4242, 4343];

  try {
    const spawnProcess = (() => {
      const pid = spawnedPids.shift();
      return { pid, unref: () => undefined };
    }) as never;

    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "start"],
      paths,
      writeLine: (message) => output.push(message),
      spawnProcess,
      isProcessRunning: (pid) => pid === 4242 || pid === 4343,
      killProcess: (pid) => killed.push(pid),
    });

    await assert.rejects(
      runDaemonCommand({
        argv: ["node", "bestie", "daemon", "restart"],
        paths,
        writeLine: (message) => output.push(message),
        printUpdateNotice: async () => undefined,
        spawnProcess,
        isProcessRunning: (pid) => pid === 4242 || pid === 4343,
        killProcess: (pid) => killed.push(pid),
        stopTimeoutMs: 0,
      }),
      /Daemon pid 4242/
    );

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number };
    assert.equal(state.pid, 4242);
    assert.deepEqual(killed, [4242]);
    assert.deepEqual(spawnedPids, []);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runServiceCommand installs a user systemd service", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const calls: Array<{ file: string; args: string[] }> = [];
  const oldXdgConfigHome = process.env.XDG_CONFIG_HOME;

  try {
    process.env.XDG_CONFIG_HOME = resolve(paths.rootDir, "xdg-config");
    await writeTestConfig(paths, TEST_CONFIG);
    await writeFile(paths.envPath, "BESTIE_TELEGRAM_BOT_TOKEN=telegram\n", { mode: 0o600 });
    await runServiceCommand({
      argv: ["node", "bestie", "service", "install"],
      paths,
      platform: "linux",
      writeLine: (message) => output.push(message),
      execFile: async (file, args) => {
        calls.push({ file, args });
      },
    });

    const service = await readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie.service"), "utf8");
    assert.match(service, /Description=Bestie service runtime/);
    assert.match(service, /ExecStart=.* service run/);
    assert.match(service, /Restart=on-failure/);
    await assert.rejects(() => readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-telegram.service"), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-zalo.service"), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-cron.service"), "utf8"), /ENOENT/);
    assert.deepEqual(calls, [
      { file: "systemctl", args: ["--user", "daemon-reload"] },
      { file: "systemctl", args: ["--user", "enable", "--now", "bestie.service"] },
    ]);
    assert.match(output.join("\n"), /systemd user service/);
    assert.match(output.join("\n"), /Targets: Telegram, Cron/);
  } finally {
    if (oldXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = oldXdgConfigHome;
    }
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runServiceCommand uninstalls a user systemd service", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const calls: Array<{ file: string; args: string[] }> = [];
  const oldXdgConfigHome = process.env.XDG_CONFIG_HOME;

  try {
    process.env.XDG_CONFIG_HOME = resolve(paths.rootDir, "xdg-config");
    await mkdir(resolve(paths.rootDir, "xdg-config/systemd/user"), { recursive: true });
    await writeFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie.service"), "service", { mode: 0o600 });
    await writeFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-telegram.service"), "service", { mode: 0o600 });
    await writeFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-zalo.service"), "service", { mode: 0o600 });
    await writeFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-cron.service"), "service", { mode: 0o600 });

    await runServiceCommand({
      argv: ["node", "bestie", "service", "uninstall"],
      paths,
      platform: "linux",
      writeLine: (message) => output.push(message),
      execFile: async (file, args) => {
        calls.push({ file, args });
      },
    });

    await assert.rejects(() => readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie.service"), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-telegram.service"), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-zalo.service"), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(resolve(paths.rootDir, "xdg-config/systemd/user/bestie-cron.service"), "utf8"), /ENOENT/);
    assert.deepEqual(calls, [
      { file: "systemctl", args: ["--user", "disable", "--now", "bestie.service"] },
      { file: "systemctl", args: ["--user", "disable", "--now", "bestie-telegram.service"] },
      { file: "systemctl", args: ["--user", "disable", "--now", "bestie-zalo.service"] },
      { file: "systemctl", args: ["--user", "disable", "--now", "bestie-cron.service"] },
      { file: "systemctl", args: ["--user", "daemon-reload"] },
    ]);
    assert.match(output.join("\n"), /systemd user service/);
  } finally {
    if (oldXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = oldXdgConfigHome;
    }
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runServiceCommand installs and starts a Windows startup command", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const calls: Array<{ file: string; args: string[] }> = [];
  const oldAppData = process.env.APPDATA;

  try {
    process.env.APPDATA = resolve(paths.rootDir, "AppData", "Roaming");
    await runServiceCommand({
      argv: ["node", "bestie", "service", "install"],
      paths,
      platform: "win32",
      writeLine: (message) => output.push(message),
      execFile: async (file, args) => {
        calls.push({ file, args });
      },
    });

    const startupCommandPath = resolve(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Bestie.lnk");
    const startupIconPath = resolve(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Bestie.ico");
    assert.ok((await readFile(startupCommandPath)).length > 0);
    assert.ok((await readFile(startupIconPath)).length > 0);
    assert.deepEqual(calls, [{ file: process.execPath, args: [resolve(process.argv[1]), "daemon", "start", "--channel", "all"] }]);
    assert.match(output.join("\n"), /Windows startup command/);
  } finally {
    if (oldAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = oldAppData;
    }
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runServiceCommand manages Windows startup command lifecycle", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const calls: Array<{ file: string; args: string[] }> = [];
  const oldAppData = process.env.APPDATA;

  try {
    process.env.APPDATA = resolve(paths.rootDir, "AppData", "Roaming");
    const startupCommandPath = resolve(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Bestie.lnk");
    const startupIconPath = resolve(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Bestie.ico");
    await mkdir(dirname(startupCommandPath), { recursive: true });
    await writeFile(startupCommandPath, "old shortcut\n", { mode: 0o600 });

    const execFile = async (file: string, args: string[]) => {
      calls.push({ file, args });
    };

    await runServiceCommand({ argv: ["node", "bestie", "service", "status"], paths, platform: "win32", writeLine: (message) => output.push(message), execFile });
    await runServiceCommand({ argv: ["node", "bestie", "service", "restart"], paths, platform: "win32", writeLine: (message) => output.push(message), execFile });
    const restartedStartupCommand = await readFile(startupCommandPath);
    const restartedStartupIcon = await readFile(startupIconPath);
    await runServiceCommand({ argv: ["node", "bestie", "service", "uninstall"], paths, platform: "win32", writeLine: (message) => output.push(message), execFile });

    assert.deepEqual(calls, [
      { file: process.execPath, args: [resolve(process.argv[1]), "daemon", "restart", "--channel", "all"] },
      { file: process.execPath, args: [resolve(process.argv[1]), "daemon", "stop", "--channel", "all"] },
    ]);
    assert.ok(restartedStartupCommand.length > 0);
    assert.ok(restartedStartupIcon.length > 0);
    await assert.rejects(() => readFile(startupCommandPath, "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(startupIconPath, "utf8"), /ENOENT/);
    assert.match(output.join("\n"), /Windows startup command/);
    assert.match(output.join("\n"), /Restarted Bestie Windows startup runtime/);
  } finally {
    if (oldAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = oldAppData;
    }
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand stops orphan managed processes without state files", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const runningPids = new Set([1111, 2222, 3333, 4444]);
  const killed: number[] = [];

  try {
    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "stop", "--channel", "all"],
      paths,
      writeLine: (message) => output.push(message),
      listProcessCommandLines: () => [
        { pid: 1111, commandLine: "node C:\\Users\\quynp\\AppData\\Roaming\\npm\\node_modules\\bestie-agent\\dist\\cli\\index.js channels telegram" },
        { pid: 2222, commandLine: "node C:\\Users\\quynp\\AppData\\Roaming\\npm\\node_modules\\bestie-agent\\dist\\cli\\index.js channels zalo" },
        { pid: 3333, commandLine: "node C:\\Users\\quynp\\AppData\\Roaming\\npm\\node_modules\\bestie-agent\\dist\\cli\\index.js cron run" },
        { pid: 4444, commandLine: "node C:\\Users\\quynp\\AppData\\Roaming\\npm\\node_modules\\bestie-agent\\dist\\cli\\index.js ui --no-open" },
      ],
      isProcessRunning: (pid) => runningPids.has(pid),
      killProcess: (pid) => {
        killed.push(pid);
        runningPids.delete(pid);
      },
    });

    assert.deepEqual(killed.sort((left, right) => left - right), [1111, 2222, 3333, 4444]);
    assert.match(output.join("\n"), /orphan Bestie Telegram/);
    assert.match(output.join("\n"), /orphan Bestie Web UI/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runServiceCommand runs configured service targets in one runtime", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const channels: string[] = [];

  try {
    await writeTestConfig(paths, TEST_CONFIG);
    await writeFile(paths.envPath, "BESTIE_TELEGRAM_BOT_TOKEN=telegram\nBESTIE_ZALO_BOT_TOKEN=zalo\n", { mode: 0o600 });

    await runServiceCommand({
      argv: ["node", "bestie", "service", "run"],
      paths,
      writeLine: (message) => output.push(message),
      serviceRunner: async (channel) => {
        channels.push(channel);
      },
    });

    assert.deepEqual(channels, ["telegram", "zalo", "cron"]);
    assert.match(output.join("\n"), /Bestie service runtime .* Telegram, Zalo, Cron/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runServiceCommand restarts one systemd service", async () => {
  const paths = await createTempPaths();
  const calls: Array<{ file: string; args: string[] }> = [];
  const output: string[] = [];

  try {
    await runServiceCommand({
      argv: ["node", "bestie", "service", "restart"],
      paths,
      platform: "linux",
      writeLine: (message) => output.push(message),
      execFile: async (file, args) => {
        calls.push({ file, args });
      },
    });

    assert.deepEqual(calls, [{ file: "systemctl", args: ["--user", "restart", "bestie.service"] }]);
    assert.match(output.join("\n"), /Restarted Bestie systemd user service/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand rejects service lifecycle subcommands", async () => {
  const paths = await createTempPaths();

  try {
    await assert.rejects(
      () => runDaemonCommand({ argv: ["node", "bestie", "daemon", "install"], paths }),
      /bestie daemon start\|stop\|restart\|status/,
    );
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

async function createTempPaths(): Promise<RuntimePaths> {
  const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-daemon-command-test-"));
  const appDir = resolve(rootDir, ".bestie");
  const logsDir = resolve(appDir, "logs");
  const dataDir = resolve(appDir, "data");

  return {
    rootDir,
    appDir,
    configPath: resolve(appDir, "config.json"),
    envPath: resolve(appDir, ".env"),
    characterPath: resolve(appDir, "character.json"),
    systemPromptPath: resolve(appDir, "system-prompt.md"),
    logsDir,
    appLogPath: resolve(logsDir, "app.log"),
    dataDir,
    memoryDbPath: resolve(dataDir, "memory.sqlite"),
    workspaceDir: resolve(appDir, "workspace"),
  };
}

async function writeTestConfig(paths: RuntimePaths, config: AppConfig): Promise<void> {
  await mkdir(paths.appDir, { recursive: true });
  await writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
