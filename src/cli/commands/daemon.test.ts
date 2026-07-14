import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type { RuntimePaths } from "../../runtime/paths.js";
import { runDaemonCommand } from "./daemon.js";

test("runDaemonCommand starts, reports, and stops the daemon", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];

  try {
    await runDaemonCommand({
      argv: ["node", "bestie", "daemon", "start"],
      paths,
      writeLine: (message) => output.push(message),
      printUpdateNotice: async () => undefined,
      spawnProcess: (() => ({ pid: 4242, unref: () => undefined })) as never,
      isProcessRunning: (pid) => pid === 4242 && !killed.includes(pid),
      killProcess: (pid) => killed.push(pid),
    });

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number; args: string[]; logPath: string };
    assert.equal(state.pid, 4242);
    assert.deepEqual(state.args.slice(-2), ["channels", "telegram"]);
    assert.equal(state.logPath, resolve(paths.logsDir, "daemon-telegram.log"));
    assert.match(output.join("\n"), /Telegram daemon started with pid 4242/);

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "status"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => pid === 4242 });
    assert.match(output.at(-2) ?? "", /Telegram daemon is running with pid 4242/);

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "stop"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => pid === 4242 && !killed.includes(pid), killProcess: (pid) => killed.push(pid) });
    assert.deepEqual(killed, [4242]);
    assert.match(output.at(-1) ?? "", /Telegram daemon stopped: 4242/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand can manage all channel daemons", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4242, 4343];
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

    assert.equal(telegram.pid, 4242);
    assert.equal(zalo.pid, 4343);
    assert.deepEqual(telegram.args.slice(-2), ["channels", "telegram"]);
    assert.deepEqual(zalo.args.slice(-2), ["channels", "zalo"]);
    assert.equal(telegram.logPath, resolve(paths.logsDir, "daemon-telegram.log"));
    assert.equal(zalo.logPath, resolve(paths.logsDir, "daemon-zalo.log"));

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "status", "--channel", "all"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => runningPids.has(pid) });
    assert.match(output.join("\n"), /Telegram daemon is running with pid 4242/);
    assert.match(output.join("\n"), /Zalo daemon is running with pid 4343/);

    await runDaemonCommand({ argv: ["node", "bestie", "daemon", "stop", "--channel", "all"], paths, writeLine: (message) => output.push(message), isProcessRunning: (pid) => runningPids.has(pid) && !killed.includes(pid), killProcess: (pid) => killed.push(pid) });
    assert.deepEqual(killed, [4242, 4343]);
    assert.match(output.join("\n"), /Telegram daemon stopped: 4242/);
    assert.match(output.join("\n"), /Zalo daemon stopped: 4343/);
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
    assert.match(output.join("\n"), /Telegram daemon stopped: 4242/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand restarts the daemon", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4242, 4343];
  const runningPids = new Set([4242, 4343]);

  try {
    const spawnProcess = (() => {
      const pid = spawnedPids.shift();
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
    assert.equal(state.pid, 4343);
    assert.deepEqual(killed, [4242]);
    assert.match(output.join("\n"), /Telegram daemon stopped: 4242/);
    assert.match(output.join("\n"), /Telegram daemon started with pid 4343/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand does not kill a reused stale daemon pid", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const killed: number[] = [];
  const spawnedPids = [4343];

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
      isProcessRunning: (pid) => pid === 4242 || pid === 4343,
      killProcess: (pid) => killed.push(pid),
      getProcessCommandLine: () => [process.execPath, "/unrelated/service"],
    });

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number };
    assert.equal(state.pid, 4343);
    assert.deepEqual(killed, []);
    assert.match(output.join("\n"), /state was stale/);
    assert.match(output.join("\n"), /Telegram daemon started with pid 4343/);
  } finally {
    await rm(paths.rootDir, { recursive: true, force: true });
  }
});

test("runDaemonCommand restarts when the old daemon exits before SIGTERM", async () => {
  const paths = await createTempPaths();
  const output: string[] = [];
  const spawnedPids = [4242, 4343];
  const runningPids = new Set([4242, 4343]);

  try {
    const spawnProcess = (() => ({ pid: spawnedPids.shift(), unref: () => undefined })) as never;

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
    assert.match(output.join("\n"), /Telegram daemon stopped: 4242/);
    assert.match(output.join("\n"), /Telegram daemon started with pid 4343/);
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
      /Daemon pid 4242 did not stop/
    );

    const state = JSON.parse(await readFile(resolve(paths.appDir, "daemon-telegram.json"), "utf8")) as { pid: number };
    assert.equal(state.pid, 4242);
    assert.deepEqual(killed, [4242]);
    assert.deepEqual(spawnedPids, [4343]);
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
