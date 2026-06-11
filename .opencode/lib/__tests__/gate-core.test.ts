/**
 * gate-core.test.ts — TDD RED phase tests
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const {
  getProjectRoot,
  resolveStateDir,
  readJsonFile,
  fileExists,
  computeSHA256,
  writeJsonFile,
  getEnforcementMode,
  getGateStatePath,
  getMachinePath,
  createFreshStore,
  loadGateStore,
  saveGateStore,
  generateSessionId,
  createSession,
  armSession,
  completeSession,
  drainStaleSessions,
  validateTaskArtifacts,
  computeDigest,
  extractSemver,
} = require('../gate-core');

describe('gate-core', () => {
  describe('getProjectRoot', () => {
    it('should return a non-empty string', () => {
      const root = getProjectRoot();
      expect(root).toBeTruthy();
      expect(typeof root).toBe('string');
    });
  });

  describe('resolveStateDir', () => {
    it('should return a path ending with .opencode/state', () => {
      const dir = resolveStateDir();
      expect(dir).toContain('.opencode');
      expect(dir).toContain('state');
    });
  });

  describe('readJsonFile', () => {
    it('should return null for non-existent files', () => {
      const result = readJsonFile('/nonexistent/path.json');
      expect(result).toBeNull();
    });

    it('should parse valid JSON files', () => {
      const tmpFile = path.join(os.tmpdir(), 'test-' + Date.now() + '.json');
      fs.writeFileSync(tmpFile, JSON.stringify({ hello: 'world' }));
      const result = readJsonFile(tmpFile);
      expect(result).not.toBeNull();
      expect(result.hello).toBe('world');
      fs.rmSync(tmpFile);
    });
  });

  describe('fileExists', () => {
    it('should return false for non-existent files', () => {
      expect(fileExists('/nonexistent')).toBe(false);
    });
  });

  describe('computeSHA256', () => {
    it('should return a 64-char hex string for existing files', () => {
      const tmpFile = path.join(os.tmpdir(), 'hash-test-' + Date.now() + '.txt');
      fs.writeFileSync(tmpFile, 'hello');
      const hash = computeSHA256(tmpFile);
      expect(hash).not.toBeNull();
      expect(hash!.length).toBe(64);
      fs.rmSync(tmpFile);
    });
  });

  describe('writeJsonFile', () => {
    it('should write valid JSON to disk', () => {
      const tmpFile = path.join(os.tmpdir(), 'write-test-' + Date.now() + '.json');
      writeJsonFile(tmpFile, { key: 'value' });
      expect(fs.existsSync(tmpFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      expect(content.key).toBe('value');
      fs.rmSync(tmpFile);
    });
  });

  describe('getEnforcementMode', () => {
    it('should return a valid enforcement mode string', () => {
      const mode = getEnforcementMode();
      expect(['advisory', 'strict', 'locked']).toContain(mode);
    });
  });

  describe('createFreshStore', () => {
    it('should return a store with formatVersion 2.0', () => {
      const store = createFreshStore();
      expect(store.formatVersion).toBe('2.0');
      expect(store.sessions).toEqual({});
      expect(store.active_sessions).toEqual([]);
    });
  });

  describe('generateSessionId', () => {
    it('should generate a non-empty session ID', () => {
      const id = generateSessionId();
      expect(id).toBeTruthy();
      expect(id).toContain('cg_ses_');
    });
  });

  describe('createSession', () => {
    it('should create a session and return it', () => {
      const { session } = createSession(
        'Test task',
        [],
        {},
        'advisory',
      );
      expect(session.session_id).toBeTruthy();
      expect(session.gate_status).toBe('checked');
      expect(session.task_description).toBe('Test task');
    });
  });

  describe('armSession', () => {
    it('should reject non-existent sessions', () => {
      const result = armSession('nonexistent', 'Plan summary here');
      expect(result.status).toBe('rejected');
      expect(result.reason).toContain('session not found');
    });
  });

  describe('completeSession', () => {
    it('should reject non-existent sessions', () => {
      const result = completeSession('nonexistent', 'Done');
      expect(result.status).toBe('rejected');
      expect(result.reason).toContain('session not found');
    });
  });

  describe('computeDigest', () => {
    it('should return error for non-existent files', () => {
      const result = computeDigest('/nonexistent');
      expect(result.digest).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  describe('extractSemver', () => {
    it('should return null for non-existent files', () => {
      expect(extractSemver('/nonexistent')).toBeNull();
    });
  });

  describe('validateTaskArtifacts', () => {
    /** SA-FIX-VALIDATE-PATH: Test root uses project-based .task_temp for realistic path resolution */
    const testRoot = getProjectRoot();
    const testTaskId = 'SA-FIX-VALIDATE-TEST-' + Date.now();
    const testDir = path.join(testRoot, '.task_temp', testTaskId);
    const subDir = path.join(testDir, '_dispatch');

    beforeAll(() => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.mkdirSync(subDir, { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should return empty for null taskId', () => {
      const missing = validateTaskArtifacts(null);
      expect(missing).toEqual([]);
    });

    it('should return empty when artifacts exist in primary path', () => {
      fs.writeFileSync(path.join(testDir, 'HANDOVER.md'), '# handover');
      fs.writeFileSync(path.join(testDir, 'TASK_LOG.md'), '# task log');
      const missing = validateTaskArtifacts(testTaskId, testRoot);
      expect(missing).toEqual([]);
    });

    it('should find artifacts via fallback subdirectory scan', () => {
      // Clean primary but place artifacts in _dispatch subdirectory
      try { fs.rmSync(path.join(testDir, 'HANDOVER.md'), { force: true }); } catch {}
      try { fs.rmSync(path.join(testDir, 'TASK_LOG.md'), { force: true }); } catch {}
      fs.writeFileSync(path.join(subDir, 'HANDOVER.md'), '# dispatach handover');
      fs.writeFileSync(path.join(subDir, 'TASK_LOG.md'), '# dispatch task log');
      const missing = validateTaskArtifacts(testTaskId, testRoot);
      expect(missing).toEqual([]);
    });

    it('should report missing when artifacts not in primary or any subdirectory', () => {
      // Clean everything
      try { fs.rmSync(path.join(subDir, 'HANDOVER.md'), { force: true }); } catch {}
      try { fs.rmSync(path.join(subDir, 'TASK_LOG.md'), { force: true }); } catch {}
      try { fs.rmSync(path.join(testDir, 'HANDOVER.md'), { force: true }); } catch {}
      try { fs.rmSync(path.join(testDir, 'TASK_LOG.md'), { force: true }); } catch {}
      const missing = validateTaskArtifacts(testTaskId, testRoot);
      expect(missing).toContain('HANDOVER.md');
      expect(missing).toContain('TASK_LOG.md');
    });

    it('should use sessionId fallback when taskId is null', () => {
      // Use the same directory (named after sessionId)
      try { fs.rmSync(subDir, { recursive: true, force: true }); } catch {}
      fs.writeFileSync(path.join(testDir, 'HANDOVER.md'), '# session handover');
      const missing = validateTaskArtifacts(null, testRoot, testTaskId);
      expect(missing).not.toContain('HANDOVER.md');
    });
  });
});
