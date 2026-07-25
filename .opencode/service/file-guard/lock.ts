// service/file-guard/lock.ts — mkdir-based file mutex
// Source: safe-edit-core.ts acquireLock()

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOCK_BASE_DIR = path.join(os.tmpdir(), "opencode", "safe-edit-locks");

function _ensureLockBaseDir(): void {
  try { fs.mkdirSync(LOCK_BASE_DIR, { recursive: true }); } catch { /* best-effort */ }
}

function _spinWait(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) { /* busy-wait */ }
}

export function acquireLock(filePath: string, maxRetries = 100, baseDelay = 10): () => void {
  const lockDir = path.join(LOCK_BASE_DIR, Buffer.from(filePath).toString("hex"));
  _ensureLockBaseDir();
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      return (): void => {
        try { fs.rmdirSync(lockDir); } catch { /* best-effort */ }
      };
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== "EEXIST") throw err;
      const waitMs = Math.min(baseDelay * Math.pow(1.5, i), 200);
      _spinWait(waitMs);
    }
  }
  throw new Error(`Could not acquire lock for ${filePath} after ${maxRetries} retries`);
}
