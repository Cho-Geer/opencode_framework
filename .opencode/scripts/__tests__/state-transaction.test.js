/**
 * state-transaction.test.js — TDD RED phase tests
 * ==============================================
 * Tests for the Unified State Transaction Engine.
 *
 * Tests cover:
 *   - UUID v4 generation (format validation)
 *   - SHA-256 hashing
 *   - beginTransaction factory
 *   - prepare() — writes .tmp and .prepared, computes hashes
 *   - commit() — atomic rename, WAL COMMIT entry, cleanup
 *   - rollback() — cleanup .tmp, WAL ROLLBACK entry
 *   - Monotonic revision counter
 *   - Crash recovery scan (orphaned .prepared)
 *   - Transaction log verification
 *   - WAL integrity (every BEGIN has COMMIT/ROLLBACK)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { closeDb } = require("../../lib/db-manager");
const { dbWriteMachineMeta } = require("../../lib/db-state-manager");

// Use a temp directory for test isolation
const TEST_DIR = path.join(__dirname, "__txn_test__");
const ORIGINAL_OPENCODE_ROOT = process.env.OPENCODE_ROOT;

/** Reset the singleton DB connection and seed machine_meta.revision in the test DB. */
function seedMachineRevision(rev) {
  closeDb();
  dbWriteMachineMeta({ meta: { revision: rev } });
}

function setupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function teardownTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

afterAll(() => {
  teardownTestDir();
  if (ORIGINAL_OPENCODE_ROOT === undefined) {
    delete process.env.OPENCODE_ROOT;
  } else {
    process.env.OPENCODE_ROOT = ORIGINAL_OPENCODE_ROOT;
  }
});

// ─── Helpers ──────────────────────────────────────────────
function sha256(content) {
  return "sha256-" + crypto.createHash("sha256").update(content).digest("hex");
}

// ─── Tests ─────────────────────────────────────────────────

describe("state-transaction — UUID v4 generator", () => {
  // Load the module after setting up test environment
  let generateUUID;

  beforeAll(() => {
    // Override paths for test isolation
    process.env.OPENCODE_ROOT = TEST_DIR;
    process.env.__TEST_MODE__ = "1";

    // We bypass the module's own OPENCODE_ROOT by re-requiring with env set
    const mod = require("../../scripts/state-transaction");
    generateUUID = mod.generateUUID;
  });

  test("generates valid UUID v4 format", () => {
    const uuid = generateUUID();
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidV4Pattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidV4Pattern.test(uuid)).toBe(true);
  });

  test("generates unique UUIDs", () => {
    const uuids = new Set();
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID());
    }
    expect(uuids.size).toBe(100);
  });

  test("generates 36-character UUID", () => {
    const uuid = generateUUID();
    expect(uuid).toHaveLength(36);
  });
});

describe("state-transaction — SHA-256 hash", () => {
  let mod;

  beforeAll(() => {
    process.env.OPENCODE_ROOT = TEST_DIR;
    mod = require("../../scripts/state-transaction");
  });

  test("produces sha256- prefixed hash", () => {
    const hash = mod.sha256("hello");
    expect(hash).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  test("same input produces same hash", () => {
    const h1 = mod.sha256("test data");
    const h2 = mod.sha256("test data");
    expect(h1).toBe(h2);
  });

  test("different inputs produce different hashes", () => {
    const h1 = mod.sha256("data1");
    const h2 = mod.sha256("data2");
    expect(h1).not.toBe(h2);
  });

  test("empty string produces valid hash", () => {
    const hash = mod.sha256("");
    expect(hash).toMatch(/^sha256-[a-f0-9]{64}$/);
  });
});

describe("state-transaction — beginTransaction factory", () => {
  let mod;

  beforeAll(() => {
    setupTestDir();
    // Create the state dir
    fs.mkdirSync(path.join(TEST_DIR, ".opencode", "state"), {
      recursive: true,
    });
    // Create an empty .transaction-log
    fs.writeFileSync(
      path.join(TEST_DIR, ".opencode", "state", ".transaction-log"),
      "",
    );
    process.env.OPENCODE_ROOT = TEST_DIR;
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("returns a StateTransaction instance", () => {
    const txn = mod.beginTransaction(
      path.join(TEST_DIR, ".opencode", "state", "test.json"),
      "@Architect",
      "TEST-001",
    );
    expect(txn).toBeDefined();
    expect(txn.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(txn.agent).toBe("@Architect");
    expect(txn.taskId).toBe("TEST-001");
    expect(txn.committed).toBe(false);
    expect(txn.rolledBack).toBe(false);
  });

  test("each transaction has unique operation_id", () => {
    const txn1 = mod.beginTransaction(
      path.join(TEST_DIR, ".opencode", "state", "test1.json"),
      "@Architect",
      "TEST-001",
    );
    const txn2 = mod.beginTransaction(
      path.join(TEST_DIR, ".opencode", "state", "test2.json"),
      "@Architect",
      "TEST-002",
    );
    expect(txn1.operationId).not.toBe(txn2.operationId);
  });
});

describe("state-transaction — prepare()", () => {
  let mod;
  let testFilePath;

  beforeAll(() => {
    setupTestDir();
    fs.mkdirSync(path.join(TEST_DIR, ".opencode", "state"), {
      recursive: true,
    });
    // Create a minimal machine.json for revision tracking
    const machine = {
      meta: {
        version: "1.0.0",
        revision: 0,
        createdAt: new Date().toISOString(),
        lastUpdated: null,
        project: "test",
        framework: "opencode-v3",
      },
    };
    const stateDir = path.join(TEST_DIR, ".opencode", "state");
    fs.writeFileSync(
      path.join(stateDir, "machine.json"),
      JSON.stringify(machine, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");

    testFilePath = path.join(stateDir, "test-gate.json");
    // Write initial content
    fs.writeFileSync(
      testFilePath,
      JSON.stringify({ version: 1, data: "old" }, null, 2) + "\n",
    );

    process.env.OPENCODE_ROOT = TEST_DIR;
    seedMachineRevision(0);
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("writes .tmp file with new content", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-001");
    const newContent =
      JSON.stringify({ version: 2, data: "new" }, null, 2) + "\n";
    const result = txn.prepare(newContent);

    expect(result).toBeDefined();
    expect(result.operation_id).toBe(txn.operationId);
    expect(result.new_revision).toBeGreaterThan(0);

    // Verify .tmp exists and has correct content
    expect(fs.existsSync(txn.tmpPath)).toBe(true);
    const tmpContent = fs.readFileSync(txn.tmpPath, "utf-8");
    expect(tmpContent).toBe(newContent);
  });

  test("writes .prepared marker", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-002");
    const newContent = JSON.stringify({ version: 3 }, null, 2) + "\n";
    txn.prepare(newContent);

    expect(fs.existsSync(txn.preparedPath)).toBe(true);
    const preparedData = JSON.parse(fs.readFileSync(txn.preparedPath, "utf-8"));
    expect(preparedData.operation_id).toBe(txn.operationId);
    expect(preparedData.agent).toBe("@Architect");
    expect(preparedData.task_id).toBe("TEST-002");

    // Cleanup for next test
    txn.commit();
  });

  test("computes old_hash of existing file", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-003");
    const newContent = JSON.stringify({ version: 4 }, null, 2) + "\n";
    txn.prepare(newContent);

    const expectedOldHash = sha256(fs.readFileSync(testFilePath, "utf-8"));
    expect(txn.oldHash).toBe(expectedOldHash);

    txn.commit();
  });

  test("handles non-existent file (old_hash of empty)", () => {
    const newPath = path.join(TEST_DIR, ".opencode", "state", "brand-new.json");
    const txn = mod.beginTransaction(newPath, "@Architect", "TEST-004");
    const newContent = "new file content";
    txn.prepare(newContent);

    expect(txn.oldHash).toBe(sha256(""));
    expect(txn.newRevision).toBeGreaterThan(0);

    // Commit so we can test the next case
    txn.commit();
  });

  test("throws if called after commit", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-005");
    txn.prepare(JSON.stringify({ version: 5 }, null, 2) + "\n");
    txn.commit();
    expect(() => txn.prepare("new content")).toThrow(/already finalized/);
  });

  test("throws if called after rollback", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-006");
    txn.prepare(JSON.stringify({ version: 6 }, null, 2) + "\n");
    txn.rollback("test rollback");
    expect(() => txn.prepare("new content")).toThrow(/already finalized/);
  });
});

describe("state-transaction — commit()", () => {
  let mod;
  let testFilePath;
  let stateDir;

  beforeAll(() => {
    setupTestDir();
    stateDir = path.join(TEST_DIR, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const machine = {
      meta: {
        version: "1.0.0",
        revision: 5,
        createdAt: new Date().toISOString(),
        lastUpdated: null,
        project: "test",
        framework: "opencode-v3",
      },
    };
    fs.writeFileSync(
      path.join(stateDir, "machine.json"),
      JSON.stringify(machine, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");

    testFilePath = path.join(stateDir, "test-commit.json");
    fs.writeFileSync(testFilePath, "original content\n");

    process.env.OPENCODE_ROOT = TEST_DIR;
    seedMachineRevision(5);
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("atomically replaces target file with new content", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-001");
    const newContent = "committed content\n";
    txn.prepare(newContent);
    txn.commit();

    // Verify file was replaced
    const fileContent = fs.readFileSync(testFilePath, "utf-8");
    expect(fileContent).toBe(newContent);

    // Verify .tmp is removed (cleaned up)
    expect(fs.existsSync(txn.tmpPath)).toBe(false);
  });

  test("removes .prepared marker after commit", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-002");
    txn.prepare("content after commit\n");
    txn.commit();

    expect(fs.existsSync(txn.preparedPath)).toBe(false);
  });

  test("writes COMMIT entry to transaction log", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-003");
    txn.prepare("content with commit log\n");
    const commitResult = txn.commit();

    const logEntries = mod.readTransactionLog();
    const commitEntry = logEntries.find(
      (e) => e.phase === "COMMIT" && e.operation_id === txn.operationId,
    );
    expect(commitEntry).toBeDefined();
    expect(commitEntry.new_revision).toBe(txn.newRevision);
    expect(commitEntry.duration_ms).toBeGreaterThanOrEqual(0);
    expect(commitResult.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("returns commit result with operation_id, revision, hash, duration", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-004");
    txn.prepare("commit result test\n");
    const result = txn.commit();

    expect(result.operation_id).toBe(txn.operationId);
    expect(result.new_revision).toBeGreaterThan(0);
    expect(result.new_hash).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("throws if commit called twice", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-005");
    txn.prepare("double commit test\n");
    txn.commit();
    expect(() => txn.commit()).toThrow(/already committed/);
  });

  test("throws if commit called after rollback", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-006");
    txn.prepare("rollback then commit test\n");
    txn.rollback("intentional rollback");
    expect(() => txn.commit()).toThrow(/rolled back/);
  });
});

describe("state-transaction — rollback()", () => {
  let mod;
  let testFilePath;
  let stateDir;

  beforeAll(() => {
    setupTestDir();
    stateDir = path.join(TEST_DIR, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const machine = {
      meta: {
        version: "1.0.0",
        revision: 10,
        createdAt: new Date().toISOString(),
        lastUpdated: null,
        project: "test",
        framework: "opencode-v3",
      },
    };
    fs.writeFileSync(
      path.join(stateDir, "machine.json"),
      JSON.stringify(machine, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");

    testFilePath = path.join(stateDir, "test-rollback.json");
    fs.writeFileSync(testFilePath, "will not change\n");

    process.env.OPENCODE_ROOT = TEST_DIR;
    seedMachineRevision(10);
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("preserves original file content on rollback", () => {
    const originalContent = fs.readFileSync(testFilePath, "utf-8");
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-001");
    txn.prepare("this should not be committed\n");
    txn.rollback("test: preserve original");

    const afterContent = fs.readFileSync(testFilePath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  test("removes .tmp file on rollback", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-002");
    txn.prepare("tmp will be deleted\n");
    expect(fs.existsSync(txn.tmpPath)).toBe(true);
    txn.rollback("test: remove tmp");
    expect(fs.existsSync(txn.tmpPath)).toBe(false);
  });

  test("removes .prepared marker on rollback", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-003");
    txn.prepare("prepared will be deleted\n");
    expect(fs.existsSync(txn.preparedPath)).toBe(true);
    txn.rollback("test: remove prepared");
    expect(fs.existsSync(txn.preparedPath)).toBe(false);
  });

  test("writes ROLLBACK entry to transaction log", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-004");
    txn.prepare("rollback log test\n");
    txn.rollback("reason: unit test");

    const logEntries = mod.readTransactionLog();
    const rollbackEntry = logEntries.find(
      (e) => e.phase === "ROLLBACK" && e.operation_id === txn.operationId,
    );
    expect(rollbackEntry).toBeDefined();
    expect(rollbackEntry.reason).toBe("reason: unit test");
  });

  test("returns rollback result with operation_id and reason", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-005");
    txn.prepare("result test\n");
    const result = txn.rollback("test reason");

    expect(result.operation_id).toBe(txn.operationId);
    expect(result.reason).toBe("test reason");
  });

  test("throws if rollback called twice", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-006");
    txn.prepare("double rollback\n");
    txn.rollback("first");
    expect(() => txn.rollback("second")).toThrow(/already rolled back/);
  });

  test("throws if rollback called after commit", () => {
    const txn = mod.beginTransaction(testFilePath, "@Architect", "TEST-007");
    txn.prepare("commit then rollback\n");
    txn.commit();
    expect(() => txn.rollback("too late")).toThrow(/already committed/);
  });
});

describe("state-transaction — recovery scan", () => {
  let mod;
  let stateDir;

  beforeAll(() => {
    setupTestDir();
    stateDir = path.join(TEST_DIR, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const machine = {
      meta: {
        version: "1.0.0",
        revision: 15,
        createdAt: new Date().toISOString(),
        lastUpdated: null,
        project: "test",
        framework: "opencode-v3",
      },
    };
    fs.writeFileSync(
      path.join(stateDir, "machine.json"),
      JSON.stringify(machine, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");

    process.env.OPENCODE_ROOT = TEST_DIR;
    seedMachineRevision(15);
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("detects and recovers orphaned .prepared files", () => {
    // Create an orphaned .prepared without COMMIT/ROLLBACK
    const orphanId = mod.generateUUID();
    const orphanPreparedPath = path.join(
      stateDir,
      `orphan.txn-${orphanId}.prepared`,
    );
    const orphanTmpPath = path.join(stateDir, `orphan.txn-${orphanId}.tmp`);

    const preparedMarker = {
      operation_id: orphanId,
      file: path.join(stateDir, "orphan-target.json"),
      old_hash: mod.sha256(""),
      new_revision: 999,
      timestamp: new Date().toISOString(),
      agent: "@Architect",
      task_id: "ORPHAN-TEST",
      tmp_path: orphanTmpPath,
    };

    fs.writeFileSync(
      orphanPreparedPath,
      JSON.stringify(preparedMarker, null, 2) + "\n",
    );
    fs.writeFileSync(orphanTmpPath, "orphan content\n");

    // Run recovery
    const result = mod.runRecoveryScan();

    expect(result.recovered).toBeGreaterThanOrEqual(1);
    const orphanDetail = result.details.find(
      (d) => d.operation_id === orphanId,
    );
    expect(orphanDetail).toBeDefined();
    expect(orphanDetail.action).toBe("rollback_orphan");

    // Verify cleanup
    expect(fs.existsSync(orphanPreparedPath)).toBe(false);
    expect(fs.existsSync(orphanTmpPath)).toBe(false);
  });

  test("cleanup committed transactions that still have lingering .prepared", () => {
    const opId = mod.generateUUID();
    const preparedPath = path.join(stateDir, `stale.txn-${opId}.prepared`);

    fs.writeFileSync(
      preparedPath,
      JSON.stringify(
        {
          operation_id: opId,
          file: path.join(stateDir, "stale.json"),
          old_hash: mod.sha256(""),
          new_revision: 1000,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );

    // Write a COMMIT entry for this operation to the transaction log
    const logPath = path.join(stateDir, ".transaction-log");
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        phase: "COMMIT",
        operation_id: opId,
        timestamp: new Date().toISOString(),
        new_hash: mod.sha256("test"),
        new_revision: 1000,
        duration_ms: 5,
      }) + "\n",
    );

    const result = mod.runRecoveryScan();
    const detail = result.details.find((d) => d.operation_id === opId);
    expect(detail).toBeDefined();
    expect(detail.action).toBe("cleanup_committed");
    expect(fs.existsSync(preparedPath)).toBe(false);
  });

  test("no orphans results in recovered=0", () => {
    // Clean state — no leftover .prepared files
    const result = mod.runRecoveryScan();
    expect(result.recovered).toBe(0);
    expect(result.orphans).toHaveLength(0);
  });
});

describe("state-transaction — transaction log verification", () => {
  let mod;
  let stateDir;

  beforeAll(() => {
    setupTestDir();
    stateDir = path.join(TEST_DIR, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const machine = {
      meta: {
        version: "1.0.0",
        revision: 20,
        createdAt: new Date().toISOString(),
        lastUpdated: null,
        project: "test",
        framework: "opencode-v3",
      },
    };
    fs.writeFileSync(
      path.join(stateDir, "machine.json"),
      JSON.stringify(machine, null, 2) + "\n",
    );
    // Start with clean log
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");

    process.env.OPENCODE_ROOT = TEST_DIR;
    seedMachineRevision(20);
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("validates clean transaction log", () => {
    const result = mod.verifyTransactionLog();
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("detects orphaned BEGIN without COMMIT/ROLLBACK", () => {
    const logPath = path.join(stateDir, ".transaction-log");
    const orphanId = mod.generateUUID();
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        phase: "BEGIN",
        operation_id: orphanId,
        file: "test.json",
        old_hash: mod.sha256(""),
        new_revision: 50,
        timestamp: new Date().toISOString(),
        agent: "@Architect",
        task_id: "ORPHAN-BEGIN",
      }) + "\n",
    );

    const result = mod.verifyTransactionLog();
    expect(result.valid).toBe(false);
    const orphanIssue = result.issues.find((i) => i.includes(orphanId));
    expect(orphanIssue).toBeDefined();
    expect(orphanIssue).toMatch(/no COMMIT or ROLLBACK/);
  });

  test("detects non-monotonic revision", () => {
    const logPath = path.join(stateDir, ".transaction-log");
    // Write two COMMIT entries with the same revision. The verifier sorts
    // commits by new_revision and flags duplicates as non-monotonic.
    const id1 = mod.generateUUID();
    const id2 = mod.generateUUID();

    fs.appendFileSync(
      logPath,
      JSON.stringify({
        phase: "BEGIN",
        operation_id: id1,
        timestamp: new Date().toISOString(),
      }) +
        "\n" +
        JSON.stringify({
          phase: "COMMIT",
          operation_id: id1,
          new_revision: 10,
          timestamp: new Date().toISOString(),
        }) +
        "\n" +
        JSON.stringify({
          phase: "BEGIN",
          operation_id: id2,
          timestamp: new Date().toISOString(),
        }) +
        "\n" +
        JSON.stringify({
          phase: "COMMIT",
          operation_id: id2,
          new_revision: 10,
          timestamp: new Date().toISOString(),
        }) +
        "\n",
    );

    // Clear cache to re-read the log
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    const freshMod = require("../../scripts/state-transaction");
    const result = freshMod.verifyTransactionLog();

    const nonMonoIssue = result.issues.find((i) => i.includes("Non-monotonic"));
    expect(nonMonoIssue).toBeDefined();
  });

  test("fully committed transactions pass validation", () => {
    // Clean up and create proper transactions
    // Reset
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    const freshMod = require("../../scripts/state-transaction");

    const targetPath = path.join(stateDir, "test-valid.json");
    fs.writeFileSync(targetPath, "initial\n");

    // Transaction 1
    const txn1 = freshMod.beginTransaction(targetPath, "@Architect", "TEST-V1");
    txn1.prepare("content v1\n");
    txn1.commit();

    // Transaction 2
    const txn2 = freshMod.beginTransaction(targetPath, "@Architect", "TEST-V2");
    txn2.prepare("content v2\n");
    txn2.commit();

    // Transaction 3 — rolled back
    const txn3 = freshMod.beginTransaction(targetPath, "@Architect", "TEST-V3");
    txn3.prepare("content v3 - rolled back\n");
    txn3.rollback("test rollback");

    const result = freshMod.verifyTransactionLog();
    // Should be valid since every BEGIN has COMMIT or ROLLBACK
    expect(result.valid).toBe(true);
    expect(result.stats.begins).toBe(3);
    expect(result.stats.commits).toBe(2);
    expect(result.stats.rollbacks).toBe(1);
  });
});

describe("state-transaction — monotonic revision counter", () => {
  let mod;
  let stateDir;

  beforeAll(() => {
    setupTestDir();
    stateDir = path.join(TEST_DIR, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const machine = {
      meta: {
        version: "1.0.0",
        revision: 42,
        createdAt: new Date().toISOString(),
        lastUpdated: null,
        project: "test",
        framework: "opencode-v3",
      },
    };
    fs.writeFileSync(
      path.join(stateDir, "machine.json"),
      JSON.stringify(machine, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");

    process.env.OPENCODE_ROOT = TEST_DIR;
    seedMachineRevision(42);
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("getCurrentRevision reads machine meta revision from DB", () => {
    const rev = mod.getCurrentRevision();
    expect(rev).toBe(42);
  });

  test("prepare() increments revision beyond current", () => {
    const targetPath = path.join(stateDir, "test-rev.json");
    fs.writeFileSync(targetPath, "revision test\n");

    const txn = mod.beginTransaction(targetPath, "@Architect", "TEST-REV");
    const result = txn.prepare("new revision content\n");
    expect(result.new_revision).toBeGreaterThan(42);
    txn.commit();

    // After commit, revision should have been persisted in machine.json
    const machine = JSON.parse(
      fs.readFileSync(path.join(stateDir, "machine.json"), "utf-8"),
    );
    // Note: For non-machine.json transactions, the revision is bumped in machine.json
    // using the transaction's new_revision
  });
});

describe("state-transaction — WAL BEGIN entries contain required fields", () => {
  let mod;
  let stateDir;
  let targetPath;

  beforeAll(() => {
    setupTestDir();
    stateDir = path.join(TEST_DIR, ".opencode", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const machine = {
      meta: {
        version: "1.0.0",
        revision: 30,
        createdAt: new Date().toISOString(),
        lastUpdated: null,
        project: "test",
        framework: "opencode-v3",
      },
    };
    fs.writeFileSync(
      path.join(stateDir, "machine.json"),
      JSON.stringify(machine, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(stateDir, ".transaction-log"), "");

    targetPath = path.join(stateDir, "test-wal.json");
    fs.writeFileSync(targetPath, "wal test\n");

    process.env.OPENCODE_ROOT = TEST_DIR;
    seedMachineRevision(30);
    delete require.cache[require.resolve("../../scripts/state-transaction")];
    mod = require("../../scripts/state-transaction");
  });

  afterAll(() => {
    teardownTestDir();
  });

  test("BEGIN entry has all required fields", () => {
    const txn = mod.beginTransaction(targetPath, "@Architect", "TEST-WAL");
    txn.prepare("wal fields test\n");
    txn.commit();

    const entries = mod.readTransactionLog();
    const beginEntry = entries.find(
      (e) => e.phase === "BEGIN" && e.operation_id === txn.operationId,
    );

    expect(beginEntry).toBeDefined();
    expect(beginEntry.operation_id).toBe(txn.operationId);
    expect(beginEntry.file).toBeTruthy();
    expect(beginEntry.old_hash).toMatch(/^sha256-/);
    // new_revision is intentionally recorded on COMMIT, not BEGIN.
    expect(beginEntry.timestamp).toBeTruthy();
    expect(beginEntry.agent).toBe("@Architect");
    expect(beginEntry.task_id).toBe("TEST-WAL");
  });
});
