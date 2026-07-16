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
    super(`Thiếu file cấu hình tại ${configPath}. Chạy \`bestie onboard\` để tạo cấu hình.`, "MissingConfigError");
  }
}

export class InvalidConfigError extends UserFacingError {
  constructor(reason: string) {
    super(`Cấu hình không hợp lệ: ${reason}`, "InvalidConfigError");
  }
}

export class MissingSecretError extends UserFacingError {
  constructor(envVarName: string, envPath: string) {
    super(`Thiếu API key cho ${envVarName}. Chạy \`bestie onboard\` hoặc thêm key vào ${envPath}.`, "MissingSecretError");
  }
}

export class MissingCharacterFileError extends UserFacingError {
  constructor(filePath: string) {
    super(`Thiếu file tính cách tại ${filePath}. Chạy \`bestie onboard\` để tạo lại các file tính cách cục bộ.`, "MissingCharacterFileError");
  }
}

export class EmptyPromptError extends UserFacingError {
  constructor(filePath: string) {
    super(`Prompt hệ thống đang trống tại ${filePath}. Khôi phục file hoặc chạy lại \`bestie onboard\` trước khi chat.`, "EmptyPromptError");
  }
}