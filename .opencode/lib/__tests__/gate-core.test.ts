/**
 * gate-core.test.ts — TDD RED phase tests
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const {
  getProjectRoot,
  resolveStateDir,
  readJsonFile,
  fileExists,
  computeSHA256,
  getEnforcementMode,
  getRuleDisposition,
  shouldBlock,
  getGateStatePath,
  getMachinePath,
  createFreshStore,
  loadGateStore,
  saveGateStore,
  generateGateSessionId,
  createGateSession,
  armGateSession,
  completeGateSession,
  drainStaleSessions,
  validateTaskArtifacts,
  computeDigest,
  extractSemver,
} = require("../gate-core");

const {
  dbWriteSessionMap,
  dbQuerySessionByDagTaskId,
} = require("../db-state-manager");

describe("gate-core", () => {
  describe("getProjectRoot", () => {
    it("should return a non-empty string", () => {
      const root = getProjectRoot();
      expect(root).toBeTruthy();
      expect(typeof root).toBe("string");
    });
  });

  describe("resolveStateDir", () => {
    it("should return a path ending with .opencode/state", () => {
      const dir = resolveStateDir();
      expect(dir).toContain(".opencode");
      expect(dir).toContain("state");
    });
  });

  describe("readJsonFile", () => {
    it("should return null for non-existent files", () => {
      const result = readJsonFile("/nonexistent/path.json");
      expect(result).toBeNull();
    });

    it("should parse valid JSON files", () => {
      const tmpFile = path.join(os.tmpdir(), "test-" + Date.now() + ".json");
      fs.writeFileSync(tmpFile, JSON.stringify({ hello: "world" }));
      const result = readJsonFile(tmpFile);
      expect(result).not.toBeNull();
      expect(result.hello).toBe("world");
      fs.rmSync(tmpFile);
    });
  });

  describe("fileExists", () => {
    it("should return false for non-existent files", () => {
      expect(fileExists("/nonexistent")).toBe(false);
    });
  });

  describe("computeSHA256", () => {
    it("should return a 64-char hex string for existing files", () => {
      const tmpFile = path.join(
        os.tmpdir(),
        "hash-test-" + Date.now() + ".txt",
      );
      fs.writeFileSync(tmpFile, "hello");
      const hash = computeSHA256(tmpFile);
      expect(hash).not.toBeNull();
      expect(hash!.length).toBe(64);
      fs.rmSync(tmpFile);
    });
  });

  describe("getEnforcementMode", () => {
    it("should return 'strict' (compat shim after P1 migration)", () => {
      const mode = getEnforcementMode();
      expect(mode).toBe("strict");
    });
  });

  describe("getRuleDisposition (P1 rule-disposition API)", () => {
    it("should return 'hard_block' for dangerous-shell-command", () => {
      expect(getRuleDisposition("dangerous-shell-command")).toBe("hard_block");
    });

    it("should return 'audit_only' for checklist-incomplete", () => {
      expect(getRuleDisposition("checklist-incomplete")).toBe("audit_only");
    });

    it("should return 'warn_continue' for recommended-skill-missing", () => {
      expect(getRuleDisposition("recommended-skill-missing")).toBe("warn_continue");
    });

    it("should return 'audit_only' for unknown rules (safe default)", () => {
      expect(getRuleDisposition("nonexistent-rule-xyz")).toBe("audit_only");
    });

    it("shouldBlock returns true only for hard_block rules", () => {
      expect(shouldBlock("dangerous-shell-command")).toBe(true);
      expect(shouldBlock("checklist-incomplete")).toBe(false);
      expect(shouldBlock("recommended-skill-missing")).toBe(false);
    });
  });

  describe("createFreshStore", () => {
    it("should return a store with formatVersion 2.0", () => {
      const store = createFreshStore();
      expect(store.formatVersion).toBe("2.0");
      expect(store.sessions).toEqual({});
      expect(store.active_sessions).toEqual([]);
    });
  });

  describe("generateSessionId", () => {
    it("should generate a non-empty session ID", () => {
      const id = generateGateSessionId();
      expect(id).toBeTruthy();
      expect(id).toContain("cg_ses_");
    });
  });

  describe("createGateSession", () => {
    it("should create a session and return it", () => {
      const { session } = createGateSession("Test task", [], {}, "advisory");
      expect(session.session_id).toBeTruthy();
      expect(session.gate_status).toBe("checked");
      expect(session.task_description).toBe("Test task");
    });
  });

  describe("armGateSession", () => {
    it("should reject non-existent sessions", () => {
      const result = armGateSession("nonexistent", "Plan summary here");
      expect(result.status).toBe("rejected");
      expect(result.reason).toContain("session not found");
    });

    // ── FW-DISPATCH-TASKID-IMMUTABLE: task_id integrity tests ──
    // Uses session_map DB (not .dispatch_ctx file) because:
    //   (a) .dispatch_ctx is a shared file — concurrent dispatches overwrite it
    //   (b) task-after.ts deletes .dispatch_ctx — late gate checks bypass integrity
    //   (c) session_map DB is per-session, immune to both race conditions and deletion
    describe("session_map DB integrity", () => {
      const testSessionId = "test-session-" + Date.now();
      const testAgent = "Coder-BE";

      beforeEach(() => {
        // Ensure DB is completely clean before each test.
        // The "no entries" test requires zero dag_task_id rows, so we must
        // remove ALL rows, not just pattern-matched ones.
        try {
          const { getDb } = require("../db-manager");
          const db = getDb();
          db.run(`DELETE FROM session_map`);
        } catch {}
      });

      afterEach(() => {
        // Clean up ALL dag_task_id entries from session_map DB to prevent
        // test contamination across test suites (uc7ks-domain tests share DB)
        try {
          const { getDb } = require("../db-manager");
          const db = getDb();
          db.run(`DELETE FROM session_map WHERE session_id = ?`, [
            testSessionId,
          ]);
          db.run(`DELETE FROM session_map WHERE session_id = 'session-1'`);
          db.run(`DELETE FROM session_map WHERE session_id = 'session-2'`);
          // Remove any leftover dag_task_id entries from other test suites
          db.run(`DELETE FROM session_map WHERE dag_task_id LIKE 'GAP-FIX-%'`);
          db.run(`DELETE FROM session_map WHERE dag_task_id LIKE 'TASK-%'`);
        } catch {}
        // Also clean .dispatch_ctx if left over
        const testRoot = getProjectRoot();
        const dispatchCtxPath = path.join(
          testRoot,
          ".task_temp",
          "_dispatch",
          ".dispatch_ctx",
        );
        try {
          fs.rmSync(dispatchCtxPath, { force: true });
        } catch {}
      });

      it("should reject when taskId is not registered in session_map DB (fabricated)", () => {
        // Register GAP-FIX-ALL-001 as the dispatch-assigned dagTaskId
        dbWriteSessionMap(testSessionId, testAgent, "GAP-FIX-ALL-001");

        // Sub-agent attempts to use GAP-FIX-ALL-002 — not registered → fabricated
        const { session } = createGateSession("Test", [], {}, "advisory");
        const result = armGateSession(
          session.session_id,
          "Plan summary here",
          "TestAgent",
          "GAP-FIX-ALL-002",
        );
        expect(result.status).toBe("rejected");
        expect(result.reason).toContain("DISPATCH-INTEGRITY");
        expect(result.reason).toContain("GAP-FIX-ALL-002");
      });

      it("should normalize taskId from session_map when empty and only one registered", () => {
        // Register exactly one dagTaskId
        dbWriteSessionMap(testSessionId, testAgent, "GAP-FIX-ALL-001");

        // No .dispatch_ctx file, no explicit taskId — should use DB value
        const { session } = createGateSession("Test", [], {}, "advisory");
        const result = armGateSession(
          session.session_id,
          "Plan summary here",
          "Orchestrator",
          undefined,
        );
        // Orchestrator is exempt — no declared_deliverables required
        expect(result.status).toBe("armed");
      });

      it("should allow when taskId is registered in session_map DB", () => {
        // Register GAP-FIX-ALL-001 as the dispatch-assigned dagTaskId
        dbWriteSessionMap(testSessionId, testAgent, "GAP-FIX-ALL-001");

        // Sub-agent provides matching taskId — legitimate
        const { session } = createGateSession("Test", [], {}, "advisory");
        const result = armGateSession(
          session.session_id,
          "Plan summary here",
          "Orchestrator",
          "GAP-FIX-ALL-001",
        );
        expect(result.status).toBe("armed");
      });

      it("should pass when no dag_task_id entries in session_map (no dispatch context)", () => {
        // No dag_task_id entries → no integrity constraint → manual invocation
        // Any taskId is allowed (no Orchestrator dispatch happened)
        const { session } = createGateSession("Test", [], {}, "advisory");
        const result = armGateSession(
          session.session_id,
          "Plan summary here",
          "Orchestrator",
          "MANUAL-TASK-003",
        );
        expect(result.status).toBe("armed");
      });

      it("should reject fabricated taskId even with concurrent registered taskIds", () => {
        // Simulate concurrent dispatches: two different dagTaskIds registered
        dbWriteSessionMap("session-1", "Coder-BE", "GAP-FIX-ALL-001");
        dbWriteSessionMap("session-2", "Coder-FE", "GAP-FIX-ALL-002");

        // Sub-agent fabricates a third taskId — not registered in any session
        const { session } = createGateSession("Test", [], {}, "advisory");
        const result = armGateSession(
          session.session_id,
          "Plan summary here",
          "TestAgent",
          "FABRICATED-003",
        );
        expect(result.status).toBe("rejected");
        expect(result.reason).toContain("DISPATCH-INTEGRITY");
        expect(result.reason).toContain("FABRICATED-003");

        // Clean up concurrent test sessions
        try {
          const { getDb } = require("../db-manager");
          const db = getDb();
          db.run(`DELETE FROM session_map WHERE session_id = 'session-1'`);
          db.run(`DELETE FROM session_map WHERE session_id = 'session-2'`);
        } catch {}
      });
    });
  });

  describe("completeGateSession", () => {
    it("should reject non-existent sessions", () => {
      const result = completeGateSession("nonexistent", "Done");
      expect(result.status).toBe("rejected");
      expect(result.reason).toContain("session not found");
    });
  });

  describe("computeDigest", () => {
    it("should return error for non-existent files", () => {
      const result = computeDigest("/nonexistent");
      expect(result.digest).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  describe("extractSemver", () => {
    it("should return null for non-existent files", () => {
      expect(extractSemver("/nonexistent")).toBeNull();
    });
  });

  describe("validateTaskArtifacts", () => {
    /** SA-FIX-VALIDATE-PATH: Test root uses project-based .task_temp for realistic path resolution */
    const testRoot = getProjectRoot();
    const testTaskId = "SA-FIX-VALIDATE-TEST-" + Date.now();
    const testDir = path.join(testRoot, ".task_temp", testTaskId);
    const subDir = path.join(testDir, "_dispatch");

    beforeAll(() => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.mkdirSync(subDir, { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("should return empty for null taskId", () => {
      const missing = validateTaskArtifacts(null);
      expect(missing).toEqual([]);
    });

    it("should return empty when artifacts exist in primary path", () => {
      fs.writeFileSync(path.join(testDir, "HANDOVER.md"), "# handover");
      fs.writeFileSync(path.join(testDir, "TASK_LOG.md"), "# task log");
      const missing = validateTaskArtifacts(testTaskId, testRoot);
      expect(missing).toEqual([]);
    });

    it("should find artifacts via fallback subdirectory scan", () => {
      // Clean primary but place artifacts in _dispatch subdirectory
      try {
        fs.rmSync(path.join(testDir, "HANDOVER.md"), { force: true });
      } catch {}
      try {
        fs.rmSync(path.join(testDir, "TASK_LOG.md"), { force: true });
      } catch {}
      fs.writeFileSync(
        path.join(subDir, "HANDOVER.md"),
        "# dispatach handover",
      );
      fs.writeFileSync(path.join(subDir, "TASK_LOG.md"), "# dispatch task log");
      const missing = validateTaskArtifacts(testTaskId, testRoot);
      expect(missing).toEqual([]);
    });

    it("should report missing when artifacts not in primary or any subdirectory", () => {
      // Clean everything
      try {
        fs.rmSync(path.join(subDir, "HANDOVER.md"), { force: true });
      } catch {}
      try {
        fs.rmSync(path.join(subDir, "TASK_LOG.md"), { force: true });
      } catch {}
      try {
        fs.rmSync(path.join(testDir, "HANDOVER.md"), { force: true });
      } catch {}
      try {
        fs.rmSync(path.join(testDir, "TASK_LOG.md"), { force: true });
      } catch {}
      const missing = validateTaskArtifacts(testTaskId, testRoot);
      expect(missing).toContain("HANDOVER.md");
      expect(missing).toContain("TASK_LOG.md");
    });

    it("should use sessionId fallback when taskId is null", () => {
      // Use the same directory (named after sessionId)
      try {
        fs.rmSync(subDir, { recursive: true, force: true });
      } catch {}
      fs.writeFileSync(path.join(testDir, "HANDOVER.md"), "# session handover");
      const missing = validateTaskArtifacts(null, testRoot, testTaskId);
      expect(missing).not.toContain("HANDOVER.md");
    });
  });
});
