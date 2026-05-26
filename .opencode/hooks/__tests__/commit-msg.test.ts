import { execSync, ExecSyncOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HOOK_PATH = path.resolve(__dirname, '..', 'commit-msg');

function createTestRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-test-'));
  execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email test@test.com', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name Test', { cwd: tmpDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');
  execSync('git add . && git commit -m "Initial commit"', { cwd: tmpDir, stdio: 'pipe' });
  return tmpDir;
}

function runHook(
  tmpDir: string,
  commitMsg: string,
  extraEnv: Record<string, string> = {},
): { exitCode: number; output: string } {
  const msgFile = path.join(tmpDir, 'COMMIT_EDITMSG');
  fs.writeFileSync(msgFile, commitMsg);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
  };
  delete env.npm_config_local_prefix;
  delete env.npm_package_json;

  const opts: ExecSyncOptions = {
    cwd: tmpDir,
    encoding: 'utf-8',
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  try {
    const stdout = execSync(`bash "${HOOK_PATH}" "${msgFile}"`, opts);
    return { exitCode: 0, output: stdout.toString() };
  } catch (error: any) {
    return {
      exitCode: error.status ?? 1,
      output: (error.stdout?.toString() ?? '') + (error.stderr?.toString() ?? ''),
    };
  }
}

function createPriorCommit(tmpDir: string, msg: string): void {
  fs.writeFileSync(path.join(tmpDir, 'test.txt'), `content-${Date.now()}`);
  execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
  // Use --no-verify to skip hooks
  execSync(`git commit --no-verify -m "${msg}"`, { cwd: tmpDir, stdio: 'pipe' });
}

describe('commit-msg hook — TDD marker enforcement', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTestRepo();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: Valid commit with [Green] passes (with prior [Red] commit) ──
  it('should pass for a valid [Green] commit with preceding [Red]', () => {
    // Create a prior [Red] commit for the same task
    createPriorCommit(tmpDir, '[Red] CI-UNIFY-002 Write failing tests');

    const result = runHook(tmpDir, '[Green] CI-UNIFY-002 Implement the feature', {
      ENFORCEMENT_MODE: 'strict',
    });
    expect(result.exitCode).toBe(0);
  });

  // ── Test 2: Valid commit with [Red] tag passes (no prior needed) ──
  it('should pass for a valid [Red] commit without any prior', () => {
    const result = runHook(tmpDir, '[Red] CI-UNIFY-002 Write failing tests', {
      ENFORCEMENT_MODE: 'strict',
    });
    expect(result.exitCode).toBe(0);
  });

  // ── Test 3: Commit missing TDD tag fails in strict mode ──
  it('should fail for commit without any TDD tag in strict mode', () => {
    const result = runHook(tmpDir, 'feat(scope): implement a feature without TDD marker', {
      ENFORCEMENT_MODE: 'strict',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output.toLowerCase()).toContain('tdd');
  });

  // ── Test 4: Merge commit is skipped ──
  it('should skip validation for merge commits', () => {
    const result = runHook(tmpDir, 'Merge branch "feature" into main', {
      ENFORCEMENT_MODE: 'strict',
    });
    expect(result.exitCode).toBe(0);
  });

  // ── Test 5: Advisory mode warns but does not block ──
  it('should warn but not block in advisory mode when TDD tag is missing', () => {
    const result = runHook(tmpDir, 'feat(scope): normal commit in advisory mode', {
      ENFORCEMENT_MODE: 'advisory',
    });
    expect(result.exitCode).toBe(0);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toMatch(/warn|advisory|tdd/i);
  });
});
