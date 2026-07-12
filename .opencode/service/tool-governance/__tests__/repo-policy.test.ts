import { describe, test, expect } from "bun:test";
import { evaluate } from "../policies/repo-policy";
import type { ToolGovernanceContext } from "../context";
import { classifyGithubMcpTool, classifyRepoShellCommand } from "../../repo/classify";

function ctxWith(tool: string, repoOperation: any): ToolGovernanceContext {
  return { sessionID: "test-sid", agent: "test-agent", tool, args: {}, targetPaths: [], repoOperation };
}

describe("repo-policy", () => {
  test("non-repo tool => null (not a repo operation)", () => {
    expect(evaluate({ sessionID: "s", agent: "a", tool: "safe_edit", args: {}, targetPaths: [] })).toBeNull();
  });

  test("safe_shell cat => null (no repo op classified)", () => {
    expect(evaluate(ctxWith("safe_shell", classifyRepoShellCommand("cat foo.txt")))).toBeNull();
  });

  test("safe_shell sha256sum => null (no repo op classified)", () => {
    expect(evaluate(ctxWith("safe_shell", classifyRepoShellCommand("sha256sum foo.txt")))).toBeNull();
  });

  test("safe_shell git status => allow (repo read allowed, REPO-OP)", () => {
    const d = evaluate(ctxWith("safe_shell", classifyRepoShellCommand("git status")));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("allow");
    expect(d!.ruleId).toBe("REPO-OP");
    expect(d!.layer).toBe("repo-policy");
  });

  test("safe_shell git add => deny (repo write blocked, REPO-OP)", () => {
    const d = evaluate(ctxWith("safe_shell", classifyRepoShellCommand("git add a.ts")));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("deny");
    expect(d!.ruleId).toBe("REPO-OP");
    expect(d!.layer).toBe("repo-policy");
  });

  test("github read => allow (repo read allowed, REPO-OP)", () => {
    const d = evaluate(ctxWith("github_get_issue", classifyGithubMcpTool("github_get_issue", { owner: "o", repo: "r", issue_number: 1 })));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("allow");
    expect(d!.ruleId).toBe("REPO-OP");
    expect(d!.layer).toBe("repo-policy");
  });

  test("github write => deny (REPO-OP)", () => {
    const d = evaluate(ctxWith("github_create_issue", classifyGithubMcpTool("github_create_issue", { owner: "o", repo: "r", title: "t" })));
    expect(d).not.toBeNull();
    expect(d!.outcome).toBe("deny");
    expect(d!.ruleId).toBe("REPO-OP");
    expect(d!.layer).toBe("repo-policy");
  });
});
