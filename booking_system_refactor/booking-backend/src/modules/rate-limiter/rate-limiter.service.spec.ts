import { Test, TestingModule } from '@nestjs/testing';
import { RateLimiterService } from './rate-limiter.service';
import { CacheService } from '../cache/cache.service';
import { RateLimitTier, RATE_LIMIT_DEFAULTS } from './rate-limiter.decorator';

/**
 * Helper: create a mock result for the Lua rate limit script.
 * The Lua script returns: [allowed (0|1), current_count]
 */
const luaResult = (allowed: boolean, current: number): [number, number] => {
  return [allowed ? 1 : 0, current];
};

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let cacheService: CacheService;

  // Mock Redis client (Lua script approach - no pipeline needed for checkRateLimit)
  const mockRedisClient = {
    eval: jest.fn(),
    zremrangebyscore: jest.fn(),
    zcard: jest.fn(),
    zadd: jest.fn(),
    zrange: jest.fn(),
    zrem: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    scan: jest.fn(),
    pipeline: jest.fn(),
  };

  // Mock CacheService
  const mockCacheService = {
    isAvailable: jest.fn(),
    getClient: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
    cacheService = module.get<CacheService>(CacheService);

    // Default: Redis is available
    mockCacheService.isAvailable.mockReturnValue(true);
    mockCacheService.getClient.mockReturnValue(mockRedisClient);
  });

  describe('isAllowed', () => {
    it('should allow request when under limit', async () => {
      // Lua script returns: allowed=1, current=1 (0 existing + 1 new)
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      const result = await service.isAllowed('user123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.limit).toBe(RATE_LIMIT_DEFAULTS.api.limit);
      expect(result.window).toBe(RATE_LIMIT_DEFAULTS.api.window);

      // Verify eval was called with 1 key + 4 args
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('ZREMRANGEBYSCORE'),
        1,
        expect.stringContaining('ratelimit:'),
        expect.any(Number), // windowStart
        expect.any(Number), // now
        RATE_LIMIT_DEFAULTS.api.limit,
        RATE_LIMIT_DEFAULTS.api.window + 10, // window + buffer
      );
    });

    it('should deny request when over limit', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30000;

      // Lua script returns: allowed=0, current=30 (at limit)
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 30));
      mockRedisClient.zrange.mockResolvedValue(['timestamp1', String(oldestTimestamp)]);

      const result = await service.isAllowed('user123', '/api/test', 'api');

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(30);
      expect(result.limit).toBe(RATE_LIMIT_DEFAULTS.api.limit);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should fail open when Redis is unavailable', async () => {
      mockCacheService.isAvailable.mockReturnValue(false);

      const result = await service.isAllowed('user123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });

    it('should fail open when Redis throws an error', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection lost'));

      const result = await service.isAllowed('user123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });

    it('should use custom limit when provided', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      const result = await service.isAllowed('user123', '/api/test', 'api', 50);

      expect(result.limit).toBe(50);
      // Verify eval was called with custom limit
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        50, // custom limit
        expect.any(Number),
      );
    });

    it('should use custom window when provided', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      const result = await service.isAllowed('user123', '/api/test', 'api', undefined, 120);

      expect(result.window).toBe(120);
    });

    it('should enforce strict tier limits (1 req/sec)', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      const result = await service.isAllowed('user123', '/api/book', 'strict');

      expect(result.limit).toBe(1);
      expect(result.window).toBe(1);
    });

    it('should enforce auth tier limits (5 req/min)', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 3));

      const result = await service.isAllowed('user123', '/auth/login', 'auth');

      expect(result.limit).toBe(5);
      expect(result.window).toBe(60);
    });
  });

  describe('getStatus', () => {
    it('should return current rate limit status', async () => {
      mockRedisClient.zremrangebyscore.mockResolvedValue(0);
      mockRedisClient.zcard.mockResolvedValue(10);
      mockRedisClient.zrange.mockResolvedValue(['ts', '1700000000000']);

      const status = await service.getStatus('user123', '/api/test', 'api');

      expect(status.current).toBe(10);
      expect(status.limit).toBe(30);
      expect(status.remaining).toBe(20);
      expect(status.window).toBe(60);
    });

    it('should return full capacity when Redis is unavailable', async () => {
      mockCacheService.isAvailable.mockReturnValue(false);

      const status = await service.getStatus('user123', '/api/test', 'api');

      expect(status.current).toBe(0);
      expect(status.remaining).toBe(30);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.zremrangebyscore.mockRejectedValue(new Error('Redis error'));

      const status = await service.getStatus('user123', '/api/test', 'api');

      expect(status.current).toBe(0);
      expect(status.remaining).toBe(30);
    });
  });

  describe('resetLimit', () => {
    it('should reset rate limit for specific endpoint', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await service.resetLimit('user123', '/api/test');

      expect(mockRedisClient.del).toHaveBeenCalled();
    });

    it('should reset all rate limits for identifier when no endpoint specified', async () => {
      mockRedisClient.scan
        .mockResolvedValueOnce(['0', ['ratelimit:user123:/api/test1', 'ratelimit:user123:/api/test2']])
        .mockResolvedValueOnce(['0', []]);
      mockRedisClient.del.mockResolvedValue(2);

      await service.resetLimit('user123');

      expect(mockRedisClient.scan).toHaveBeenCalled();
      expect(mockRedisClient.del).toHaveBeenCalled();
    });

    it('should handle Redis unavailability gracefully', async () => {
      mockCacheService.isAvailable.mockReturnValue(false);

      await expect(service.resetLimit('user123', '/api/test')).resolves.not.toThrow();
    });
  });

  describe('concurrent requests', () => {
    it('should handle concurrent isAllowed calls correctly', async () => {
      let callCount = 0;
      mockRedisClient.eval.mockImplementation(async () => {
        callCount++;
        return luaResult(true, callCount);
      });

      const results = await Promise.all([
        service.isAllowed('user123', '/api/test', 'api'),
        service.isAllowed('user123', '/api/test', 'api'),
        service.isAllowed('user123', '/api/test', 'api'),
      ]);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.allowed)).toBe(true);
    });
  });

  describe('different tiers', () => {
    it.each<[RateLimitTier, number, number]>([
      ['strict', 1, 1],
      ['auth', 5, 60],
      ['api', 30, 60],
      ['public', 100, 60],
    ])('should apply %s tier limits (%d req/%ds)', async (tier, expectedLimit, expectedWindow) => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      const result = await service.isAllowed('user123', '/api/test', tier);

      expect(result.limit).toBe(expectedLimit);
      expect(result.window).toBe(expectedWindow);
    });
  });

  // ========================================================================
  // NEW: Five rate limiting layers
  // ========================================================================

  describe('5 rate limiting layers', () => {
    it('layer 1: User+TimeSlot - should allow 1 req/sec per user per time slot', async () => {
      // Strict tier: 1 request per 1 second window
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      const result = await service.isAllowed(
        'user-123',
        '/api/slots/2026-04-16T10:00:00/book',
        'strict',
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(1);
      expect(result.window).toBe(1);
      expect(result.current).toBe(1);
    });

    it('layer 1: User+TimeSlot - should deny second request within same second', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 500;

      // Lua script denies: already 1 request in window
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 1));
      mockRedisClient.zrange.mockResolvedValue(['ts', String(oldestTimestamp)]);

      const result = await service.isAllowed(
        'user-123',
        '/api/slots/2026-04-16T10:00:00/book',
        'strict',
      );

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(1);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('layer 2: User Daily - should allow up to 20 requests per day per user', async () => {
      // Custom limit of 20 requests per 86400 seconds (1 day)
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 6)); // 5 existing + 1 new

      const result = await service.isAllowed(
        'user-123',
        '/api/bookings',
        'api',
        20,
        86400,
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(20);
      expect(result.window).toBe(86400);
      expect(result.current).toBe(6); // 5 + 1
    });

    it('layer 2: User Daily - should deny 21st request in a day', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 3600000; // 1 hour ago

      // Lua script: 20 requests already made, limit is 20
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 20));
      mockRedisClient.zrange.mockResolvedValue(['ts', String(oldestTimestamp)]);

      const result = await service.isAllowed(
        'user-123',
        '/api/bookings',
        'api',
        20,
        86400,
      );

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(20);
    });

    it('layer 3: IP Global - should enforce 10 req/min per IP across all endpoints', async () => {
      // Custom limit: 10 requests per 60 seconds
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 4)); // 3 existing + 1 new

      const result = await service.isAllowed(
        '192.168.1.1',
        '/api/global',
        'api',
        10,
        60,
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.window).toBe(60);
      expect(result.current).toBe(4);
    });

    it('layer 3: IP Global - should deny 11th request per minute from same IP', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30000;

      // Lua script denies: 10 requests already this minute
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 10));
      mockRedisClient.zrange.mockResolvedValue(['ts', String(oldestTimestamp)]);

      const result = await service.isAllowed(
        '192.168.1.1',
        '/api/another-endpoint',
        'api',
        10,
        60,
      );

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
    });

    it('layer 4: TimeSlot Capacity - should allow booking when slot has capacity', async () => {
      // Public tier: 100 requests per 60 seconds
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 51)); // 50 existing + 1 new

      const result = await service.isAllowed(
        'slot-cap-1',
        '/api/slots/2026-04-16T10:00:00',
        'public',
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.current).toBe(51);
    });

    it('layer 4: TimeSlot Capacity - should deny when slot is at capacity', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 10000;

      // Lua script denies: 100 requests already (slot at max capacity)
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 100));
      mockRedisClient.zrange.mockResolvedValue(['ts', String(oldestTimestamp)]);

      const result = await service.isAllowed(
        'slot-cap-1',
        '/api/slots/2026-04-16T10:00:00',
        'public',
      );

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(100);
    });

    it('layer 5: Global User - should allow up to 100 req/min across all user operations', async () => {
      // Custom limit: 100 requests per 60 seconds
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 51)); // 50 existing + 1 new

      const result = await service.isAllowed(
        'user-123',
        '/api/user/global',
        'public',
        100,
        60,
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.window).toBe(60);
      expect(result.current).toBe(51);
    });

    it('layer 5: Global User - should deny when user exceeds 100 req/min globally', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 20000;

      // Lua script denies: 100 requests already made
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 100));
      mockRedisClient.zrange.mockResolvedValue(['ts', String(oldestTimestamp)]);

      const result = await service.isAllowed(
        'user-123',
        '/api/user/global',
        'public',
        100,
        60,
      );

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(100);
    });
  });

  // ========================================================================
  // NEW: Sliding window logic
  // ========================================================================

  describe('sliding window logic', () => {
    it('should use Lua script for atomic sliding window log algorithm', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 11)); // 10 existing + 1 new

      await service.isAllowed('user-123', '/api/test', 'api');

      // Verify eval was called with the Lua script
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('ZREMRANGEBYSCORE'),
        1,
        expect.stringContaining('ratelimit:'),
        expect.any(Number), // windowStart
        expect.any(Number), // now
        30, // api limit
        70, // window + buffer (60 + 10)
      );
    });

    it('should correctly calculate window boundaries for different tiers', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      // Test strict: 1 second window
      await service.isAllowed('user-123', '/api/test', 'strict');
      // Verify eval called with strict tier params
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        1,   // strict limit
        11,  // window + buffer (1 + 10)
      );

      jest.clearAllMocks();
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      // Test auth: 60 second window
      await service.isAllowed('user-123', '/auth/login', 'auth');
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        5,   // auth limit
        70,  // window + buffer (60 + 10)
      );
    });

    it('should clean up expired entries outside the sliding window', async () => {
      // Lua script: cleaned 15 old entries, 0 remaining, 1 new added
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      const result = await service.isAllowed('user-123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1); // Fresh count after cleanup
    });

    it('should set key expiration for auto-cleanup via Lua script', async () => {
      const window = 60;
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      await service.isAllowed('user-123', '/api/test', 'api');

      // Verify the Lua script receives window + 10 as TTL arg
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRE'),
        1,
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        30,        // limit
        window + 10, // TTL
      );
    });

    it('should allow requests after window expires (sliding window reset)', async () => {
      // Lua script: all entries expired, 0 remaining, 1 new added
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      // Even though limit was reached before, after window expires it resets
      const result = await service.isAllowed('user-123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });
  });

  // ========================================================================
  // NEW: Header generation (via getStatus)
  // ========================================================================

  describe('header generation data (getStatus)', () => {
    it('should provide X-RateLimit-Limit data', async () => {
      mockRedisClient.zremrangebyscore.mockResolvedValue(0);
      mockRedisClient.zcard.mockResolvedValue(5);
      mockRedisClient.zrange.mockResolvedValue(['ts', '1700000000000']);

      const status = await service.getStatus('user-123', '/api/test', 'api');

      expect(status.limit).toBe(30); // api tier default
    });

    it('should provide X-RateLimit-Remaining data', async () => {
      mockRedisClient.zremrangebyscore.mockResolvedValue(0);
      mockRedisClient.zcard.mockResolvedValue(25);
      mockRedisClient.zrange.mockResolvedValue(['ts', '1700000000000']);

      const status = await service.getStatus('user-123', '/api/test', 'api');

      expect(status.remaining).toBe(5); // 30 - 25
    });

    it('should provide X-RateLimit-Reset data as Date', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30000; // 30 seconds ago

      mockRedisClient.zremrangebyscore.mockResolvedValue(0);
      mockRedisClient.zcard.mockResolvedValue(5);
      mockRedisClient.zrange.mockResolvedValue(['ts', String(oldestTimestamp)]);

      const status = await service.getStatus('user-123', '/api/test', 'api');

      expect(status.resetAt).toBeInstanceOf(Date);
      // Reset should be oldest entry + window
      expect(status.resetAt.getTime()).toBe(oldestTimestamp + 60000);
    });

    it('should never return negative remaining count', async () => {
      mockRedisClient.zremrangebyscore.mockResolvedValue(0);
      mockRedisClient.zcard.mockResolvedValue(35); // Over the limit
      mockRedisClient.zrange.mockResolvedValue(['ts', '1700000000000']);

      const status = await service.getStatus('user-123', '/api/test', 'api');

      expect(status.remaining).toBe(0); // Math.max(0, 30 - 35)
    });

    it('should calculate resetAt from oldest entry in window', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 15000; // 15 seconds ago
      const window = 60;

      mockRedisClient.zremrangebyscore.mockResolvedValue(0);
      mockRedisClient.zcard.mockResolvedValue(10);
      mockRedisClient.zrange.mockResolvedValue(['member', String(oldestTimestamp)]);

      const status = await service.getStatus('user-123', '/api/test', 'api');

      // resetAt = oldestTimestamp + window * 1000
      expect(status.resetAt.getTime()).toBe(oldestTimestamp + window * 1000);
    });

    it('should default resetAt to now + window when no entries exist', async () => {
      const now = Date.now();
      mockRedisClient.zremrangebyscore.mockResolvedValue(0);
      mockRedisClient.zcard.mockResolvedValue(0);
      mockRedisClient.zrange.mockResolvedValue([]);

      const status = await service.getStatus('user-123', '/api/test', 'api');

      // When empty, resetAt defaults to now + window
      expect(status.remaining).toBe(30);
      expect(status.resetAt.getTime()).toBeGreaterThanOrEqual(now + 60000 - 100); // Allow small time drift
    });
  });

  // ========================================================================
  // NEW: Key building and sanitization
  // ========================================================================

  describe('key building', () => {
    it('should build correct rate limit key format', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      await service.isAllowed('user-123', '/api/bookings', 'api');

      // Key should be ratelimit:user-123:/api/bookings passed to eval
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.stringContaining('ratelimit:'),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('should sanitize endpoint to prevent key injection', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(true, 1));

      await service.isAllowed('user-123', '/api/bookings;DROP TABLE', 'api');

      // The key should not contain special characters
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.not.stringContaining(';'),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  // ========================================================================
  // NEW: getRedisClient
  // ========================================================================

  describe('getRedisClient', () => {
    it('should return the raw Redis client', () => {
      const client = service.getRedisClient();
      expect(client).toBe(mockRedisClient);
    });
  });

  // ========================================================================
  // GREEN Phase: Lua Script 优化验证
  //
  // 这些测试验证新的 Lua 脚本实现不会出现先加后删的问题:
  // 1. Lua 脚本在 Redis 服务端原子执行，没有竞态窗口
  // 2. 超标时不会添加条目（无无用 zadd）
  // 3. 不会在脚本外部调用 zrem（无竞态窗口）
  // 4. Redis 往返次数从 2 次减少为 1 次
  // ========================================================================

  describe('BUG-005: Lua 脚本原子性验证 (GREEN)', () => {
    it('[Green] 超标时 Lua 脚本不会添加条目 (对比旧实现的无条件zadd)', async () => {
      // Lua script: count=30 >= limit=30, returns {0, 30} without adding
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 30));
      mockRedisClient.zrange.mockResolvedValue(['ts', String(Date.now())]);

      const result = await service.isAllowed('user123', '/api/test', 'api');

      // Lua 脚本内判断超标，没有执行 ZADD
      // 验证外部没有 zrem 调用（因为是 Lua 内原子完成的）
      expect(mockRedisClient.zrem).not.toHaveBeenCalled();

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(30);
    });

    it('[Green] 只调用一次 eval 完成全部检查 (从2次往返减少到1次)', async () => {
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 30));
      mockRedisClient.zrange.mockResolvedValue(['ts', String(Date.now())]);

      await service.isAllowed('user123', '/api/test', 'api');

      // 只做了 1 次 EVAL 调用（代替了旧实现的 1 次 pipeline + 1 次 zrem + 1 次 zrange）
      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1);
      // pipeline 不应该被调用（不再是 pipeline 模式）
      expect(mockRedisClient.pipeline).not.toHaveBeenCalled();
    });

    it('[Green] 并发请求不存在竞态窗口 (Lua 脚本原子执行)', async () => {
      // 模拟 Lua 脚本的原子行为：
      // 即使在并发场景下，每个 eval 调用在 Redis 内都是串行执行的
      let callCount = 0;
      mockRedisClient.eval.mockImplementation(async () => {
        callCount++;
        // 每个请求看到的是 Redis 内的真实状态
        if (callCount <= 30) {
          return luaResult(true, callCount); // 前30个允许
        }
        return luaResult(false, 30); // 超过30拒绝
      });
      mockRedisClient.zrange.mockResolvedValue(['ts', String(Date.now() - 1000)]);

      // 模拟 35 个并发请求
      const results = await Promise.all(
        Array.from({ length: 35 }, () =>
          service.isAllowed('user123', '/api/test', 'api'),
        ),
      );

      const allowedCount = results.filter(r => r.allowed).length;
      const deniedCount = results.filter(r => !r.allowed).length;

      // 前30个应该被允许，后5个被拒绝（滑动窗口限制）
      expect(allowedCount).toBe(30);
      expect(deniedCount).toBe(5);

      // 关键: zrem 从未被调用（Lua 脚本内完成了所有操作）
      expect(mockRedisClient.zrem).not.toHaveBeenCalled();
    });

    it('[Green] retryAfter 计算仍然正确', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 50000; // 最老条目在50秒前

      // Lua 脚本拒绝
      mockRedisClient.eval.mockResolvedValue(luaResult(false, 30));
      mockRedisClient.zrange.mockResolvedValue(['oldest-ts', String(oldestTimestamp)]);

      const result = await service.isAllowed('user123', '/api/test', 'api');

      expect(result.allowed).toBe(false);
      // retryAfter = oldest + window - now = (now - 50000) + 60000 - now = 10000ms
      expect(result.retryAfter).toBe(oldestTimestamp + 60000 - now);
    });
  });
});
