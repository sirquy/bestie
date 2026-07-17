import { evaluateMemoryCandidate, type MemoryType } from "../../memory/policy.js";
import { isMemoryScope, SqliteMemoryStore, type PendingMemory, type StoredMemory, type StoredMessageRole } from "../../memory/sqlite-store.js";
import { isMemoryRetrievalPolicy, setMemoryRetrievalPolicy } from "../../memory/governance.js";
import { buildMemoryHygieneDoctorReport, fixMemoryHygieneDoctorIssues, formatMemoryHygieneDoctorFixes, formatMemoryHygieneDoctorReport } from "../../memory/hygiene-doctor.js";
import { calculateMemoryHygieneScore } from "../../memory/hygiene-score.js";
import { formatMemoryHygieneStatus } from "../../memory/hygiene-status.js";
import { formatMemoryHygieneTrendReport, recordMemoryHygieneSnapshot } from "../../memory/hygiene-trend.js";
import { MEMORY_MAINTENANCE_DEFAULT_SCHEDULE, installMemoryMaintenanceReport, getMemoryMaintenanceReportStatus, removeMemoryMaintenanceReport, runMemoryMaintenanceDigest } from "../../memory/maintenance.js";
import { applyMemoryRebalancePlan, formatMemoryRebalanceApplyResult, formatMemoryRebalancePlan, planMemoryRebalance } from "../../memory/rebalance.js";
import { formatMemoryTiersReport } from "../../memory/tiers.js";
import { loadConfig, type MemoryDeletePolicy } from "../../runtime/config.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { analyzeMemoriesTool, planMemoryHygieneTool, readMemoryHygieneTrendTool, type AnalyzeMemoriesResult, type MemoryAnalysisMode, type MemoryHygienePlanResult } from "../../tools/local-read-tools.js";
import { badge, dim, rule, title } from "../ui.js";

const allowedTypes = new Set<MemoryType>([
  "preference",
  "communication_preference",
  "user_fact",
  "project_context",
  "durable_decision",
  "sensitive_personal",
  "secret",
  "one_off",
]);

interface MemoryCleanupPlan {
  checked: number;
  deleteIds: number[];
  duplicateGroups: AnalyzeMemoriesResult["duplicateGroups"];
  staleMemories: AnalyzeMemoriesResult["staleMemories"];
  conflictGroups: AnalyzeMemoriesResult["conflictGroups"];
  skippedConflictIds: number[];
}

export async function runMemoryCommand(argv: string[] = process.argv): Promise<void> {
  const subcommand = argv[3] ?? "list";

  if (subcommand === "status") {
    await showMemoryStatus();
    return;
  }

  if (subcommand === "pause") {
    await setMemoryPaused(true);
    return;
  }

  if (subcommand === "resume") {
    await setMemoryPaused(false);
    return;
  }

  if (subcommand === "list") {
    await listMemories(argv);
    return;
  }

  if (subcommand === "tiers") {
    await showMemoryTiers();
    return;
  }

  if (subcommand === "rebalance") {
    await runMemoryRebalance(argv);
    return;
  }

  if (subcommand === "add") {
    await addMemory(argv);
    return;
  }

  if (subcommand === "search") {
    await searchMemories(argv);
    return;
  }

  if (subcommand === "analyze") {
    await analyzeMemories(argv);
    return;
  }

  if (subcommand === "cleanup") {
    await cleanupMemories(argv);
    return;
  }

  if (subcommand === "hygiene") {
    await showMemoryHygiene(argv);
    return;
  }

  if (subcommand === "digest") {
    await runMemoryDigest();
    return;
  }

  if (subcommand === "maintenance") {
    await runMemoryMaintenanceCommand(argv);
    return;
  }

  if (subcommand === "governance") {
    await runMemoryGovernanceCommand(argv);
    return;
  }

  if (subcommand === "pin" || subcommand === "unpin") {
    await setMemoryPinned(argv, subcommand === "pin");
    return;
  }

  if (subcommand === "move") {
    await moveMemoryScope(argv);
    return;
  }

  if (subcommand === "supersede") {
    await supersedeMemory(argv);
    return;
  }

  if (subcommand === "inspect") {
    await inspectMemory(argv);
    return;
  }

  if (subcommand === "edit") {
    await editMemory(argv);
    return;
  }

  if (subcommand === "forget" || subcommand === "delete") {
    await forgetMemory(argv);
    return;
  }

  if (subcommand === "clear") {
    await clearMemoryData(argv);
    return;
  }

  if (subcommand === "export") {
    await exportMemoryData();
    return;
  }

  if (subcommand === "messages") {
    await listRecentMessages(argv);
    return;
  }

  if (subcommand === "pending") {
    if (argv[4] === "inspect") {
      await inspectPendingMemory(argv);
      return;
    }

    if (argv[4] === "search") {
      await searchPendingMemories(argv);
      return;
    }

    await listPendingMemories(argv);
    return;
  }

  if (subcommand === "approve") {
    await approvePendingMemory(argv);
    return;
  }

  if (subcommand === "reject-all") {
    await rejectAllPendingMemories(argv);
    return;
  }

  if (subcommand === "reject") {
    await rejectPendingMemory(argv);
    return;
  }

  console.error(`Unknown memory command: ${subcommand}`);
  console.error("Usage: bestie memory status | pause | resume | list | tiers | rebalance [--dry-run|--apply] [--yes] [--json] | search <query> | analyze [--mode all|duplicates|stale|conflicts] [--json] | hygiene [status|trend|doctor|--apply] [--fix] [--yes] [--json] | digest | cleanup --dry-run|--apply [--yes] [--json] | maintenance install|status|remove [--channel telegram:<id>|zalo:<id>] [--schedule <cron>] | add <type> <content> | inspect <id> | edit <id> <content> | forget <id> | messages [--limit <n>] [--role user|assistant|system] | messages search <query> [--limit <n>] [--role user|assistant|system] | export | clear --yes | pending [--limit <n>] | pending search <query> [--limit <n>] | pending inspect <id> | approve <id> | reject <id> | reject-all --yes");
  process.exitCode = 1;
}

async function showMemoryStatus(): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    const state = store.getMemoryState();
    console.log(`${state.paused ? badge("PAUSED", "yellow") : badge("ACTIVE", "green")} Memory is ${state.paused ? "paused" : "active"}.`);
  } finally {
    store.close();
  }
}

async function setMemoryPaused(paused: boolean): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    const state = store.setMemoryPaused(paused);
    console.log(`${state.paused ? badge("PAUSED", "yellow") : badge("ACTIVE", "green")} Memory is ${state.paused ? "paused" : "active"}.`);
  } finally {
    store.close();
  }
}

async function listMemories(argv: string[]): Promise<void> {
  const args = parseFlagArgs(argv.slice(4));
  const scope = args["--scope"];

  if (scope !== undefined && !isMemoryScope(scope)) {
    console.error("--scope must be core, project, or session.");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memories = scope ? store.listActiveMemoriesByScope(scope) : store.listActiveMemories();

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No active memories${scope ? ` in ${scope} scope` : ""} yet.`);
      return;
    }

    console.log(title(`Active Memories${scope ? ` / ${scope}` : ""} (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatActiveMemoryLine(memory));
    }
  } finally {
    store.close();
  }
}

async function showMemoryTiers(): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    console.log(formatMemoryTiersReport({ memories: store.listActiveMemories(), plan: await planMemoryHygieneTool({ paths: getRuntimePaths() }) }));
  } finally {
    store.close();
  }
}

async function runMemoryRebalance(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run") || !argv.includes("--apply");
  const apply = argv.includes("--apply");
  const json = argv.includes("--json");
  const store = await SqliteMemoryStore.open();

  try {
    const plan = planMemoryRebalance(store.listActiveMemories());

    if (dryRun) {
      if (json) {
        console.log(JSON.stringify({ allowed: true, applied: false, plan }, null, 2));
      } else {
        console.log(formatMemoryRebalancePlan({ plan }));
      }
      return;
    }

    if (!apply) {
      console.error("Usage: bestie memory rebalance [--dry-run|--apply] [--yes] [--json]");
      process.exitCode = 1;
      return;
    }

    const deletePolicy = await loadMemoryDeletePolicy();
    if (deletePolicy === "deny") {
      if (json) {
        console.log(JSON.stringify({ allowed: false, applied: false, reason: "memory.deletePolicy is deny.", plan }, null, 2));
      } else {
        console.log(`${badge("DENIED", "red")} memory.deletePolicy is deny. No memories were moved.`);
      }
      process.exitCode = 1;
      return;
    }

    if (deletePolicy === "ask" && !argv.includes("--yes")) {
      if (json) {
        console.log(JSON.stringify({ allowed: false, applied: false, reason: "memory.deletePolicy is ask; re-run with --yes to confirm rebalance.", plan }, null, 2));
      } else {
        console.log(formatMemoryRebalancePlan({ plan }));
        console.log(`${badge("CONFIRM", "yellow")} memory.deletePolicy is ask. Re-run with \`bestie memory rebalance --apply --yes\` to move non-review-only memories.`);
      }
      process.exitCode = 1;
      return;
    }

    const result = applyMemoryRebalancePlan(store, plan);
    if (json) {
      console.log(JSON.stringify({ allowed: true, applied: true, result, plan }, null, 2));
    } else {
      console.log(formatMemoryRebalanceApplyResult(result));
    }
  } finally {
    store.close();
  }
}

async function runMemoryDigest(): Promise<void> {
  const paths = getRuntimePaths();
  const config = await loadConfig();

  console.log(`${badge("INFO", "blue")} Running memory maintenance digest...`);

  const result = await runMemoryMaintenanceDigest({ config, paths });

  if (result.ok) {
    console.log(result.output);
  } else {
    console.log(`${badge("ERROR", "red")} Digest failed: ${result.reason}`);
    process.exitCode = 1;
  }
}

async function searchMemories(argv: string[]): Promise<void> {
  const query = argv.slice(4).join(" ").trim();

  if (query.length === 0) {
    console.error("Usage: bestie memory search <query>");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memories = store.searchMemories(query);

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No matching active memories.`);
      return;
    }

    console.log(title(`Matching Active Memories (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatActiveMemoryLine(memory));
    }
  } finally {
    store.close();
  }
}

async function analyzeMemories(argv: string[]): Promise<void> {
  const mode = parseAnalyzeMode(argv);

  if (mode === false) {
    return;
  }

  const result = await analyzeMemoriesTool({ paths: getRuntimePaths(), mode });

  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.allowed) {
    console.log(`${badge("DENIED", "red")} ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log(title(`Memory Analysis (${result.mode}, checked ${result.checked})`));
  console.log(rule());
  printDuplicateGroups(result.duplicateGroups);
  printStaleMemories(result.staleMemories);
  printConflictGroups(result.conflictGroups);

  if (result.duplicateGroups.length === 0 && result.staleMemories.length === 0 && result.conflictGroups.length === 0) {
    console.log(`${badge("OK", "green")} No duplicate, stale, or conflicting active memories found.`);
  }
}

async function cleanupMemories(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const json = argv.includes("--json");

  if (dryRun === apply) {
    console.error("Usage: bestie memory cleanup --dry-run|--apply [--yes] [--json]");
    process.exitCode = 1;
    return;
  }

  const analysis = await analyzeMemoriesTool({ paths: getRuntimePaths(), mode: "all" });
  const plan = createMemoryCleanupPlan(analysis);

  if (!analysis.allowed) {
    if (json) {
      console.log(JSON.stringify({ allowed: false, reason: analysis.reason, plan }, null, 2));
    } else {
      console.log(`${badge("DENIED", "red")} ${analysis.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    if (json) {
      console.log(JSON.stringify({ allowed: true, applied: false, plan }, null, 2));
      return;
    }

    printCleanupPlan(plan, false);
    return;
  }

  const deletePolicy = await loadMemoryDeletePolicy();
  if (deletePolicy === "deny") {
    if (json) {
      console.log(JSON.stringify({ allowed: false, applied: false, reason: "memory.deletePolicy is deny.", plan }, null, 2));
    } else {
      console.log(`${badge("DENIED", "red")} memory.deletePolicy is deny. No memories were deleted.`);
    }
    process.exitCode = 1;
    return;
  }

  if (deletePolicy === "ask" && !argv.includes("--yes")) {
    if (json) {
      console.log(JSON.stringify({ allowed: false, applied: false, reason: "memory.deletePolicy is ask; re-run with --yes to confirm local cleanup.", plan }, null, 2));
    } else {
      printCleanupPlan(plan, false);
      console.log(`${badge("CONFIRM", "yellow")} memory.deletePolicy is ask. Re-run with \`bestie memory cleanup --apply --yes\` to delete planned duplicate and stale memories.`);
    }
    process.exitCode = 1;
    return;
  }

  const applied = await applyMemoryCleanupPlan(plan);

  if (json) {
    console.log(JSON.stringify({ allowed: true, applied: true, deletedIds: applied.deletedIds, missingIds: applied.missingIds, plan }, null, 2));
    return;
  }

  printCleanupPlan(plan, true);
  console.log(`${badge("DELETED", "green")} Deleted ${applied.deletedIds.length} planned memory/memories.${applied.missingIds.length > 0 ? ` Missing: ${applied.missingIds.map((id) => `#${id}`).join(", ")}.` : ""}`);
}

async function showMemoryHygiene(argv: string[]): Promise<void> {
  const status = argv[4] === "status";
  const doctor = argv[4] === "doctor";
  const trendCommand = argv[4] === "trend";
  const apply = argv.includes("--apply");
  const fix = argv.includes("--fix");
  const json = argv.includes("--json");
  const paths = getRuntimePaths();
  if (trendCommand) {
    const trend = await readMemoryHygieneTrendTool({ paths });
    if (json) {
      console.log(JSON.stringify(trend, null, 2));
    } else {
      console.log(formatMemoryHygieneTrendReport(trend));
    }
    if (!trend.allowed) {
      process.exitCode = 1;
    }
    return;
  }

  const plan = await planMemoryHygieneTool({ paths });

  if (status || doctor) {
    const config = await loadConfig();
    const deletePolicy = config.memory?.deletePolicy ?? "ask";
    const retrievalPolicy = config.memory?.retrievalPolicy ?? "full";
    if (doctor) {
      const report = await buildMemoryHygieneDoctorReport({ paths, plan, deletePolicy, retrievalPolicy });
      if (fix) {
        const fixes = await fixMemoryHygieneDoctorIssues({ paths, report });
        const nextPlan = await planMemoryHygieneTool({ paths });
        const nextReport = await buildMemoryHygieneDoctorReport({ paths, plan: nextPlan, deletePolicy, retrievalPolicy });
        const trend = await recordMemoryHygieneSnapshot({ paths, plan: nextPlan, score: nextReport.score, source: "cli:doctor:fix" });
        if (json) {
          console.log(JSON.stringify({ allowed: nextPlan.allowed, deletePolicy, retrievalPolicy, fixes, report: nextReport, trend }, null, 2));
        } else {
          console.log(formatMemoryHygieneDoctorFixes(fixes));
          console.log(formatMemoryHygieneDoctorReport(nextReport, trend));
        }
        if (nextReport.issueCount > 0) {
          process.exitCode = 1;
        }
        return;
      }

      const trend = await recordMemoryHygieneSnapshot({ paths, plan, score: report.score, source: "cli:doctor" });
      if (json) {
        console.log(JSON.stringify({ allowed: plan.allowed, deletePolicy, retrievalPolicy, report, trend }, null, 2));
      } else {
        console.log(formatMemoryHygieneDoctorReport(report, trend));
      }
      if (report.issueCount > 0) {
        process.exitCode = 1;
      }
      return;
    }

    const score = calculateMemoryHygieneScore(plan);
    const trend = await recordMemoryHygieneSnapshot({ paths, plan, score, source: "cli:status" });
    if (json) {
      console.log(JSON.stringify({ allowed: plan.allowed, deletePolicy, retrievalPolicy, plan, trend }, null, 2));
    } else {
      console.log(formatMemoryHygieneStatus({ plan, deletePolicy, retrievalPolicy, trend }));
    }
    if (!plan.allowed) {
      process.exitCode = 1;
    }
    return;
  }

  if (json && !apply) {
    console.log(JSON.stringify({ allowed: plan.allowed, applied: false, plan }, null, 2));
    return;
  }

  if (!plan.allowed) {
    if (json) {
      console.log(JSON.stringify({ allowed: false, applied: false, reason: plan.reason, plan }, null, 2));
    } else {
      console.log(`${badge("DENIED", "red")} ${plan.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    printHygienePlan(plan, false);
    return;
  }

  const deletePolicy = await loadMemoryDeletePolicy();
  if (deletePolicy === "deny") {
    if (json) {
      console.log(JSON.stringify({ allowed: false, applied: false, reason: "memory.deletePolicy is deny.", plan }, null, 2));
    } else {
      console.log(`${badge("DENIED", "red")} memory.deletePolicy is deny. No memories were deleted.`);
    }
    process.exitCode = 1;
    return;
  }

  if (deletePolicy === "ask" && !argv.includes("--yes")) {
    if (json) {
      console.log(JSON.stringify({ allowed: false, applied: false, reason: "memory.deletePolicy is ask; re-run with --yes to confirm hygiene cleanup.", plan }, null, 2));
    } else {
      printHygienePlan(plan, false);
      console.log(`${badge("CONFIRM", "yellow")} memory.deletePolicy is ask. Re-run with \`bestie memory hygiene --apply --yes\` to delete planned duplicate and stale memories.`);
    }
    process.exitCode = 1;
    return;
  }

  const applied = await applyMemoryHygienePlan(plan);

  if (json) {
    console.log(JSON.stringify({ allowed: true, applied: true, deletedIds: applied.deletedIds, missingIds: applied.missingIds, plan }, null, 2));
    return;
  }

  printHygienePlan(plan, true);
  console.log(`${badge("DELETED", "green")} Deleted ${applied.deletedIds.length} planned memory/memories.${applied.missingIds.length > 0 ? ` Missing: ${applied.missingIds.map((id) => `#${id}`).join(", ")}.` : ""}`);
}

async function runMemoryMaintenanceCommand(argv: string[]): Promise<void> {
  const action = argv[4] ?? "status";

  if (action === "install") {
    await installMemoryMaintenance(argv);
    return;
  }

  if (action === "status") {
    await showMemoryMaintenanceStatus();
    return;
  }

  if (action === "remove" || action === "uninstall") {
    await removeMemoryMaintenance();
    return;
  }

  console.error("Usage: bestie memory maintenance install|status|remove [--channel telegram:<id>|zalo:<id>] [--schedule <cron>]");
  process.exitCode = 1;
}

async function runMemoryGovernanceCommand(argv: string[]): Promise<void> {
  const action = argv[4] ?? "status";

  if (action === "status") {
    const config = await loadConfig();
    console.log(`Retrieval policy: ${config.memory?.retrievalPolicy ?? "full"}`);
    return;
  }

  if (action === "policy") {
    const policy = argv[5];
    if (!isMemoryRetrievalPolicy(policy)) {
      console.error("Usage: bestie memory governance policy full|governed");
      process.exitCode = 1;
      return;
    }

    await setMemoryRetrievalPolicy(policy);
    console.log(`${badge("OK", "green")} memory.retrievalPolicy set to ${policy}.`);
    return;
  }

  console.error("Usage: bestie memory governance status|policy full|governed");
  process.exitCode = 1;
}

async function installMemoryMaintenance(argv: string[]): Promise<void> {
  const args = parseFlagArgs(argv.slice(5));
  const scheduleValue = args["--schedule"] ?? MEMORY_MAINTENANCE_DEFAULT_SCHEDULE;
  const channel = args["--channel"] ?? (await defaultMaintenanceChannel());

  const result = await installMemoryMaintenanceReport({ channel, scheduleValue });
  if (!result.ok) {
    console.error(result.reason.replace(/^Channel must/, "--channel must"));
    process.exitCode = 1;
    return;
  }

  console.log(`${badge("OK", "green")} Memory maintenance report installed: #${result.schedule.id}`);
  console.log(`Schedule: ${result.schedule.scheduleValue}`);
  console.log(`Channel: ${result.schedule.channel ?? "configured owner channels"}`);
  console.log(`Next run: ${result.schedule.nextRunAt}`);
}

async function showMemoryMaintenanceStatus(): Promise<void> {
  const schedule = await getMemoryMaintenanceReportStatus();
  if (!schedule) {
    console.log(`${badge("INFO", "blue")} Memory maintenance report is not installed.`);
    console.log("Install with `bestie memory maintenance install --channel telegram:<id>` or `--channel zalo:<id>`.");
    return;
  }

  console.log(title("Memory Maintenance Report"));
  console.log(rule());
  console.log(`#${schedule.id} ${schedule.enabled ? "enabled" : "disabled"}`);
  console.log(`Schedule: ${schedule.scheduleValue}`);
  console.log(`Channel: ${schedule.channel ?? "configured owner channels"}`);
  console.log(`Next run: ${schedule.nextRunAt || "none"}`);
  console.log(`Last result: ${schedule.lastResult ?? "none"}`);
}

async function removeMemoryMaintenance(): Promise<void> {
  const schedule = await removeMemoryMaintenanceReport();
  if (!schedule) {
    console.log(`${badge("INFO", "blue")} Memory maintenance report is not installed.`);
    return;
  }

  console.log(`${badge("OK", "green")} Memory maintenance report removed: #${schedule.id}`);
}

async function addMemory(argv: string[]): Promise<void> {
  const type = argv[4];
  const content = argv.slice(5).join(" ").trim();

  if (!isMemoryType(type)) {
    console.error("Memory type must be one of: preference, communication_preference, user_fact, project_context, durable_decision, sensitive_personal, secret, one_off.");
    process.exitCode = 1;
    return;
  }

  const policy = evaluateMemoryCandidate({ type, content });
  const stateStore = await SqliteMemoryStore.open();

  try {
    if (stateStore.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before adding memories.`);
      return;
    }
  } finally {
    stateStore.close();
  }

  if (policy.decision === "pending") {
    const store = await SqliteMemoryStore.open();

    try {
      const pending = store.addPendingMemory({ type, content, reason: policy.reason, source: "manual-command" });
      console.log(`${badge("PENDING", "yellow")} Memory pending approval: ${pending.id}`);
      console.log(policy.reason);
      console.log(`Next: bestie memory pending inspect ${pending.id}`);
      console.log(`Then: bestie memory approve ${pending.id} or bestie memory reject ${pending.id}`);
      return;
    } finally {
      store.close();
    }
  }

  if (policy.decision !== "store") {
    console.log(`${badge("SKIP", "yellow")} Memory not stored: ${policy.reason}`);
    console.log(`Decision: ${policy.decision}`);
    return;
  }

  if (policy.sensitivity === "secret") {
    console.log(`${badge("SKIP", "yellow")} Memory not stored: ${policy.reason}`);
    console.log("Decision: never");
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memory = store.addMemory({
      type,
      content,
      sensitivity: policy.sensitivity,
      source: "manual-command",
      explicitConsent: true,
      policyReason: policy.reason,
    });
    console.log(`${badge("STORED", "green")} Memory stored: ${memory.id}`);
  } finally {
    store.close();
  }
}

async function inspectMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memory = store.listAllMemories().find((item) => item.id === id);

    if (!memory) {
      console.log(`No memory found for id ${id}.`);
      return;
    }

    console.log(JSON.stringify(memory, null, 2));
  } finally {
    store.close();
  }
}

async function setMemoryPinned(argv: string[], pinned: boolean): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const updated = store.setMemoryPinned(id, pinned);
    if (!updated) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    console.log(`${badge(pinned ? "PINNED" : "UNPINNED", "green")} Memory ${pinned ? "pinned" : "unpinned"}: ${updated.id}`);
  } finally {
    store.close();
  }
}

async function moveMemoryScope(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);
  const args = parseFlagArgs(argv.slice(5));
  const scope = args["--scope"];

  if (!id) {
    return;
  }

  if (!isMemoryScope(scope)) {
    console.error("Usage: bestie memory move <id> --scope core|project|session");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const updated = store.setMemoryScope(id, scope);
    if (!updated) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("MOVED", "green")} Memory ${updated.id} moved to ${updated.scope}.`);
  } finally {
    store.close();
  }
}

async function supersedeMemory(argv: string[]): Promise<void> {
  const oldId = parsePositiveId(argv[4]);
  const newId = parsePositiveId(argv[5]);

  if (!oldId || !newId) {
    console.error("Usage: bestie memory supersede <oldId> <newId>");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const updated = store.supersedeMemory(oldId, newId);
    if (!updated) {
      console.log(`${badge("INFO", "blue")} Could not supersede memory. Make sure both ids are active and different.`);
      return;
    }

    console.log(`${badge("SUPERSEDED", "green")} Memory ${updated.id} superseded by ${updated.supersededBy}.`);
  } finally {
    store.close();
  }
}

async function editMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);
  const content = argv.slice(5).join(" ").trim();

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before editing memories.`);
      return;
    }

    const current = store.getActiveMemory(id);

    if (!current) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    const policy = evaluateMemoryCandidate({ type: current.type as MemoryType, content, explicitConsent: current.sensitivity === "sensitive" });

    if (policy.decision !== "store" || policy.sensitivity === "secret") {
      console.log(`${badge("SKIP", "yellow")} Memory not updated: ${policy.reason}`);
      console.log(`Decision: ${policy.decision === "store" ? "never" : policy.decision}`);
      return;
    }

    const updated = store.updateMemoryContent(id, content);

    if (!updated) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("UPDATED", "green")} Memory updated: ${updated.id}`);
  } finally {
    store.close();
  }
}

async function forgetMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const forgotten = store.forgetMemory(id);

    if (!forgotten) {
      console.log(`${badge("INFO", "blue")} No active memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("FORGOT", "green")} Memory forgotten: ${id}`);
  } finally {
    store.close();
  }
}

async function clearMemoryData(argv: string[]): Promise<void> {
  if (!argv.includes("--yes")) {
    console.log("Memory not cleared. Re-run with `bestie memory clear --yes` to delete memories, pending memories, and persisted messages.");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    store.clearAllData();
    console.log(`${badge("CLEARED", "green")} Memory data cleared.`);
  } finally {
    store.close();
  }
}

async function exportMemoryData(): Promise<void> {
  const store = await SqliteMemoryStore.open();

  try {
    console.log(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          memories: store.listAllMemories(),
          pendingMemories: store.listPendingMemories(Number.MAX_SAFE_INTEGER),
          messages: store.listAllMessages(),
        },
        null,
        2,
      ),
    );
  } finally {
    store.close();
  }
}

async function listRecentMessages(argv: string[] = process.argv): Promise<void> {
  const isSearch = argv[4] === "search";
  const query = isSearch ? parseMessageSearchQuery(argv) : "";
  const limit = parseLimitOption(argv, 20);
  const role = parseRoleOption(argv);

  if (!limit || role === false) {
    return;
  }

  if (isSearch && query.length === 0) {
    console.error("Usage: bestie memory messages search <query> [--limit <n>]");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const messages = isSearch ? store.searchMessages(query, limit, role) : store.listRecentMessages(limit, role);

    if (messages.length === 0) {
      console.log(`${badge("INFO", "blue")} ${isSearch ? "No matching persisted messages." : "No persisted messages yet."}`);
      return;
    }

    console.log(title(isSearch ? `Matching Messages (${messages.length})` : `Recent Messages (${messages.length})`));
    console.log(rule());
    for (const message of messages) {
      console.log(`${badge(message.role.toUpperCase(), message.role === "assistant" ? "magenta" : message.role === "user" ? "green" : "cyan")} #${message.id} ${dim(message.channel ?? "unknown")} ${message.content}`);
    }
  } finally {
    store.close();
  }
}

async function listPendingMemories(argv: string[] = process.argv): Promise<void> {
  const limit = parseLimitOption(argv, 20);

  if (!limit) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memories = store.listPendingMemories(limit);

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No pending memories.`);
      return;
    }

    console.log(title(`Pending Memories (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatPendingMemoryBlock(memory));
    }
    console.log(`${badge("NEXT", "cyan")} Approve with \`bestie memory approve <id>\` or reject with \`bestie memory reject <id>\`. Inspect details with \`bestie memory pending inspect <id>\`.`);
  } finally {
    store.close();
  }
}

async function searchPendingMemories(argv: string[]): Promise<void> {
  const query = parsePendingSearchQuery(argv);
  const limit = parseLimitOption(argv, 20);

  if (!limit) {
    return;
  }

  if (query.length === 0) {
    console.error("Usage: bestie memory pending search <query> [--limit <n>]");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memories = store.searchPendingMemories(query, limit);

    if (memories.length === 0) {
      console.log(`${badge("INFO", "blue")} No matching pending memories.`);
      return;
    }

    console.log(title(`Matching Pending Memories (${memories.length})`));
    console.log(rule());
    for (const memory of memories) {
      console.log(formatPendingMemoryBlock(memory));
    }
    console.log(`${badge("NEXT", "cyan")} Approve with \`bestie memory approve <id>\` or reject with \`bestie memory reject <id>\`. Inspect details with \`bestie memory pending inspect <id>\`.`);
  } finally {
    store.close();
  }
}

async function inspectPendingMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[5]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const memory = store.getPendingMemoryById(id);

    if (!memory) {
      console.log(`No pending memory found for id ${id}.`);
      return;
    }

    console.log(JSON.stringify(memory, null, 2));
  } finally {
    store.close();
  }
}

async function approvePendingMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before approving pending memories.`);
      return;
    }

    const memory = store.approvePendingMemory(id);

    if (!memory) {
      console.log(`${badge("INFO", "blue")} No pending memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("APPROVED", "green")} Pending memory approved: ${id} -> memory ${memory.id}`);
    console.log(formatActiveMemoryLine(memory));
  } finally {
    store.close();
  }
}

async function rejectAllPendingMemories(argv: string[]): Promise<void> {
  if (!argv.includes("--yes")) {
    console.log("Pending memories not rejected. Re-run with `bestie memory reject-all --yes` to clear the pending queue.");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const rejectedCount = store.rejectAllPendingMemories();
    console.log(`${badge("REJECTED", "green")} Pending memories rejected: ${rejectedCount}`);
  } finally {
    store.close();
  }
}

async function rejectPendingMemory(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[4]);

  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const rejected = store.rejectPendingMemory(id);

    if (!rejected) {
      console.log(`${badge("INFO", "blue")} No pending memory found for id ${id}.`);
      return;
    }

    console.log(`${badge("REJECTED", "green")} Pending memory rejected: ${id}`);
  } finally {
    store.close();
  }
}

function formatActiveMemoryLine(memory: StoredMemory): string {
  return `${badge(memory.type.toUpperCase(), "cyan")} #${memory.id} scope ${memory.scope} importance ${memory.importance} ${dim(`${memory.sensitivity}; updated ${memory.updatedAt}`)} ${memory.content}`;
}

function formatPendingMemoryBlock(memory: PendingMemory): string {
  const lines = [`${badge(memory.type.toUpperCase(), "yellow")} #${memory.id} ${dim(`created ${memory.createdAt}`)} ${memory.content}`];

  if (memory.reason) {
    lines.push(`   Reason: ${memory.reason}`);
  }

  lines.push(`   Next: bestie memory pending inspect ${memory.id}`);
  return lines.join("\n");
}

function printDuplicateGroups(groups: Array<{ canonicalId: number; duplicateIds: number[]; reason: string }>): void {
  if (groups.length === 0) return;
  console.log(`${badge("DUPLICATES", "yellow")} ${groups.length} group(s)`);
  for (const group of groups) {
    console.log(`   Keep #${group.canonicalId}; review duplicates ${group.duplicateIds.map((id) => `#${id}`).join(", ")}. ${dim(group.reason)}`);
  }
}

function printStaleMemories(memories: Array<{ id: number; reason: string }>): void {
  if (memories.length === 0) return;
  console.log(`${badge("STALE", "yellow")} ${memories.length} memory/memories`);
  for (const memory of memories) {
    console.log(`   #${memory.id} ${dim(memory.reason)}`);
  }
}

function printConflictGroups(groups: Array<{ ids: number[]; reason: string }>): void {
  if (groups.length === 0) return;
  console.log(`${badge("CONFLICTS", "yellow")} ${groups.length} group(s)`);
  for (const group of groups) {
    console.log(`   Review ${group.ids.map((id) => `#${id}`).join(" <-> ")}. ${dim(group.reason)}`);
  }
}

function createMemoryCleanupPlan(analysis: AnalyzeMemoriesResult): MemoryCleanupPlan {
  const duplicateIds = analysis.duplicateGroups.flatMap((group) => group.duplicateIds);
  const staleIds = analysis.staleMemories.map((memory) => memory.id);
  const deleteIds = [...new Set([...duplicateIds, ...staleIds])].sort((left, right) => left - right);
  const skippedConflictIds = [...new Set(analysis.conflictGroups.flatMap((group) => group.ids))].sort((left, right) => left - right);

  return {
    checked: analysis.checked,
    deleteIds,
    duplicateGroups: analysis.duplicateGroups,
    staleMemories: analysis.staleMemories,
    conflictGroups: analysis.conflictGroups,
    skippedConflictIds,
  };
}

function printCleanupPlan(plan: MemoryCleanupPlan, applied: boolean): void {
  console.log(title(`${applied ? "Applied" : "Planned"} Memory Cleanup (${plan.checked} checked)`));
  console.log(rule());
  if (plan.deleteIds.length === 0) {
    console.log(`${badge("OK", "green")} No duplicate or stale memories planned for deletion.`);
  } else {
    console.log(`${badge("DELETE", "yellow")} ${plan.deleteIds.length} planned: ${plan.deleteIds.map((id) => `#${id}`).join(", ")}`);
  }
  printDuplicateGroups(plan.duplicateGroups);
  printStaleMemories(plan.staleMemories);
  if (plan.conflictGroups.length > 0) {
    printConflictGroups(plan.conflictGroups);
    console.log(`${badge("SKIP", "cyan")} Conflicts are review-only and are not auto-deleted: ${plan.skippedConflictIds.map((id) => `#${id}`).join(", ")}`);
  }
}

function printHygienePlan(plan: MemoryHygienePlanResult, applied: boolean): void {
  console.log(title(`${applied ? "Applied" : "Planned"} Memory Hygiene (${plan.checked} checked)`));
  console.log(rule());
  if (plan.deleteIds.length === 0) {
    console.log(`${badge("OK", "green")} No duplicate or stale memories planned for deletion.`);
  } else {
    console.log(`${badge("DELETE", "yellow")} ${plan.deleteIds.length} planned: ${plan.deleteIds.map((id) => `#${id}`).join(", ")}`);
  }
  printDuplicateGroups(plan.duplicateGroups);
  printStaleMemories(plan.staleMemories);
  if (plan.reviewOnlyIds.length > 0) {
    printConflictGroups(plan.conflictGroups);
    console.log(`${badge("REVIEW", "cyan")} Review-only memories: ${plan.reviewOnlyIds.map((id) => `#${id}`).join(", ")}`);
  }
}

async function applyMemoryCleanupPlan(plan: MemoryCleanupPlan): Promise<{ deletedIds: number[]; missingIds: number[] }> {
  const store = await SqliteMemoryStore.open();

  try {
    const deletedIds: number[] = [];
    const missingIds: number[] = [];

    for (const id of plan.deleteIds) {
      if (store.forgetMemory(id)) {
        deletedIds.push(id);
      } else {
        missingIds.push(id);
      }
    }

    return { deletedIds, missingIds };
  } finally {
    store.close();
  }
}

async function applyMemoryHygienePlan(plan: MemoryHygienePlanResult): Promise<{ deletedIds: number[]; missingIds: number[] }> {
  const store = await SqliteMemoryStore.open();

  try {
    const deletedIds: number[] = [];
    const missingIds: number[] = [];

    for (const id of plan.deleteIds) {
      if (store.forgetMemory(id)) {
        deletedIds.push(id);
      } else {
        missingIds.push(id);
      }
    }

    return { deletedIds, missingIds };
  } finally {
    store.close();
  }
}

async function loadMemoryDeletePolicy(): Promise<MemoryDeletePolicy> {
  try {
    const config = await loadConfig();
    return config.memory?.deletePolicy ?? "ask";
  } catch {
    return "ask";
  }
}

async function defaultMaintenanceChannel(): Promise<string | undefined> {
  try {
    const config = await loadConfig();
    const telegramOwner = config.channels?.telegram?.enabled ? config.channels.telegram.ownerUserId.trim() : "";
    if (telegramOwner) {
      return `telegram:${telegramOwner}`;
    }

    const zaloOwner = config.channels?.zalo?.enabled ? config.channels.zalo.ownerUserId.trim() : "";
    return zaloOwner ? `zalo:${zaloOwner}` : undefined;
  } catch {
    return undefined;
  }
}

function parseFlagArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--") && index + 1 < args.length && !args[index + 1].startsWith("--")) {
      result[arg] = args[index + 1];
      index += 1;
    }
  }

  return result;
}

function parseAnalyzeMode(argv: string[]): MemoryAnalysisMode | false | undefined {
  const modeFlagIndex = argv.indexOf("--mode");

  if (modeFlagIndex === -1) {
    return undefined;
  }

  const mode = argv[modeFlagIndex + 1];

  if (mode === "all" || mode === "duplicates" || mode === "stale" || mode === "conflicts") {
    return mode;
  }

  console.error("--mode must be one of: all, duplicates, stale, conflicts.");
  process.exitCode = 1;
  return false;
}

function parsePendingSearchQuery(argv: string[]): string {
  const queryParts: string[] = [];

  for (let index = 5; index < argv.length; index += 1) {
    if (argv[index] === "--limit") {
      index += 1;
      continue;
    }

    queryParts.push(argv[index]);
  }

  return queryParts.join(" ").trim();
}

function parseMessageSearchQuery(argv: string[]): string {
  const queryParts: string[] = [];

  for (let index = 5; index < argv.length; index += 1) {
    if (argv[index] === "--limit" || argv[index] === "--role") {
      index += 1;
      continue;
    }

    queryParts.push(argv[index]);
  }

  return queryParts.join(" ").trim();
}

function parseRoleOption(argv: string[]): StoredMessageRole | undefined | false {
  const roleFlagIndex = argv.indexOf("--role");

  if (roleFlagIndex === -1) {
    return undefined;
  }

  const role = argv[roleFlagIndex + 1];

  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  console.error("--role must be one of: user, assistant, system.");
  process.exitCode = 1;
  return false;
}

function parseLimitOption(argv: string[], defaultLimit: number): number | undefined {
  const limitFlagIndex = argv.indexOf("--limit");

  if (limitFlagIndex === -1) {
    return defaultLimit;
  }

  const value = Number(argv[limitFlagIndex + 1]);

  if (!Number.isInteger(value) || value <= 0) {
    console.error("--limit must be a positive integer.");
    process.exitCode = 1;
    return undefined;
  }

  return value;
}

function parsePositiveId(value: string | undefined): number | undefined {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    console.error("Memory id must be a positive integer.");
    process.exitCode = 1;
    return undefined;
  }

  return id;
}

function isMemoryType(type: string | undefined): type is MemoryType {
  return typeof type === "string" && allowedTypes.has(type as MemoryType);
}
