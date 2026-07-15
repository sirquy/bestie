import { homedir } from "node:os";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const envPath = resolve(homedir(), ".bestie", ".env");

// Parse .env the same way the app does
function parseEnv(envText) {
  const values = {};
  for (const line of envText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    if (key) {
      values[key] = unquoteEnvValue(value);
    }
  }
  return values;
}

function unquoteEnvValue(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

// 1. Read from .env file
console.log("=== .env file test ===");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  console.log("File size:", content.length);
  console.log("First 10 chars (hex):", Buffer.from(content.slice(0, 10)).toString("hex"));
  const envValues = parseEnv(content);
  const apiKeyFromEnv = envValues["OPENAI_API_KEY"];
  console.log("From .env file:", apiKeyFromEnv ? "FOUND (len=" + apiKeyFromEnv.length + ")" : "MISSING");
}

// 2. Read from process.env
console.log("\n=== process.env test ===");
const apiKeyFromProcess = process.env["OPENAI_API_KEY"];
console.log("From process.env:", apiKeyFromProcess ? "FOUND (len=" + apiKeyFromProcess.length + ")" : "MISSING");

// 3. Check what loadRequiredSecret would return
const envValues = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
const finalKey = envValues["OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"];
console.log("\n=== Final result ===");
console.log("apiKey resolved:", finalKey ? "YES (len=" + finalKey.length + ")" : "NO");
if (finalKey) {
  console.log("First 8 chars:", finalKey.slice(0, 8) + "...");
}
