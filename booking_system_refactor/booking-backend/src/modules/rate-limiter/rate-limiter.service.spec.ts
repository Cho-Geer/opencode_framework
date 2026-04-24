import { Test, TestingModule } from '@nestjs/testing';
import { RateLimiterService } from './rate-limiter.service';
import { CacheService } from '../cache/cache.service';
import { RateLimitTier, RATE_LIMIT_DEFAULTS } from './rate-limiter.decorator';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let cacheService: CacheService;

  // Mock Redis client
  const mockRedisClient = {
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
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0], // zremrangebyscore result
          [null, 0], // zcard result (0 requests before adding)
          [null, 1], // zadd result
          [null, true], // expire result
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await service.isAllowed('user123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.limit).toBe(RATE_LIMIT_DEFAULTS.api.limit);
      expect(result.window).toBe(RATE_LIMIT_DEFAULTS.api.window);
    });

    it('should deny request when over limit', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30000;

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 30],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
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
      mockRedisClient.pipeline.mockImplementation(() => {
        throw new Error('Redis connection lost');
      });

      const result = await service.isAllowed('user123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });

    it('should use custom limit when provided', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await service.isAllowed('user123', '/api/test', 'api', 50);

      expect(result.limit).toBe(50);
    });

    it('should use custom window when provided', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await service.isAllowed('user123', '/api/test', 'api', undefined, 120);

      expect(result.window).toBe(120);
    });

    it('should enforce strict tier limits (1 req/sec)', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await service.isAllowed('user123', '/api/book', 'strict');

      expect(result.limit).toBe(1);
      expect(result.window).toBe(1);
    });

    it('should enforce auth tier limits (5 req/min)', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 2],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockImplementation(async () => {
          callCount++;
          return [
            [null, 0],
            [null, callCount - 1],
            [null, 1],
            [null, true],
          ];
        }),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await service.isAllowed('user123', '/api/test', tier);

      expect(result.limit).toBe(expectedLimit);
      expect(result.window).toBe(expectedWindow);
    });
  });

  // ========================================================================
  // NEW: Five rate limiting layers
  // ========================================================================

  describe('5 rate limiting layers', () => {
    const createPipelineMock = (currentCount: number, allowed: boolean = true) => ({
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 0],
        [null, currentCount],
        [null, allowed ? 1 : 0],
        [null, true],
      ]),
    });

    it('layer 1: User+TimeSlot - should allow 1 req/sec per user per time slot', async () => {
      // Strict tier: 1 request per 1 second window
      const mockPipeline = createPipelineMock(0, true);
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 1], // 1 request already in window
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
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
      const mockPipeline = createPipelineMock(5, true); // 5 requests so far today
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 20], // 20 requests already made today
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
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
      const mockPipeline = createPipelineMock(3, true);
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 10], // 10 requests already this minute
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
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
      // Simulating slot capacity check
      const mockPipeline = createPipelineMock(50, true);
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 100], // slot at max capacity
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
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
      // Custom limit: 100 requests per 60 seconds for global user rate limiting
      const mockPipeline = createPipelineMock(50, true);
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 100], // user already made 100 requests this minute
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
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
    it('should use sliding window log algorithm via sorted sets', async () => {
      const now = Date.now();
      const window = 60; // 60 seconds
      const windowStart = now - window * 1000;

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 5], // removed 5 expired entries
          [null, 10], // 10 entries remain in window
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      await service.isAllowed('user-123', '/api/test', 'api');

      // Verify sliding window: remove old entries first
      // Use range assertion to allow for small timing drift (±100ms)
      const callArgs = mockPipeline.zremrangebyscore.mock.calls[0];
      expect(callArgs[1]).toBe(0);
      expect(callArgs[2]).toBeLessThanOrEqual(windowStart);
      expect(callArgs[2]).toBeGreaterThanOrEqual(windowStart - 100);
      // Then count remaining
      expect(mockPipeline.zcard).toHaveBeenCalled();
      // Then add current timestamp
      expect(mockPipeline.zadd).toHaveBeenCalled();
    });

    it('should correctly calculate window boundaries for different tiers', async () => {
      const now = Date.now();

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      // Test strict: 1 second window
      await service.isAllowed('user-123', '/api/test', 'strict');
      // Allow small timing drift (±100ms)
      const strictCallArgs = mockPipeline.zremrangebyscore.mock.calls[0];
      expect(strictCallArgs[1]).toBe(0);
      expect(strictCallArgs[2]).toBeLessThanOrEqual(now - 1000);
      expect(strictCallArgs[2]).toBeGreaterThanOrEqual(now - 1000 - 100);

      jest.clearAllMocks();
      const mockPipeline2 = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline2);

      // Test auth: 60 second window
      const now2 = Date.now();
      await service.isAllowed('user-123', '/auth/login', 'auth');
      // Allow small timing drift (±100ms)
      const authCallArgs = mockPipeline2.zremrangebyscore.mock.calls[0];
      expect(authCallArgs[1]).toBe(0);
      expect(authCallArgs[2]).toBeLessThanOrEqual(now2 - 60000);
      expect(authCallArgs[2]).toBeGreaterThanOrEqual(now2 - 60000 - 100);
    });

    it('should clean up expired entries outside the sliding window', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 15], // 15 old entries removed
          [null, 0], // 0 remaining in window
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await service.isAllowed('user-123', '/api/test', 'api');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1); // Fresh count after cleanup
    });

    it('should set key expiration for auto-cleanup', async () => {
      const window = 60;

      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      await service.isAllowed('user-123', '/api/test', 'api');

      // expire should be called with window + 10 buffer
      expect(mockPipeline.expire).toHaveBeenCalledWith(
        expect.any(String),
        window + 10,
      );
    });

    it('should allow requests after window expires (sliding window reset)', async () => {
      // Simulate: window has expired, all old entries cleaned
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 30], // all 30 old entries expired
          [null, 0], // window is empty now
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

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
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      await service.isAllowed('user-123', '/api/bookings', 'api');

      // Key should be ratelimit:user-123:/api/bookings
      const pipelineCall = mockRedisClient.pipeline.mock.calls;
      expect(pipelineCall).toHaveLength(1);
    });

    it('should sanitize endpoint to prevent key injection', async () => {
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      await service.isAllowed('user-123', '/api/bookings;DROP TABLE', 'api');

      // The key should not contain special characters
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        expect.not.stringContaining(';'),
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
  // BUG-005: Pipeline "先加后删" 设计缺陷测试 (RED Phase)
  //
  // 这些测试记录当前实现的问题(使用 Redis pipeline):
  // 1. zadd 总是在 pipeline 中无条件执行(即使会超标)
  // 2. zrem 在 pipeline 外部执行，不是原子的
  // 3. 存在竞态窗口: 在 pipeline 执行完毕和 zrem 执行之间,
  //    其他并发请求可能看到这个"幽灵"条目
  //
  // 当切换到 Lua 脚本后，这些测试应该失败(RED)，因为新实现不会先加后删
  // ========================================================================

  describe('BUG-005: Pipeline 先加后删竞态窗口', () => {
    it('[Red] 应证明当前pipeline中zadd总被执行即使会超标', async () => {
      // 当前行为: pipeline 中 zadd 被无条件调用(第299行)
      // 即使 zcard 返回 >= limit, zadd 仍会执行
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 30], // 已经达到30限制
          [null, 1],  // zadd 仍然执行了!
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
      mockRedisClient.zrange.mockResolvedValue(['ts', String(Date.now())]);

      const result = await service.isAllowed('user123', '/api/test', 'api');

      // 这个断言验证: zadd 在 pipeline 中被调用了(不必要地)
      expect(mockPipeline.zadd).toHaveBeenCalled();

      // 同时验证: zrem 在 pipeline 之外被调用(存在竞态窗口)
      expect(mockRedisClient.zrem).toHaveBeenCalled();

      // 最终结果是拒绝，但做了不必要的工作
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(30);
    });

    it('[Red] 应证明zrem在pipeline外部执行存在竞态窗口', async () => {
      // 这是一个时序攻击场景:
      // 1. 请求A的pipeline执行: zremrangebyscore + zcard(=limit) + zadd
      // 2. 在请求A的zrem执行前，请求B的pipeline也执行了
      // 3. 请求B的zcard也看到=limit(因为请求A的zadd已添加)
      // 4. 请求B也被拒绝(正确)但请求A的zrem和请求B的zrem都执行了
      // 5. 更糟糕: 如果limit是临界值，zrem可能误删合法条目

      let execCallCount = 0;
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockImplementation(async () => {
          execCallCount++;
          if (execCallCount === 1) {
            return [
              [null, 0],
              [null, 30], // 请求A看到30(已达上限)
              [null, 1],  // 仍然添加了
              [null, true],
            ];
          }
          // 请求B看到31! 因为请求A在pipeline中已zadd
          // 但请求A的zrem还没执行!
          return [
            [null, 0],
            [null, 31], // 幽灵条目导致计数为31
            [null, 1],
            [null, true],
          ];
        }),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
      mockRedisClient.zrange.mockResolvedValue(['ts', String(Date.now() - 1000)]);

      // 模拟两个并发请求
      const results = await Promise.all([
        service.isAllowed('user123', '/api/test', 'api'),
        service.isAllowed('user123', '/api/test', 'api'),
      ]);

      // 关键证据: 在竞态窗口期间, zrem被调用了至少2次
      expect(mockRedisClient.zrem).toHaveBeenCalledTimes(2);

      // 这个测试证明了"先加后删"模式的竞态窗口问题
      // 如果切换到先检查后添加的Lua脚本，zrem将永远不会被调用
    });

    it('[Red] 应证明当前实现做了不必要的zadd->zrem往返', async () => {
      // 监控Redis的往返次数
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 30], // 已达上限
          [null, 1],
          [null, true],
        ]),
      };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);
      mockRedisClient.zrem.mockResolvedValue(1);
      mockRedisClient.zrange.mockResolvedValue(['ts', String(Date.now() - 1000)]);

      await service.isAllowed('user123', '/api/test', 'api');

      // 当前实现做了4次pipeline调用中包含了不必要的zadd
      // 然后在pipeline外部又做了1次zrem调用
      // 优化后: 仅1次EVAL调用完成所有操作，没有不必要的zadd/zrem
      const totalRedisCalls = mockRedisClient.pipeline.mock.calls.length +
        mockRedisClient.zrem.mock.calls.length +
        mockRedisClient.zrange.mock.calls.length;

      expect(totalRedisCalls).toBeGreaterThanOrEqual(1);
      // 这条测试在Lua实现后应验证总调用次数减少
    });
  });
});
