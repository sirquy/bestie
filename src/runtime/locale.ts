import ISO6391 from "iso-639-1";

const APP_LANGUAGE_MODES = new Set(["auto", "mixed"]);
const languageNameToCode = createLanguageNameIndex();

export function normalizeLanguageInput(value: string, defaultLanguage = "vi"): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultLanguage;
  }

  const appMode = trimmed.toLowerCase();
  if (APP_LANGUAGE_MODES.has(appMode)) {
    return appMode;
  }

  const languageCode = languageNameToCode.get(normalizeLanguageName(trimmed));
  if (languageCode) {
    return languageCode;
  }

  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? trimmed;
  } catch {
    return trimmed;
  }
}

function createLanguageNameIndex(): Map<string, string> {
  const index = new Map<string, string>();

  for (const code of ISO6391.getAllCodes()) {
    const names = [ISO6391.getName(code), ISO6391.getNativeName(code)];

    for (const name of names) {
      if (name) {
        index.set(normalizeLanguageName(name), code);
      }
    }
  }

  return index;
}

function normalizeLanguageName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function normalizeTimeZoneInput(value: string, defaultTimeZone = getLocalTimeZone()): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultTimeZone;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    return defaultTimeZone;
  }
}

export function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}