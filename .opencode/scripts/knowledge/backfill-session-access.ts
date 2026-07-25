#!/usr/bin/env bun
// ════════════════════════════════════════════════════════════════════
// backfill-session-access.ts — A2 v13 backfill script
// ════════════════════════════════════════════════════════════════════
// Reads knowledge_cache_state.session_access from substate_kv SQLite
// table (the canonical JSON blob storage per P1-B split architecture),
// then backfills the v11 typed tables:
//   - knowledge_session_access
//   - knowledge_discovery
//   - knowledge_attestation
//
// Uses UPSERT (INSERT ... ON CONFLICT DO UPDATE) which is enabled by
// the v13 unique indexes added in db-manager.ts.
//
// Legacy status mapping: entries created before the Phase 0 discovery/
// attestation separation (pre-2026-06-18) receive status
// 'legacy_discovered_only' in knowledge_session_access. Entries with
// explicit discovery/attestation data use the actual status.
//
// Idempotent: safe to run multiple times. UPSERT ensures no duplicates.
// Row count should stabilize after first run.
//
// Usage:
//   bun .opencode/scripts/knowledge/backfill-session-access.ts
//   bun .opencode/scripts/knowledge/backfill-session-access.ts --dry-run
//   bun .opencode/scripts/knowledge/backfill-session-access.ts --stats-only
//
// @author @Super-Admin
// @version 1.0.0
// @since 2026-06-21
// ════════════════════════════════════════════════════════════════════

import * as path from "node:path";
import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";

const SRC = "backfill-session-access";

// ── Configuration ────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");
const STATS_ONLY = process.argv.includes("--stats-only");

// ── Types ─────────────────────────────────────────────────────────

interface BlobAgent {
  pipeline_task_id?: string;
  declared_scope?: string;
  pipeline_status?: string;
  cache_sufficiency?: any;
  tasks?: Record<string, BlobTask>;
}

interface BlobTask {
  domains?: Record<string, BlobDomain>;
  discovery?: BlobDiscovery;
  attestation?: BlobAttestation;
}

interface BlobDomain {
  declared_at?: string | null;
  pipeline_status?: string;
  kc_dispatched?: boolean;
  cache_sufficiency?: BlobCacheSufficiency;
  discovery?: BlobDiscovery;
  attestation?: BlobAttestation;
}

interface BlobCacheSufficiency {
  status?: string;
  missing_topics?: string[];
  declared_at?: string | null;
  reason?: string;
  files_read?: string[];
  content_summary?: string;
  discovery?: BlobDiscovery;
}

interface BlobDiscovery {
  status?: string;
  missing_topics?: string[];
  discovered_files?: string[];
  discovered_at?: string | null;
}

interface BlobAttestation {
  status?: string;
  reason?: string;
  files_read?: string[];
  content_summary?: string;
  attested_at?: string | null;
  cache_sufficient?: boolean;
  insufficiency_reason?: string;
  retry_count?: number;
}

interface BackfillStats {
  agentsScanned: number;
  tasksScanned: number;
  domainsScanned: number;
  sessionAccessInserted: number;
  sessionAccessUpdated: number;
  discoveryInserted: number;
  discoveryUpdated: number;
  attestationInserted: number;
  attestationUpdated: number;
  legacyCount: number;
  errors: number;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Determine the status for knowledge_session_access based on
 * the domain blob data. Maps legacy and new-format data to
 * standard status values:
 *   - 'attested' — attestation exists with status='attested'
 *   - 'insufficient' — attestation exists with status='insufficient'
 *   - 'discovered' — discovery exists, no attestation
 *   - 'declared' — pipeline_status='declared', no discovery
 *   - 'legacy_discovered_only' — pre-Phase 0, has cache_sufficiency
 *     but no explicit discovery/attestation separation
 */
function resolveSessionStatus(blob: BlobDomain, isLegacy: boolean): string {
  // New format: attestation data exists
  if (blob.attestation) {
    if (blob.attestation.status === "attested") return "attested";
    if (blob.attestation.status === "insufficient") return "insufficient";
    return "attested"; // fallback: attestation exists = attested
  }
  // New format: discovery data exists, no attestation
  if (blob.discovery) {
    if (blob.discovery.status === "sufficient") return "discovered";
    return "declared";
  }
  // Legacy format: cache_sufficiency exists but no discovery/attestation
  if (blob.cache_sufficiency || isLegacy) {
    return "legacy_discovered_only";
  }
  // Only declared
  return blob.pipeline_status || "declared";
}

/**
 * Parse ISO date string or default to null/now.
 */
function parseDateOrNull(val: string | null | undefined): number | null {
  if (!val) return null;
  try {
    const ms = new Date(val).getTime();
    return isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  A2 Backfill: knowledge_session_access from JSON blob ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  if (DRY_RUN) console.log("⚠️  DRY RUN — no writes will be performed\n");
  if (STATS_ONLY) console.log("📊 STATS ONLY — no writes will be performed\n");

  const stats: BackfillStats = {
    agentsScanned: 0,
    tasksScanned: 0,
    domainsScanned: 0,
    sessionAccessInserted: 0,
    sessionAccessUpdated: 0,
    discoveryInserted: 0,
    discoveryUpdated: 0,
    attestationInserted: 0,
    attestationUpdated: 0,
    legacyCount: 0,
    errors: 0,
  };

  // ── Step 1: Read knowledge_cache_state from substate_kv ─────────
  let kcs: any;
  try {
    const db = getDb({ skipSchema: true });
    const row = db
      .query("SELECT json FROM substate_kv WHERE key = ?")
      .get("knowledge_cache_state") as { json: string } | null;

    if (!row || !row.json) {
      console.error(
        "❌ knowledge_cache_state not found in substate_kv. Nothing to backfill.",
      );
      writeLog(SRC, "ERROR", {
        event: "A2-BACKFILL-NO-KCS",
        detail: "substate_kv.knowledge_cache_state is missing",
      });
      process.exit(1);
    }

    kcs = JSON.parse(row.json);
    console.log(
      `✅ Read knowledge_cache_state from substate_kv (${row.json.length} bytes)`,
    );
  } catch (e: any) {
    console.error(`❌ Failed to read substate_kv: ${e.message}`);
    process.exit(1);
  }

  const sessionAccess = kcs.session_access || {};
  const agentKeys = Object.keys(sessionAccess);

  console.log(`   Agents in blob: ${agentKeys.length}`);

  // ── Step 2: Ensure v13 unique indexes + iterate agent→task→domain ──
  // Force re-open DB to trigger initializeSchema (which includes v13 migration).
  // Using forceReset ensures fresh PRAGMA + schema init even if a cached
  // connection exists from prior tool calls in this process.
  const db = getDb({ forceReset: true });

  // Detect schema version for pre-v11 safety
  const sv = db.query("SELECT MAX(version) AS v FROM schema_version").get() as {
    v: number;
  } | null;
  if ((sv?.v ?? 0) < 11) {
    console.error(
      `❌ Schema version is ${sv?.v ?? "unknown"} — need at least v11 for typed knowledge tables. Run framework initializeSchema first.`,
    );
    process.exit(1);
  }

  // Verify v13 indexes exist (defense-in-depth; initializeSchema should have created them)
  const idxCheck = db
    .query(
      `SELECT COUNT(*) AS c FROM sqlite_master
       WHERE type='index' AND name='idx_knowledge_session_access_agent_task_domain_unique'`,
    )
    .get() as { c: number } | null;
  if ((idxCheck?.c ?? 0) === 0) {
    console.log("   Creating v13 unique indexes (not found in DB)...");
    try {
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_session_access_agent_task_domain_unique
         ON knowledge_session_access(agent, task_id, domain_id)`,
      );
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_discovery_agent_task_domain_unique
         ON knowledge_discovery(agent, task_id, domain_id)`,
      );
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_attestation_agent_task_domain_unique
         ON knowledge_attestation(agent, task_id, domain_id)`,
      );
      console.log("   ✅ v13 unique indexes created.");
    } catch (e: any) {
      console.error(`   ❌ Failed to create v13 indexes: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log("   ✅ v13 unique indexes already exist.");
  }

  // Prepare UPSERT statements
  const upsertSession = db.prepare(`
    INSERT INTO knowledge_session_access
      (agent, task_id, domain_id, opencode_session_id, status,
       discovered_at, declared_at, attested_at, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent, task_id, domain_id) DO UPDATE SET
      status = CASE
        WHEN knowledge_session_access.status = 'attested' THEN 'attested'
        WHEN knowledge_session_access.status = 'discovered'
          AND excluded.status IN ('declared', 'legacy_discovered_only') THEN 'discovered'
        WHEN knowledge_session_access.status = 'legacy_discovered_only'
          AND excluded.status = 'declared' THEN 'legacy_discovered_only'
        ELSE excluded.status
      END,
      discovered_at = COALESCE(knowledge_session_access.discovered_at, excluded.discovered_at),
      declared_at = COALESCE(knowledge_session_access.declared_at, excluded.declared_at),
      attested_at = COALESCE(knowledge_session_access.attested_at, excluded.attested_at),
      updated_at = excluded.updated_at
  `);

  const upsertDiscovery = db.prepare(`
    INSERT INTO knowledge_discovery
      (agent, task_id, domain_id, result_status, matched_entries, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent, task_id, domain_id) DO UPDATE SET
      result_status = excluded.result_status,
      matched_entries = excluded.matched_entries,
      created_at = excluded.created_at
  `);

  const upsertAttestation = db.prepare(`
    INSERT INTO knowledge_attestation
      (agent, task_id, domain_id, status, cache_sufficient, files_read,
       evidence_file_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent, task_id, domain_id) DO UPDATE SET
      status = CASE
        WHEN knowledge_attestation.status = 'attested' THEN 'attested'
        ELSE excluded.status
      END,
      cache_sufficient = excluded.cache_sufficient,
      files_read = excluded.files_read,
      evidence_file_count = excluded.evidence_file_count,
      created_at = excluded.created_at
  `);

  const now = Date.now();

  for (const agentKey of agentKeys) {
    const agentEntry: BlobAgent = sessionAccess[agentKey];
    stats.agentsScanned++;

    // ── Handle nested tasks[taskId].domains[domainId] structure ──
    const tasks = agentEntry.tasks || {};

    // Also handle legacy flat entries that have pipeline_task_id + declared_scope
    // but no nested tasks structure
    const hasLegacyFlat =
      agentEntry.pipeline_task_id && agentEntry.declared_scope;
    const hasNestedTasks = Object.keys(tasks).length > 0;

    if (!hasLegacyFlat && !hasNestedTasks) continue;

    // ── A) Process legacy flat entries ────────────────────────────
    if (hasLegacyFlat) {
      const taskId = agentEntry.pipeline_task_id || "unknown";
      const domainId = agentEntry.declared_scope || "all";
      const pipelineStatus = agentEntry.pipeline_status || "declared";
      const isLegacy = !agentEntry.tasks; // no nested tasks = legacy

      stats.tasksScanned++;
      stats.domainsScanned++;

      const sessionStatus =
        pipelineStatus === "declared" ? "declared" : "legacy_discovered_only";

      if (sessionStatus === "legacy_discovered_only") stats.legacyCount++;

      // Perf: check if row already exists before UPSERT
      const existing = db
        .query(
          `SELECT COUNT(*) AS c FROM knowledge_session_access
           WHERE agent = ? AND task_id = ? AND domain_id = ?`,
        )
        .get(agentKey, taskId, domainId) as { c: number } | null;

      if (!DRY_RUN && !STATS_ONLY) {
        try {
          upsertSession.run(
            agentKey,
            taskId,
            domainId,
            sessionStatus,
            null, // discovered_at — set for discovered+
            pipelineStatus === "declared" ? now : null, // declared_at
            null, // attested_at
            now,
            now,
          );
          if ((existing?.c ?? 0) === 0) {
            stats.sessionAccessInserted++;
          } else {
            stats.sessionAccessUpdated++;
          }
        } catch (e: any) {
          stats.errors++;
          writeLog(SRC, "ERROR", {
            event: "A2-BACKFILL-UPSERT-FAIL",
            detail: `agent=${agentKey} task=${taskId} domain=${domainId} err=${e.message}`,
          });
        }
      }

      // Backfill discovery record if cache_sufficiency suggests discovery
      if (agentEntry.cache_sufficiency) {
        const cs = agentEntry.cache_sufficiency;
        const discStatus = cs.discovery?.status || cs.status || "sufficient";
        const discFiles = cs.discovery?.discovered_files?.length || 0;
        const discAt = parseDateOrNull(
          cs.discovery?.discovered_at || cs.declared_at,
        );

        if (!DRY_RUN && !STATS_ONLY) {
          try {
            upsertDiscovery.run(
              agentKey,
              taskId,
              domainId,
              discStatus,
              discFiles,
              discAt || now,
            );
            stats.discoveryInserted++;
          } catch (e: any) {
            // Non-fatal
          }
        }
      }
    }

    // ── B) Process nested tasks structure ──────────────────────────
    for (const taskId of Object.keys(tasks)) {
      const taskEntry: BlobTask = tasks[taskId];
      const domains = taskEntry.domains || {};

      stats.tasksScanned++;

      for (const domainId of Object.keys(domains)) {
        const domainEntry: BlobDomain = domains[domainId];
        stats.domainsScanned++;

        const isLegacy = !domainEntry.discovery && !domainEntry.attestation;
        const sessionStatus = resolveSessionStatus(domainEntry, isLegacy);

        if (sessionStatus === "legacy_discovered_only") stats.legacyCount++;

        // Perf: check if row already exists
        const existing = db
          .query(
            `SELECT COUNT(*) AS c FROM knowledge_session_access
             WHERE agent = ? AND task_id = ? AND domain_id = ?`,
          )
          .get(agentKey, taskId, domainId) as { c: number } | null;

        if (!DRY_RUN && !STATS_ONLY) {
          try {
            upsertSession.run(
              agentKey,
              taskId,
              domainId,
              sessionStatus,
              // discovered_at from discovery timestamp
              parseDateOrNull(domainEntry.discovery?.discovered_at),
              // declared_at from domain or cache_sufficiency
              parseDateOrNull(domainEntry.declared_at),
              // attested_at from attestation timestamp
              parseDateOrNull(domainEntry.attestation?.attested_at),
              now,
              now,
            );
            if ((existing?.c ?? 0) === 0) {
              stats.sessionAccessInserted++;
            } else {
              stats.sessionAccessUpdated++;
            }
          } catch (e: any) {
            stats.errors++;
            writeLog(SRC, "ERROR", {
              event: "A2-BACKFILL-UPSERT-FAIL",
              detail: `agent=${agentKey} task=${taskId} domain=${domainId} err=${e.message}`,
            });
          }
        }

        // Backfill discovery
        if (domainEntry.discovery) {
          if (!DRY_RUN && !STATS_ONLY) {
            try {
              upsertDiscovery.run(
                agentKey,
                taskId,
                domainId,
                domainEntry.discovery.status || "sufficient",
                domainEntry.discovery.discovered_files?.length || 0,
                parseDateOrNull(domainEntry.discovery.discovered_at) || now,
              );
              stats.discoveryInserted++;
            } catch {
              // Non-fatal
            }
          }
        } else if (domainEntry.cache_sufficiency?.discovery) {
          const cd = domainEntry.cache_sufficiency.discovery;
          if (!DRY_RUN && !STATS_ONLY) {
            try {
              upsertDiscovery.run(
                agentKey,
                taskId,
                domainId,
                cd.status || "sufficient",
                cd.discovered_files?.length || 0,
                parseDateOrNull(cd.discovered_at) || now,
              );
              stats.discoveryInserted++;
            } catch {
              // Non-fatal
            }
          }
        }

        // Backfill attestation
        if (domainEntry.attestation) {
          const att = domainEntry.attestation;
          if (!DRY_RUN && !STATS_ONLY) {
            try {
              upsertAttestation.run(
                agentKey,
                taskId,
                domainId,
                att.status || "attested",
                att.cache_sufficient ? 1 : 0,
                JSON.stringify(att.files_read || []),
                (att.files_read || []).length,
                parseDateOrNull(att.attested_at) || now,
              );
              stats.attestationInserted++;
            } catch {
              // Non-fatal
            }
          }
        }
      }
    }
  }

  // ── Step 3: Report ──────────────────────────────────────────────

  // Get final row counts from DB
  const saCount = db
    .query("SELECT COUNT(*) AS c FROM knowledge_session_access")
    .get() as { c: number } | null;
  const discCount = db
    .query("SELECT COUNT(*) AS c FROM knowledge_discovery")
    .get() as { c: number } | null;
  const attCount = db
    .query("SELECT COUNT(*) AS c FROM knowledge_attestation")
    .get() as { c: number } | null;

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║              BACKFILL COMPLETE                         ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`\n📊 Scan Statistics:`);
  console.log(`   Agents scanned:     ${stats.agentsScanned}`);
  console.log(`   Tasks scanned:      ${stats.tasksScanned}`);
  console.log(`   Domains scanned:    ${stats.domainsScanned}`);
  console.log(`   Legacy entries:     ${stats.legacyCount}`);

  if (!STATS_ONLY) {
    console.log(`\n📝 Write Statistics:`);
    console.log(
      `   session_access:     ${stats.sessionAccessInserted} inserted, ${stats.sessionAccessUpdated} updated`,
    );
    console.log(`   discovery:          ${stats.discoveryInserted} inserted`);
    console.log(`   attestation:        ${stats.attestationInserted} inserted`);
  }

  console.log(`\n📦 DB Row Counts After Backfill:`);
  console.log(`   knowledge_session_access: ${saCount?.c ?? "?"} rows`);
  console.log(`   knowledge_discovery:      ${discCount?.c ?? "?"} rows`);
  console.log(`   knowledge_attestation:    ${attCount?.c ?? "?"} rows`);

  if (stats.errors > 0) {
    console.log(`\n⚠️  Errors: ${stats.errors}`);
  }

  console.log(
    `\n✅ Backfill ${DRY_RUN ? "DRY RUN " : ""}${STATS_ONLY ? "STATS ONLY " : ""}complete.`,
  );

  if (!DRY_RUN && !STATS_ONLY) {
    console.log(
      `   Run again to verify idempotency (should produce 0 inserts/updates).`,
    );
  }

  writeLog(SRC, "INFO", {
    event: "A2-BACKFILL-COMPLETE",
    detail: `agents=${stats.agentsScanned} tasks=${stats.tasksScanned} domains=${stats.domainsScanned} sa_inserted=${stats.sessionAccessInserted} sa_updated=${stats.sessionAccessUpdated} legacy=${stats.legacyCount} errors=${stats.errors}`,
  });
}

main().catch((err) => {
  console.error(`❌ Fatal: ${err.message}`);
  writeLog(SRC, "ERROR", { event: "A2-BACKFILL-FATAL", detail: err.message });
  process.exit(1);
});
