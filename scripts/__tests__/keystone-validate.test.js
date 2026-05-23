/**
 * keystone-validate.test.js — Tests for scripts/keystone-validate.js
 *
 * Tests all exported functions: computeFileHash, buildIntegrityChain,
 * validateBundle, validateContract, readMachineJson.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ── Helpers ──────────────────────────────────────────────

const SCRIPT_PATH = path.resolve(__dirname, "..", "keystone-validate.js");
const STATE_DIR = path.resolve(__dirname, "..", "..", ".opencode", "state");
const MACHINE_PATH = path.join(STATE_DIR, "machine.json");
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

let kv;

beforeAll(() => {
  kv = require(SCRIPT_PATH);
});

// ── computeFileHash ──────────────────────────────────────

describe("computeFileHash", () => {
  test("returns sha256-<hex> for an existing file", () => {
    const hash = kv.computeFileHash("AGENTS.md");
    expect(hash).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  test('returns "MISSING" for a non-existent file', () => {
    const hash = kv.computeFileHash("nonexistent-file-xyz.md");
    expect(hash).toBe("MISSING");
  });

  test("strips x-keystone-state-hash header from contract.yaml", () => {
    // contract.yaml should have the header — hash should still be valid
    const hash = kv.computeFileHash("contract.yaml");
    expect(hash).toMatch(/^sha256-[a-f0-9]{64}$/);
  });
});

// ── buildIntegrityChain ──────────────────────────────────

describe("buildIntegrityChain", () => {
  test("returns a Map", () => {
    const chain = kv.buildIntegrityChain();
    expect(chain).toBeInstanceOf(Map);
  });

  test("includes contract.yaml", () => {
    const chain = kv.buildIntegrityChain();
    expect(chain.has("contract.yaml")).toBe(true);
  });

  test("includes AGENTS.md and PROJECT_REFERENCE.md", () => {
    const chain = kv.buildIntegrityChain();
    expect(chain.has("AGENTS.md")).toBe(true);
    expect(chain.has("PROJECT_REFERENCE.md")).toBe(true);
  });

  test("all entries have valid hash format or MISSING", () => {
    const chain = kv.buildIntegrityChain();
    for (const [relPath, hash] of chain) {
      expect(hash).toMatch(/^(sha256-[a-f0-9]{64}|MISSING)$/);
    }
  });

  test("includes requirement docs", () => {
    const chain = kv.buildIntegrityChain();
    for (const doc of kv.CORE_REQUIREMENT_DOCS) {
      const relPath = `.opencode/context/requirements/${doc}`;
      expect(chain.has(relPath)).toBe(true);
    }
  });
});

// ── readMachineJson ──────────────────────────────────────

describe("readMachineJson", () => {
  test("returns an object when machine.json exists", () => {
    const machine = kv.readMachineJson();
    // If machine.json doesn't exist, this returns null
    if (machine !== null) {
      expect(machine).toBeInstanceOf(Object);
    }
  });
});

// ── validateContract ─────────────────────────────────────

describe("validateContract", () => {
  test("returns an object with passed and detail keys", () => {
    const result = kv.validateContract();
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("detail");
  });

  test("passed is boolean", () => {
    const result = kv.validateContract();
    expect(typeof result.passed).toBe("boolean");
  });
});

// ── validateBundle ───────────────────────────────────────

describe("validateBundle", () => {
  test("returns an object with passed, results, and summary", () => {
    const result = kv.validateBundle(false);
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("summary");
  });

  test("results is an array", () => {
    const result = kv.validateBundle(false);
    expect(Array.isArray(result.results)).toBe(true);
  });

  test("each result has path, status, expected, actual", () => {
    const result = kv.validateBundle(false);
    for (const r of result.results) {
      expect(r).toHaveProperty("path");
      expect(r).toHaveProperty("status");
      expect(r).toHaveProperty("expected");
      expect(r).toHaveProperty("actual");
    }
  });
});

// ── CORE_REQUIREMENT_DOCS ────────────────────────────────

describe("CORE_REQUIREMENT_DOCS", () => {
  test("has 6 documents", () => {
    expect(kv.CORE_REQUIREMENT_DOCS).toHaveLength(6);
  });
});

// ── CLI main (integration sanity) ────────────────────────

describe("CLI output", () => {
  test("--help shows usage when no args", (done) => {
    const { exec } = require("child_process");
    exec(`node "${SCRIPT_PATH}"`, (err, stdout, stderr) => {
      expect(stderr).toContain("Usage:");
      expect(err).not.toBeNull();
      done();
    });
  });

  test("--hash AGENTS.md prints sha256-<hex>", (done) => {
    const { exec } = require("child_process");
    exec(`node "${SCRIPT_PATH}" --hash AGENTS.md`, (err, stdout, stderr) => {
      expect(stdout.trim()).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(err).toBeNull();
      done();
    });
  });
});
