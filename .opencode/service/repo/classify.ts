import type {
  RepoOperation,
  RepoOperationKind,
  RepoDecision,
  RepoClassificationInput,
  RepoProvider,
} from "./types";

const HOOK_BYPASS_FLAGS = new Set(["--no-verify", "-n"]);
const HOOK_BYPASS_CONFIG_KEYS = ["core.hookspath", "core.skipworktree", "core.skiphooks"];

function makeOperation(
  provider: RepoProvider,
  command: string,
  argv: string[],
  subcommand: string,
  kind: RepoOperationKind,
  paths: string[] = [],
  remotes: string[] = [],
  reason: string = "",
): RepoOperation {
  const decision = kindToDecision(kind);
  return {
    provider,
    command,
    argv,
    subcommand,
    kind,
    decision,
    paths,
    remotes,
    requiresGrant: kind === "local_write",
    requiresHumanConfirmation: kind === "remote_write",
    reason: reason || `${kind} ${provider} ${subcommand}`,
  };
}

function kindToDecision(kind: RepoOperationKind): RepoDecision {
  switch (kind) {
    case "read":
      return "allow";
    case "local_write":
      return "grant_required";
    case "remote_write":
      return "human_confirmation_required";
    case "destructive":
    case "hook_bypass":
    case "unknown":
      return "block";
  }
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.some((a) => a === flag || a.startsWith(flag + "="));
}

function hasAnyFlag(argv: string[], flags: Set<string>): boolean {
  return argv.some((a) => {
    for (const f of flags) {
      if (a === f || a.startsWith(f + "=")) return true;
    }
    return false;
  });
}

function extractPathsFromArgv(argv: string[], startIdx: number): string[] {
  const paths: string[] = [];
  let afterSeparator = false;
  for (let i = startIdx; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      afterSeparator = true;
      continue;
    }
    if (afterSeparator && !arg.startsWith("-")) {
      paths.push(arg);
    } else if (!arg.startsWith("-") && !afterSeparator && i >= startIdx) {
      paths.push(arg);
    }
  }
  return paths;
}

function findSubcommand(argv: string[], startIdx: number): string {
  for (let i = startIdx; i < argv.length; i++) {
    if (!argv[i].startsWith("-")) return argv[i];
  }
  return "";
}

export function classifyGitArgv(argv: string[]): RepoOperation {
  if (argv.length === 0 || argv[0] !== "git") {
    return makeOperation("git", argv.join(" "), argv, "", "unknown", [], [], "not a git command");
  }

  let cmdIdx = 1;

  while (cmdIdx < argv.length && argv[cmdIdx].startsWith("-")) {
    const opt = argv[cmdIdx].toLowerCase();

    if (opt === "-c" && cmdIdx + 1 < argv.length) {
      const configPair = argv[cmdIdx + 1].toLowerCase();
      for (const key of HOOK_BYPASS_CONFIG_KEYS) {
        if (configPair.startsWith(key)) {
          return makeOperation("git", argv.join(" "), argv, "commit", "hook_bypass", [], [],
            `hook bypass via -c ${argv[cmdIdx + 1]}`);
        }
      }
      cmdIdx += 2;
      continue;
    }
    cmdIdx++;
  }

  if (cmdIdx >= argv.length) {
    return makeOperation("git", argv.join(" "), argv, "", "unknown", [], [], "no subcommand");
  }

  const sub = argv[cmdIdx].toLowerCase();
  const restArgv = argv.slice(cmdIdx + 1);

  switch (sub) {
    case "status":
      return makeOperation("git", argv.join(" "), argv, "status", "read");

    case "diff":
      return makeOperation("git", argv.join(" "), argv, "diff", "read",
        extractPathsFromArgv(restArgv, 0));

    case "log":
      return makeOperation("git", argv.join(" "), argv, "log", "read",
        extractPathsFromArgv(restArgv, 0));

    case "show": {
      const paths: string[] = [];
      for (let i = 0; i < restArgv.length; i++) {
        if (restArgv[i] === "--") {
          paths.push(...restArgv.slice(i + 1).filter((a) => !a.startsWith("-")));
          break;
        }
      }
      return makeOperation("git", argv.join(" "), argv, "show", "read", paths);
    }

    case "branch": {
      if (hasFlag(restArgv, "-d") || hasFlag(restArgv, "-D") ||
          hasFlag(restArgv, "--delete") || hasFlag(restArgv, "-m") ||
          hasFlag(restArgv, "-M") || hasFlag(restArgv, "--move") ||
          hasFlag(restArgv, "--set-upstream-to") ||
          hasFlag(restArgv, "--unset-upstream")) {
        return makeOperation("git", argv.join(" "), argv, "branch", "destructive", [], [],
          "branch modification");
      }
      return makeOperation("git", argv.join(" "), argv, "branch", "read");
    }

    case "add": {
      const paths = restArgv.filter((a) => !a.startsWith("-"));
      return makeOperation("git", argv.join(" "), argv, "add", "local_write", paths, [],
        "requires repo_maintenance grant");
    }

    case "restore": {
      if (hasFlag(restArgv, "--staged")) {
        const paths = restArgv.filter((a) => !a.startsWith("-"));
        return makeOperation("git", argv.join(" "), argv, "restore", "local_write", paths, [],
          "requires repo_maintenance grant");
      }
      return makeOperation("git", argv.join(" "), argv, "restore", "destructive", [], [],
        "restore without --staged modifies working tree");
    }

    case "reset": {
      if (hasFlag(restArgv, "--hard")) {
        return makeOperation("git", argv.join(" "), argv, "reset", "destructive", [], [],
          "reset --hard is destructive");
      }
      if (hasFlag(restArgv, "--soft") || hasFlag(restArgv, "--mixed")) {
        return makeOperation("git", argv.join(" "), argv, "reset", "destructive", [], [],
          "reset with mode flag is destructive");
      }
      const paths = restArgv.filter((a) => !a.startsWith("-"));
      if (paths.length > 0) {
        return makeOperation("git", argv.join(" "), argv, "reset", "local_write", paths, [],
          "reset <paths> unstages files, requires grant");
      }
      return makeOperation("git", argv.join(" "), argv, "reset", "destructive", [], [],
        "reset without paths is destructive");
    }

    case "commit": {
      if (hasAnyFlag(restArgv, HOOK_BYPASS_FLAGS)) {
        return makeOperation("git", argv.join(" "), argv, "commit", "hook_bypass", [], [],
          "hook bypass via --no-verify");
      }
      return makeOperation("git", argv.join(" "), argv, "commit", "local_write", [], [],
        "requires repo_maintenance grant");
    }

    case "push": {
      const remotes: string[] = [];
      for (let i = 0; i < restArgv.length; i++) {
        if (!restArgv[i].startsWith("-")) {
          remotes.push(restArgv[i]);
          break;
        }
      }
      return makeOperation("git", argv.join(" "), argv, "push", "remote_write", [], remotes,
        "requires remote_repo_write grant + human confirmation");
    }

    case "tag":
      if (restArgv.length === 0 || hasFlag(restArgv, "-l") || hasFlag(restArgv, "--list") || hasFlag(restArgv, "-n")) {
        return makeOperation("git", argv.join(" "), argv, "tag", "read");
      }
      return makeOperation("git", argv.join(" "), argv, "tag", "destructive", [], [],
        "tag write is destructive");

    case "merge":
      return makeOperation("git", argv.join(" "), argv, "merge", "destructive", [], [],
        "merge is destructive");

    case "rebase":
      return makeOperation("git", argv.join(" "), argv, "rebase", "destructive", [], [],
        "rebase is destructive");

    case "stash": {
      if (restArgv.length === 0 || restArgv[0] === "list" || restArgv[0] === "show") {
        return makeOperation("git", argv.join(" "), argv, "stash", "read");
      }
      return makeOperation("git", argv.join(" "), argv, "stash", "destructive", [], [],
        `stash ${restArgv[0]} is destructive`);
    }

    case "checkout": {
      if (restArgv.length > 0 && restArgv[0] === "--") {
        const paths = restArgv.slice(1).filter((a) => !a.startsWith("-"));
        return makeOperation("git", argv.join(" "), argv, "checkout", "destructive", paths, [],
          "checkout -- discards working tree changes");
      }
      return makeOperation("git", argv.join(" "), argv, "checkout", "destructive", [], [],
        "checkout is destructive");
    }

    case "switch":
      return makeOperation("git", argv.join(" "), argv, "switch", "destructive", [], [],
        "switch changes branch");

    case "worktree": {
      if (restArgv[0] === "list" || restArgv[0] === "lock") {
        return makeOperation("git", argv.join(" "), argv, "worktree", "read");
      }
      return makeOperation("git", argv.join(" "), argv, "worktree", "destructive", [], [],
        `worktree ${restArgv[0] || "unknown"} is destructive`);
    }

    case "clean":
      return makeOperation("git", argv.join(" "), argv, "clean", "destructive", [], [],
        "clean is destructive");

    case "config": {
      if (restArgv.length >= 2) {
        const key = restArgv[0].toLowerCase();
        for (const hk of HOOK_BYPASS_CONFIG_KEYS) {
          if (key === hk) {
            return makeOperation("git", argv.join(" "), argv, "config", "hook_bypass", [], [],
              `config ${key} is hook bypass`);
          }
        }
      }
      return makeOperation("git", argv.join(" "), argv, "config", "unknown", [], [],
        "git config is not classified as safe");
    }

    case "remote": {
      if (restArgv.length === 0 || restArgv[0] === "-v" || restArgv[0] === "show" || restArgv[0] === "prune") {
        return makeOperation("git", argv.join(" "), argv, "remote", "read");
      }
      return makeOperation("git", argv.join(" "), argv, "remote", "unknown", [], [],
        "git remote write is not classified");
    }

    case "fetch":
      return makeOperation("git", argv.join(" "), argv, "fetch", "read");

    case "pull":
      return makeOperation("git", argv.join(" "), argv, "pull", "destructive", [], [],
        "pull involves merge/rebase, classified as destructive");

    case "clone":
    case "init":
      return makeOperation("git", argv.join(" "), argv, sub, "unknown", [], [],
        `${sub} is not supported as first-class repo tool`);

    case "rev-parse":
    case "describe":
    case "shortlog":
    case "blame":
    case "annotate":
      return makeOperation("git", argv.join(" "), argv, sub, "read");

    default:
      return makeOperation("git", argv.join(" "), argv, sub, "unknown", [], [],
        `unclassified git subcommand: ${sub}`);
  }
}

export function classifyGhArgv(argv: string[]): RepoOperation {
  if (argv.length === 0 || argv[0] !== "gh") {
    return makeOperation("gh", argv.join(" "), argv, "", "unknown", [], [], "not a gh command");
  }

  if (argv.length < 2) {
    return makeOperation("gh", argv.join(" "), argv, "", "unknown", [], [], "incomplete gh command");
  }

  const resource = argv[1].toLowerCase();
  const restArgv = argv.slice(2);
  const action = restArgv.length > 0 ? restArgv[0].toLowerCase() : "";

  switch (resource) {
    case "pr":
      switch (action) {
        case "view":
        case "list":
        case "checks":
        case "diff":
        case "status":
          return makeOperation("gh", argv.join(" "), argv, `pr ${action}`, "read");
        case "create":
        case "comment":
        case "merge":
        case "edit":
        case "close":
        case "review":
        case "reopen":
        case "ready":
          return makeOperation("gh", argv.join(" "), argv, `pr ${action}`, "remote_write", [], [],
            `gh pr ${action} requires remote_repo_write + human confirmation`);
        default:
          return makeOperation("gh", argv.join(" "), argv, `pr ${action || "unknown"}`, "unknown", [], [],
            `unclassified gh pr action: ${action}`);
      }

    case "issue":
      switch (action) {
        case "view":
        case "list":
        case "status":
          return makeOperation("gh", argv.join(" "), argv, `issue ${action}`, "read");
        case "create":
        case "comment":
        case "edit":
        case "close":
        case "reopen":
        case "delete":
        case "transfer":
        case "pin":
        case "unpin":
          return makeOperation("gh", argv.join(" "), argv, `issue ${action}`, "remote_write", [], [],
            `gh issue ${action} requires remote_repo_write + human confirmation`);
        default:
          return makeOperation("gh", argv.join(" "), argv, `issue ${action || "unknown"}`, "unknown", [], [],
            `unclassified gh issue action: ${action}`);
      }

    case "repo":
      switch (action) {
        case "view":
          return makeOperation("gh", argv.join(" "), argv, "repo view", "read");
        case "clone":
        case "fork":
          return makeOperation("gh", argv.join(" "), argv, `repo ${action}`, "read");
        case "create":
        case "edit":
        case "delete":
        case "archive":
        case "rename":
          return makeOperation("gh", argv.join(" "), argv, `repo ${action}`, "remote_write", [], [],
            `gh repo ${action} requires remote_repo_write + human confirmation`);
        default:
          return makeOperation("gh", argv.join(" "), argv, `repo ${action || "unknown"}`, "unknown", [], [],
            `unclassified gh repo action: ${action}`);
      }

    case "release":
      switch (action) {
        case "view":
        case "list":
        case "download":
          return makeOperation("gh", argv.join(" "), argv, `release ${action}`, "read");
        case "create":
        case "upload":
        case "delete":
        case "edit":
          return makeOperation("gh", argv.join(" "), argv, `release ${action}`, "remote_write", [], [],
            `gh release ${action} requires remote_repo_write + human confirmation`);
        default:
          return makeOperation("gh", argv.join(" "), argv, `release ${action || "unknown"}`, "unknown", [], [],
            `unclassified gh release action: ${action}`);
      }

    case "workflow":
      switch (action) {
        case "view":
        case "list":
          return makeOperation("gh", argv.join(" "), argv, `workflow ${action}`, "read");
        case "run":
        case "enable":
        case "disable":
          return makeOperation("gh", argv.join(" "), argv, `workflow ${action}`, "remote_write", [], [],
            `gh workflow ${action} requires remote_repo_write + human confirmation`);
        default:
          return makeOperation("gh", argv.join(" "), argv, `workflow ${action || "unknown"}`, "unknown", [], [],
            `unclassified gh workflow action: ${action}`);
      }

    case "run":
      switch (action) {
        case "view":
        case "list":
          return makeOperation("gh", argv.join(" "), argv, `run ${action}`, "read");
        case "rerun":
        case "cancel":
        case "delete":
          return makeOperation("gh", argv.join(" "), argv, `run ${action}`, "remote_write", [], [],
            `gh run ${action} requires remote_repo_write + human confirmation`);
        default:
          return makeOperation("gh", argv.join(" "), argv, `run ${action || "unknown"}`, "unknown", [], [],
            `unclassified gh run action: ${action}`);
      }

    case "secret":
      switch (action) {
        case "list":
          return makeOperation("gh", argv.join(" "), argv, "secret list", "read");
        case "set":
        case "delete":
          return makeOperation("gh", argv.join(" "), argv, `secret ${action}`, "remote_write", [], [],
            `gh secret ${action} requires remote_repo_write + human confirmation`);
        default:
          return makeOperation("gh", argv.join(" "), argv, `secret ${action || "unknown"}`, "unknown", [], [],
            `unclassified gh secret action: ${action}`);
      }

    case "api": {
      let method = "GET";
      for (let i = 0; i < restArgv.length; i++) {
        if (restArgv[i] === "-X" || restArgv[i] === "--method") {
          if (i + 1 < restArgv.length) {
            method = restArgv[i + 1].toUpperCase();
          }
          break;
        }
        if (restArgv[i].startsWith("-X") && restArgv[i].length > 2) {
          method = restArgv[i].substring(2).toUpperCase();
          break;
        }
      }
      if (method === "GET" || method === "HEAD") {
        return makeOperation("gh", argv.join(" "), argv, "api read", "read");
      }
      return makeOperation("gh", argv.join(" "), argv, `api ${method}`, "remote_write", [], [],
        `gh api -X ${method} requires remote_repo_write + human confirmation`);
    }

    default:
      return makeOperation("gh", argv.join(" "), argv, `${resource} ${action || ""}`.trim(), "unknown", [], [],
        `unclassified gh resource: ${resource}`);
  }
}

export function classifyGithubMcpTool(
  toolName: string,
  args?: Record<string, unknown>,
): RepoOperation {
  const name = toolName.toLowerCase();

  if (name.startsWith("github_search_") ||
      name.startsWith("github_get_") ||
      name.startsWith("github_list_")) {
    return makeOperation("github_mcp", toolName, [], name, "read");
  }

  const remoteWriteTools = new Set([
    "github_create_issue",
    "github_create_pull_request",
    "github_create_or_update_file",
    "github_fork_repository",
    "github_create_release",
    "github_create_release_asset",
    "github_add_issue_comment",
    "github_add_pull_request_review_comment",
    "github_merge_pull_request",
    "github_update_issue",
    "github_close_issue",
    "github_reopen_issue",
    "github_update_pull_request",
    "github_close_pull_request",
  ]);

  if (remoteWriteTools.has(name)) {
    return makeOperation("github_mcp", toolName, [], name, "remote_write", [], [],
      `GitHub MCP ${toolName} requires remote_repo_write + human confirmation`);
  }

  return makeOperation("github_mcp", toolName, [], name, "unknown", [], [],
    `unclassified GitHub MCP tool: ${toolName}`);
}

export function splitRepoShellCommand(command: string): string[] | null {
  if (!command || typeof command !== "string") return null;

  const trimmed = command.trim();
  if (!trimmed) return null;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === ";" || ch === "|" || ch === "&") return null;
    if (ch === ">" || ch === "<") return null;
    if (ch === "'" || ch === '"') {
      const closer = ch;
      i++;
      while (i < trimmed.length && trimmed[i] !== closer) {
        if (trimmed[i] === "\\") i++;
        i++;
      }
    }
  }

  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "\\" && !inSingle && i + 1 < trimmed.length) {
      current += ch + trimmed[i + 1];
      i++;
    } else if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  return parts.length > 0 ? parts : null;
}

export function classifyRepoShellCommand(command: string): RepoOperation {
  const argv = splitRepoShellCommand(command);
  if (argv === null) {
    return makeOperation("git", command, [], "", "unknown", [], [],
      "multi-command or shell operators detected");
  }

  if (argv.length === 0) {
    return makeOperation("git", command, argv, "", "unknown", [], [], "empty command");
  }

  const cmd = argv[0].toLowerCase();
  if (cmd === "git") {
    return classifyGitArgv(argv);
  }
  if (cmd === "gh") {
    return classifyGhArgv(argv);
  }

  return makeOperation("git", command, argv, "", "unknown", [], [],
    `not a git or gh command: ${cmd}`);
}

export function classifyRepoOperation(input: RepoClassificationInput): RepoOperation {
  if (input.provider === "github_mcp" || input.toolName?.startsWith("github_")) {
    return classifyGithubMcpTool(input.toolName || "", input.args);
  }

  if (input.argv && input.argv.length > 0) {
    const cmd = input.argv[0].toLowerCase();
    if (cmd === "git") return classifyGitArgv(input.argv);
    if (cmd === "gh") return classifyGhArgv(input.argv);
  }

  if (input.command) {
    return classifyRepoShellCommand(input.command);
  }

  return makeOperation(
    input.provider || "git",
    input.command || "",
    input.argv || [],
    "",
    "unknown",
    [],
    [],
    "insufficient input for classification",
  );
}

export function isRepoReadOperation(op: RepoOperation): boolean {
  return op.kind === "read";
}

export function isRepoWriteOperation(op: RepoOperation): boolean {
  return op.kind === "local_write" || op.kind === "remote_write";
}
