export interface ParsedModelRef {
  provider: string;
  model: string;
}

export function normalizeProviderId(provider: string): string {
  return provider.trim().toLowerCase();
}

export function parseModelRef(value: string): ParsedModelRef | null {
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return null;
  }

  const provider = normalizeProviderId(trimmed.slice(0, slashIndex));
  const model = trimmed.slice(slashIndex + 1).trim();
  return provider && model ? { provider, model } : null;
}

export function buildModelRef(provider: string, model: string): string {
  return `${normalizeProviderId(provider)}/${model.trim()}`;
}

export function requireModelRef(value: string, path = "model"): ParsedModelRef {
  const parsed = parseModelRef(value);
  if (!parsed) {
    throw new Error(`${path} must use provider/model format.`);
  }
  return parsed;
}