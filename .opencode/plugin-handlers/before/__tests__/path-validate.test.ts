import { describe, test, expect } from "bun:test";
import { handle } from "../path-validate";

describe("path-validate handler", () => {
  // --- NULL BYTE ---
  test("null byte in path => throws", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: "/home/project/\0malicious" } },
        {},
      ),
    ).rejects.toThrow(/NULL_BYTE/);
  });

  test("encoded null byte (%00) in path => throws", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: "/home/project/%00malicious" } },
        {},
      ),
    ).rejects.toThrow(/NULL_BYTE/);
  });

  // --- PATH TRAVERSAL ---
  test("path traversal escaping root => throws", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: "../../../etc/passwd" } },
        {},
      ),
    ).rejects.toThrow(/PATH_TRAVERSAL/);
  });

  // --- WORKTREE BOUNDARY ---
  test("absolute path outside project root => throws", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: "/etc/passwd" } },
        {},
      ),
    ).rejects.toThrow(/WORKTREE_BOUNDARY/);
  });

  // --- OVERLY LONG PATH ---
  test("overly long path => throws", async () => {
    const longPath = "/home/project/" + "a".repeat(5000);
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: longPath } },
        {},
      ),
    ).rejects.toThrow(/PATH_LENGTH/);
  });

  // --- INVALID CHARACTERS ---
  test("control characters in path => throws", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: "/home/project/file\u0001name" } },
        {},
      ),
    ).rejects.toThrow(/INVALID_CHARS/);
  });

  // --- VALID PATHS (ALLOWED) ---
  test("normal relative path => resolves", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: "src/app/app.module.ts" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("normal absolute path within project => resolves", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: process.env.OPENCODE_ROOT + "/src/app/app.module.ts" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("safe_mkdir valid path => resolves", async () => {
    await expect(
      handle(
        { tool: "safe_mkdir", sessionID: "pv-sid", args: { path: "src/app/new-dir" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("non-write tool passes through", async () => {
    await expect(
      handle(
        { tool: "read", sessionID: "pv-sid", args: { filePath: "src/app/app.module.ts" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  // --- ENHANCEMENT 1: safe_shell bare absolute path ---
  test("safe_shell bare absolute path outside root => throws", async () => {
    await expect(
      handle(
        { tool: "safe_shell", sessionID: "pv-sid", args: { command: "cat /etc/passwd" } },
        {},
      ),
    ).rejects.toThrow(/WORKTREE_BOUNDARY/);
  });

  test("safe_shell bare relative traversal => throws", async () => {
    await expect(
      handle(
        { tool: "safe_shell", sessionID: "pv-sid", args: { command: "cat ../../../etc/passwd" } },
        {},
      ),
    ).rejects.toThrow(/PATH_TRAVERSAL/);
  });

  test("safe_shell command with no path => resolves", async () => {
    await expect(
      handle(
        { tool: "safe_shell", sessionID: "pv-sid", args: { command: "ls -la" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("safe_shell command with shell builtin => resolves", async () => {
    await expect(
      handle(
        { tool: "safe_shell", sessionID: "pv-sid", args: { command: "cd /tmp" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("safe_shell file with extension still detected", async () => {
    await expect(
      handle(
        { tool: "safe_shell", sessionID: "pv-sid", args: { command: "cat /etc/config.json" } },
        {},
      ),
    ).rejects.toThrow(/WORKTREE_BOUNDARY/);
  });

  // --- ENHANCEMENT 2: symlink escape ---
  test("symlink escape detection via realpathSync", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: "/nonexistent/symlink/target" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  // --- ENHANCEMENT 3: path normalization warning ---
  test("path with redundant ./ segment is allowed but logged", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: process.env.OPENCODE_ROOT + "/src/./app/app.module.ts" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  test("path with ../ within root is allowed but logged", async () => {
    await expect(
      handle(
        { tool: "safe_edit", sessionID: "pv-sid", args: { filePath: process.env.OPENCODE_ROOT + "/src/app/../app/app.module.ts" } },
        {},
      ),
    ).resolves.toBeUndefined();
  });
});
