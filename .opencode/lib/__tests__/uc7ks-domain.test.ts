/**
 * uc7ks-domain.test.ts — FW-UC7KS-DOMAIN-001 tests
 * Tests for session_map domain_id integration and per-domain UC7KS write checks.
 */

import { dbWriteSessionMap, dbReadSessionMap, dbQuerySessionByDomain } from '../db-state-manager';
import { checkUC7KSWrite } from '../uc7ks-utils';
import { atomicWriteSubState } from '../state-utils';
import { getDb } from '../db-manager';

describe('FW-UC7KS-DOMAIN-001', () => {
  const testSessionId = 'test-uc7ks-domain-' + Date.now();
  const testAgent = 'Coder-BE';
  const testDomain = 'backend_api';

  afterEach(() => {
    try {
      const db = getDb();
      db.run(`DELETE FROM session_map WHERE session_id LIKE 'test-uc7ks-domain-%'`);
      db.run(`DELETE FROM session_map WHERE domain_id = 'frontend_ui' AND session_id LIKE 'test-%'`);
    } catch {}
  });

  describe('session_map domain_id CRUD', () => {
    it('should write and read domain_id via dbWriteSessionMap', () => {
      const result = dbWriteSessionMap(testSessionId, testAgent, undefined, testDomain);
      expect(result).toBe(true);

      const entry = dbReadSessionMap(testSessionId);
      expect(entry).not.toBeNull();
      expect(entry!.domain_id).toBe(testDomain);
      expect(entry!.agent).toBe(testAgent);
    });

    it('should preserve domain_id on upsert without explicit domainId', () => {
      // Write with domainId
      dbWriteSessionMap(testSessionId, testAgent, 'TASK-001', testDomain);

      // Upsert without domainId (chatMessageHook path)
      dbWriteSessionMap(testSessionId, testAgent);

      const entry = dbReadSessionMap(testSessionId);
      expect(entry!.domain_id).toBe(testDomain);
      expect(entry!.dag_task_id).toBe('TASK-001');
    });

    it('should preserve dag_task_id when only domainId is provided', () => {
      // Write with both
      dbWriteSessionMap(testSessionId, testAgent, 'TASK-001', testDomain);

      // Upsert with only domainId
      dbWriteSessionMap(testSessionId, testAgent, undefined, 'frontend_ui');

      const entry = dbReadSessionMap(testSessionId);
      expect(entry!.dag_task_id).toBe('TASK-001');
      expect(entry!.domain_id).toBe('frontend_ui');
    });

    it('should query sessions by domain_id via dbQuerySessionByDomain', () => {
      dbWriteSessionMap(testSessionId + '-1', testAgent, 'TASK-001', testDomain);
      dbWriteSessionMap(testSessionId + '-2', 'Coder-FE', 'TASK-002', 'frontend_ui');
      dbWriteSessionMap(testSessionId + '-3', testAgent, 'TASK-003', testDomain);

      const beSessions = dbQuerySessionByDomain(testDomain);
      expect(beSessions).toContain(testSessionId + '-1');
      expect(beSessions).toContain(testSessionId + '-3');
      expect(beSessions).not.toContain(testSessionId + '-2');

      const feSessions = dbQuerySessionByDomain('frontend_ui');
      expect(feSessions).toContain(testSessionId + '-2');
      expect(feSessions).not.toContain(testSessionId + '-1');
    });

    it('should return empty array for unregistered domain_id', () => {
      const sessions = dbQuerySessionByDomain('nonexistent_domain');
      expect(sessions).toEqual([]);
    });
  });

  describe('checkUC7KSWrite per-domain integration', () => {

    afterEach(() => {
      // Clean up knowledge cache state
      try {
        atomicWriteSubState('knowledge_cache_state', (state) => {
          if (state.session_access) {
            delete state.session_access[testAgent.replace(/^@/, '')];
          }
        });
      } catch {}
    });

    it('should pass when per-domain discovery+attestation is set', () => {
      // Setup: write per-domain data with both discovery and attestation
      atomicWriteSubState('knowledge_cache_state', (state) => {
        state.session_access = state.session_access || {};
        const ak = testAgent.replace(/^@/, '');
        state.session_access[ak] = {
          uc7_001_compliant: false,
          tasks: {
            'TASK-001': {
              domains: {
                'backend_api': {
                  pipeline_status: 'completed',
                  cache_sufficiency: {
                    discovery: {
                      status: 'sufficient',
                      missing_topics: [],
                      discovered_files: ['opencode/framework/plugins.md'],
                    },
                    attestation: {
                      status: 'attested',
                      files_read: ['opencode/framework/plugins.md'],
                      declared_at: new Date().toISOString(),
                    },
                  },
                },
              },
            },
          },
        };
      });

      const result = checkUC7KSWrite(
        testAgent, 'strict', 'sess-1', 'TASK-001', 'backend_api'
      );
      expect(result).toBeNull(); // Should pass per-domain
    });

    it('should block when per-domain cache_sufficiency is insufficient', () => {
      atomicWriteSubState('knowledge_cache_state', (state) => {
        state.session_access = state.session_access || {};
        const ak = testAgent.replace(/^@/, '');
        state.session_access[ak] = {
          uc7_001_compliant: true, // Global flag IS set
          tasks: {
            'TASK-001': {
              domains: {
                'backend_api': {
                  pipeline_status: 'completed',
                  cache_sufficiency: {
                    status: 'insufficient',
                    missing_topics: ['authentication'],
                    declared_at: new Date().toISOString(),
                    reason: 'missing auth docs',
                    files_read: [],
                    content_summary: '',
                  },
                },
              },
            },
          },
        };
      });

      const result = checkUC7KSWrite(
        testAgent, 'strict', 'sess-1', 'TASK-001', 'backend_api'
      );
      expect(result).not.toBeNull(); // Should block
      expect(result).toContain('UC7-001');
      expect(result).toContain('缓存不足');
      expect(result).toContain('authentication');
    });

    it('should fallback to global check when no taskId/domainId provided', () => {
      atomicWriteSubState('knowledge_cache_state', (state) => {
        state.session_access = state.session_access || {};
        const ak = testAgent.replace(/^@/, '');
        state.session_access[ak] = {
          uc7_001_compliant: true,
        };
      });

      // No taskId/domainId — should use global flag
      const result = checkUC7KSWrite(testAgent, 'strict');
      // Global flag true with no taskId/domainId — falls through path C
      expect(result).toBeUndefined();
    });

    it('should block via Path B when taskId+domainId present but per-task data missing', () => {
      atomicWriteSubState('knowledge_cache_state', (state) => {
        state.session_access = state.session_access || {};
        const ak = testAgent.replace(/^@/, '');
        state.session_access[ak] = {
          uc7_001_compliant: false,
        };
      });

      // taskId/domainId provided but no matching nested entry → Path B block
      const result = checkUC7KSWrite(
        testAgent, 'strict', 'sess-1', 'TASK-001', 'backend_api'
      );
      expect(result).not.toBeNull();
      expect(result).toContain('UC7-001');
      expect(result).toContain('not searched');
    });

    it('should block via Path B even when global uc7_001_compliant is true (Appendix A gap fix)', () => {
      // This is the critical test: agent has global flag set from a previous
      // session but never searched cache for THIS task/domain. Path B should
      // block regardless of the global flag.
      atomicWriteSubState('knowledge_cache_state', (state) => {
        state.session_access = state.session_access || {};
        const ak = testAgent.replace(/^@/, '');
        state.session_access[ak] = {
          uc7_001_compliant: true, // Global flag is TRUE from previous session
          // But NO tasks[TASK-001].domains[backend_api] entry
        };
      });

      const result = checkUC7KSWrite(
        testAgent, 'strict', 'sess-1', 'TASK-001', 'backend_api'
      );
      expect(result).not.toBeNull(); // Should block via Path B
      expect(result).toContain('UC7-001');
      expect(result).toContain('无任何域已证明已读');
      // TASK-001 truncated in buildBlockMessage (54 char limit)
    });

    it('should pass in advisory mode regardless of domain state', () => {
      const result = checkUC7KSWrite(
        testAgent, 'advisory', 'sess-1', 'TASK-001', 'backend_api'
      );
      expect(result).toBeNull();
    });

    it('should bypass for Knowledge-Curator regardless of domain', () => {
      const result = checkUC7KSWrite(
        'Knowledge-Curator', 'strict', 'sess-1', 'TASK-001', 'backend_api'
      );
      expect(result).toBeNull();
    });
  });
});
