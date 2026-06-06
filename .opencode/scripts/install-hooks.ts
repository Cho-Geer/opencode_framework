#!/usr/bin/env node
// install-hooks.ts — P6-002
// Ensures git config core.hooksPath = .opencode/hooks.
// Validates hook scripts exist and are executable.
// Works on: Windows, Git Bash, WSL, Linux, macOS.
// --dry-run flag reports without changing.

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const HOOKS_DIR = path.join(PROJECT_ROOT, '.opencode', 'hooks');

// Required hooks for framework governance
const REQUIRED_HOOKS = ['pre-commit', 'commit-msg'];
// Optional hooks (check existence, warn if missing)
const OPTIONAL_HOOKS = ['pre-push', 'post-commit', 'post-merge'];
// FW-REPAIR-14: Framework scripts that MUST be executable (shebang scripts invoked directly)
// These are NOT in .opencode/hooks/ but are critical for framework operation.
// Previously pre-execution-gate.ts was tracked as 100644 in Git, causing recurring
// framework-self-test failures. Now tracked as 100755 + repaired here as safety net.
const REQUIRED_EXECUTABLE_SCRIPTS = [
  '.opencode/scripts/pre-execution-gate.ts',
  '.opencode/scripts/pre-execution-hook.sh',
  '.opencode/scripts/enforcement-mode-check.sh',
  '.opencode/scripts/framework-health-check.sh',
  '.opencode/scripts/state-machine-reset.sh',
];

function isWindows() {
  return os.platform() === 'win32';
}

function runGit(args) {
  try {
    const result = spawnSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 10000
    });
    return { success: result.status === 0, stdout: result.stdout?.trim() || '', stderr: result.stderr?.trim() || '' };
  } catch (e) {
    return { success: false, stdout: '', stderr: e.message };
  }
}

function isExecutable(filepath) {
  try {
    if (isWindows()) {
      // On Windows, just check file exists and has .sh or no extension
      fs.accessSync(filepath, fs.constants.F_OK);
      return true;
    }
    // On Unix: check executable bit
    fs.accessSync(filepath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function makeExecutable(filepath) {
  if (isWindows()) return true; // Windows doesn't use executable bit
  try {
    fs.chmodSync(filepath, 0o755);
    return true;
  } catch (e) {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verifyOnly = args.includes('--verify');

  const results = [];
  let needsRepair = false;

  // ── Step 1: Set hooksPath ──
  const currentPath = runGit(['config', '--local', 'core.hooksPath']);
  const targetPath = '.opencode/hooks';

  if (!currentPath.success || currentPath.stdout !== targetPath) {
    if (!dryRun && !verifyOnly) {
      const setResult = runGit(['config', 'core.hooksPath', targetPath]);
      if (setResult.success) {
        results.push({ check: 'hooksPath_set', status: 'fixed', detail: `Set core.hooksPath = ${targetPath}` });
      } else {
        results.push({ check: 'hooksPath_set', status: 'error', detail: `Failed to set hooksPath: ${setResult.stderr}` });
        needsRepair = true;
      }
    } else if (dryRun) {
      results.push({ check: 'hooksPath_set', status: 'would_fix', detail: `Would set core.hooksPath = ${targetPath} (current: ${currentPath.stdout || 'not set'})` });
    }
  } else {
    results.push({ check: 'hooksPath_set', status: 'pass', detail: `core.hooksPath = ${targetPath}` });
  }

  // ── Step 2: Verify hooks directory exists ──
  if (!fs.existsSync(HOOKS_DIR)) {
    results.push({ check: 'hooks_dir', status: 'error', detail: `.opencode/hooks/ directory not found` });
    needsRepair = true;
    // Can't proceed without hooks directory
    output(results, needsRepair);
    return;
  }
  results.push({ check: 'hooks_dir', status: 'pass', detail: '.opencode/hooks/ exists' });

  // ── Step 3: Check required hooks ──
  for (const hook of REQUIRED_HOOKS) {
    const hookPath = path.join(HOOKS_DIR, hook);
    if (!fs.existsSync(hookPath)) {
      results.push({ check: `hook_${hook}`, status: 'missing', detail: `Required hook '${hook}' not found` });
      needsRepair = true;
      continue;
    }

    if (!isExecutable(hookPath)) {
      if (!dryRun && !verifyOnly) {
        if (makeExecutable(hookPath)) {
          results.push({ check: `hook_${hook}`, status: 'fixed', detail: `Made '${hook}' executable (chmod +x)` });
        } else {
          results.push({ check: `hook_${hook}`, status: 'error', detail: `'${hook}' exists but cannot make executable` });
          needsRepair = true;
        }
      } else if (dryRun) {
        results.push({ check: `hook_${hook}`, status: 'would_fix', detail: `Would make '${hook}' executable` });
      }
    } else {
      results.push({ check: `hook_${hook}`, status: 'pass', detail: `'${hook}' exists and is executable` });
    }
  }

  // ── Step 4: Check optional hooks ──
  for (const hook of OPTIONAL_HOOKS) {
    const hookPath = path.join(HOOKS_DIR, hook);
    if (fs.existsSync(hookPath)) {
      if (isExecutable(hookPath)) {
        results.push({ check: `hook_${hook}`, status: 'pass', detail: `Optional hook '${hook}' exists and is executable` });
      } else {
        results.push({ check: `hook_${hook}`, status: 'warn', detail: `Optional hook '${hook}' exists but not executable` });
      }
    } else {
      results.push({ check: `hook_${hook}`, status: 'info', detail: `Optional hook '${hook}' not present (not required)` });
    }
  }

  // ── Step 5: Check framework scripts that require executable permissions ──
  // FW-REPAIR-14: These scripts have #! shebangs and are invoked directly (not via `node`).
  // Without the execute bit, they fail silently or require explicit `node` invocation,
  // which breaks pre-commit hooks and framework-self-test validation.
  for (const scriptRel of REQUIRED_EXECUTABLE_SCRIPTS) {
    const scriptPath = path.join(PROJECT_ROOT, scriptRel);
    const scriptName = path.basename(scriptRel);
    if (!fs.existsSync(scriptPath)) {
      results.push({ check: `script_${scriptName}`, status: 'missing', detail: `Required script '${scriptRel}' not found` });
      needsRepair = true;
      continue;
    }
    if (!isExecutable(scriptPath)) {
      if (!dryRun && !verifyOnly) {
        if (makeExecutable(scriptPath)) {
          results.push({ check: `script_${scriptName}`, status: 'fixed', detail: `Made '${scriptRel}' executable (chmod +x)` });
        } else {
          results.push({ check: `script_${scriptName}`, status: 'error', detail: `'${scriptRel}' exists but cannot make executable` });
          needsRepair = true;
        }
      } else if (dryRun) {
        results.push({ check: `script_${scriptName}`, status: 'would_fix', detail: `Would make '${scriptRel}' executable` });
      }
    } else {
      results.push({ check: `script_${scriptName}`, status: 'pass', detail: `'${scriptRel}' exists and is executable` });
    }
  }

  // ── Step 6: Verify final hooksPath ──
  const finalPath = runGit(['config', '--local', 'core.hooksPath']);
  if (finalPath.success && finalPath.stdout === targetPath) {
    results.push({ check: 'hooksPath_verify', status: 'pass', detail: 'Verified hooksPath is correctly set' });
  } else if (!dryRun && !verifyOnly) {
    results.push({ check: 'hooksPath_verify', status: 'warn', detail: `hooksPath is '${finalPath.stdout || 'not set'}' (expected '${targetPath}')` });
  }

  output(results, needsRepair);
}

function output(results, needsRepair) {
  const errors = results.filter(r => r.status === 'error' || r.status === 'missing');
  const warnings = results.filter(r => r.status === 'warn' || r.status === 'would_fix');

  console.log(JSON.stringify({
    all_good: !needsRepair && errors.length === 0,
    needs_repair: needsRepair || errors.length > 0,
    results,
    summary: `${results.filter(r => r.status === 'pass').length} passed, ${errors.length} errors, ${warnings.length} warnings`
  }, null, 2));

  process.exit(needsRepair || errors.length > 0 ? 1 : 0);
}

main();
