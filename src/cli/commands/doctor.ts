import { runDoctor } from "../../runtime/doctor.js";
import { rule, statusBadge, title } from "../ui.js";

export async function runDoctorCommand(argv: string[] = process.argv): Promise<void> {
  const report = await runDoctor(undefined, { connectTelegram: argv.includes("--telegram-connect"), connectZalo: argv.includes("--zalo-connect"), testTelegramSpeech: argv.includes("--telegram-speech-test"), fix: argv.includes("--fix") });

  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    setDoctorExitCode(report.issueCount);
    return;
  }

  console.log(title("Bestie Doctor"));
  console.log(rule());

  if (report.fixes.length > 0) {
    console.log("\nFixes\n");

    for (const fix of report.fixes) {
      const marker = fix.status === "fixed" ? statusBadge("pass") : fix.status === "skipped" ? statusBadge("warn") : statusBadge("fail");
      console.log(`${marker} ${fix.name}: ${fix.message}`);
    }

    console.log("");
  }

  for (const check of report.checks) {
    const marker = statusBadge(check.status);
    console.log(`${marker} ${check.name}: ${check.message}`);

    if (check.fix) {
      console.log(`  Fix: ${check.fix}`);
    }
  }

  console.log(`\n${statusBadge(report.issueCount === 0 ? "pass" : "fail")} Summary: ${report.issueCount} ${report.issueCount === 1 ? "issue" : "issues"} found.`);
  setDoctorExitCode(report.issueCount);
}

function setDoctorExitCode(issueCount: number): void {
  if (issueCount > 0) {
    process.exitCode = 1;
  }
}
