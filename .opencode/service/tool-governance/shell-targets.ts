import * as path from "node:path";
import { classifyGhArgv, classifyGitArgv } from "../repo/classify";

const PATH_FLAG_NAMES = new Set([
  "--file",
  "--files",
  "--config",
  "--output",
  "--out",
  "--input",
  "--cwd",
  "-C",
  "-o",
]);

const GENERIC_PATH_COMMANDS = new Set([
  "cat", "head", "tail", "ls", "wc", "find", "sha256sum", "md5sum", "file",
  "stat", "tree", "touch", "mkdir", "rm", "cp", "mv", "tee", "dd", "diff",
]);

const PSEUDO_PATHS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/stdin"]);

export type ScopePathResult =
  | { applies: false; paths: []; reason: "read_only_shell" }
  | { applies: true; paths: string[]; reason: "parsed" }
  | { applies: true; paths: []; reason: "unparseable_modify_shell" };

function splitShellStatements(command: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "|") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      if (ch === "|" && command[i + 1] === ch) i++;
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

function splitShellModifyCommands(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (
      ch === ";" ||
      ch === "|" ||
      ch === "&" ||
      ch === "<" ||
      ch === ">" ||
      ch === "\n"
    ) {
      if (current.trim()) result.push(current.trim());
      if (
        (ch === "&" || ch === "|" || ch === "<" || ch === ">") &&
        command[i + 1] === ch
      ) {
        i++;
      }
      current = "";
      continue;
    }
    current += ch;
  }

  if (current.trim()) result.push(current.trim());
  return result.length > 0 ? result : [command.trim()];
}

function tokenizeShellStatement(statement: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = () => {
    if (current) {
      tokens.push(current);
      current = "";
    }
  };

  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      pushCurrent();
      continue;
    }
    if (ch === ">" || ch === "<") {
      let prefix = "";
      if (/^\d+$/.test(current)) {
        prefix = current;
        current = "";
      } else {
        pushCurrent();
      }
      let op = prefix + ch;
      if (statement[i + 1] === ch) {
        op += ch;
        i++;
      }
      if (statement[i + 1] === "&") {
        op += "&";
        i++;
      }
      tokens.push(op);
      continue;
    }
    current += ch;
  }

  pushCurrent();
  return tokens;
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isPseudoPath(value: string): boolean {
  return PSEUDO_PATHS.has(value);
}

function isLikelyPathToken(token: string): boolean {
  const value = stripOuterQuotes(token);
  if (!value) return false;
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/")
  );
}

function resolvePathToken(token: string, cwd: string): string {
  const value = stripOuterQuotes(token);
  if (value.startsWith("~/")) {
    const home = process.env.HOME || "~";
    return path.join(home, value.slice(2));
  }
  if (value.startsWith("/")) return value;
  return path.resolve(cwd, value);
}

function maybePushPath(rawToken: string, cwd: string, out: string[]): void {
  if (!isLikelyPathToken(rawToken)) return;
  const resolved = resolvePathToken(rawToken, cwd);
  if (!isPseudoPath(resolved)) out.push(resolved);
}

function getCommandIndex(tokens: string[]): number {
  let idx = 0;
  while (idx < tokens.length && isEnvAssignment(tokens[idx])) idx++;
  return idx;
}

function handleRepoCommand(tokens: string[], commandIdx: number, cwd: string): string[] {
  const argv = tokens.slice(commandIdx).map(stripOuterQuotes);
  if (argv.length === 0) return [];

  const op =
    argv[0].toLowerCase() === "git"
      ? classifyGitArgv(argv)
      : classifyGhArgv(argv);

  return op.paths.map((p) => resolvePathToken(p, cwd));
}

function extractRedirectionPaths(tokens: string[], cwd: string): string[] {
  const paths: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (!/[<>]/.test(token)) continue;
    if (token.includes("&")) continue;
    const next = stripOuterQuotes(tokens[i + 1]);
    if (!next || next === "-" || /^\d+$/.test(next)) continue;
    maybePushPath(next, cwd, paths);
  }
  return paths;
}

function extractGenericCommandPaths(
  command: string,
  tokens: string[],
  commandIdx: number,
  cwd: string,
): string[] {
  const paths: string[] = [];
  const cmd = command.toLowerCase();

  if (cmd === "cd") return paths;

  if (cmd === "grep") {
    let seenPattern = false;
    for (let i = commandIdx + 1; i < tokens.length; i++) {
      const token = stripOuterQuotes(tokens[i]);
      if (!token) continue;
      if (!seenPattern) {
        if (token === "--") {
          seenPattern = true;
          continue;
        }
        if (token.startsWith("-")) continue;
        seenPattern = true;
        continue;
      }
      if (token.startsWith("-")) continue;
      maybePushPath(token, cwd, paths);
    }
    return paths;
  }

  if (cmd === "find") {
    for (let i = commandIdx + 1; i < tokens.length; i++) {
      const token = stripOuterQuotes(tokens[i]);
      if (!token) continue;
      if (token.startsWith("-")) continue;
      maybePushPath(token, cwd, paths);
      break;
    }
    return paths;
  }

  if (cmd === "node" || cmd === "bun" || cmd === "python3" || cmd === "python" || cmd === "npx" || cmd === "bash" || cmd === "sh") {
    for (let i = commandIdx + 1; i < tokens.length; i++) {
      const token = stripOuterQuotes(tokens[i]);
      if (!token) continue;
      if (token === "-e" || token === "-c" || token === "-lc") return paths;
      if (token.startsWith("-")) continue;
      maybePushPath(token, cwd, paths);
      break;
    }
    return paths;
  }

  if (!GENERIC_PATH_COMMANDS.has(cmd)) return paths;

  for (let i = commandIdx + 1; i < tokens.length; i++) {
    const token = stripOuterQuotes(tokens[i]);
    if (!token || token === "--") continue;
    if (token.startsWith("-")) continue;
    maybePushPath(token, cwd, paths);
  }
  return paths;
}

function extractFlagPaths(tokens: string[], commandIdx: number, cwd: string): string[] {
  const paths: string[] = [];
  for (let i = commandIdx + 1; i < tokens.length; i++) {
    const token = stripOuterQuotes(tokens[i]);
    if (!token) continue;
    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      const flag = token.slice(0, eqIdx);
      const value = token.slice(eqIdx + 1);
      if (PATH_FLAG_NAMES.has(flag)) maybePushPath(value, cwd, paths);
      continue;
    }
    if (!PATH_FLAG_NAMES.has(token)) continue;
    if (i + 1 >= tokens.length) continue;
    maybePushPath(tokens[i + 1], cwd, paths);
    i++;
  }
  return paths;
}

function extractPathsFromStatement(statement: string, cwd: string): { paths: string[]; nextCwd: string } {
  const tokens = tokenizeShellStatement(statement);
  if (tokens.length === 0) return { paths: [], nextCwd: cwd };

  const commandIdx = getCommandIndex(tokens);
  if (commandIdx >= tokens.length) return { paths: [], nextCwd: cwd };

  const command = stripOuterQuotes(tokens[commandIdx]).toLowerCase();
  let nextCwd = cwd;

  if (command === "cd") {
    const target = tokens[commandIdx + 1];
    if (target) {
      const targetValue = stripOuterQuotes(target);
      if (targetValue !== "-" && !targetValue.startsWith("-")) {
        nextCwd = resolvePathToken(targetValue, cwd);
      }
    }
    return { paths: [], nextCwd };
  }

  const paths: string[] = [];
  paths.push(...extractRedirectionPaths(tokens, cwd));
  paths.push(...extractFlagPaths(tokens, commandIdx, cwd));

  if (command === "git" || command === "gh") {
    paths.push(...handleRepoCommand(tokens, commandIdx, cwd));
    return { paths, nextCwd };
  }

  paths.push(...extractGenericCommandPaths(command, tokens, commandIdx, cwd));
  return { paths, nextCwd };
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function firstExecutableToken(statement: string): string {
  const tokens = tokenizeShellStatement(statement);
  const commandIdx = getCommandIndex(tokens);
  if (commandIdx >= tokens.length) return "";
  return stripOuterQuotes(tokens[commandIdx]).toLowerCase();
}

function extractScriptPath(statement: string, cwd: string): string {
  const tokens = tokenizeShellStatement(statement);
  const commandIdx = getCommandIndex(tokens);
  if (commandIdx >= tokens.length) return "";

  const cmd = stripOuterQuotes(tokens[commandIdx]).toLowerCase();
  if (!["node", "bun", "python3", "python", "npx", "bash", "sh"].includes(cmd)) {
    return "";
  }

  for (let i = commandIdx + 1; i < tokens.length; i++) {
    const token = stripOuterQuotes(tokens[i]);
    if (!token) continue;
    if (token === "-e" || token === "-c" || token === "-lc") return "";
    if (token.startsWith("-")) continue;
    if (!isLikelyPathToken(token)) return "";
    return resolvePathToken(token, cwd);
  }

  return "";
}

export function extractShellLocalPaths(command: string): string[] {
  const projectRoot = process.env.OPENCODE_ROOT || process.cwd();
  let cwd = projectRoot;
  const paths: string[] = [];

  for (const statement of splitShellStatements(command)) {
    const result = extractPathsFromStatement(statement, cwd);
    paths.push(...result.paths);
    cwd = result.nextCwd;
  }

  return dedupePaths(paths);
}

export function parseShellWriteTargets(command: string): ScopePathResult {
  if (!command || typeof command !== "string") {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  const subCmds = splitShellModifyCommands(command);
  const allPaths: string[] = [];
  let anyUnparseable = false;
  for (const subCmd of subCmds) {
    const subResult = parseSingleCommand(subCmd);
    if (subResult.reason === "unparseable_modify_shell") anyUnparseable = true;
    if (subResult.applies) {
      for (const p of subResult.paths) allPaths.push(p);
    }
  }
  if (anyUnparseable) {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }
  if (allPaths.length === 0) {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }
  return { applies: true, paths: allPaths, reason: "parsed" };
}

function parseSingleCommand(command: string): ScopePathResult {
  const trimmed = command.trim();
  const cmdMatch = trimmed.match(/^(\S+)/);
  if (!cmdMatch) {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }
  const cmd = cmdMatch[1];

  if (
    !/^(cp|mv|rm|python3|node|bun|npx|tee|cat|sed|dd|sh|bash|touch|mkdir)$/.test(
      cmd,
    )
  ) {
    if (cmd === "echo") {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  const paths: string[] = [];

  if (cmd === "sed") {
    const sedParts = trimmed.split(/\s+/).filter(Boolean);
    const sedFiles: string[] = [];
    for (let si = 1; si < sedParts.length; si++) {
      const sp = sedParts[si];
      if (sp === "sed") continue;
      if (sp.startsWith("-i")) continue;
      if (sp.startsWith("'") || sp.startsWith('"')) continue;
      if (/^[a-zA-Z0-9_./-]+\.[a-zA-Z]+$/.test(sp)) sedFiles.push(sp);
    }
    if (sedFiles.length === 0) {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
    return { applies: true, paths: sedFiles, reason: "parsed" };
  }

  if (cmd === "cp") {
    const cpParts = trimmed.split(/\s+/).filter(Boolean);
    if (cpParts.length >= 3) {
      const dst = cpParts[cpParts.length - 1];
      if (!dst.startsWith("-") && dst !== "cp") paths.push(dst);
    }
    return { applies: true, paths, reason: "parsed" };
  }

  if (cmd === "mv") {
    const mvParts = trimmed.split(/\s+/).filter(Boolean);
    if (mvParts.length >= 3) {
      const mvSrc = mvParts[1];
      const mvDst = mvParts[mvParts.length - 1];
      if (!mvSrc.startsWith("-")) paths.push(mvSrc);
      if (!mvDst.startsWith("-") && mvDst !== mvSrc) paths.push(mvDst);
    }
    return { applies: true, paths, reason: "parsed" };
  }

  if (cmd === "rm") {
    const rmParts = trimmed.split(/\s+/).filter(Boolean);
    if (rmParts.length >= 2) {
      for (let ri = 1; ri < rmParts.length; ri++) {
        if (!rmParts[ri].startsWith("-") && rmParts[ri] !== "rm") {
          paths.push(rmParts[ri]);
        }
      }
    }
    return { applies: true, paths, reason: "parsed" };
  }

  if (cmd === "tee") {
    const teeParts = trimmed.split(/\s+/).filter(Boolean);
    for (let ti = 1; ti < teeParts.length; ti++) {
      const tp = teeParts[ti];
      if (tp !== "tee" && !tp.startsWith("-") && !/^[<>|&]|^\d+>/.test(tp)) {
        paths.push(tp);
      }
    }
    return { applies: true, paths, reason: "parsed" };
  }

  if (cmd === "touch" || cmd === "mkdir") {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      if (!parts[i].startsWith("-") && parts[i] !== cmd) {
        paths.push(parts[i]);
      }
    }
    return { applies: true, paths, reason: "parsed" };
  }

  if (cmd === "dd") {
    const ddMatch = trimmed.match(/of=(\S+)/);
    if (ddMatch) {
      paths.push(ddMatch[1]);
      return { applies: true, paths, reason: "parsed" };
    }
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  if (cmd === "cat") {
    if (trimmed.includes(">")) {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  const stdinOrHeredocRe =
    /(<<\s*['"]?\w+['"]?|<<\s*\\?\w+|\s<\s+\S+|\s-\s*$|\s-\s)/;
  if (stdinOrHeredocRe.test(trimmed)) {
    if (
      cmd === "node" ||
      cmd === "bun" ||
      cmd === "python3" ||
      cmd === "sh" ||
      cmd === "bash"
    ) {
      return { applies: true, paths: [], reason: "unparseable_modify_shell" };
    }
  }

  if (
    ((cmd === "node" || cmd === "bun") && trimmed.includes(" -e ")) ||
    (cmd === "python3" && trimmed.includes(" -c "))
  ) {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  if (cmd === "node" || cmd === "bun" || cmd === "npx" || cmd === "python3") {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  if ((cmd === "sh" || cmd === "bash") && trimmed.includes("-c")) {
    return { applies: true, paths: [], reason: "unparseable_modify_shell" };
  }

  if (cmd === "sh" || cmd === "bash") {
    return { applies: false, paths: [], reason: "read_only_shell" };
  }

  return { applies: false, paths: [], reason: "read_only_shell" };
}

export function extractShellEvidenceTarget(command: string): string {
  if (!command) return "";

  const statements = splitShellStatements(command);
  let cwd = process.env.OPENCODE_ROOT || process.cwd();

  for (const statement of statements) {
    const executable = firstExecutableToken(statement);
    if (!executable) continue;

    if (executable === "cd") {
      const result = extractPathsFromStatement(statement, cwd);
      cwd = result.nextCwd;
      continue;
    }

    if (executable === "git" || executable === "gh") {
      return "";
    }

    const scriptPath = extractScriptPath(statement, cwd);
    if (scriptPath) return scriptPath;
  }

  const scope = parseShellWriteTargets(command);
  if (scope.applies && scope.paths.length > 0) {
    return scope.paths[0];
  }

  return "";
}
