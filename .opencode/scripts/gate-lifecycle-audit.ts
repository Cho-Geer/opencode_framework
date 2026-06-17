#!/usr/bin/env bun
// gate-lifecycle-audit.ts — P4-003
// Audits gate sessions for lifecycle compliance via DB (Post-Step-8 migration).
// --auto-drain flag moves stale sessions (>24h armed) to drained_sessions.
// FW-PLAN-JS-TO-TS: Unified to TypeScript + Bun; reads from DB via db-state-manager.
// Post-Step-8 DB-only migration: gate-state.json is frozen snapshot.
// Read from DB via dbLoadGateStore() for accurate session state.
const {
  readJsonFile,
  resolveFrameworkPaths,
} = require("../lib/gate-core.ts");
const {
  dbLoadGateStore,
  dbSaveGateStore,
  dbArchiveDrainedSession,
} = require("../lib/db-state-manager");

const paths = resolveFrameworkPaths();
const GATE_STATE_PATH = paths.gateState;

const HOURS_24_MS = 24 * 60 * 60 * 1000;

function main() {
  const args = process.argv.slice(2);
  const autoDrain = args.includes("--auto-drain");

  const violations = [];
  const staleSessions = [];
  let activeCount = 0;
  let drainedCount = 0;

  const gateState = dbLoadGateStore();

  if (!gateState) {
    console.log(
      JSON.stringify(
        {
          active_count: 0,
          drained_count: 0,
          violations: [
            {
              severity: "HIGH",
              issue: "gate_state_missing",
              detail: "gate-state DB store missing or invalid",
            },
          ],
          stale_sessions: [],
          summary: "gate-state DB store not found or invalid",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const sessions = gateState.sessions || gateState.active_sessions || {};
  const drained = gateState.drained_sessions || {};

  drainedCount = Object.keys(drained).length;

  // Ensure drained_sessions field exists
  if (!gateState.drained_sessions) {
    gateState.drained_sessions = {};
  }

  for (const [sid, session] of Object.entries(sessions)) {
    if (typeof session !== "object" || session === null) {
      violations.push({
        severity: "WARNING",
        session_id: sid,
        issue: "non_object_session",
        detail:
          "Session value is not a JSON object (may be raw orchestration context)",
      });
      continue;
    }

    const armed = session.gate_status === "armed";
    const completed = session.gate_status === "completed";

    // ── Required fields for armed sessions ──
    if (armed) {
      activeCount++;
      if (!session.task_id && !session.task_description) {
        violations.push({
          severity: "WARNING",
          session_id: sid,
          issue: "missing_task_info",
          detail: "Armed session missing both task_id and task_description",
        });
      }
      if (!session.agent) {
        violations.push({
          severity: "WARNING",
          session_id: sid,
          issue: "missing_agent",
          detail: "Armed session missing agent field",
        });
      }
      if (!session.created_at) {
        violations.push({
          severity: "WARNING",
          session_id: sid,
          issue: "missing_created_at",
          detail: "Armed session missing created_at",
        });
      }
    }

    // ── Stale session detection (armed > 24h without completion) ──
    if (armed && (session.confirmed_at || session.created_at)) {
      const created = new Date(session.confirmed_at || session.created_at);
      const ageMs = Date.now() - created.getTime();
      if (ageMs > HOURS_24_MS) {
        const ageHours = Math.round(ageMs / (1000 * 60 * 60));
        staleSessions.push({
          session_id: sid,
          age_hours: ageHours,
          task_description: session.task_description || "unknown",
          created_at: session.created_at,
        });
        violations.push({
          severity: "HIGH",
          session_id: sid,
          issue: "stale_armed",
          detail: `Session armed for ${ageHours}h (>24h max) without completion`,
        });
      }
    }

    // ── Also check sessions with gate_status 'checked' or 'failed' that are > 48h ──
    if (
      (session.gate_status === "checked" || session.gate_status === "failed") &&
      (session.confirmed_at || session.created_at)
    ) {
      const created = new Date(session.confirmed_at || session.created_at);
      const ageMs = Date.now() - created.getTime();
      if (ageMs > 48 * 60 * 60 * 1000) {
        const ageHours = Math.round(ageMs / (1000 * 60 * 60));
        staleSessions.push({
          session_id: sid,
          age_hours: ageHours,
          gate_status: session.gate_status,
          task_description: session.task_description || "unknown",
          created_at: session.created_at,
        });
        violations.push({
          severity: "HIGH",
          session_id: sid,
          issue: "stale_unarmed",
          detail: `Session in '${session.gate_status}' state for ${ageHours}h (>48h max) without resolution`,
        });
      }
    }
  }

  // ── Count active (armed/checked/failed not completed) ──
  const activeStatuses = ["armed", "checked", "failed"];
  activeCount = Object.values(sessions).filter(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      activeStatuses.includes(s.gate_status),
  ).length;

  // ── Auto-drain if requested ──
  if (autoDrain && staleSessions.length > 0) {
    // Post-Step-8 DB-only migration: read from DB, drain in DB, write to DB
    try {
      const { dbLoadGateStore, dbSaveGateStore, dbArchiveDrainedSession } = require("../lib/db-state-manager");
      const dbStore = dbLoadGateStore();
      const dbSessions = dbStore?.sessions || {};
      const dbDrained = dbStore?.drained_sessions || {};

      for (const stale of staleSessions) {
        const sid = stale.session_id;
        const session = dbSessions[sid];
        if (session && typeof session === "object") {
          const drainedEntry = {
            ...session,
            drained_at: new Date().toISOString(),
            drain_reason: `auto-drain: ${stale.issue || "stale"} (${stale.age_hours}h)`,
            gate_status: "drained",
          };
          dbDrained[sid] = drainedEntry;
          dbArchiveDrainedSession(sid, drainedEntry);
          delete dbSessions[sid];
        }
      }

      if (!args.includes("--dry-run")) {
        dbStore.sessions = dbSessions;
        dbStore.drained_sessions = dbDrained;
        dbSaveGateStore(dbStore);
      }

      drainedCount = Object.keys(dbDrained).length;
      activeCount = Object.values(dbSessions).filter(
        (s) =>
          typeof s === "object" &&
          s !== null &&
          activeStatuses.includes(s.gate_status),
      ).length;
    } catch (e) {
      console.error("DB auto-drain failed:", e.message);
      // Fallback: skip auto-drain if DB unavailable
      drainedCount = 0;
    }
  }

  // ── Output ──
  const highViolations = violations.filter((v) => v.severity === "HIGH");
  const status =
    highViolations.length > 0
      ? "FAIL"
      : violations.length > 0
        ? "WARN"
        : "PASS";

  console.log(
    JSON.stringify(
      {
        status,
        active_count: activeCount,
        drained_count: drainedCount,
        violations,
        stale_sessions: staleSessions,
        summary: `active=${activeCount}, drained=${drainedCount}, violations=${violations.length} (${highViolations.length} HIGH), stale=${staleSessions.length}`,
      },
      null,
      2,
    ),
  );

  process.exit(highViolations.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { main };
