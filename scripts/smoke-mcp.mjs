import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const rootDir = await mkdtemp(resolve(tmpdir(), "bestie-mcp-smoke-"));
const cliPath = resolve(process.env.INIT_CWD ?? process.cwd(), "dist/cli/index.js");

try {
  await runCli(["onboard", "--skip-provider-test"], "Bestie\nBoss\nvi\nUTC\n7\nask\nopenai-compatible\nhttp://127.0.0.1:9/v1\ntest-model\ntest-key\n");

  const emptyList = await runCli(["mcp", "list"]);
  assertIncludes(emptyList.stdout, "No MCP servers configured");

  await updateConfig({ servers: [{ name: "dry-run", enabled: false, command: "node", args: ["server.js"], env: { SECRET_TOKEN: "hidden" } }] });
  assertIncludes((await runCli(["mcp", "list"])).stdout, "dry-run  [DISABLED]");
  assertIncludes((await runCli(["mcp", "show", "dry-run"])).stdout, "Env keys       SECRET_TOKEN");
  assertIncludes((await runCli(["mcp", "test", "dry-run"])).stdout, "WARN");

  await writeFile(
    resolve(rootDir, "fake-mcp.mjs"),
    `process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.trim().split(/\\r?\\n/)) {
    if (line.length === 0) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");
    }
    if (request.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "read_file", description: "Read a local file", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] } }) + "\\n");
    }
    if (request.method === "tools/call") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "read " + request.params.arguments.path }] } }) + "\\n");
    }
  }
});
`,
  );
  await updateConfig({ servers: [{ name: "fake", enabled: true, command: process.execPath, args: ["fake-mcp.mjs"], env: { SECRET_TOKEN: "hidden" } }] });
  assertIncludes((await runCli(["mcp", "test", "fake", "--connect"])).stdout, "PASS");
  assertIncludes((await runCli(["mcp", "tools", "fake", "--connect"])).stdout, "- read_file: Read a local file");
  assertIncludes((await runCli(["mcp", "classify", "fake", "read_file", "--category", "read"])).stdout, "classified as read");
  assertIncludes((await runCli(["mcp", "show", "fake"])).stdout, "Tools          read_file(read)");
  assertIncludes((await runCli(["mcp", "call", "fake", "read_file", "--read", "--json", '{"path":"README.md"}'])).stdout, "read README.md");
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

async function runCli(args, input = undefined) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: rootDir, env: { ...process.env, BESTIE_NO_BANNER: "1", HOME: rootDir }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${args.join(" ")}`));
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`Command failed (${code}): ${args.join(" ")}\n${stdout}${stderr}`));
      }
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

async function updateConfig(mcp) {
  const configPath = resolve(rootDir, ".bestie/config.json");
  const config = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(configPath, "utf8")));
  config.mcp = mcp;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include ${expected}, got: ${value}`);
  }
}