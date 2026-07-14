const SECRET_LIKE_PATTERN = /(?:sk[-_][A-Za-z0-9_-]{8,}|(?:qc|ck)_[A-Za-z0-9_-]{16,}|\b\d{6,}:[A-Za-z0-9_-]{20,}\b|test-key|telegram-token|bot-token|\b(?=[A-Za-z0-9]{32,}\b)(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+\b|Bearer\s+[A-Za-z0-9._~+/=-]+|("?(?:api[_-]?key|token|secret|password)"?\s*[:=]\s*)"?[^",\s}]+"?)/gi;

export function containsSecretLikeValue(text: string): boolean {
  SECRET_LIKE_PATTERN.lastIndex = 0;
  return SECRET_LIKE_PATTERN.test(text);
}

export function redactSecretLikeValues(text: string, knownSecrets: string[] = []): string {
  let redacted = text;

  for (const secret of knownSecrets.filter((value) => value.length > 0)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  return redacted.replace(SECRET_LIKE_PATTERN, (match, label: string | undefined) => {
    if (match.toLowerCase().startsWith("bearer ")) {
      return "Bearer [REDACTED]";
    }

    if (label) {
      return `${label}"[REDACTED]"`;
    }

    return "[REDACTED]";
  });
}
