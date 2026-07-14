import { runDoctor } from "../../runtime/doctor.js";

export async function runDoctorCommand(argv: string[] = process.argv): Promise<void> {
  const report = await runDoctor(undefined, { connectTelegram: argv.includes("--telegram-connect"), connectZalo: argv.includes("--zalo-connect"), testTelegramSpeech: argv.includes("--telegram-speech-test"), fix: argv.includes("--fix") });

  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    setDoctorExitCode(report.issueCount);
    return;
  }

  console.log("Bestie Doctor\n");

  if (report.fixes.length > 0) {
    console.log("Fixes\n");

    for (const fix of report.fixes) {
      const marker = fix.status === "fixed" ? "FIXED" : fix.status === "skipped" ? "SKIP" : "FAIL";
      console.log(`${marker} ${fix.name}: ${fix.message}`);
    }

    console.log("");
  }

  for (const check of report.checks) {
    const marker = check.status === "pass" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${marker} ${check.name}: ${check.message}`);

    if (check.fix) {
      console.log(`  Fix: ${check.fix}`);
    }
  }

  console.log(`\nSummary: ${report.issueCount} ${report.issueCount === 1 ? "issue" : "issues"} found.`);
  setDoctorExitCode(report.issueCount);
}

function setDoctorExitCode(issueCount: number): void {
  if (issueCount > 0) {
    process.exitCode = 1;
  }
}
