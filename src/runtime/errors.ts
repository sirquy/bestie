export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = code;
  }
}

export class MissingConfigError extends UserFacingError {
  constructor(configPath: string) {
    super(`Missing config at ${configPath}. Run \`bestie onboard\` to create it.`, "MissingConfigError");
  }
}

export class InvalidConfigError extends UserFacingError {
  constructor(reason: string) {
    super(`Invalid config: ${reason}`, "InvalidConfigError");
  }
}

export class MissingSecretError extends UserFacingError {
  constructor(envVarName: string, envPath: string) {
    super(`Missing API key for ${envVarName}. Run \`bestie onboard\` or add it to ${envPath}.`, "MissingSecretError");
  }
}

export class MissingCharacterFileError extends UserFacingError {
  constructor(filePath: string) {
    super(`Missing character file at ${filePath}. Run \`bestie onboard\` to recreate local character files.`, "MissingCharacterFileError");
  }
}

export class EmptyPromptError extends UserFacingError {
  constructor(filePath: string) {
    super(`System prompt is empty at ${filePath}. Restore it or rerun \`bestie onboard\` before starting chat.`, "EmptyPromptError");
  }
}