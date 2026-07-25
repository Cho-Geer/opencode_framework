import { describe, expect, test } from "bun:test";
import {
  extractShellEvidenceTarget,
  extractShellLocalPaths,
  parseShellWriteTargets,
} from "../shell-targets";

describe("tool-governance shell-targets", () => {
  test("extractShellLocalPaths ignores gh --repo slug and keeps local redirects only", () => {
    expect(
      extractShellLocalPaths(
        "gh issue create --repo microsoft/vscode --title test --body body > ./audit.log",
      ),
    ).toEqual([`${process.env.OPENCODE_ROOT || process.cwd()}/audit.log`]);
  });

  test("parseShellWriteTargets parses local write targets", () => {
    expect(parseShellWriteTargets("cp src/index.ts src/index.copy.ts")).toEqual({
      applies: true,
      paths: ["src/index.copy.ts"],
      reason: "parsed",
    });
  });

  test("extractShellEvidenceTarget defers repo shell commands", () => {
    expect(
      extractShellEvidenceTarget(
        "gh issue create --repo microsoft/vscode --title test --body body",
      ),
    ).toBe("");
    expect(extractShellEvidenceTarget("git add src/index.ts")).toBe("");
  });

  test("extractShellEvidenceTarget keeps local source edits", () => {
    expect(extractShellEvidenceTarget("cp src/a.ts src/b.ts")).toBe("src/b.ts");
    expect(extractShellEvidenceTarget("node ./scripts/update-schema.ts")).toBe(
      `${process.env.OPENCODE_ROOT || process.cwd()}/scripts/update-schema.ts`,
    );
  });
});
