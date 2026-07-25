import { evaluateMemoryCandidate, type MemoryType } from "../../memory/policy.js";
import { analyzeKnowledgeGraph, planKnowledgeGraphReview, type KnowledgeGraphAnalysis, type KnowledgeGraphReviewPlan } from "../../memory/knowledge-governance.js";
import { isMemoryScope, SqliteMemoryStore, type ConversationSummary, type KnowledgeEntity, type KnowledgeEntityKind, type KnowledgeRelationWithEntities, type KnowledgeSensitivity, type PendingKnowledgeItem, type PendingMemory, type StoredMemory, type StoredMessageRole } from "../../memory/sqlite-store.js";
import { isMemoryRetrievalPolicy, setMemoryRetrievalPolicy } from "../../memory/governance.js";
import { buildMemoryHygieneDoctorReport, fixMemoryHygieneDoctorIssues, formatMemoryHygieneDoctorFixes, formatMemoryHygieneDoctorReport } from "../../memory/hygiene-doctor.js";
import { calculateMemoryHygieneScore } from "../../memory/hygiene-score.js";
import { formatMemoryHygieneStatus } from "../../memory/hygiene-status.js";
import { formatMemoryHygieneTrendReport, recordMemoryHygieneSnapshot } from "../../memory/hygiene-trend.js";
import { MEMORY_MAINTENANCE_DEFAULT_SCHEDULE, installMemoryMaintenanceReport, getMemoryMaintenanceReportStatus, removeMemoryMaintenanceReport, runMemoryMaintenanceDigest } from "../../memory/maintenance.js";
import { applyMemoryRebalancePlan, formatMemoryRebalanceApplyResult, formatMemoryRebalancePlan, planMemoryRebalance } from "../../memory/rebalance.js";
import { formatMemorySummary } from "../../memory/summary.js";
import { formatMemoryTiersReport } from "../../memory/tiers.js";
import { refreshAllConversationSummaries, type ConversationSummaryChannel, type ConversationSummaryRefreshReport } from "../../memory/conversation-summary.js";
import { sendChatCompletionWithFallbacks } from "../../llm/chat-completion.js";
import { loadLlmCandidateSecret, resolvePrimaryLlmCandidate } from "../../llm/resolve-config.js";
import { loadConfig, type MemoryDeletePolicy } from "../../runtime/config.js";
import { MissingConfigError } from "../../runtime/errors.js";
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

const allowedKnowledgeEntityKinds = new Set<KnowledgeEntityKind>([
  "person",
  "project",
  "preference",
  "tool",
  "skill",
  "topic",
  "organization",
  "location",
  "decision",
  "concept",
]);

const allowedKnowledgeSensitivities = new Set<KnowledgeSensitivity>(["normal", "sensitive"]);

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

  if (subcommand === "summary") {
    await showMemorySummary();
    return;
  }

  if (subcommand === "graph") {
    await runMemoryGraphCommand(argv);
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

  if (subcommand === "summaries") {
    if (argv[4] === "refresh") {
      await refreshConversationSummaries(argv);
      return;
    }

    await listConversationSummaries(argv);
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
  console.error("Usage: bestie memory status | pause | resume | list | tiers | rebalance [--dry-run|--apply] [--yes] [--json] | summary | summaries [--channel <name>] [--user <id>] [--limit <n>] [--json] | summaries refresh [--channel terminal|telegram|zalo|ui] [--user <id>] [--limit <n>] [--json] | graph status|search|entities|relations|analyze|review|inspect|add|merge|forget|export | search <query> | analyze [--mode all|duplicates|stale|conflicts] [--json] | hygiene [status|trend|doctor|--apply] [--fix] [--yes] [--json] | digest | cleanup --dry-run|--apply [--yes] [--json] | maintenance install|status|remove [--channel telegram:<id>|zalo:<id>] [--schedule <cron>] | add <type> <content> | inspect <id> | edit <id> <content> | forget <id> | messages [--limit <n>] [--role user|assistant|system] | messages search <query> [--limit <n>] [--role user|assistant|system] | export | clear --yes | pending [--limit <n>] | pending search <query> [--limit <n>] | pending inspect <id> | approve <id> | reject <id> | reject-all --yes");
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

async function showMemorySummary(): Promise<void> {
  const paths = getRuntimePaths();
  const config = await loadConfig();
  const store = await SqliteMemoryStore.open(paths);

  try {
    const memories = store.listActiveMemories();
    const plan = await planMemoryHygieneTool({ paths });
    const rebalance = planMemoryRebalance(memories);
    const trendResult = await readMemoryHygieneTrendTool({ paths });
    const trend = trendResult.latest && trendResult.baseline && trendResult.latest.id !== trendResult.baseline.id
      ? { previousScore: trendResult.baseline.score, delta: trendResult.delta, direction: trendResult.direction }
      : undefined;

    console.log(formatMemorySummary({
      memories,
      plan,
      rebalance,
      trend,
      conversationSummaries: store.listConversationSummaries({ limit: 1000 }),
      deletePolicy: config.memory?.deletePolicy ?? "ask",
      retrievalPolicy: config.memory?.retrievalPolicy ?? "full",
    }));
  } finally {
    store.close();
  }
}

async function runMemoryGraphCommand(argv: string[]): Promise<void> {
  const action = argv[4] ?? "status";

  if (action === "status") {
    await showKnowledgeGraphStatus();
    return;
  }

  if (action === "search") {
    await searchKnowledgeGraph(argv);
    return;
  }

  if (action === "entities") {
    await listKnowledgeEntities(argv);
    return;
  }

  if (action === "relations") {
    await listKnowledgeRelations(argv);
    return;
  }

  if (action === "analyze" || action === "hygiene") {
    await analyzeKnowledgeGraphCommand(argv);
    return;
  }

  if (action === "review" || action === "plan") {
    await reviewKnowledgeGraphCommand(argv);
    return;
  }

  if (action === "inspect") {
    await inspectKnowledgeGraphItem(argv);
    return;
  }

  if (action === "add") {
    await addKnowledgeGraphItem(argv);
    return;
  }

  if (action === "forget" || action === "delete") {
    await forgetKnowledgeGraphItem(argv);
    return;
  }

  if (action === "update" || action === "edit") {
    await updateKnowledgeGraphItem(argv);
    return;
  }

  if (action === "merge") {
    await mergeKnowledgeGraphItem(argv);
    return;
  }

  if (action === "export") {
    await exportKnowledgeGraph();
    return;
  }

  if (action === "pending") {
    if (argv[5] === "inspect") {
      await inspectPendingKnowledgeGraphItem(argv);
      return;
    }
    if (argv[5] === "sanitize") {
      await sanitizePendingKnowledgeGraphItem(argv);
      return;
    }

    await listPendingKnowledgeGraphItems(argv);
    return;
  }

  if (action === "approve") {
    await approvePendingKnowledgeGraphItem(argv);
    return;
  }

  if (action === "reject") {
    await rejectPendingKnowledgeGraphItem(argv);
    return;
  }

  if (action === "reject-all") {
    await rejectAllPendingKnowledgeGraphItems(argv);
    return;
  }

  console.error(`Unknown memory graph command: ${action}`);
  console.error("Usage: bestie memory graph status | search <query> | entities [--kind <kind>] | relations | analyze|hygiene [--json] | review [--json] [--limit <n>] | inspect entity|relation <id> | add entity <kind> <name> | add relation <sourceId> <type> <targetId> [evidence] | update relation <id> [--confidence <n>] [--evidence <text>] [--scope core|project|session] [--sensitivity normal|sensitive] --yes | merge entity <primaryId> <duplicateId> --yes | forget entity|relation <id> | export | pending [--limit <n>] | pending inspect <id> | pending sanitize <id> | approve <id> | reject <id> | reject-all --yes");
  process.exitCode = 1;
}

async function showKnowledgeGraphStatus(): Promise<void> {
  const store = await SqliteMemoryStore.open();
  try {
    const stats = store.getKnowledgeGraphStats();
    console.log(title("Knowledge Graph"));
    console.log(rule());
    console.log(`${badge("ACTIVE", "green")} ${stats.entities} entities, ${stats.relations} relations`);
    if (stats.pending > 0) {
      console.log(`${badge("PENDING", "yellow")} ${stats.pending} pending graph item(s)`);
    }
    console.log(`Next: bestie memory graph search <query>`);
  } finally {
    store.close();
  }
}

async function searchKnowledgeGraph(argv: string[]): Promise<void> {
  const query = argv.slice(5).join(" ").trim();
  if (!query) {
    console.error("Usage: bestie memory graph search <query>");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    const result = store.searchKnowledgeGraph(query);
    if (result.entities.length === 0 && result.relations.length === 0) {
      console.log(`${badge("INFO", "blue")} No matching knowledge graph items.`);
      return;
    }

    console.log(title(`Knowledge Graph Matches (${result.entities.length} entities, ${result.relations.length} relations)`));
    console.log(rule());
    for (const entity of result.entities) {
      console.log(formatKnowledgeEntityLine(entity));
    }
    for (const relation of result.relations) {
      console.log(formatKnowledgeRelationLine(relation));
    }
  } finally {
    store.close();
  }
}

async function listKnowledgeEntities(argv: string[]): Promise<void> {
  const kind = parseKnowledgeKindFlag(argv);
  if (kind === false) {
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    const entities = store.listKnowledgeEntities({ kind, limit: 100 });
    if (entities.length === 0) {
      console.log(`${badge("INFO", "blue")} No active knowledge entities${kind ? ` of kind ${kind}` : ""}.`);
      return;
    }

    console.log(title(`Knowledge Entities (${entities.length})`));
    console.log(rule());
    for (const entity of entities) {
      console.log(formatKnowledgeEntityLine(entity));
    }
  } finally {
    store.close();
  }
}

async function listKnowledgeRelations(argv: string[]): Promise<void> {
  const limit = parseLimitFlag(argv) ?? 100;
  const store = await SqliteMemoryStore.open();
  try {
    const relations = store.listKnowledgeRelations(limit);
    if (relations.length === 0) {
      console.log(`${badge("INFO", "blue")} No active knowledge relations.`);
      return;
    }

    console.log(title(`Knowledge Relations (${relations.length})`));
    console.log(rule());
    for (const relation of relations) {
      console.log(formatKnowledgeRelationLine(relation));
    }
  } finally {
    store.close();
  }
}

async function analyzeKnowledgeGraphCommand(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const store = await SqliteMemoryStore.open();
  try {
    const analysis = analyzeKnowledgeGraph({
      entities: store.listKnowledgeEntities({ limit: 10_000 }),
      relations: store.listKnowledgeRelations(10_000),
      pending: store.listPendingKnowledgeItems(10_000),
    });

    if (json) {
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }

    console.log(formatKnowledgeGraphAnalysis(analysis));
  } finally {
    store.close();
  }
}

async function reviewKnowledgeGraphCommand(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const limit = parseLimitFlag(argv) ?? 10;
  const store = await SqliteMemoryStore.open();
  try {
    const analysis = analyzeKnowledgeGraph({
      entities: store.listKnowledgeEntities({ limit: 10_000 }),
      relations: store.listKnowledgeRelations(10_000),
      pending: store.listPendingKnowledgeItems(10_000),
    });
    const plan = planKnowledgeGraphReview(analysis, limit);

    if (json) {
      console.log(JSON.stringify({ analysis, plan }, null, 2));
      return;
    }

    console.log(formatKnowledgeGraphReviewPlan(plan));
  } finally {
    store.close();
  }
}

function formatKnowledgeGraphReviewPlan(plan: KnowledgeGraphReviewPlan): string {
  const lines = [
    title("Knowledge Graph Review"),
    rule(),
    `${badge(plan.score >= 80 ? "OK" : plan.score >= 60 ? "REVIEW" : "RISK", plan.score >= 80 ? "green" : "yellow")} Score ${plan.score}/100; ${plan.issueCount} issue(s)`,
  ];

  if (plan.suggestions.length === 0) {
    lines.push(`${badge("CLEAN", "green")} No graph review suggestions.`);
    return lines.join("\n");
  }

  for (const [index, suggestion] of plan.suggestions.entries()) {
    lines.push(`${index + 1}. ${badge(suggestion.priority.toUpperCase(), suggestion.priority === "high" ? "yellow" : "cyan")} ${suggestion.title}`);
    lines.push(`   ${suggestion.reason}`);
    lines.push(`   Next: ${suggestion.command}`);
  }
  if (plan.nextCommand) {
    lines.push(`${badge("NEXT", "cyan")} ${plan.nextCommand}`);
  }
  return lines.join("\n");
}

function formatKnowledgeGraphAnalysis(analysis: KnowledgeGraphAnalysis): string {
  const lines = [
    title("Knowledge Graph Hygiene"),
    rule(),
    `${badge(analysis.score >= 80 ? "OK" : analysis.score >= 60 ? "REVIEW" : "RISK", analysis.score >= 80 ? "green" : "yellow")} Score ${analysis.score}/100`,
    `Checked: ${analysis.checkedEntities} entities, ${analysis.checkedRelations} relations`,
  ];

  if (analysis.orphanEntities.length === 0 && analysis.lowConfidenceRelations.length === 0 && analysis.mergeCandidates.length === 0 && analysis.conflictingRelations.length === 0 && analysis.pendingItems.length === 0) {
    lines.push(`${badge("CLEAN", "green")} No graph hygiene issues found.`);
    return lines.join("\n");
  }

  if (analysis.mergeCandidates.length > 0) {
    lines.push(`${badge("MERGE", "yellow")} ${analysis.mergeCandidates.length} possible duplicate entity pair(s).`);
    for (const candidate of analysis.mergeCandidates.slice(0, 10)) {
      lines.push(`   #${candidate.primaryId} ${candidate.primaryName} <- #${candidate.duplicateId} ${candidate.duplicateName} [${candidate.kind}] ${dim(candidate.reason)}`);
    }
  }

  if (analysis.conflictingRelations.length > 0) {
    lines.push(`${badge("CONFLICT", "yellow")} ${analysis.conflictingRelations.length} relation conflict(s) need review.`);
    for (const conflict of analysis.conflictingRelations.slice(0, 10)) {
      lines.push(`   #${conflict.relationIds.join("/#")} ${conflict.source} -> ${conflict.target} types ${conflict.types.join(" vs ")} ${dim(conflict.reason)}`);
    }
  }

  if (analysis.pendingItems.length > 0) {
    lines.push(`${badge("PENDING", "yellow")} ${analysis.pendingItems.length} graph item(s) need review.`);
    for (const item of analysis.pendingItems.slice(0, 10)) {
      lines.push(`   #${item.id}${item.reason ? ` ${dim(item.reason)}` : ""}`);
    }
  }

  if (analysis.orphanEntities.length > 0) {
    lines.push(`${badge("ORPHAN", "yellow")} ${analysis.orphanEntities.length} entity/entities have no relations.`);
    for (const entity of analysis.orphanEntities.slice(0, 10)) {
      lines.push(`   #${entity.id} [${entity.kind}] ${entity.name} ${dim(entity.reason)}`);
    }
  }

  if (analysis.lowConfidenceRelations.length > 0) {
    lines.push(`${badge("LOW", "yellow")} ${analysis.lowConfidenceRelations.length} low-confidence relation(s).`);
    for (const relation of analysis.lowConfidenceRelations.slice(0, 10)) {
      lines.push(`   #${relation.id} ${relation.relation} confidence ${relation.confidence} ${dim(relation.reason)}`);
    }
  }

  lines.push(`Next: bestie memory graph merge entity <primaryId> <duplicateId> --yes or bestie memory graph inspect relation <id>`);
  return lines.join("\n");
}

async function inspectKnowledgeGraphItem(argv: string[]): Promise<void> {
  const kind = argv[5];
  const id = parsePositiveId(argv[6]);
  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    if (kind === "entity") {
      const entity = store.getKnowledgeEntity(id);
      if (!entity) {
        console.log(`${badge("INFO", "blue")} No active knowledge entity found for id ${id}.`);
        return;
      }
      console.log(title(`Knowledge Entity #${entity.id}`));
      console.log(rule());
      console.log(JSON.stringify({ ...entity, neighborhood: store.getKnowledgeEntityNeighborhood(entity.id) }, null, 2));
      return;
    }

    if (kind === "relation") {
      const relation = store.listKnowledgeRelations(1000).find((item) => item.id === id);
      if (!relation) {
        console.log(`${badge("INFO", "blue")} No active knowledge relation found for id ${id}.`);
        return;
      }
      console.log(title(`Knowledge Relation #${relation.id}`));
      console.log(rule());
      console.log(JSON.stringify(relation, null, 2));
      return;
    }

    console.error("Usage: bestie memory graph inspect entity|relation <id>");
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

async function addKnowledgeGraphItem(argv: string[]): Promise<void> {
  const kind = argv[5];
  const store = await SqliteMemoryStore.open();
  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before adding graph items.`);
      return;
    }

    if (kind === "entity") {
      const entityKind = argv[6];
      const name = argv.slice(7).join(" ").trim();
      if (!isKnowledgeEntityKind(entityKind) || !name) {
        console.error("Usage: bestie memory graph add entity <kind> <name>");
        console.error(`Kinds: ${Array.from(allowedKnowledgeEntityKinds).join(", ")}`);
        process.exitCode = 1;
        return;
      }
      const entity = store.upsertKnowledgeEntity({ kind: entityKind, canonicalName: name });
      console.log(`${badge("STORED", "green")} Knowledge entity stored: #${entity.id}`);
      console.log(formatKnowledgeEntityLine(entity));
      return;
    }

    if (kind === "relation") {
      const sourceEntityId = Number(argv[6]);
      const relationType = argv[7];
      const targetEntityId = Number(argv[8]);
      const evidence = argv.slice(9).join(" ").trim();
      if (!Number.isInteger(sourceEntityId) || sourceEntityId <= 0 || !relationType || !Number.isInteger(targetEntityId) || targetEntityId <= 0) {
        console.error("Usage: bestie memory graph add relation <sourceId> <type> <targetId> [evidence]");
        process.exitCode = 1;
        return;
      }
      const relation = store.upsertKnowledgeRelation({ sourceEntityId, relationType, targetEntityId, evidence });
      if (!relation) {
        console.log(`${badge("INFO", "blue")} Source or target entity not found.`);
        return;
      }
      console.log(`${badge("STORED", "green")} Knowledge relation stored: #${relation.id}`);
      return;
    }

    console.error("Usage: bestie memory graph add entity <kind> <name> | relation <sourceId> <type> <targetId> [evidence]");
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

async function forgetKnowledgeGraphItem(argv: string[]): Promise<void> {
  const kind = argv[5];
  const id = parsePositiveId(argv[6]);
  if (!id) {
    return;
  }

  const deletePolicy = await loadMemoryDeletePolicy();
  if (deletePolicy === "deny") {
    console.log(`${badge("DENIED", "red")} memory.deletePolicy is deny. No graph item was deleted.`);
    process.exitCode = 1;
    return;
  }
  if (deletePolicy === "ask" && !argv.includes("--yes")) {
    console.log(`${badge("CONFIRM", "yellow")} Re-run with \`bestie memory graph forget ${kind} ${id} --yes\` to confirm.`);
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    const deleted = kind === "entity" ? store.forgetKnowledgeEntity(id) : kind === "relation" ? store.forgetKnowledgeRelation(id) : undefined;
    if (deleted === undefined) {
      console.error("Usage: bestie memory graph forget entity|relation <id> [--yes]");
      process.exitCode = 1;
      return;
    }
    if (!deleted) {
      console.log(`${badge("INFO", "blue")} No active knowledge ${kind} found for id ${id}.`);
      return;
    }
    console.log(`${badge("FORGOT", "green")} Knowledge ${kind} forgotten: #${id}`);
  } finally {
    store.close();
  }
}

async function updateKnowledgeGraphItem(argv: string[]): Promise<void> {
  const kind = argv[5];
  const id = parsePositiveId(argv[6]);
  if (kind !== "relation" || !id) {
    console.error("Usage: bestie memory graph update relation <id> [--confidence <n>] [--evidence <text>] [--scope core|project|session] [--sensitivity normal|sensitive] --yes");
    process.exitCode = 1;
    return;
  }

  const confidence = parseConfidenceFlag(argv);
  if (confidence === false) return;
  const evidence = parseTextFlag(argv, "--evidence");
  if (evidence === false) return;
  const scope = parseScopeFlag(argv);
  if (scope === false) return;
  const sensitivity = parseKnowledgeSensitivityFlag(argv);
  if (sensitivity === false) return;

  if (confidence === undefined && evidence === undefined && scope === undefined && sensitivity === undefined) {
    console.error("Provide at least one of --confidence, --evidence, --scope, or --sensitivity.");
    process.exitCode = 1;
    return;
  }

  const deletePolicy = await loadMemoryDeletePolicy();
  if (deletePolicy === "deny") {
    console.log(`${badge("DENIED", "red")} memory.deletePolicy is deny. No graph relation was updated.`);
    process.exitCode = 1;
    return;
  }
  if (deletePolicy === "ask" && !argv.includes("--yes")) {
    console.log(`${badge("CONFIRM", "yellow")} Re-run with \`bestie memory graph update relation ${id} --yes\` plus the same update flags to confirm.`);
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before updating graph relations.`);
      return;
    }

    const relation = store.updateKnowledgeRelation(id, { confidence, evidence, scope, sensitivity });
    if (!relation) {
      console.log(`${badge("INFO", "blue")} No active knowledge relation found for id ${id}.`);
      return;
    }
    console.log(`${badge("UPDATED", "green")} Knowledge relation updated: #${id}`);
    console.log(JSON.stringify(relation, null, 2));
  } finally {
    store.close();
  }
}

async function mergeKnowledgeGraphItem(argv: string[]): Promise<void> {
  const kind = argv[5];
  const primaryId = parsePositiveId(argv[6]);
  const duplicateId = parsePositiveId(argv[7]);
  if (kind !== "entity" || !primaryId || !duplicateId) {
    console.error("Usage: bestie memory graph merge entity <primaryId> <duplicateId> --yes");
    process.exitCode = 1;
    return;
  }

  const deletePolicy = await loadMemoryDeletePolicy();
  if (deletePolicy === "deny") {
    console.log(`${badge("DENIED", "red")} memory.deletePolicy is deny. No graph entity was merged.`);
    process.exitCode = 1;
    return;
  }
  if (deletePolicy === "ask" && !argv.includes("--yes")) {
    console.log(`${badge("CONFIRM", "yellow")} Re-run with \`bestie memory graph merge entity ${primaryId} ${duplicateId} --yes\` to confirm.`);
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before merging graph entities.`);
      return;
    }

    const result = store.mergeKnowledgeEntities(primaryId, duplicateId);
    if (!result) {
      console.log(`${badge("INFO", "blue")} Could not merge graph entities. Check that both ids are active entities with the same kind.`);
      return;
    }

    console.log(`${badge("MERGED", "green")} Knowledge entity merged: #${result.primary.id} <- #${result.duplicate.id}`);
    console.log(formatKnowledgeEntityLine(result.primary));
    console.log(`${badge("RELATIONS", "cyan")} redirected ${result.redirectedRelations}, merged ${result.mergedRelations}`);
  } finally {
    store.close();
  }
}

async function exportKnowledgeGraph(): Promise<void> {
  const store = await SqliteMemoryStore.open();
  try {
    console.log(JSON.stringify({
      entities: store.listKnowledgeEntities({ limit: 10_000 }),
      relations: store.listKnowledgeRelations(10_000),
      pending: store.listPendingKnowledgeItems(10_000),
    }, null, 2));
  } finally {
    store.close();
  }
}

async function listPendingKnowledgeGraphItems(argv: string[]): Promise<void> {
  const limit = parseLimitOption(argv, 20);
  if (!limit) {
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    const pending = store.listPendingKnowledgeItems(limit);
    if (pending.length === 0) {
      console.log(`${badge("INFO", "blue")} No pending knowledge graph items.`);
      return;
    }

    console.log(title(`Pending Knowledge Graph Items (${pending.length})`));
    console.log(rule());
    for (const item of pending) {
      console.log(formatPendingKnowledgeGraphBlock(item));
    }
    console.log(`${badge("NEXT", "cyan")} Approve with \`bestie memory graph approve <id>\` or reject with \`bestie memory graph reject <id>\`. Inspect details with \`bestie memory graph pending inspect <id>\`.`);
  } finally {
    store.close();
  }
}

async function inspectPendingKnowledgeGraphItem(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[6]);
  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    const item = store.getPendingKnowledgeItem(id);
    if (!item) {
      console.log(`${badge("INFO", "blue")} No pending knowledge graph item found for id ${id}.`);
      return;
    }
    console.log(JSON.stringify(item, null, 2));
  } finally {
    store.close();
  }
}

async function sanitizePendingKnowledgeGraphItem(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[6]);
  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before sanitizing pending knowledge graph items.`);
      return;
    }

    const sanitized = store.sanitizePendingKnowledgeItem(id);
    if (!sanitized) {
      console.log(`${badge("INFO", "blue")} No pending knowledge graph item found for id ${id}.`);
      return;
    }
    if (sanitized.status === "blocked") {
      console.log(`${badge("BLOCKED", "red")} Pending knowledge graph item could not be sanitized automatically.`);
      console.log(`${badge("WHY", "yellow")} ${sanitized.explanation ?? sanitized.reason}`);
      console.log(`${badge("NEXT", "cyan")} Reject with \`bestie memory graph reject ${id}\` or recreate the item manually with sanitized evidence.`);
      return;
    }

    console.log(`${badge("SANITIZED", "green")} Pending knowledge graph item sanitized: ${id}`);
    if (sanitized.previousDiagnostics?.blockedBy.length) {
      console.log(`${badge("REMOVED", "cyan")} ${sanitized.previousDiagnostics.blockedBy.join(", ")}`);
    }
    console.log(formatPendingKnowledgeGraphBlock(sanitized.item));
    console.log(`${badge("NEXT", "cyan")} Approve with \`bestie memory graph approve ${id}\` or inspect with \`bestie memory graph pending inspect ${id}\`.`);
  } finally {
    store.close();
  }
}

async function approvePendingKnowledgeGraphItem(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[5]);
  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    if (store.getMemoryState().paused) {
      console.log(`${badge("PAUSED", "yellow")} Memory is paused. Run \`bestie memory resume\` before approving pending knowledge graph items.`);
      return;
    }

    const approved = store.approvePendingKnowledgeItem(id);
    if (!approved) {
      console.log(`${badge("INFO", "blue")} No pending knowledge graph item found for id ${id}.`);
      return;
    }
    if (approved.status === "blocked") {
      console.log(`${badge("BLOCKED", "red")} Pending knowledge graph item was not stored.`);
      console.log(`${badge("WHY", "yellow")} ${approved.explanation ?? approved.reason}`);
      console.log(`${badge("NEXT", "cyan")} Reject with \`bestie memory graph reject ${id}\` or recreate the item with sanitized evidence.`);
      return;
    }

    console.log(`${badge("APPROVED", "green")} Pending knowledge graph item approved: ${id}`);
    console.log(`${badge("STORED", "green")} ${approved.entities.length} entities, ${approved.relations.length} relations`);
  } finally {
    store.close();
  }
}

async function rejectPendingKnowledgeGraphItem(argv: string[]): Promise<void> {
  const id = parsePositiveId(argv[5]);
  if (!id) {
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    const rejected = store.rejectPendingKnowledgeItem(id);
    if (!rejected) {
      console.log(`${badge("INFO", "blue")} No pending knowledge graph item found for id ${id}.`);
      return;
    }
    console.log(`${badge("REJECTED", "green")} Pending knowledge graph item rejected: ${id}`);
  } finally {
    store.close();
  }
}

async function rejectAllPendingKnowledgeGraphItems(argv: string[]): Promise<void> {
  if (!argv.includes("--yes")) {
    console.log("Pending knowledge graph items not rejected. Re-run with `bestie memory graph reject-all --yes` to clear the graph pending queue.");
    process.exitCode = 1;
    return;
  }

  const store = await SqliteMemoryStore.open();
  try {
    let rejectedCount = 0;
    for (const item of store.listPendingKnowledgeItems(10_000)) {
      if (store.rejectPendingKnowledgeItem(item.id)) {
        rejectedCount += 1;
      }
    }
    console.log(`${badge("REJECTED", "green")} Pending knowledge graph items rejected: ${rejectedCount}`);
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
  const timeZone = await loadAgentTimeZoneIfConfigured();
  const args = parseFlagArgs(argv.slice(5));
  const scheduleValue = args["--schedule"] ?? MEMORY_MAINTENANCE_DEFAULT_SCHEDULE;
  const channel = args["--channel"] ?? (await defaultMaintenanceChannel());

  const result = await installMemoryMaintenanceReport({ channel, scheduleValue, timeZone });
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

async function listConversationSummaries(argv: string[] = process.argv): Promise<void> {
  const limit = parseLimitOption(argv, 20);
  const channel = parseTextFlag(argv, "--channel");
  const userId = parseTextFlag(argv, "--user");
  const json = argv.includes("--json");

  if (!limit || channel === false || userId === false) {
    return;
  }

  const store = await SqliteMemoryStore.open();

  try {
    const summaries = store.listConversationSummaries({ channel, userId, limit });
    if (json) {
      console.log(JSON.stringify({ summaries }, null, 2));
      return;
    }

    if (summaries.length === 0) {
      console.log(`${badge("INFO", "blue")} No rolling conversation summaries yet.`);
      return;
    }

    console.log(title(`Conversation Summaries (${summaries.length})`));
    console.log(rule());
    for (const summary of summaries) {
      console.log(formatConversationSummaryBlock(summary));
    }
  } finally {
    store.close();
  }
}

async function refreshConversationSummaries(argv: string[] = process.argv): Promise<void> {
  const limit = parseLimitOption(argv, 20);
  const rawChannel = parseTextFlag(argv, "--channel");
  const userId = parseTextFlag(argv, "--user");
  const json = argv.includes("--json");
  const paths = getRuntimePaths();

  if (!limit || rawChannel === false || userId === false) {
    return;
  }

  const channel = parseConversationSummaryChannel(rawChannel);
  if (channel === false) {
    return;
  }

  const config = await loadConfig(paths);
  const apiKey = await loadLlmCandidateSecret(resolvePrimaryLlmCandidate(config), paths);
  const report = await refreshAllConversationSummaries({
    config,
    paths,
    apiKey,
    channel,
    userId,
    limit,
    chatCompletion: async (currentConfig, _apiKey, options) => sendChatCompletionWithFallbacks(currentConfig, options, { paths }),
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatConversationSummaryRefreshReport(report));
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

function formatConversationSummaryBlock(summary: ConversationSummary): string {
  const owner = summary.userId ? `${summary.channel}:${summary.userId}` : summary.channel;
  const content = summary.content.length > 500 ? `${summary.content.slice(0, 497)}...` : summary.content;
  return [
    `${badge("SUMMARY", "cyan")} #${summary.id} ${owner} ${dim(`updated ${summary.updatedAt}; summarized through message #${summary.summarizedMessageId}`)}`,
    `   ${content}`,
  ].join("\n");
}

function formatConversationSummaryRefreshReport(report: ConversationSummaryRefreshReport): string {
  const lines = [
    title("Conversation Summary Refresh"),
    rule(),
    `${badge(report.failed > 0 ? "WARN" : "OK", report.failed > 0 ? "yellow" : "green")} Checked ${report.checked}; refreshed ${report.refreshed}; skipped ${report.skipped}; failed ${report.failed}; recent window ${report.recentMessageLimit}`,
  ];

  if (report.paused) {
    lines.push(`${badge("PAUSED", "yellow")} Memory is paused; no summaries refreshed.`);
    return lines.join("\n");
  }

  if (report.items.length === 0) {
    lines.push(`${badge("CLEAN", "green")} No stale long conversation summaries found.`);
    return lines.join("\n");
  }

  for (const item of report.items) {
    const owner = item.userId ? `${item.channel}:${item.userId}` : item.channel;
    const statusBadge = item.status === "refreshed" ? badge("REFRESHED", "green") : item.status === "failed" ? badge("FAILED", "red") : badge("SKIPPED", "yellow");
    const detail = item.summarizedMessageId ? `summarized through message #${item.summarizedMessageId}` : item.reason ?? "no detail";
    lines.push(`${statusBadge} ${owner} ${dim(`${item.messageCount} message(s); ${detail}`)}`);
  }

  return lines.join("\n");
}

function formatKnowledgeEntityLine(entity: KnowledgeEntity): string {
  const aliases = entity.aliases.length > 0 ? ` aliases ${entity.aliases.join(", ")}` : "";
  return `${badge(entity.kind.toUpperCase(), "cyan")} #${entity.id} scope ${entity.scope} confidence ${entity.confidence} ${dim(`${entity.sensitivity}; updated ${entity.updatedAt}`)} ${entity.canonicalName}${aliases}`;
}

function formatKnowledgeRelationLine(relation: KnowledgeRelationWithEntities): string {
  const evidence = relation.evidence ? ` ${dim(relation.evidence)}` : "";
  return `${badge("RELATION", "cyan")} #${relation.id} ${relation.sourceEntity.canonicalName} --${relation.relationType}--> ${relation.targetEntity.canonicalName} confidence ${relation.confidence}${evidence}`;
}

function formatPendingKnowledgeGraphBlock(item: PendingKnowledgeItem): string {
  const payload = JSON.stringify(item.payload);
  const preview = payload.length > 220 ? `${payload.slice(0, 217)}...` : payload;
  return [
    `${badge("PENDING", "yellow")} #${item.id} ${dim(`source ${item.source ?? "unknown"}; created ${item.createdAt}`)}`,
    item.reason ? `   Reason: ${item.reason}` : undefined,
    `   Payload: ${preview}`,
  ].filter(Boolean).join("\n");
}

function isKnowledgeEntityKind(value: string | undefined): value is KnowledgeEntityKind {
  return value !== undefined && allowedKnowledgeEntityKinds.has(value as KnowledgeEntityKind);
}

function parseKnowledgeKindFlag(argv: string[]): KnowledgeEntityKind | undefined | false {
  const index = argv.indexOf("--kind");
  if (index === -1) {
    return undefined;
  }
  const kind = argv[index + 1];
  if (!isKnowledgeEntityKind(kind)) {
    console.error(`--kind must be one of: ${Array.from(allowedKnowledgeEntityKinds).join(", ")}`);
    process.exitCode = 1;
    return false;
  }
  return kind;
}

function parseLimitFlag(argv: string[]): number | undefined {
  const index = argv.indexOf("--limit");
  if (index === -1) {
    return undefined;
  }
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    console.error("--limit must be a positive integer.");
    process.exitCode = 1;
    return undefined;
  }
  return value;
}

function parseConfidenceFlag(argv: string[]): number | undefined | false {
  const index = argv.indexOf("--confidence");
  if (index === -1) {
    return undefined;
  }
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    console.error("--confidence must be a number between 0 and 1.");
    process.exitCode = 1;
    return false;
  }
  return value;
}

function parseTextFlag(argv: string[], flag: string): string | undefined | false {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${flag} requires a value.`);
    process.exitCode = 1;
    return false;
  }
  return value;
}

function parseConversationSummaryChannel(value: string | undefined): ConversationSummaryChannel | undefined | false {
  if (value === undefined) {
    return undefined;
  }
  if (value === "terminal" || value === "telegram" || value === "zalo" || value === "ui") {
    return value;
  }

  console.error("--channel must be one of: terminal, telegram, zalo, ui.");
  process.exitCode = 1;
  return false;
}

function parseScopeFlag(argv: string[]): "core" | "project" | "session" | undefined | false {
  const index = argv.indexOf("--scope");
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!isMemoryScope(value)) {
    console.error("--scope must be core, project, or session.");
    process.exitCode = 1;
    return false;
  }
  return value;
}

function parseKnowledgeSensitivityFlag(argv: string[]): KnowledgeSensitivity | undefined | false {
  const index = argv.indexOf("--sensitivity");
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!allowedKnowledgeSensitivities.has(value as KnowledgeSensitivity)) {
    console.error(`--sensitivity must be one of: ${Array.from(allowedKnowledgeSensitivities).join(", ")}`);
    process.exitCode = 1;
    return false;
  }
  return value as KnowledgeSensitivity;
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

async function loadAgentTimeZoneIfConfigured(): Promise<string | undefined> {
  try {
    return (await loadConfig()).agent.timeZone;
  } catch (error) {
    if (error instanceof MissingConfigError) {
      return undefined;
    }
    throw error;
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
