import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { closeDb } from "../../../lib/db-manager";
import { handle } from "../codegraph";

let tempDir = "";

function resetTempDb(): void {
  closeDb();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-hook-"));
  process.env.FRAMEWORK_DB_PATH = path.join(tempDir, "framework-state.db");
}

describe("before/codegraph github MCP enforcement", () => {
  beforeEach(() => {
    resetTempDb();
  });

  afterEach(() => {
    closeDb();
    delete process.env.FRAMEWORK_DB_PATH;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("allows github read tools to bypass repo-write enforcement", async () => {
    await expect(
      handle(
        {
          tool: "github_get_issue",
          sessionID: "session-read",
          args: { owner: "octo", repo: "demo", issue_number: 1 },
        },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("does NOT block github write tools (delegated to tool-governance)", async () => {
    // After the Phase 3 contraction, codegraph.ts is a pure evidence adapter and
    // no longer adjudicates repo-op / GitHub MCP writes. The governance domain
    // (tool-governance-handler → repo-policy) is the sole adjudicator.
    await expect(
      handle(
        {
          tool: "github_create_issue",
          sessionID: "session-write",
          args: { owner: "octo", repo: "demo", title: "test" },
        },
        {},
      ),
    ).resolves.toBeUndefined();
  });

    test("safe_shell cat <file> => not blocked by REPO-OP", async () => {
      const input = { tool: "safe_shell", args: { command: "cat foo.txt" }, sessionID: "test-sid" };
      const output = { args: { command: "cat foo.txt" } };
      try {
        await handle(input, output);
      } catch (e: any) {
        expect(String(e.message)).not.toContain("REPO-OP");
      }
    });

    test("safe_shell sha256sum <file> => not blocked by REPO-OP", async () => {
      const input = { tool: "safe_shell", args: { command: "sha256sum foo.txt" }, sessionID: "test-sid" };
      const output = { args: { command: "sha256sum foo.txt" } };
      try {
        await handle(input, output);
      } catch (e: any) {
        expect(String(e.message)).not.toContain("REPO-OP");
      }
    });

    test("safe_shell git add a.ts => not blocked by REPO-OP (moved to repo-policy)", async () => {
      const input = { tool: "safe_shell", args: { command: "git add a.ts" }, sessionID: "test-sid" };
      const output = { args: { command: "git add a.ts" } };
      try {
        await handle(input, output);
      } catch (e: any) {
        expect(String(e.message)).not.toContain("REPO-OP");
      }
    });

});
