import { homedir } from "node:os";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "../dist/runtime/env.js";

const envPath = resolve(homedir(), ".bestie", ".env");

// 1. Read from .env file
console.log("=== .env file test ===");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  const envValues = parseEnv(content);
  console.log("File size:", content.length);
  console.log("First 10 chars (hex):", Buffer.from(content.slice(0, 10)).toString("hex"));
  console.log("From .env file:", envValues["OPENAI_API_KEY"] ? "PRESENT" : "MISSING");
  globalThis.__bestieEnvValues = envValues;
}

// 2. Read from process.env
console.log("\n=== process.env test ===");
const apiKeyFromProcess = process.env["OPENAI_API_KEY"];
console.log("From process.env:", apiKeyFromProcess ? "PRESENT" : "MISSING");

// 3. Check what loadRequiredSecret would return
const finalKey = globalThis.__bestieEnvValues?.["OPENAI_API_KEY"] ?? apiKeyFromProcess;
console.log("\n=== Final result ===");
console.log("apiKey resolved:", finalKey ? "PRESENT" : "MISSING");
