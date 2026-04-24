import { Logger } from "@nestjs/common";

/**
 * Reusable distributed lock helper.
 * Wraps the acquire → execute → release pattern to reduce boilerplate.
 */

export interface LockOptions {
  key: string;
  ttl: number;
  logger?: Logger;
}

export type LockTask<T> = () => Promise<T>;

export interface SettledResult {
  taskName: string;
  success: boolean;
  value?: unknown;
  reason?: unknown;
}

/**
 * Acquires a distributed lock, executes the task if successful, and
 * guarantees release in the finally block.
 *
 * @returns The task result if the lock was acquired, or `null` if another instance holds the lock.
 */
export async function withDistributedLock<T>(
  cacheService: { acquireLock(key: string, ttl: number): Promise<boolean>; releaseLock(key: string): Promise<void> },
  options: LockOptions,
  task: LockTask<T>,
): Promise<T | null> {
  const { key, ttl, logger } = options;

  const acquired = await cacheService.acquireLock(key, ttl);
  if (!acquired) {
    (logger ?? new Logger("LockUtil")).warn(
      `Skipping: another instance holds the lock "${key}"`,
    );
    return null;
  }

  try {
    return await task();
  } finally {
    await cacheService.releaseLock(key);
  }
}

/**
 * Processes Promise.allSettled results and logs each outcome.
 * Returns a summary of success/failure counts per task.
 */
export function processSettledResults<T>(
  results: PromiseSettledResult<T>[],
  taskNames: string[],
  logger: Logger,
): SettledResult[] {
  return results.map((result, index) => {
    const taskName = taskNames[index] ?? `task-${index}`;
    if (result.status === "fulfilled") {
      logger.log(`${taskName} completed: ${String(result.value)}`);
      return { taskName, success: true, value: result.value };
    }
    logger.error(`${taskName} failed`, result.reason);
    return { taskName, success: false, reason: result.reason };
  });
}
