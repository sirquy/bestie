const SESSION_VERSION = 1;

export interface ZaloPersonalCredentials {
  imei: string;
  cookie: unknown;
  userAgent: string;
  language?: string;
}

export interface ZaloPersonalSession {
  version: typeof SESSION_VERSION;
  credentials: ZaloPersonalCredentials;
}

export function encodeZaloPersonalSession(credentials: ZaloPersonalCredentials): string {
  const payload: ZaloPersonalSession = { version: SESSION_VERSION, credentials };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeZaloPersonalSession(value: string): ZaloPersonalSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value.trim(), "base64url").toString("utf8"));
  } catch {
    throw new Error("Zalo Personal session is invalid. Log in again with `bestie channels zalo-personal login`.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Zalo Personal session is invalid. Log in again with `bestie channels zalo-personal login`.");
  }
  const session = parsed as Partial<ZaloPersonalSession>;
  if (session.version !== SESSION_VERSION || !session.credentials || typeof session.credentials !== "object") {
    throw new Error("Zalo Personal session version is unsupported. Log in again with `bestie channels zalo-personal login`.");
  }
  const credentials = session.credentials as ZaloPersonalCredentials;
  if (!credentials.imei || !credentials.userAgent || !credentials.cookie || (Array.isArray(credentials.cookie) && credentials.cookie.length === 0)) {
    throw new Error("Zalo Personal session is incomplete. Log in again with `bestie channels zalo-personal login`.");
  }
  return { version: SESSION_VERSION, credentials };
}
