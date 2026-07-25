// prune-attest.ts — Session access pruning and attestation helpers
// Phase 1f: Split from uc7ks-schema.ts

/**
 * UC7KS Session Access Pruning and Attestation
 *
 * Provides functions for:
 * - Pruning old session access data (pruneSessionAccess, pruneSessionAccessFromDB)
 * - Reading cache attestation from disk (readCacheAttestation)
 * - Checking domain knowledge attestation status (isDomainKnowledgeAttested)
 * - Reading attestation configuration (readAttestationRequired)
 *
 * @since 2026-06-23 (Phase 1f: Split from uc7ks-schema.ts)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../../lib/db-manager";
import { writeLog } from "../../lib/log-manager";
import {
  SessionAccess,
  AgentEntry,
  TaskEntry,
  DomainEntry,
  CacheSufficiency,
  CacheAttestation,
  normalizeAgentKey,
} from "./schema";

const SRC = "uc7ks-prune-attest";

// ── Prune Types ────────────────────────────────────────────────────────

export interface PruneOptions {
  cutoff_ms: number;
  max_entries?: number;
  session_id?: string;
}

export interface PruneResult {
  pruned_agents: number;
  pruned_tasks: number;
  pruned_domains: number;
  retained_agents: number;
  retained_tasks: number;
  retained_domains: number;
}

// ── Prune Session Access (In-Memory) ───────────────────────────────────

/**
 * Prune old session access data based on cutoff timestamp.
 * Removes tasks older than cutoff, then removes empty agents.
 * Returns prune result with counts of pruned vs retained entries.
 */
export function pruneSessionAccess(
  sessionAccess: SessionAccess,
  options: PruneOptions,
): PruneResult {
  const cutoff = options.cutoff_ms;
  let prunedAgents = 0;
  let prunedTasks = 0;
  let prunedDomains = 0;
  let retainedAgents = 0;
  let retainedTasks = 0;
  let retainedDomains = 0;

  const agentKeys = Object.keys(sessionAccess.agents);

  for (const agentKey of agentKeys) {
    const agent = sessionAccess.agents[agentKey];
    const taskIds = Object.keys(agent.tasks);

    for (const taskId of taskIds) {
      const task = agent.tasks[taskId];

      if (task.created_at < cutoff) {
        // Prune this task
        const domainCount = Object.keys(task.domains).length;
        prunedDomains += domainCount;
        prunedTasks++;
        delete agent.tasks[taskId];
      } else {
        // Retain this task
        retainedTasks++;
        const domainCount = Object.keys(task.domains).length;
        retainedDomains += domainCount;
      }
    }

    // Remove agent if no tasks remain
    if (Object.keys(agent.tasks).length === 0) {
      delete sessionAccess.agents[agentKey];
      prunedAgents++;
    } else {
      retainedAgents++;
    }
  }

  sessionAccess.last_updated = Date.now();

  return {
    pruned_agents: prunedAgents,
    pruned_tasks: prunedTasks,
    pruned_domains: prunedDomains,
    retained_agents: retainedAgents,
    retained_tasks: retainedTasks,
    retained_domains: retainedDomains,
  };
}

// ── Prune Session Access (Database) ────────────────────────────────────

/**
 * Prune session access data from SQLite database.
 * Removes tasks older than cutoff, then removes empty agents.
 * Returns prune result with counts of pruned vs retained entries.
 */
export function pruneSessionAccessFromDB(
  options: PruneOptions,
): PruneResult {
  const db = getDb();
  const cutoff = options.cutoff_ms;
  let prunedAgents = 0;
  let prunedTasks = 0;
  let prunedDomains = 0;
  let retainedAgents = 0;
  let retainedTasks = 0;
  let retainedDomains = 0;

  try {
    // Query all agents
    const agents = db
      .query("SELECT DISTINCT agent FROM session_access")
      .all() as any[];

    for (const agentRow of agents) {
      const agentKey = agentRow.agent;

      // Query tasks for this agent
      const tasks = db
        .query(
          "SELECT task_id, created_at FROM session_access WHERE agent = ?",
        )
        .all(agentKey) as any[];

      let agentHasTasks = false;

      for (const taskRow of tasks) {
        if (taskRow.created_at < cutoff) {
          // Prune this task
          const domainCount = db
            .query(
              "SELECT COUNT(*) as count FROM session_access WHERE agent = ? AND task_id = ?",
            )
            .get(agentKey, taskRow.task_id) as any;

          prunedDomains += domainCount.count;
          prunedTasks++;

          db.run(
            "DELETE FROM session_access WHERE agent = ? AND task_id = ?",
            [agentKey, taskRow.task_id],
          );
        } else {
          agentHasTasks = true;
          retainedTasks++;

          const domainCount = db
            .query(
              "SELECT COUNT(*) as count FROM session_access WHERE agent = ? AND task_id = ?",
            )
            .get(agentKey, taskRow.task_id) as any;

          retainedDomains += domainCount.count;
        }
      }

      if (!agentHasTasks) {
        prunedAgents++;
      } else {
        retainedAgents++;
      }
    }

    writeLog(SRC, "INFO", {
      event: "PRUNE-DB-COMPLETE",
      pruned_agents: prunedAgents,
      pruned_tasks: prunedTasks,
      pruned_domains: prunedDomains,
      retained_agents: retainedAgents,
      retained_tasks: retainedTasks,
      retained_domains: retainedDomains,
    });
  } catch (err: any) {
    writeLog(SRC, "ERROR", {
      event: "PRUNE-DB-FAILED",
      error: err.message,
    });
  }

  return {
    pruned_agents: prunedAgents,
    pruned_tasks: prunedTasks,
    pruned_domains: prunedDomains,
    retained_agents: retainedAgents,
    retained_tasks: retainedTasks,
    retained_domains: retainedDomains,
  };
}

// ── Attestation Helpers ────────────────────────────────────────────────

/**
 * Read cache attestation from disk.
 * Loads attestation.json from state directory and parses it.
 * Returns null if file doesn't exist or is invalid.
 */
export function readCacheAttestation(stateDir: string): CacheAttestation | null {
  const attestationPath = path.resolve(stateDir, "attestation.json");

  try {
    if (!fs.existsSync(attestationPath)) {
      return null;
    }

    const content = fs.readFileSync(attestationPath, "utf-8");
    const attestation = JSON.parse(content) as CacheAttestation;
    return attestation;
  } catch (err: any) {
    writeLog(SRC, "WARN", {
      event: "ATTESTATION-READ-FAILED",
      path: attestationPath,
      error: err.message,
    });
    return null;
  }
}

/**
 * Check if a specific domain's knowledge is attested.
 * Returns true if attestation exists and cache_sufficient is true.
 */
export function isDomainKnowledgeAttested(
  stateDir: string,
  domainId: string,
): boolean {
  const attestation = readCacheAttestation(stateDir);
  if (!attestation) return false;

  return attestation.cache_sufficient === true;
}

/**
 * Read whether attestation is required for knowledge domains.
 * Reads from config file in state directory.
 * Defaults to true if config doesn't exist or is invalid.
 */
export function readAttestationRequired(stateDir: string): boolean {
  const configPath = path.resolve(stateDir, "uc7ks-config.json");

  try {
    if (!fs.existsSync(configPath)) {
      return true;
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);
    return config.attestation_required !== false;
  } catch (err: any) {
    writeLog(SRC, "WARN", {
      event: "CONFIG-READ-FAILED",
      path: configPath,
      error: err.message,
    });
    return true;
  }
}
