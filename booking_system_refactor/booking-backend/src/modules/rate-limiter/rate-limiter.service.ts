import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "../cache/cache.service";
import { RateLimitTier, RATE_LIMIT_DEFAULTS } from "./rate-limiter.decorator";

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current number of requests in the window */
  current: number;
  /** Maximum allowed requests in the window */
  limit: number;
  /** Window duration in seconds */
  window: number;
  /** Time to wait before retrying (in milliseconds), only present when not allowed */
  retryAfter?: number;
}

/**
 * Current rate limit status for an identifier.
 */
export interface RateLimitStatus {
  /** Current number of requests in the window */
  current: number;
  /** Maximum allowed requests in the window */
  limit: number;
  /** Window duration in seconds */
  window: number;
  /** Remaining requests allowed in the current window */
  remaining: number;
  /** Time when the rate limit window resets */
  resetAt: Date;
}

/**
 * Redis Lua script for atomic sliding window rate limiting.
 *
 * Performs the entire rate limit check in a single atomic Redis operation:
 * 1. Remove expired entries (older than the window boundary)
 * 2. Count remaining entries
 * 3. If count >= limit, return {0, count} (denied)
 * 4. If count < limit, add current timestamp and set expiry, return {1, count + 1} (allowed)
 *
 * KEYS[1]    - The sorted set key for this rate limit
 * ARGV[1]    - Window boundary timestamp (now - window * 1000)
 * ARGV[2]    - Current timestamp to add as member/score
 * ARGV[3]    - Maximum requests allowed (limit)
 * ARGV[4]    - TTL for the key (window + buffer in seconds)
 *
 * Returns: [allowed (0 or 1), current_count]
 */
const LUA_RATE_LIMIT_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1]);
  local count = redis.call('ZCARD', KEYS[1]);
  if count >= tonumber(ARGV[3]) then
    return {0, count};
  end
  redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[2]);
  redis.call('EXPIRE', KEYS[1], ARGV[4]);
  return {1, count + 1};
`;

/**
 * Redis-based rate limiting service using the Sliding Window Log algorithm.
 *
 * Uses Redis sorted sets with atomic Lua script execution for accurate
 * and efficient rate limiting without race conditions.
 *
 * Key format: `ratelimit:{identifier}:{endpoint}`
 *
 * Algorithm (atomic via Lua):
 * 1. Remove all entries older than the window
 * 2. Count remaining entries
 * 3. If count < limit, add current timestamp and allow
 * 4. If count >= limit, deny
 *
 * Fail-open behavior: If Redis is unavailable, all requests are allowed
 * and a warning is logged.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly keyPrefix = "ratelimit:";

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Check if a request is allowed based on rate limit configuration.
   *
   * Uses Redis sorted sets with sliding window log algorithm for accurate
   * rate limiting. Executes atomically via Redis pipeline.
   *
   * @param identifier - Unique identifier (IP, user ID, API key)
   * @param endpoint - Request endpoint path
   * @param tier - Rate limit tier defining limits and window
   * @param customLimit - Optional override for the limit
   * @param customWindow - Optional override for the window (in seconds)
   * @returns Rate limit result indicating if request is allowed
   */
  async isAllowed(
    identifier: string,
    endpoint: string,
    tier: RateLimitTier,
    customLimit?: number,
    customWindow?: number,
  ): Promise<RateLimitResult> {
    const limit = customLimit ?? RATE_LIMIT_DEFAULTS[tier].limit;
    const window = customWindow ?? RATE_LIMIT_DEFAULTS[tier].window;
    const key = this.buildKey(identifier, endpoint);

    // Fail open: allow all requests if Redis is unavailable
    if (!this.cacheService.isAvailable()) {
      this.logger.warn(
        `Redis unavailable. Rate limiter failing open for ${identifier}:${endpoint}`,
      );
      return {
        allowed: true,
        current: 0,
        limit,
        window,
      };
    }

    try {
      return await this.checkRateLimit(key, limit, window);
    } catch (error: unknown) {
      // Fail open on any Redis error
      this.logger.error(
        `Rate limit check failed for ${identifier}:${endpoint}. Failing open.`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        allowed: true,
        current: 0,
        limit,
        window,
      };
    }
  }

  /**
   * Get the current rate limit status for an identifier and endpoint.
   *
   * @param identifier - Unique identifier (IP, user ID, API key)
   * @param endpoint - Request endpoint path
   * @param tier - Rate limit tier
   * @param customLimit - Optional override for the limit
   * @param customWindow - Optional override for the window (in seconds)
   * @returns Current rate limit status
   */
  async getStatus(
    identifier: string,
    endpoint: string,
    tier: RateLimitTier,
    customLimit?: number,
    customWindow?: number,
  ): Promise<RateLimitStatus> {
    const limit = customLimit ?? RATE_LIMIT_DEFAULTS[tier].limit;
    const window = customWindow ?? RATE_LIMIT_DEFAULTS[tier].window;
    const key = this.buildKey(identifier, endpoint);

    if (!this.cacheService.isAvailable()) {
      return {
        current: 0,
        limit,
        window,
        remaining: limit,
        resetAt: new Date(Date.now() + window * 1000),
      };
    }

    try {
      const client = this.cacheService.getClient();
      if (!client) {
        throw new Error("Redis client unavailable");
      }

      const now = Date.now();
      const windowStart = now - window * 1000;

      // Clean expired entries and count current
      await client.zremrangebyscore(key, 0, windowStart);
      const current = await client.zcard(key);

      // Get the oldest entry to calculate reset time
      const oldestEntries = await client.zrange(key, 0, 0, "WITHSCORES");
      let resetAt: Date;
      if (oldestEntries.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntries[1], 10);
        resetAt = new Date(oldestTimestamp + window * 1000);
      } else {
        resetAt = new Date(now + window * 1000);
      }

      return {
        current,
        limit,
        window,
        remaining: Math.max(0, limit - current),
        resetAt,
      };
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get rate limit status for ${identifier}:${endpoint}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        current: 0,
        limit,
        window,
        remaining: limit,
        resetAt: new Date(Date.now() + window * 1000),
      };
    }
  }

  /**
   * Reset rate limit counters for an identifier.
   *
   * Admin function to clear rate limit data for a specific identifier.
   * If endpoint is not specified, all rate limit keys for the identifier
   * will be removed.
   *
   * @param identifier - Unique identifier (IP, user ID, API key)
   * @param endpoint - Optional specific endpoint to reset (resets all if not provided)
   */
  async resetLimit(identifier: string, endpoint?: string): Promise<void> {
    if (!this.cacheService.isAvailable()) {
      this.logger.warn("Redis unavailable. Cannot reset rate limit.");
      return;
    }

    try {
      const client = this.cacheService.getClient();
      if (!client) {
        throw new Error("Redis client unavailable");
      }

      if (endpoint) {
        const key = this.buildKey(identifier, endpoint);
        await client.del(key);
      } else {
        // Use SCAN to find all keys for this identifier
        const pattern = `${this.keyPrefix}${identifier}:*`;
        let cursor = "0";
        do {
          const result = await client.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            100,
          );
          cursor = result[0];
          const keys = result[1];
          if (keys.length > 0) {
            await client.del(...keys);
          }
        } while (cursor !== "0");
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to reset rate limit for ${identifier}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Get Redis client for advanced operations (e.g., idempotency caching).
   */
  getRedisClient(): ReturnType<typeof this.cacheService.getClient> {
    return this.cacheService.getClient();
  }

  /**
   * Build the Redis key for rate limiting.
   *
   * @param identifier - Unique identifier
   * @param endpoint - Request endpoint path
   * @returns Formatted Redis key
   */
  private buildKey(identifier: string, endpoint: string): string {
    // Sanitize endpoint to remove special characters
    const sanitizedEndpoint = endpoint.replace(/[^a-zA-Z0-9/_-]/g, "");
    return `${this.keyPrefix}${identifier}:${sanitizedEndpoint}`;
  }

  /**
   * Execute the atomic rate limit check using Redis Lua script.
   *
   * Uses EVAL to execute a Lua script atomically on the Redis server:
   * 1. Remove expired entries (older than window)
   * 2. Count remaining entries
   * 3. If count >= limit, return denied (without adding)
   * 4. If count < limit, add current timestamp and return allowed
   *
   * This eliminates the race condition present in the previous pipeline approach
   * where zadd was always executed first, then zrem was called separately to
   * undo it when over threshold.
   *
   * @param key - Redis key for rate limiting
   * @param limit - Maximum requests allowed in window
   * @param window - Window duration in seconds
   * @returns Rate limit result
   */
  private async checkRateLimit(
    key: string,
    limit: number,
    window: number,
  ): Promise<RateLimitResult> {
    const client = this.cacheService.getClient();
    if (!client) {
      throw new Error("Redis client unavailable");
    }

    const now = Date.now();
    const windowStart = now - window * 1000;

    // Execute Lua script atomically on Redis server
    // Returns: [allowed (0|1), current_count]
    const result = await client.eval(
      LUA_RATE_LIMIT_SCRIPT,
      1, // number of keys
      key,       // KEYS[1]
      windowStart, // ARGV[1]
      now,         // ARGV[2]
      limit,       // ARGV[3]
      window + 10, // ARGV[4] (window + buffer for TTL)
    );

    const rawResult = result as [number, number];
    const allowed = rawResult[0] === 1;
    const currentCount = rawResult[1];

    if (!allowed) {
      // Calculate retry-after using the oldest entry remaining
      const oldestEntries = await client.zrange(key, 0, 0, "WITHSCORES");
      let retryAfter = window * 1000;
      if (oldestEntries.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntries[1], 10);
        retryAfter = oldestTimestamp + window * 1000 - now;
      }

      return {
        allowed: false,
        current: currentCount,
        limit,
        window,
        retryAfter: Math.max(0, retryAfter),
      };
    }

    return {
      allowed: true,
      current: currentCount,
      limit,
      window,
    };
  }
}
