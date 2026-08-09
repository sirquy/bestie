import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { RuntimePaths } from "../runtime/paths.js";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 1000;

interface UiAuthRecord {
  version: 1;
  salt: string;
  pinHash: string;
}

interface UiAuthSession {
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface UiAuthSessionStatus {
  idleExpiresAt: string;
  sessionExpiresAt: string;
}

export class UiAuthService {
  private readonly sessions = new Map<string, UiAuthSession>();
  private readonly authPath: string;
  private failedAttempts = 0;
  private lockedUntil = 0;

  constructor(paths: RuntimePaths, private readonly now: () => number = Date.now) {
    this.authPath = resolve(paths.dataDir, "ui-auth.json");
  }

  async isConfigured(): Promise<boolean> {
    return (await this.readRecord()) !== undefined;
  }

  async setup(pin: string): Promise<void> {
    assertValidPin(pin);
    if (await this.isConfigured()) throw new Error("UI Local Unlock is already configured.");
    await this.writeRecord(await createRecord(pin));
  }

  async login(pin: string): Promise<{ sessionId: string; csrfToken: string }> {
    const record = await this.readRecord();
    if (!record) throw new Error("Set up UI Local Unlock before signing in.");
    const now = this.now();
    if (now < this.lockedUntil) throw new Error(`Too many incorrect PIN attempts. Try again in ${Math.ceil((this.lockedUntil - now) / 1000)} seconds.`);

    const valid = await verifyPin(pin, record);
    if (!valid) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.failedAttempts = 0;
        this.lockedUntil = now + LOCKOUT_MS;
      }
      throw new Error("Incorrect unlock PIN.");
    }

    this.failedAttempts = 0;
    const sessionId = randomToken();
    const csrfToken = randomToken();
    this.sessions.set(sessionId, { csrfToken, createdAt: now, lastSeenAt: now });
    return { sessionId, csrfToken };
  }

  async changePin(currentPin: string, nextPin: string): Promise<void> {
    const record = await this.readRecord();
    if (!record || !await verifyPin(currentPin, record)) throw new Error("Current unlock PIN is incorrect.");
    assertValidPin(nextPin);
    await this.writeRecord(await createRecord(nextPin));
    this.clearSessions();
  }

  validateSession(sessionId: string | undefined, options: { touch?: boolean } = {}): UiAuthSession | undefined {
    if (!sessionId) return undefined;
    const session = this.sessions.get(sessionId);
    const now = this.now();
    if (!session || now - session.createdAt > SESSION_TTL_MS || now - session.lastSeenAt > IDLE_TTL_MS) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    if (options.touch !== false) session.lastSeenAt = now;
    return session;
  }

  validateCsrf(session: UiAuthSession, token: string | undefined): boolean {
    return Boolean(token && token.length === session.csrfToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken)));
  }

  getSessionStatus(session: UiAuthSession): UiAuthSessionStatus {
    return {
      idleExpiresAt: new Date(session.lastSeenAt + IDLE_TTL_MS).toISOString(),
      sessionExpiresAt: new Date(session.createdAt + SESSION_TTL_MS).toISOString(),
    };
  }

  clearSessions(): void {
    this.sessions.clear();
  }

  async reset(): Promise<boolean> {
    this.clearSessions();
    try {
      await unlink(this.authPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async readRecord(): Promise<UiAuthRecord | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.authPath, "utf8")) as unknown;
      return isRecord(parsed) && parsed.version === 1 && typeof parsed.salt === "string" && typeof parsed.pinHash === "string"
        ? { version: 1, salt: parsed.salt, pinHash: parsed.pinHash }
        : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async writeRecord(record: UiAuthRecord): Promise<void> {
    await mkdir(resolve(this.authPath, ".."), { recursive: true, mode: 0o700 });
    await writeFile(this.authPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

async function createRecord(pin: string): Promise<UiAuthRecord> {
  const salt = randomBytes(16).toString("base64url");
  return { version: 1, salt, pinHash: await hashPin(pin, salt) };
}

async function verifyPin(pin: string, record: UiAuthRecord): Promise<boolean> {
  if (!/^\d{6}$/.test(pin)) return false;
  const hash = Buffer.from(await hashPin(pin, record.salt));
  const expected = Buffer.from(record.pinHash);
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Buffer.from(await scrypt(pin, salt, 64) as Uint8Array).toString("base64url");
}

function assertValidPin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) throw new Error("Unlock PIN must contain exactly 6 digits.");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}