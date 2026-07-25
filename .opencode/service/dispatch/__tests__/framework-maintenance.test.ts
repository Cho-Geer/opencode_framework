import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { closeDb, getDb } from "../../../lib/db-manager";
import {
  clearFrameworkMaintenancePolicyCache,
  resolveGrantAllowedPaths,
  resolveGrantMaxWrites,
  isFrameworkPathAllowed,
  normalizeFrameworkPath,
} from "../framework-maintenance-policy";
import {
  createGrant,
  hasGrant,
  recordGrantWrite,
  completeGrant,
} from "../privilege";
import {
  createFrameworkMaintenancePlan,
  getActiveFrameworkMaintenancePlan,
  assertPathInActivePlan,
  completeFrameworkMaintenancePlan,
} from "../framework-maintenance-plan";
import safeFrameworkEdit from "../../../tools/safe_framework_edit";

let tempDir: string;

function setupTempDb(): void {
  closeDb();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "framework-maintenance-"));
  process.env.OPENCODE_ROOT = tempDir;
  process.env.FRAMEWORK_DB_PATH = path.join(tempDir, "framework-state.db");
  fs.mkdirSync(path.join(tempDir, ".opencode"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, ".opencode", "project.config.json"),
    JSON.stringify({
      project: { name: "test", description: "test", version: "1.0.0" },
      dispatch_privilege: {
        framework_maintenance: {
          ttl_minutes: 45,
          default_max_writes: 3,
          hard_max_writes: 5,
          default_allowed_paths: [".opencode/**", "opencode.json"],
          blocked_paths: [".opencode/state/**", ".git/**"],
          require_plan: true,
          require_codegraph: true,
        },
      },
    }),
  );
  getDb({ forceReset: true });
}

describe("framework maintenance policy", () => {
  beforeEach(() => {
    setupTempDb();
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    delete process.env.OPENCODE_ROOT;
    delete process.env.FRAMEWORK_DB_PATH;
    clearFrameworkMaintenancePolicyCache();
    closeDb();
  });

  test("resolveGrantAllowedPaths falls back to defaults when omitted", () => {
    const paths = resolveGrantAllowedPaths();
    expect(paths).toEqual([".opencode/**", "opencode.json"]);
  });

  test("resolveGrantAllowedPaths filters blocked paths", () => {
    const paths = resolveGrantAllowedPaths([".opencode/state/db", ".opencode/lib"]);
    expect(paths).not.toContain(".opencode/state/db");
    expect(paths).toContain(".opencode/lib");
  });

  test("resolveGrantMaxWrites respects hard cap", () => {
    expect(resolveGrantMaxWrites(10)).toBe(5);
    expect(resolveGrantMaxWrites(2)).toBe(2);
    expect(resolveGrantMaxWrites(undefined)).toBe(3);
  });

  test("isFrameworkPathAllowed blocks blocked paths", () => {
    expect(isFrameworkPathAllowed(".opencode/lib/foo.ts", [".opencode/**"], [".opencode/state/**"])).toBe(true);
    expect(isFrameworkPathAllowed(".opencode/state/db", [".opencode/**"], [".opencode/state/**"])).toBe(false);
    expect(isFrameworkPathAllowed("opencode.json", ["opencode.json"], [])).toBe(true);
  });

  test("normalizeFrameworkPath rejects traversal", () => {
    expect(() => normalizeFrameworkPath("../etc/passwd")).toThrow(/traversal/);
    expect(normalizeFrameworkPath(".opencode/lib/foo.ts")).toBe(".opencode/lib/foo.ts");
  });
});

describe("framework maintenance grant lifecycle", () => {
  beforeEach(() => {
    setupTempDb();
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    delete process.env.OPENCODE_ROOT;
    delete process.env.FRAMEWORK_DB_PATH;
    clearFrameworkMaintenancePolicyCache();
    closeDb();
  });

  function makeGrant(maxWrites?: number) {
    const grant = createGrant({
      dispatch_key: "dispatch-1",
      parent_session_id: "parent-1",
      agent_type: "build",
      privilege: "framework_maintenance",
      allowed_tools: ["safe_framework_edit"],
      reason: "test",
      max_writes: maxWrites,
      ttl_ms: 60_000,
    });
    if (!grant) throw new Error("createGrant returned null");
    return grant;
  }

  test("createGrant uses default allowed paths and max writes", () => {
    const grant = makeGrant();
    const allowed: string[] = JSON.parse(grant.allowed_paths);
    expect(allowed).toEqual([".opencode/**", "opencode.json"]);
    expect(grant.max_writes).toBe(3);
    expect(grant.writes_used).toBe(0);
  });

  test("bindGrant links grant to child session", () => {
    const grant = makeGrant();
    const { bindGrant } = require("../privilege");
    const bound = bindGrant(grant.dispatch_key, "child-1");
    expect(bound).not.toBeNull();
    expect(bound?.child_session_id).toBe("child-1");
    expect(bound?.status).toBe("bound");
  });

  test("hasGrant rejects exhausted budget", () => {
    const grant = makeGrant(1);
    const { bindGrant } = require("../privilege");
    bindGrant(grant.dispatch_key, "child-1");
    recordGrantWrite(grant.id);
    const g = hasGrant("child-1", "framework_maintenance", ".opencode/lib/foo.ts");
    expect(g).toBeNull();
  });

  test("recordGrantWrite increments writes_used and consumes at max", () => {
    const grant = makeGrant(2);
    const { bindGrant } = require("../privilege");
    bindGrant(grant.dispatch_key, "child-1");
    recordGrantWrite(grant.id);
    let row = getDb().query("SELECT writes_used, status FROM dispatch_privilege_grants WHERE id = ?").get(grant.id) as any;
    expect(row.writes_used).toBe(1);
    expect(row.status).toBe("bound");
    recordGrantWrite(grant.id);
    row = getDb().query("SELECT writes_used, status FROM dispatch_privilege_grants WHERE id = ?").get(grant.id) as any;
    expect(row.writes_used).toBe(2);
    expect(row.status).toBe("consumed");
  });

  test("plan creation rejects empty planned_paths", () => {
    const grant = makeGrant();
    expect(() =>
      createFrameworkMaintenancePlan({
        sessionId: "child-1",
        grantId: grant.id,
        plannedPaths: [],
        codegraphTargets: ["cg://a"],
        rationale: "test",
      }),
    ).toThrow(/planned_paths/);
  });

  test("plan creation rejects paths outside policy", () => {
    const grant = makeGrant();
    const { bindGrant } = require("../privilege");
    bindGrant(grant.dispatch_key, "child-1");
    expect(() =>
      createFrameworkMaintenancePlan({
        sessionId: "child-1",
        grantId: grant.id,
        plannedPaths: [".opencode/state/db"],
        codegraphTargets: ["cg://a"],
        rationale: "test",
      }),
    ).toThrow(/not allowed/);
  });

  test("full plan + write + complete flow", () => {
    const grant = makeGrant();
    const { bindGrant } = require("../privilege");
    bindGrant(grant.dispatch_key, "child-1");

    const plan = createFrameworkMaintenancePlan({
      sessionId: "child-1",
      grantId: grant.id,
      plannedPaths: [".opencode/lib/foo.ts", ".opencode/lib/bar.ts"],
      codegraphTargets: ["cg://foo", "cg://bar"],
      rationale: "test plan",
    });
    expect(plan).not.toBeNull();

    const active = getActiveFrameworkMaintenancePlan("child-1", grant.id);
    expect(active).not.toBeNull();

    expect(() => assertPathInActivePlan("child-1", grant.id, ".opencode/lib/foo.ts")).not.toThrow();
    expect(() => assertPathInActivePlan("child-1", grant.id, ".opencode/lib/baz.ts")).toThrow(/not in the active plan/);

    recordGrantWrite(grant.id);
    completeFrameworkMaintenancePlan("child-1", grant.id);
    completeGrant(grant.id);

    const after = getActiveFrameworkMaintenancePlan("child-1", grant.id);
    expect(after).toBeNull();
  });
});

describe("safe_framework_edit integration", () => {
  beforeEach(() => {
    setupTempDb();
    fs.mkdirSync(path.join(tempDir, ".opencode"), { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    delete process.env.OPENCODE_ROOT;
    delete process.env.FRAMEWORK_DB_PATH;
    clearFrameworkMaintenancePolicyCache();
    closeDb();
  });

  test("writes a planned file and tracks budget", async () => {
    const grant = createGrant({
      dispatch_key: "dispatch-fw-edit",
      parent_session_id: "parent-fw",
      agent_type: "build",
      privilege: "framework_maintenance",
      allowed_tools: ["safe_framework_edit"],
      max_writes: 3,
      reason: "integration test",
      ttl_ms: 60_000,
    });
    if (!grant) throw new Error("createGrant returned null");

    const { bindGrant } = require("../privilege");
    bindGrant(grant.dispatch_key, "child-fw");

    createFrameworkMaintenancePlan({
      sessionId: "child-fw",
      grantId: grant.id,
      plannedPaths: [".opencode/framework-test.ts"],
      codegraphTargets: ["cg://framework-test"],
      rationale: "integration test plan",
    });

    const fixturePath = path.join(tempDir, ".opencode", "framework-test.ts");
    const result = await safeFrameworkEdit.execute(
      { filePath: fixturePath, content: "export const x = 1;\n", reason: "test write" },
      { sessionID: "child-fw", agent: "build" } as any,
    );

    expect(result).toContain("success");
    expect(fs.existsSync(fixturePath)).toBe(true);
    expect(fs.readFileSync(fixturePath, "utf8")).toContain("export const x = 1");

    const row = getDb().query("SELECT writes_used, status FROM dispatch_privilege_grants WHERE id = ?").get(grant.id) as any;
    expect(row.writes_used).toBe(1);
    expect(row.status).toBe("bound");
  });
});
