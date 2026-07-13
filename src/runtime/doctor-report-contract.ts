import { containsSecretLikeValue } from "./secret-redaction.js";

export interface DoctorReportContractResult {
  valid: boolean;
  errors: string[];
}

const CHECK_STATUSES = new Set(["pass", "warn", "fail"]);
const FIX_STATUSES = new Set(["fixed", "skipped", "failed"]);

export function validateDoctorReportContract(report: unknown): DoctorReportContractResult {
  const errors: string[] = [];

  if (!isRecord(report)) {
    return { valid: false, errors: ["report must be an object"] };
  }

  if (!Array.isArray(report.checks)) {
    errors.push("checks must be an array");
  }

  if (!Array.isArray(report.fixes)) {
    errors.push("fixes must be an array");
  }

  if (typeof report.issueCount !== "number") {
    errors.push("issueCount must be a number");
  }

  if (Array.isArray(report.checks)) {
    for (const [index, check] of report.checks.entries()) {
      validateDoctorCheckContract(check, index, errors);
    }

    if (typeof report.issueCount === "number") {
      const failedChecks = report.checks.filter((check) => isRecord(check) && check.status === "fail");

      if (report.issueCount !== failedChecks.length) {
        errors.push("issueCount must equal failed check count");
      }
    }
  }

  if (Array.isArray(report.fixes)) {
    for (const [index, fix] of report.fixes.entries()) {
      validateDoctorFixContract(fix, index, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateDoctorReportJsonContract(text: string): DoctorReportContractResult {
  if (containsSecretLikeValue(text)) {
    return { valid: false, errors: ["report JSON must not contain secret-like values"] };
  }

  try {
    return validateDoctorReportContract(JSON.parse(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    return { valid: false, errors: [`report JSON must parse: ${message}`] };
  }
}

function validateDoctorCheckContract(check: unknown, index: number, errors: string[]): void {
  if (!isRecord(check)) {
    errors.push(`checks[${index}] must be an object`);
    return;
  }

  if (typeof check.name !== "string") {
    errors.push(`checks[${index}].name must be a string`);
  }

  if (typeof check.status !== "string" || !CHECK_STATUSES.has(check.status)) {
    errors.push(`checks[${index}].status must be pass, warn, or fail`);
  }

  if (typeof check.message !== "string") {
    errors.push(`checks[${index}].message must be a string`);
  }

  if ("fix" in check && typeof check.fix !== "string") {
    errors.push(`checks[${index}].fix must be a string when present`);
  }
}

function validateDoctorFixContract(fix: unknown, index: number, errors: string[]): void {
  if (!isRecord(fix)) {
    errors.push(`fixes[${index}] must be an object`);
    return;
  }

  if (typeof fix.name !== "string") {
    errors.push(`fixes[${index}].name must be a string`);
  }

  if (typeof fix.status !== "string" || !FIX_STATUSES.has(fix.status)) {
    errors.push(`fixes[${index}].status must be fixed, skipped, or failed`);
  }

  if (typeof fix.message !== "string") {
    errors.push(`fixes[${index}].message must be a string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
