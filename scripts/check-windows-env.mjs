import { homedir } from "node:os";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const envPath = resolve(homedir(), ".bestie", ".env");
const configPath = resolve(homedir(), ".bestie", "config.json");

console.log("Platform:", process.platform);
console.log("homedir:", homedir());
console.log("envPath:", envPath);
console.log("envPath exists:", existsSync(envPath));
console.log("configPath:", configPath);
console.log("configPath exists:", existsSync(configPath));

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  console.log("env key count:", lines.length);
  for (const line of lines) {
    const eqIdx = line.indexOf("=");
    const key = eqIdx === -1 ? line : line.slice(0, eqIdx).trim();
    const rawVal = eqIdx === -1 ? "" : line.slice(eqIdx + 1).trim();
    const hasValue = rawVal.length > 0;
    console.log("  key:", key, "hasValue:", hasValue, "len:", rawVal.length);
  }
}

if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  console.log("config.llm.apiKeyEnv:", config.llm?.apiKeyEnv);
}
