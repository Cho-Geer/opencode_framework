/**
 * state-compactor.test.ts — Unit tests for state-compactor
 *
 * Tests onGateComplete, drainStaleSessions, JSONL write, index update,
 * and edge cases. Uses temp directories — never touches real state.
 *
 * @since Wave 2.1d (R2)
 */
import { StateCompactor } from "../state-compactor";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../../lib/db-manager";
import { dbSyncCompactorHot } from "../../lib/db-state-manager";

/** Override instance paths for isolated testing */
function overridePaths(c: StateCompactor, dir: string) {
  (c as any).hotFile = join(dir, "gate-state.json");
  (c as any).indexFile = join(dir, "gate-state.index.json");
  (c as any).archiveFile = join(dir, "gate-state.archive.json");
  (c as any).historyDir = join(dir, "gate-state.history");
  mkdirSync(join(dir, "gate-state.history"), { recursive: true });
}

/** Create a minimal hot gate-state.json */
function createHot(d: string, overrides: any = {}) {
  const hot = {
    formatVersion: "3.0",
    active_sessions: {},
    recent_sessions: {},
    meta: {
      total_sessions: 0,
      active_count: 0,
      recent_count: 0,
      last_compacted: new Date().toISOString(),
    },
    ...overrides,
  };
  writeFileSync(join(d, "gate-state.json"), JSON.stringify(hot, null, 2));
  return hot;
}

const testSession = {
  session_id: "cg_ses_1111111111111",
  created_at: "2026-06-03T10:00:00Z",
  gate_status: "armed" as const,
  confirmed_at: "2026-06-03T10:01:00Z",
  task_description: "Test task description for compaction unit test",
  plan_summary: "Test plan summary — compact and verify",
};

describe("state-compactor", () => {
  let tmpDir: string;
  let compactor: StateCompactor;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compactor-test-"));
    // A8 DB-first: point OPENCODE_ROOT to the temp dir and reset the DB singleton.
    process.env.OPENCODE_ROOT = tmpDir;
    closeDb();
    compactor = new StateCompactor();
    overridePaths(compactor, tmpDir);
  });

  afterEach(() => {
    closeDb();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("onGateComplete()", () => {
    beforeEach(() => {
      createHot(tmpDir, {
        active_sessions: { [testSession.session_id]: testSession },
        meta: {
          total_sessions: 1,
          active_count: 1,
          recent_count: 0,
          last_compacted: new Date().toISOString(),
        },
      });
    });

    it("writes session to history JSONL", async () => {
      await compactor.onGateComplete(testSession.session_id, testSession);
      const historyDir = join(tmpDir, "gate-state.history");
      const files = readdirSync(historyDir).filter((f) => f.endsWith(".jsonl"));
      expect(files.length).toBeGreaterThan(0);
      const content = readFileSync(join(historyDir, files[0]), "utf8");
      expect(content).toContain("cg_ses_1111111111111");
      expect(content).toContain("compaction unit test");
    });

    it("creates index entry", async () => {
      await compactor.onGateComplete(testSession.session_id, testSession);
      expect(existsSync(join(tmpDir, "gate-state.index.json"))).toBe(true);
      const idx = JSON.parse(
        readFileSync(join(tmpDir, "gate-state.index.json"), "utf8"),
      );
      expect(idx.sessions["cg_ses_1111111111111"]).toBeDefined();
      expect(idx.sessions["cg_ses_1111111111111"].archive_ref).toMatch(
        /gate-state\.history\/.*\.jsonl#\d+/,
      );
    });
  });

  // ─── drainStaleSessions ───
  describe("drainStaleSessions()", () => {
    beforeEach(() => {
      createHot(tmpDir, {
        active_sessions: {
          [testSession.session_id]: testSession,
        },
        meta: {
          total_sessions: 2,
          active_count: 2,
          recent_count: 0,
          last_compacted: new Date().toISOString(),
        },
      });
    });

    it("drains stale sessions", async () => {
      // A8 DB-first: seed the DB so drainStaleSessions can see the session.
      const hot = JSON.parse(
        readFileSync(join(tmpDir, "gate-state.json"), "utf8"),
      );
      dbSyncCompactorHot(hot);

      // Session was created ~now, threshold of 0 hours means drain everything checked
      await compactor.drainStaleSessions(0);

      // JSON file is an export cache — regenerate from the canonical DB to verify.
      compactor.regenerateGateFiles();
      const hotAfter = JSON.parse(
        readFileSync(
          join(tmpDir, ".opencode", "state", "gate-state.json"),
          "utf8",
        ),
      );
      // The test session should be drained (moved from active_sessions).
      expect(hotAfter.active_sessions["cg_ses_1111111111111"]).toBeUndefined();
    });

    it("handles empty active_sessions gracefully", async () => {
      createHot(tmpDir, { active_sessions: {} });
      await compactor.drainStaleSessions(24);
      const hot = JSON.parse(
        readFileSync(join(tmpDir, "gate-state.json"), "utf8"),
      );
      expect(Object.keys(hot.active_sessions)).toEqual([]);
    });
  });

  // ─── JSONL appending ───
  describe("history JSONL writing", () => {
    it("appends to existing JSONL file", async () => {
      createHot(tmpDir, {
        active_sessions: { [testSession.session_id]: testSession },
        meta: {
          total_sessions: 1,
          active_count: 1,
          recent_count: 0,
          last_compacted: new Date().toISOString(),
        },
      });
      await compactor.onGateComplete(testSession.session_id, testSession);

      // Add a second session
      const s2 = {
        ...testSession,
        session_id: "cg_ses_2222222222222",
        task_description: "Second task",
      };
      createHot(tmpDir, {
        active_sessions: { ["cg_ses_2222222222222"]: s2 },
        meta: {
          total_sessions: 2,
          active_count: 1,
          recent_count: 1,
          last_compacted: new Date().toISOString(),
        },
      });
      writeFileSync(
        join(tmpDir, "gate-state.index.json"),
        JSON.stringify({
          formatVersion: "3.0",
          sessions: {
            cg_ses_1111111111111: {
              session_id: "cg_ses_1111111111111",
              archive_ref:
                "gate-state.history/" +
                new Date().toISOString().split("T")[0] +
                ".jsonl#0",
            },
          },
        }),
      );
      await compactor.onGateComplete("cg_ses_2222222222222", s2);

      const historyDir = join(tmpDir, "gate-state.history");
      const files = readdirSync(historyDir).filter((f) => f.endsWith(".jsonl"));
      const content = readFileSync(join(historyDir, files[0]), "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });
});
