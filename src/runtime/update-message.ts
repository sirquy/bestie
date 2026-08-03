export function buildNpmGlobalInstallCommand(packageName: string): string {
  return `npm install -g ${packageName}@latest`;
}

export function formatUpdateInstallFailure(packageName: string, exitCode: number): string {
  return [
    "Không cập nhật được Bestie Agent.",
    "Vui lòng thử lại bằng: bestie update --apply",
    `Nếu vẫn lỗi, chạy thủ công: ${buildNpmGlobalInstallCommand(packageName)}`,
    `Chi tiết kỹ thuật: npm install thoát với mã ${exitCode}.`,
  ].join("\n");
}

