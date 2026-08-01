export type DoctorStatus = "pass" | "warn" | "fail";
export type DoctorFixStatus = "fixed" | "skipped" | "failed";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  fix?: string;
}

export interface DoctorFix {
  name: string;
  status: DoctorFixStatus;
  message: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  fixes: DoctorFix[];
  issueCount: number;
}

export interface DoctorSummary {
  ok: boolean;
  report: DoctorReport;
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
}
