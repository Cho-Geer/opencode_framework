#!/usr/bin/env bun
// safe_bash: allow-write
/**
 * indexer.ts — UC7KS Knowledge Indexer v3.0.0 (Phase 2 CLI Ops)
 *
 * CLI wrapper around knowledge-store.ts for manifest operations.
 * v2.0.0 (KC-11): All manifest read/write operations route through
 *   knowledge-store.ts API which operates on v11 DB tables as
 *   canonical source. Direct index.json I/O removed — indexer is
 *   now a thin CLI wrapper.
 * v3.0.0 (Phase 2): Adds materialize/jobs/retry-jobs CLI commands
 *   for DB-canonical knowledge materialization operations.
 *   Integrates writeLog() for script-knowledge-indexer audit trail.
 *
 * Usage: bun .opencode/scripts/knowledge/indexer.ts [command]
 *   stats              — Print manifest statistics as JSON
 *   search <keyword>   — Search entries by keyword
 *   materialize        — Force DB-to-file materialization of index.json
 *   jobs               — List pending/failed materialization jobs
 *   retry-jobs         — Retry all failed materialization jobs
 */

const { createRequire } = require("node:module");
const path = require("node:path");

/**
 * KC-11: Load knowledge-store (ESM) via createRequire for CJS interop.
 * All manifest operations now route through knowledge-store.ts API.
 */
const ksRequire = createRequire(
  path.join(__dirname, "..", "..", "lib", "knowledge-store.ts"),
);
const knowledgeStore = ksRequire("./knowledge-store");

/**
 * Phase 2: Lazy writeLog import for script-knowledge-indexer audit events.
 * Lazily loaded — only required for materialize/jobs/retry-jobs commands.
 * Using createRequire for ESM→CJS interop with log-manager.ts.
 */
let _logManager: any = null;
function getLogManager(): any {
  if (!_logManager) {
    const logRequire = createRequire(
      path.join(__dirname, "..", "..", "lib", "log-manager.ts"),
    );
    _logManager = logRequire("./log-manager");
  }
  return _logManager;
}

function writeCliLog(
  event: string,
  level: "INFO" | "WARN" | "ERROR" = "INFO",
  detail: string = "",
): void {
  try {
    const lm = getLogManager();
    lm.writeLog("script-knowledge-indexer", level, {
      event,
      detail: detail || event,
    });
  } catch {
    // Non-fatal: log failure must not break CLI output
    console.error("[indexer] writeLog failed for event:", event);
  }
}

/**
 * Phase 2: Print CLI output in either human-readable or JSON format.
 */
function output(result: any, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
  }
}

/**
 * Phase 2: Parse --json flag from remaining argv.
 * Returns [isJson, remainingArgs].
 */
function parseJsonFlag(args: string[]): [boolean, string[]] {
  const jsonIdx = args.indexOf("--json");
  if (jsonIdx >= 0) {
    return [true, args.filter((_, i) => i !== jsonIdx)];
  }
  return [false, args];
}

// CLI dispatch
if (require.main === module) {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);

  if (cmd === "stats") {
    const [isJson] = parseJsonFlag(rest);
    const stats = knowledgeStore.getStats();
    output(stats, isJson);
  } else if (cmd === "search") {
    const keyword = process.argv[3];
    if (!keyword) {
      console.error("Usage: bun indexer.ts search <keyword>");
      process.exit(1);
    }
    const hits = knowledgeStore.searchByKeyword(keyword);
    console.log(JSON.stringify(hits, null, 2));
  } else if (cmd === "materialize") {
    /**
     * Phase 2: Force materialization of the knowledge cache from DB to index.json.
     * Calls knowledgeStore.materializeToFile() which internally reads the DB,
     * writes index.json via atomic tmp+rename, and inserts a job row into
     * knowledge_materialization_jobs.
     *
     * Exit code: 0 on success, 1 on failure.
     */
    const [isJson] = parseJsonFlag(rest);
    writeCliLog(
      "KC-INDEXER-MATERIALIZE",
      "INFO",
      "materialize command invoked",
    );
    const ok = knowledgeStore.materializeToFile();
    if (ok) {
      writeCliLog("KC-INDEXER-MATERIALIZE", "INFO", "materialize succeeded");
      output({ ok: true }, isJson);
      process.exit(0);
    } else {
      writeCliLog("KC-INDEXER-MATERIALIZE", "ERROR", "materialize failed");
      output({ ok: false, error: "Materialization failed" }, isJson);
      process.exit(1);
    }
  } else if (cmd === "jobs") {
    /**
     * Phase 2: List pending or failed materialization jobs.
     * Calls knowledgeStore.getPendingMaterializationJobs() which queries
     * knowledge_materialization_jobs WHERE status IN ('pending','failed').
     *
     * Exit code: 0 on success, 1 on exception.
     */
    const [isJson] = parseJsonFlag(rest);
    writeCliLog("KC-INDEXER-JOBS", "INFO", "jobs command invoked");
    try {
      const jobs = knowledgeStore.getPendingMaterializationJobs();
      const summary = {
        count: jobs.length,
        pending: jobs.filter((j: any) => j.status === "pending").length,
        failed: jobs.filter((j: any) => j.status === "failed").length,
        jobs,
      };
      writeCliLog(
        "KC-INDEXER-JOBS",
        "INFO",
        `jobs queried: ${summary.count} total, ${summary.pending} pending, ${summary.failed} failed`,
      );
      output(isJson ? summary : JSON.stringify(summary, null, 2), isJson);
      process.exit(0);
    } catch (err: any) {
      writeCliLog(
        "KC-INDEXER-FAILED",
        "ERROR",
        `jobs query failed: ${err.message || String(err)}`,
      );
      output({ ok: false, error: err.message || String(err) }, isJson);
      process.exit(1);
    }
  } else if (cmd === "retry-jobs") {
    /**
     * Phase 2: Retry all failed materialization jobs.
     * Calls knowledgeStore.retryFailedJobs() which:
     *   1. Increments retry_count and sets status='pending'
     *   2. Re-attempts materializeManifestFromDb()
     *   3. On success: marks original job as 'superseded'
     *   4. On failure: new 'failed' job row is inserted
     *
     * Returns { attempted, succeeded, failed }.
     * Exit code: 0 if failed === 0, 1 otherwise.
     */
    const [isJson] = parseJsonFlag(rest);
    writeCliLog("KC-INDEXER-RETRY-JOBS", "INFO", "retry-jobs command invoked");
    try {
      const result = knowledgeStore.retryFailedJobs();
      writeCliLog(
        "KC-INDEXER-RETRY-JOBS",
        result.failed === 0 ? "INFO" : "WARN",
        `retry-jobs completed: attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`,
      );
      output(result, isJson);
      process.exit(result.failed === 0 ? 0 : 1);
    } catch (err: any) {
      writeCliLog(
        "KC-INDEXER-FAILED",
        "ERROR",
        `retry-jobs failed: ${err.message || String(err)}`,
      );
      output({ ok: false, error: err.message || String(err) }, isJson);
      process.exit(1);
    }
  } else if (cmd === "--help" || cmd === "-h") {
    console.log(`UC7KS Knowledge Indexer v3.0.0 (Phase 2 CLI Ops)

Usage: bun .opencode/scripts/knowledge/indexer.ts [command]

Commands:
  stats                       Print manifest statistics as JSON
  search <keyword>            Search entries by keyword (library_id, query_topic, tags)
  materialize [--json]        Force DB-to-file materialization of docs/official_docs/index.json
  jobs [--json]               List pending/failed materialization jobs (knowledge_materialization_jobs)
  retry-jobs [--json]         Retry all failed materialization jobs

Options:
  --json                      Output machine-readable JSON instead of human-readable text

Architecture:
  - v11 knowledge_entries + knowledge_files + knowledge_entry_tags tables are canonical source.
  - v12 knowledge_materialization_jobs table tracks materialization operations.
  - docs/official_docs/index.json is a materialized view generated from the DB.
  - Atomic tmp+rename strategy (UC7-007) prevents partial writes.
  - All commands route through knowledge-store.ts API.

Job status reference:
  pending     — Awaiting processing or retry
  written     — DB → file materialization succeeded
  failed      — Materialization failed, can be retried
  superseded  — Original job replaced by a subsequent successful materialization
  completed   — Janitor purge/archive/evict maintenance complete

Audit trail: All materialize/jobs/retry-jobs events are logged via writeLog()
  (source: script-knowledge-indexer) to the centralized log system.`);
  } else {
    console.error(
      "Usage: bun indexer.ts stats|search <keyword>|materialize|jobs|retry-jobs",
    );
    console.error("Run with --help for full documentation.");
    process.exit(1);
  }
}

/**
 * KC-11: Re-export knowledge-store functions for backward compat.
 * Scripts that previously imported from indexer can now import from
 * indexer and still work — these delegate to knowledge-store.
 *
 * Phase 2: Also exports materialize/jobs/retry-jobs operations.
 */
module.exports = {
  readManifest: () => knowledgeStore.readManifest(),
  writeManifest: (m: any) => knowledgeStore.writeManifest(m),
  getStats: () => knowledgeStore.getStats(),
  searchEntries: (kw: string) => knowledgeStore.searchByKeyword(kw),
  addEntry: (params: any) => knowledgeStore.addEntry(params),
  INDEX_PATH: knowledgeStore.getIndexJsonPath(),
  // Phase 2 exports
  materializeToFile: () => knowledgeStore.materializeToFile(),
  getPendingMaterializationJobs: () =>
    knowledgeStore.getPendingMaterializationJobs(),
  retryFailedJobs: () => knowledgeStore.retryFailedJobs(),
};

