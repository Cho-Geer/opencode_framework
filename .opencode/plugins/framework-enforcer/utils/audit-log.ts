/**
 * utils/audit-log.ts — Audit Log Writers
 * Extracted from framework-enforcer.ts (Phase 4 modularization).
 * STATUS: ✅ EXTRACTED
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getOpenCodeRoot, ensureDir, STATE_PATHS } from './state-utils';

export function writeAuditLogEntry(entry: Record<string, unknown>): void {
  const auditDir = path.dirname(STATE_PATHS.auditLog());
  ensureDir(auditDir);
  try {
    fs.appendFileSync(STATE_PATHS.auditLog(), JSON.stringify(entry) + '
', 'utf8');
  } catch {
    // Best-effort
  }
}

export function logAuditEntry(entry: Record<string, unknown>): void {
  writeAuditLogEntry({ timestamp: new Date().toISOString(), ...entry, sessionID: (entry.sessionID as string) || '' });
}

export function flushAuditTrail(sessionID: string): void {
  const auditDir = path.join(getOpenCodeRoot(), '.task_temp', '_global');
  if (!fs.existsSync(auditDir)) { fs.mkdirSync(auditDir, { recursive: true }); }
  const trailPath = path.join(auditDir, 'audit_trail.json');
  let existing: Record<string, unknown>[] = [];
  try { existing = JSON.parse(fs.readFileSync(trailPath, 'utf-8')); } catch {}
  existing.push({ sessionID, flushedAt: new Date().toISOString() });
  fs.writeFileSync(trailPath, JSON.stringify(existing, null, 2));
}
