import { describe, test, expect } from "bun:test";
import {
  classifyGitArgv,
  classifyGhArgv,
  classifyGithubMcpTool,
  classifyRepoShellCommand,
  splitRepoShellCommand,
  isRepoReadOperation,
  isRepoWriteOperation,
} from "../classify";

describe("splitRepoShellCommand", () => {
  test("splits simple git command", () => {
    expect(splitRepoShellCommand("git status --short")).toEqual(["git", "status", "--short"]);
  });

  test("returns null for chained commands with &&", () => {
    expect(splitRepoShellCommand("git status && git add x")).toBeNull();
  });

  test("returns null for chained commands with ;", () => {
    expect(splitRepoShellCommand("git status; git add x")).toBeNull();
  });

  test("returns null for piped commands", () => {
    expect(splitRepoShellCommand("git log | head -5")).toBeNull();
  });

  test("returns null for redirects", () => {
    expect(splitRepoShellCommand("git status > output.txt")).toBeNull();
  });

  test("handles quoted strings", () => {
    expect(splitRepoShellCommand('git commit -m "hello world"')).toEqual(
      ["git", "commit", "-m", '"hello world"']
    );
  });

  test("returns null for empty command", () => {
    expect(splitRepoShellCommand("")).toBeNull();
  });
});

describe("classifyGitArgv", () => {
  test("git status --short => read/allow", () => {
    const op = classifyGitArgv(["git", "status", "--short"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
    expect(op.provider).toBe("git");
    expect(op.subcommand).toBe("status");
  });

  test("git diff -- .opencode/plugin.ts => read/allow", () => {
    const op = classifyGitArgv(["git", "diff", "--", ".opencode/plugin.ts"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
    expect(op.paths).toContain(".opencode/plugin.ts");
  });

  test("git add file.ts => local_write/grant_required", () => {
    const op = classifyGitArgv(["git", "add", "file.ts"]);
    expect(op.kind).toBe("local_write");
    expect(op.decision).toBe("grant_required");
    expect(op.requiresGrant).toBe(true);
    expect(op.paths).toContain("file.ts");
  });

  test("git commit -m x => local_write/grant_required", () => {
    const op = classifyGitArgv(["git", "commit", "-m", "x"]);
    expect(op.kind).toBe("local_write");
    expect(op.decision).toBe("grant_required");
    expect(op.subcommand).toBe("commit");
  });

  test("git commit --no-verify -m x => hook_bypass/block", () => {
    const op = classifyGitArgv(["git", "commit", "--no-verify", "-m", "x"]);
    expect(op.kind).toBe("hook_bypass");
    expect(op.decision).toBe("block");
  });

  test("git commit -n -m x => hook_bypass/block", () => {
    const op = classifyGitArgv(["git", "commit", "-n", "-m", "x"]);
    expect(op.kind).toBe("hook_bypass");
    expect(op.decision).toBe("block");
  });

  test("git -c core.hooksPath=/tmp/noop commit -m x => hook_bypass/block", () => {
    const op = classifyGitArgv(["git", "-c", "core.hooksPath=/tmp/noop", "commit", "-m", "x"]);
    expect(op.kind).toBe("hook_bypass");
    expect(op.decision).toBe("block");
  });

  test("git -c core.skipHooks=true commit -m x => hook_bypass/block", () => {
    const op = classifyGitArgv(["git", "-c", "core.skipHooks=true", "commit", "-m", "x"]);
    expect(op.kind).toBe("hook_bypass");
    expect(op.decision).toBe("block");
  });

  test("git reset --hard HEAD => destructive/block", () => {
    const op = classifyGitArgv(["git", "reset", "--hard", "HEAD"]);
    expect(op.kind).toBe("destructive");
    expect(op.decision).toBe("block");
  });

  test("git checkout -- file.ts => destructive/block", () => {
    const op = classifyGitArgv(["git", "checkout", "--", "file.ts"]);
    expect(op.kind).toBe("destructive");
    expect(op.decision).toBe("block");
    expect(op.paths).toContain("file.ts");
  });

  test("git push origin work-one => remote_write/human_confirmation_required", () => {
    const op = classifyGitArgv(["git", "push", "origin", "work-one"]);
    expect(op.kind).toBe("remote_write");
    expect(op.decision).toBe("human_confirmation_required");
    expect(op.requiresHumanConfirmation).toBe(true);
    expect(op.remotes).toContain("origin");
  });

  test("git log --oneline -5 => read/allow", () => {
    const op = classifyGitArgv(["git", "log", "--oneline", "-5"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("git show abc123 => read/allow", () => {
    const op = classifyGitArgv(["git", "show", "abc123"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("git branch => read/allow", () => {
    const op = classifyGitArgv(["git", "branch"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("git branch --list => read/allow", () => {
    const op = classifyGitArgv(["git", "branch", "--list"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("git branch --show-current => read/allow", () => {
    const op = classifyGitArgv(["git", "branch", "--show-current"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("git branch -d feature => destructive/block", () => {
    const op = classifyGitArgv(["git", "branch", "-d", "feature"]);
    expect(op.kind).toBe("destructive");
    expect(op.decision).toBe("block");
  });

  test("git restore --staged file.ts => local_write/grant_required", () => {
    const op = classifyGitArgv(["git", "restore", "--staged", "file.ts"]);
    expect(op.kind).toBe("local_write");
    expect(op.decision).toBe("grant_required");
  });

  test("git clean -fd => destructive/block", () => {
    const op = classifyGitArgv(["git", "clean", "-fd"]);
    expect(op.kind).toBe("destructive");
    expect(op.decision).toBe("block");
  });

  test("git merge feature => destructive/block", () => {
    const op = classifyGitArgv(["git", "merge", "feature"]);
    expect(op.kind).toBe("destructive");
    expect(op.decision).toBe("block");
  });

  test("git rebase main => destructive/block", () => {
    const op = classifyGitArgv(["git", "rebase", "main"]);
    expect(op.kind).toBe("destructive");
    expect(op.decision).toBe("block");
  });

  test("git config core.hooksPath /dev/null => hook_bypass/block", () => {
    const op = classifyGitArgv(["git", "config", "core.hooksPath", "/dev/null"]);
    expect(op.kind).toBe("hook_bypass");
    expect(op.decision).toBe("block");
  });

  test("git config core.skipHooks true => hook_bypass/block", () => {
    const op = classifyGitArgv(["git", "config", "core.skipHooks", "true"]);
    expect(op.kind).toBe("hook_bypass");
    expect(op.decision).toBe("block");
  });

  test("git whatever --maybe => unknown/block", () => {
    const op = classifyGitArgv(["git", "whatever", "--maybe"]);
    expect(op.kind).toBe("unknown");
    expect(op.decision).toBe("block");
  });

  test("git rev-parse HEAD => read/allow", () => {
    const op = classifyGitArgv(["git", "rev-parse", "HEAD"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("git fetch origin => read/allow", () => {
    const op = classifyGitArgv(["git", "fetch", "origin"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });
});

describe("classifyGhArgv", () => {
  test("gh pr view 1 => read/allow", () => {
    const op = classifyGhArgv(["gh", "pr", "view", "1"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
    expect(op.provider).toBe("gh");
  });

  test("gh pr list => read/allow", () => {
    const op = classifyGhArgv(["gh", "pr", "list"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("gh pr comment 1 -b x => remote_write/human_confirmation_required", () => {
    const op = classifyGhArgv(["gh", "pr", "comment", "1", "-b", "x"]);
    expect(op.kind).toBe("remote_write");
    expect(op.decision).toBe("human_confirmation_required");
    expect(op.requiresHumanConfirmation).toBe(true);
  });

  test("gh pr create --title x => remote_write", () => {
    const op = classifyGhArgv(["gh", "pr", "create", "--title", "x"]);
    expect(op.kind).toBe("remote_write");
    expect(op.decision).toBe("human_confirmation_required");
  });

  test("gh pr merge 1 => remote_write", () => {
    const op = classifyGhArgv(["gh", "pr", "merge", "1"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh issue view 1 => read/allow", () => {
    const op = classifyGhArgv(["gh", "issue", "view", "1"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("gh issue create => remote_write", () => {
    const op = classifyGhArgv(["gh", "issue", "create"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh issue comment 1 -b x => remote_write", () => {
    const op = classifyGhArgv(["gh", "issue", "comment", "1", "-b", "x"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh api -X PATCH repos/a/b/issues/1 => remote_write", () => {
    const op = classifyGhArgv(["gh", "api", "-X", "PATCH", "repos/a/b/issues/1"]);
    expect(op.kind).toBe("remote_write");
    expect(op.decision).toBe("human_confirmation_required");
  });

  test("gh api -X POST repos/a/b/issues => remote_write", () => {
    const op = classifyGhArgv(["gh", "api", "-X", "POST", "repos/a/b/issues"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh api -X DELETE repos/a/b/issues/1 => remote_write", () => {
    const op = classifyGhArgv(["gh", "api", "-X", "DELETE", "repos/a/b/issues/1"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh api -X PUT repos/a/b/issues/1 => remote_write", () => {
    const op = classifyGhArgv(["gh", "api", "-X", "PUT", "repos/a/b/issues/1"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh api repos/a/b/pulls (default GET) => read/allow", () => {
    const op = classifyGhArgv(["gh", "api", "repos/a/b/pulls"]);
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("gh release view v1.0 => read/allow", () => {
    const op = classifyGhArgv(["gh", "release", "view", "v1.0"]);
    expect(op.kind).toBe("read");
  });

  test("gh release create v1.0 => remote_write", () => {
    const op = classifyGhArgv(["gh", "release", "create", "v1.0"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh workflow run ci.yml => remote_write", () => {
    const op = classifyGhArgv(["gh", "workflow", "run", "ci.yml"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh secret set MY_SECRET => remote_write", () => {
    const op = classifyGhArgv(["gh", "secret", "set", "MY_SECRET"]);
    expect(op.kind).toBe("remote_write");
  });

  test("gh repo view => read/allow", () => {
    const op = classifyGhArgv(["gh", "repo", "view"]);
    expect(op.kind).toBe("read");
  });

  test("unknown gh command => unknown/block", () => {
    const op = classifyGhArgv(["gh", "unknown-resource", "action"]);
    expect(op.kind).toBe("unknown");
    expect(op.decision).toBe("block");
  });
});

describe("classifyGithubMcpTool", () => {
  test("github_get_pull_request => read/allow", () => {
    const op = classifyGithubMcpTool("github_get_pull_request");
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
    expect(op.provider).toBe("github_mcp");
  });

  test("github_list_issues => read/allow", () => {
    const op = classifyGithubMcpTool("github_list_issues");
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("github_search_code => read/allow", () => {
    const op = classifyGithubMcpTool("github_search_code");
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("github_create_or_update_file => remote_write/human_confirmation_required", () => {
    const op = classifyGithubMcpTool("github_create_or_update_file");
    expect(op.kind).toBe("remote_write");
    expect(op.decision).toBe("human_confirmation_required");
    expect(op.requiresHumanConfirmation).toBe(true);
  });

  test("github_create_issue => remote_write", () => {
    const op = classifyGithubMcpTool("github_create_issue");
    expect(op.kind).toBe("remote_write");
  });

  test("github_create_pull_request => remote_write", () => {
    const op = classifyGithubMcpTool("github_create_pull_request");
    expect(op.kind).toBe("remote_write");
  });

  test("github_fork_repository => remote_write", () => {
    const op = classifyGithubMcpTool("github_fork_repository");
    expect(op.kind).toBe("remote_write");
  });

  test("unknown github tool => unknown/block", () => {
    const op = classifyGithubMcpTool("github_something_weird");
    expect(op.kind).toBe("unknown");
    expect(op.decision).toBe("block");
  });
});

describe("classifyRepoShellCommand", () => {
  test("git status && git add x => unknown/block (multi-command)", () => {
    const op = classifyRepoShellCommand("git status && git add x");
    expect(op.kind).toBe("unknown");
    expect(op.decision).toBe("block");
  });

  test("git status | head -5 => unknown/block (pipe)", () => {
    const op = classifyRepoShellCommand("git status | head -5");
    expect(op.kind).toBe("unknown");
    expect(op.decision).toBe("block");
  });

  test("git status > output.txt => unknown/block (redirect)", () => {
    const op = classifyRepoShellCommand("git status > output.txt");
    expect(op.kind).toBe("unknown");
    expect(op.decision).toBe("block");
  });

  test("git status --short => read/allow", () => {
    const op = classifyRepoShellCommand("git status --short");
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("gh pr view 1 => read/allow", () => {
    const op = classifyRepoShellCommand("gh pr view 1");
    expect(op.kind).toBe("read");
    expect(op.decision).toBe("allow");
  });

  test("not a git/gh command => unknown/block", () => {
    const op = classifyRepoShellCommand("ls -la");
    expect(op.kind).toBe("unknown");
    expect(op.decision).toBe("block");
  });
});

describe("isRepoReadOperation / isRepoWriteOperation", () => {
  test("read operation is correctly identified", () => {
    const op = classifyGitArgv(["git", "status"]);
    expect(isRepoReadOperation(op)).toBe(true);
    expect(isRepoWriteOperation(op)).toBe(false);
  });

  test("local_write operation is correctly identified", () => {
    const op = classifyGitArgv(["git", "add", "file.ts"]);
    expect(isRepoReadOperation(op)).toBe(false);
    expect(isRepoWriteOperation(op)).toBe(true);
  });

  test("remote_write operation is correctly identified", () => {
    const op = classifyGitArgv(["git", "push", "origin", "main"]);
    expect(isRepoReadOperation(op)).toBe(false);
    expect(isRepoWriteOperation(op)).toBe(true);
  });

  test("destructive is not read or write", () => {
    const op = classifyGitArgv(["git", "reset", "--hard"]);
    expect(isRepoReadOperation(op)).toBe(false);
    expect(isRepoWriteOperation(op)).toBe(false);
  });
});
