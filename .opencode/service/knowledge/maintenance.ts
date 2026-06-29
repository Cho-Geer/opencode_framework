// service/knowledge/maintenance.ts — Knowledge Cache Maintenance
// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Extracted from tools/janitor.ts (245L) + tools/nightly-compaction.ts (287L).
// Handles orphan detection, stale cleanup, index compaction, session pruning.

import * as fs from "node:fs";
import * as path from "node:path";
import { tolerantParse } from "../../lib/tolerant-json";
import { writeLog } from "../../lib/log-manager";
import { readSubState, writeSubState } from "../../lib/substate-manager";
import { type PruneOptions } from "./schema";
import { pruneSessionAccess } from "./prune-attest";
import {
  incrementAuditCounter,
  pushAuditEvent,
  touchKnowledgeAcquisition,
} from "./audit";

const SRC = "knowledge-maintenance";

// ── Janitor Types ─────────────────────────────────────────────────────

export interface RunJanitorOptions {
  dryRun: boolean;
  removeOrphans: boolean;
  maxTtlDays: number;
}

export interface JanitorReport {
  index_found: boolean;
  total_entries: number;
  orphan_entries: string[];
  reverse_orphan_files: string[];
  stale_entries: string[];
  removed_count: number;
  dry_run: boolean;
  error?: string;
}

// ── Janitor ──────────────────────────────────────────────────────────

export function runJanitor(options: RunJanitorOptions): JanitorReport {
  const { dryRun, removeOrphans, maxTtlDays } = options;
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const docsDir = path.resolve(projectRoot, "docs", "official_docs");
  const indexPath = path.resolve(docsDir, "index.json");

  const report: JanitorReport = {
    index_found: false,
    total_entries: 0,
    orphan_entries: [],
    reverse_orphan_files: [],
    stale_entries: [],
    removed_count: 0,
    dry_run: dryRun,
  };

  // ── 1. Read index.json ──
  if (!fs.existsSync(indexPath)) {
    writeLog(SRC, "WARN", { event: "JANITOR-NO-INDEX", detail: `index.json not found at ${indexPath}` });
    return { ...report, error: "index.json not found" };
  }

  let index: any;
  try {
    index = tolerantParse(fs.readFileSync(indexPath, "utf8"));
    if (!index.entries || !Array.isArray(index.entries)) {
      return { ...report, error: "Malformed index.json" };
    }
  } catch (e: any) {
    return { ...report, error: `Failed to parse index.json: ${e.message}` };
  }

  report.index_found = true;
  report.total_entries = index.entries.length;

  // ── 2. Detect orphan + stale entries ──
  const entries: any[] = index.entries;
  const now = Date.now();
  const validEntries: any[] = [];

  for (const entry of entries) {
    const files = entry.files || [];
    let allFilesExist = true;
    let isWithinTtl = true;

    for (const f of files) {
      if (!fs.existsSync(path.resolve(docsDir, f.path))) allFilesExist = false;
      if (f.ttl_days && f.created_at) {
        const ageDays = (now - new Date(f.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > f.ttl_days || ageDays > maxTtlDays) isWithinTtl = false;
      }
    }

    if (!allFilesExist) {
      report.orphan_entries.push(`${entry.library_id}/${(entry.query_topic || "unknown").substring(0, 60)}`);
    } else if (!isWithinTtl) {
      report.stale_entries.push(`${entry.library_id}/${(entry.query_topic || "unknown").substring(0, 60)}`);
    } else {
      validEntries.push(entry);
    }
  }

  // ── 3. Detect reverse-orphan files ──
  const indexedPaths = new Set<string>();
  for (const entry of entries) {
    for (const f of (entry.files || [])) {
      indexedPaths.add(path.normalize(path.resolve(docsDir, f.path)));
    }
  }

  try {
    if (fs.existsSync(docsDir)) {
      const walkDir = function (dir: string, depth: number) {
        if (depth > 8) return;
        try {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            if (item.startsWith(".") || item === "index.json") continue;
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) walkDir(fullPath, depth + 1);
            else if (stat.isFile()) {
              const normalized = path.normalize(fullPath);
              if (!indexedPaths.has(normalized)) {
                report.reverse_orphan_files.push(path.relative(docsDir, normalized));
              }
            }
          }
        } catch {}
      };
      walkDir(docsDir, 0);
    }
  } catch {}

  // ── 4. Audit counters (non-fatal) ──
  if (report.orphan_entries.length > 0 || report.reverse_orphan_files.length > 0) {
    try {
      incrementAuditCounter("reverse_orphan_count",
        report.orphan_entries.length + report.reverse_orphan_files.length);
    } catch {}
  }

  // ── 5. Remove orphans if requested ──
  if (removeOrphans && !dryRun) {
    try {
      index.entries = validEntries;
      index.total_entries = validEntries.length;
      index.last_janitor_run = new Date().toISOString();
      const tmpPath = indexPath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
      fs.renameSync(tmpPath, indexPath);
      report.removed_count = entries.length - validEntries.length;
      try {
        incrementAuditCounter("last_cleanup_removed_session_entries", report.removed_count);
      } catch {}
    } catch (e: any) {
      writeLog(SRC, "ERROR", { event: "JANITOR-REMOVE-FAILED", detail: e.message });
    }
  }

  // ── 6. Audit event ──
  try {
    pushAuditEvent({
      event: "KC-JANITOR-RUN",
      timestamp: new Date().toISOString(),
      detail: `dry_run=${dryRun} orphans=${report.orphan_entries.length} reverse_orphans=${report.reverse_orphan_files.length} stale=${report.stale_entries.length} removed=${report.removed_count}`,
    });
  } catch {}

  writeLog(SRC, "INFO", {
    event: "JANITOR-COMPLETE",
    detail: `orphans=${report.orphan_entries.length} reverse=${report.reverse_orphan_files.length} stale=${report.stale_entries.length} removed=${report.removed_count} dry_run=${dryRun}`,
  });

  return report;
}

// ── Nightly Compaction Types ─────────────────────────────────────────

export interface NightlyCompactionOptions {
  compactIndex: boolean;
  pruneSessions: boolean;
  maxSessionAgeDays: number;
}

export interface CompactionReport {
  compaction_run_at: string;
  index_size_bytes: number;
  index_entries_before: number;
  index_entries_after: number;
  index_compacted: boolean;
  sessions_pruned: boolean;
  prune_stats: {
    removed_agent_entries: number;
    removed_task_entries: number;
    removed_domain_entries: number;
    removed_stale_agents: number;
  };
}

// ── Nightly Compaction ───────────────────────────────────────────────

export function nightlyCompaction(options: NightlyCompactionOptions): CompactionReport {
  const { compactIndex, pruneSessions, maxSessionAgeDays } = options;
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  const indexPath = path.resolve(projectRoot, "docs", "official_docs", "index.json");
  const configPath = path.resolve(projectRoot, ".opencode", "project.config.json");

  const report: CompactionReport = {
    compaction_run_at: new Date().toISOString(),
    index_size_bytes: 0,
    index_entries_before: 0,
    index_entries_after: 0,
    index_compacted: false,
    sessions_pruned: false,
    prune_stats: {
      removed_agent_entries: 0,
      removed_task_entries: 0,
      removed_domain_entries: 0,
      removed_stale_agents: 0,
    },
  };

  // ── 1. Index compaction ──
  if (compactIndex && fs.existsSync(indexPath)) {
    try {
      const index = tolerantParse(fs.readFileSync(indexPath, "utf8"));
      report.index_size_bytes = fs.statSync(indexPath).size;
      report.index_entries_before = (index.entries || []).length;

      const entries = index.entries || [];
      const now = Date.now();
      const validEntries: any[] = [];
      let removedBecauseStale = 0;

      for (const entry of entries) {
        const files = entry.files || [];
        let allFilesExist = true;
        let isStale = false;

        for (const f of files) {
          if (!fs.existsSync(path.resolve(projectRoot, "docs", "official_docs", f.path))) {
            allFilesExist = false;
          }
          if (f.ttl_days && f.created_at) {
            const ageDays = (now - new Date(f.created_at).getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays > Math.min(f.ttl_days, maxSessionAgeDays * 2)) isStale = true;
          }
        }

        if (allFilesExist && !isStale) validEntries.push(entry);
        else removedBecauseStale++;
      }

      if (validEntries.length < entries.length) {
        index.entries = validEntries;
        index.total_entries = validEntries.length;
        index.last_compaction = new Date().toISOString();
        const tmpPath = indexPath + ".tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
        fs.renameSync(tmpPath, indexPath);
        report.index_compacted = true;
        report.index_entries_after = validEntries.length;
        try {
          incrementAuditCounter("last_cleanup_removed_session_entries", removedBecauseStale);
        } catch {}
      } else {
        report.index_entries_after = entries.length;
      }
    } catch (e: any) {
      writeLog(SRC, "ERROR", { event: "COMPACTION-INDEX-FAILED", detail: e.message });
    }
  }

  // ── 2. Session access pruning ──
  if (pruneSessions) {
    try {
      let config: any = {};
      try {
        if (fs.existsSync(configPath)) {
          config = tolerantParse(fs.readFileSync(configPath, "utf8"));
        }
      } catch {}

      let kcs: any = {};
      try { kcs = readSubState("knowledge_cache_state"); } catch {}
      const sa = kcs?.session_access || {};

      const pruneOpts: PruneOptions = {
        session_access_ttl_days:
          config?.template_resolution?.["knowledge.session_access_ttl_days"] || maxSessionAgeDays,
        session_access_max_tasks_per_agent:
          config?.template_resolution?.["knowledge.session_access_max_tasks_per_agent"] || 50,
        session_access_max_domains_per_task:
          config?.template_resolution?.["knowledge.session_access_max_domains_per_task"] || 8,
        session_access_preserve_attested_days:
          config?.template_resolution?.["knowledge.session_access_preserve_attested_days"] || 90,
      };

      const pruneResult = pruneSessionAccess(sa, pruneOpts);
      if (
        pruneResult.removedTaskEntries > 0 ||
        pruneResult.removedDomainEntries > 0 ||
        pruneResult.removedStaleAgents > 0
      ) {
        try { writeSubState("knowledge_cache_state", kcs); } catch {}
        report.sessions_pruned = true;
        report.prune_stats = {
          removed_agent_entries: pruneResult.removedTaskEntries,
          removed_task_entries: pruneResult.removedTaskEntries,
          removed_domain_entries: pruneResult.removedDomainEntries,
          removed_stale_agents: pruneResult.removedStaleAgents,
        };
        const totalRemoved =
          (pruneResult.removedTaskEntries || 0) +
          (pruneResult.removedDomainEntries || 0) +
          (pruneResult.removedStaleAgents || 0);
        if (totalRemoved > 0) {
          try { incrementAuditCounter("last_cleanup_removed_session_entries", totalRemoved); } catch {}
        }
      }
    } catch (e: any) {
      writeLog(SRC, "ERROR", { event: "COMPACTION-PRUNE-FAILED", detail: e.message });
    }
  }

  // ── 3. Audit timestamps + event ──
  try { touchKnowledgeAcquisition(); } catch {}
  try {
    pushAuditEvent({
      event: "KC-NIGHTLY-COMPACTION",
      timestamp: new Date().toISOString(),
      detail: `index_before=${report.index_entries_before} index_after=${report.index_entries_after} prune=${JSON.stringify(report.prune_stats)}`,
    });
  } catch {}

  writeLog(SRC, "INFO", {
    event: "NIGHTLY-COMPACTION-COMPLETE",
    detail: `compacted=${report.index_compacted} pruned=${report.sessions_pruned} removed_index=${report.index_entries_before - report.index_entries_after}`,
  });

  return report;
}
