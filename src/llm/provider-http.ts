const PROVIDER_ERROR_BODY_MAX_CHARS = 1_000;

export async function formatProviderHttpError(response: Response): Promise<string> {
  const status = `${response.status} ${response.statusText}`.trim();
  const detail = await readProviderErrorBody(response);
  return detail ? `${status}: ${detail}` : status;
}

async function readProviderErrorBody(response: Response): Promise<string> {
  try {
    const text = normalizeProviderErrorBody(await response.text());
    return text.length > PROVIDER_ERROR_BODY_MAX_CHARS
      ? `${text.slice(0, PROVIDER_ERROR_BODY_MAX_CHARS - 3)}...`
      : text;
  } catch {
    return "";
  }
}

function normalizeProviderErrorBody(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}