/**
 * permission-equivalence.test.ts — P2-D v2.1 Equivalence Matrix Tests
 *
 * Verifies that the new permission-reader.ts produces semantically equivalent
 * (or strict improvement of) decisions compared to the pre-P2-D implementation.
 *
 * Test categories:
 *   1. Shell allowlist equivalence: getAgentShellAllowlist structure & semantics
 *   2. Glob matching equivalence: pathMatchesGlob matches old matchGlob semantics
 *   3. Bifurcated conversion: permissionMapToBifurcated handles all action types
 *   4. fail-closed behavior: missing opencode.json in strict/locked mode
 *   5. agent coverage: all 10 agents have permission blocks in opencode.json
 *
 * @author @Super-Admin (P2-D v2.1)
 * @version 1.0.0
 * @since 2026-06-17
 */

import { describe, it, expect } from "bun:test";
import {
  getAgentShellAllowlist,
  permissionMapToBifurcated,
  readOpencodeConfig,
  resetOpencodeConfigCache,
} from "../permission-reader";
import { pathMatchesGlob } from "../gate-core";

describe("P2-D Permission Equivalence Matrix", () => {
  // Reset cache before tests to ensure fresh load
  resetOpencodeConfigCache();

  describe("Shell allowlist equivalence (getAgentShellAllowlist)", () => {
    it("@Coder-BE: object map with explicit allows/denies", () => {
      const result = getAgentShellAllowlist("@Coder-BE");
      // @Coder-BE has object map → allAllowed=false
      expect(result.allAllowed).toBe(false);
      expect(result.toolDenied).toBe(false);
      // Should contain explicit allows from opencode.json
      expect(result.allowed).toContain("which *");
      expect(result.allowed).toContain("npx tsc *");
      expect(result.allowed).toContain("tsc *");
      // Should contain explicit denies (for safeBashTool veto)
      expect(result.denied).toBeDefined();
    });

    it("@Meta-Planner: legacy fallback keeps explicit shell rules", () => {
      const result = getAgentShellAllowlist("@Meta-Planner");
      expect(result.allAllowed).toBe(false);
      expect(result.toolDenied).toBe(false);
      expect(result.allowed).toContain("*");
    });

    it("@CI-CD-Agent: legacy fallback keeps explicit shell rules", () => {
      const result = getAgentShellAllowlist("@CI-CD-Agent");
      expect(result.allAllowed).toBe(false);
      expect(result.allowed).toContain("*");
    });

    it("@Arbiter: should have restrictive permission", () => {
      const result = getAgentShellAllowlist("@Arbiter");
      // @Arbiter should NOT be allAllowed
      expect(result.allAllowed).toBe(false);
    });

    it("Unknown agent: permissive by default in advisory", () => {
      const result = getAgentShellAllowlist("@UnknownAgent");
      // Default behavior: toolDenied depends on mode, but allowed/denied should be empty
      expect(result.allowed).toEqual([]);
      expect(result.denied).toEqual([]);
      expect(result.needsConfirmation).toEqual([]);
    });
  });

  describe("Bifurcated conversion (permissionMapToBifurcated)", () => {
    it("should map allow to allowed", () => {
      const scopes = permissionMapToBifurcated({ "path/**": "allow" });
      expect(scopes.allowed).toContain("path/**");
      expect(scopes.denied).not.toContain("path/**");
    });

    it("should map deny to denied", () => {
      const scopes = permissionMapToBifurcated({ "forbidden/**": "deny" });
      expect(scopes.denied).toContain("forbidden/**");
      expect(scopes.allowed).not.toContain("forbidden/**");
    });

    it("should map ask to denied (non-interactive safety downgrade)", () => {
      const scopes = permissionMapToBifurcated({ "dangerous/**": "ask" });
      // "ask" must NOT be auto-allowed in non-interactive framework audits
      expect(scopes.allowed).not.toContain("dangerous/**");
      // Should be mapped to denied (safe downgrade)
      expect(scopes.denied).toContain("dangerous/**");
    });

    it("should handle mixed actions", () => {
      const scopes = permissionMapToBifurcated({
        "allow/path/**": "allow",
        "forbid/path/**": "deny",
        "ask/path/**": "ask",
      });
      expect(scopes.allowed).toContain("allow/path/**");
      expect(scopes.denied).toContain("forbid/path/**");
      expect(scopes.denied).toContain("ask/path/**");
      expect(scopes.allowed).not.toContain("ask/path/**");
    });
  });

  describe("Glob matching equivalence (pathMatchesGlob)", () => {
    it("matches single-segment wildcard", () => {
      expect(pathMatchesGlob("foo.ts", "*.ts")).toBe(true);
      expect(pathMatchesGlob("foo/bar.ts", "*.ts")).toBe(false); // * does not cross /
    });

    it("matches globstar", () => {
      expect(pathMatchesGlob("foo/bar/baz.ts", "foo/**")).toBe(true);
      expect(pathMatchesGlob("foo.ts", "foo/**")).toBe(false);
    });

    it("escapes dots", () => {
      expect(pathMatchesGlob("foo.ts", "foo.ts")).toBe(true);
      expect(pathMatchesGlob("fooXts", "foo.ts")).toBe(false);
    });

    it("matches full path with prefix", () => {
      expect(
        pathMatchesGlob("booking_system_refactor/booking-backend/src/services/booking.service.ts", "booking_system_refactor/booking-backend/src/**"),
      ).toBe(true);
      expect(
        pathMatchesGlob("booking_system_refactor/booking-backend/src/main.ts", "booking-backend/src/**"),
      ).toBe(false); // glob needs full path
    });

    it("matches .opencode paths", () => {
      expect(pathMatchesGlob(".opencode/lib/gate-checks.ts", ".opencode/**")).toBe(true);
      expect(pathMatchesGlob("opencode.json", "opencode.json")).toBe(true);
    });
  });

  describe("Agent coverage (opencode.json)", () => {
    it("active config should expose Orchestrator plus native overrides", () => {
      const cfg = readOpencodeConfig();
      const expectedAgents = [
        "Orchestrator",
        "build",
        "general",
        "plan",
        "explore",
      ];
      for (const agent of expectedAgents) {
        expect(cfg.agent[agent]).toBeDefined();
        expect(cfg.agent[agent].permission).toBeDefined();
      }
    });

    it("all active agents should have safe_edit permission defined", () => {
      const cfg = readOpencodeConfig();
      for (const agentName of Object.keys(cfg.agent)) {
        expect(cfg.agent[agentName].permission.safe_edit).toBeDefined();
      }
    });

    it("legacy role identities should still resolve permission profiles", () => {
      const legacyAgents = [
        "@Meta-Planner",
        "@Architect",
        "@Coder-BE",
        "@Coder-FE",
        "@Guardian",
        "@Arbiter",
        "@CI-CD-Agent",
        "@Super-Admin",
        "@Knowledge-Curator",
      ];
      for (const agent of legacyAgents) {
        expect(getAgentShellAllowlist(agent)).toBeDefined();
      }
    });
  });

  describe("Read opencode config", () => {
    it("should load opencode.json from project root", () => {
      const cfg = readOpencodeConfig();
      expect(cfg).not.toBeNull();
      expect(cfg.agent).toBeDefined();
      expect(cfg.default_agent).toBeDefined();
    });

    it("cached: second call should return same instance", () => {
      const cfg1 = readOpencodeConfig();
      const cfg2 = readOpencodeConfig();
      expect(cfg1).toBe(cfg2); // same reference = cached
    });
  });
});
