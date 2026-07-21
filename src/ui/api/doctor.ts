import { runDoctor, type DoctorReport } from "../../runtime/doctor.js";
import { getRuntimePaths, type RuntimePaths } from "../../runtime/paths.js";

export interface UiDoctorSummary {
  ok: boolean;
  report: DoctorReport;
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
}

export interface UiDoctorFixOptions {
  confirm: boolean;
  paths?: RuntimePaths;
}

export async function getUiDoctorSummary(paths: RuntimePaths = getRuntimePaths()): Promise<UiDoctorSummary> {
  const report = await runDoctor(paths, { fix: false });
  return summarizeDoctorReport(report);
}

export async function runUiDoctorFix(options: UiDoctorFixOptions): Promise<UiDoctorSummary> {
  if (!options.confirm) {
    throw new Error("Doctor fixes require confirm=true.");
  }

  const report = await runDoctor(options.paths ?? getRuntimePaths(), { fix: true });
  return summarizeDoctorReport(report);
}

function summarizeDoctorReport(report: DoctorReport): UiDoctorSummary {
  const summary = {
    pass: report.checks.filter((check) => check.status === "pass").length,
    warn: report.checks.filter((check) => check.status === "warn").length,
    fail: report.checks.filter((check) => check.status === "fail").length,
  };

  return { ok: report.issueCount === 0, report, summary };
}