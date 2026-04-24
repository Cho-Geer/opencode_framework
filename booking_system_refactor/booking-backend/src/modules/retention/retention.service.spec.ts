import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { PrismaService } from '../../common/database/prisma.service';
import { CacheService } from '../cache/cache.service';

// Mock PrismaService
const mockPrismaService = {
  appointment: {
    updateMany: jest.fn(),
  },
  systemLog: {
    deleteMany: jest.fn(),
  },
  userSession: {
    deleteMany: jest.fn(),
  },
  activityLog: {
    deleteMany: jest.fn(),
  },
};

// Mock CacheService
const mockCacheService = {
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
};

describe('RetentionService', () => {
  let service: RetentionService;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-16T00:00:00.000Z'));
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<RetentionService>(RetentionService);
    loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConfig', () => {
    it('should return retention config', () => {
      const config = service.getConfig();

      expect(config).toEqual({
        appointmentRetentionDays: 90,
        systemLogRetentionDays: 30,
        sessionRetentionDays: 30,
      });
    });

    it('should return a copy of config to prevent mutation', () => {
      const config = service.getConfig();
      config.appointmentRetentionDays = 999;

      expect(service.getConfig().appointmentRetentionDays).toBe(90);
    });
  });

  describe('cleanupExpiredAppointments', () => {
    it('should archive appointments older than retention period', async () => {
      mockPrismaService.appointment.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupExpiredAppointments();

      expect(result).toBe(5);
      expect(mockPrismaService.appointment.updateMany).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['COMPLETED', 'CANCELLED', 'EXPIRED'],
          },
          updatedAt: {
            lt: expect.any(Date),
          },
        },
        data: {
          remarks: '[ARCHIVED] Data retention cleanup',
        },
      });
    });

    it('should return 0 when no appointments to archive', async () => {
      mockPrismaService.appointment.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupExpiredAppointments();

      expect(result).toBe(0);
    });

    it('should calculate cutoff date correctly (90 days)', async () => {
      mockPrismaService.appointment.updateMany.mockResolvedValue({ count: 1 });

      await service.cleanupExpiredAppointments();

      const callArgs = mockPrismaService.appointment.updateMany.mock.calls[0][0];
      const cutoffDate = callArgs.where.updatedAt.lt;

      // Current time is 2026-04-16, cutoff should be 90 days before
      const expectedCutoff = new Date('2026-01-16T00:00:00.000Z');
      expect(cutoffDate.getTime()).toBe(expectedCutoff.getTime());
    });
  });

  describe('cleanupOldSystemLogs', () => {
    it('should delete system logs older than retention period', async () => {
      mockPrismaService.systemLog.deleteMany.mockResolvedValue({ count: 100 });

      const result = await service.cleanupOldSystemLogs();

      expect(result).toBe(100);
      expect(mockPrismaService.systemLog.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('should return 0 when no logs to delete', async () => {
      mockPrismaService.systemLog.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupOldSystemLogs();

      expect(result).toBe(0);
    });

    it('should calculate cutoff date correctly (30 days)', async () => {
      mockPrismaService.systemLog.deleteMany.mockResolvedValue({ count: 1 });

      await service.cleanupOldSystemLogs();

      const callArgs = mockPrismaService.systemLog.deleteMany.mock.calls[0][0];
      const cutoffDate = callArgs.where.createdAt.lt;

      const expectedCutoff = new Date('2026-03-17T00:00:00.000Z');
      expect(cutoffDate.getTime()).toBe(expectedCutoff.getTime());
    });
  });

  describe('cleanupInactiveSessions', () => {
    it('should delete inactive sessions older than retention period', async () => {
      mockPrismaService.userSession.deleteMany.mockResolvedValue({ count: 50 });

      const result = await service.cleanupInactiveSessions();

      expect(result).toBe(50);
      expect(mockPrismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            {
              isActive: false,
              createdAt: {
                lt: expect.any(Date),
              },
            },
            {
              expiresAt: {
                lt: expect.any(Date),
              },
            },
          ],
        },
      });
    });

    it('should delete expired sessions regardless of isActive status', async () => {
      mockPrismaService.userSession.deleteMany.mockResolvedValue({ count: 25 });

      await service.cleanupInactiveSessions();

      const callArgs = mockPrismaService.userSession.deleteMany.mock.calls[0][0];
      // Check that expired sessions condition is present
      expect(callArgs.where.OR).toHaveLength(2);
      expect(callArgs.where.OR[1]).toHaveProperty('expiresAt');
    });

    it('should calculate cutoff date correctly (30 days)', async () => {
      mockPrismaService.userSession.deleteMany.mockResolvedValue({ count: 1 });

      await service.cleanupInactiveSessions();

      const callArgs = mockPrismaService.userSession.deleteMany.mock.calls[0][0];
      const cutoffDate = callArgs.where.OR[0].createdAt.lt;

      const expectedCutoff = new Date('2026-03-17T00:00:00.000Z');
      expect(cutoffDate.getTime()).toBe(expectedCutoff.getTime());
    });
  });

  describe('cleanupOldActivityLogs', () => {
    it('should delete activity logs older than retention period', async () => {
      mockPrismaService.activityLog.deleteMany.mockResolvedValue({ count: 200 });

      const result = await service.cleanupOldActivityLogs();

      expect(result).toBe(200);
      expect(mockPrismaService.activityLog.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('should return 0 when no activity logs to delete', async () => {
      mockPrismaService.activityLog.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupOldActivityLogs();

      expect(result).toBe(0);
    });
  });

  describe('handleCron', () => {
    it('should run all cleanup tasks when lock is acquired', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockPrismaService.appointment.updateMany.mockResolvedValue({ count: 5 });
      mockPrismaService.systemLog.deleteMany.mockResolvedValue({ count: 100 });
      mockPrismaService.userSession.deleteMany.mockResolvedValue({ count: 50 });

      await service.handleCron();

      expect(mockCacheService.acquireLock).toHaveBeenCalledWith('retention:cleanup:lock', 3600);
      expect(mockPrismaService.appointment.updateMany).toHaveBeenCalled();
      expect(mockPrismaService.systemLog.deleteMany).toHaveBeenCalled();
      expect(mockPrismaService.userSession.deleteMany).toHaveBeenCalled();
      expect(mockCacheService.releaseLock).toHaveBeenCalledWith('retention:cleanup:lock');
    });

    it('should skip cleanup when lock cannot be acquired', async () => {
      mockCacheService.acquireLock.mockResolvedValue(false);

      await service.handleCron();

      expect(mockCacheService.acquireLock).toHaveBeenCalledWith('retention:cleanup:lock', 3600);
      expect(mockPrismaService.appointment.updateMany).not.toHaveBeenCalled();
      expect(mockPrismaService.systemLog.deleteMany).not.toHaveBeenCalled();
      expect(mockPrismaService.userSession.deleteMany).not.toHaveBeenCalled();
      expect(mockCacheService.releaseLock).not.toHaveBeenCalled();
    });

    it('should release lock in finally block when cleanup succeeds', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockPrismaService.appointment.updateMany.mockResolvedValue({ count: 5 });
      mockPrismaService.systemLog.deleteMany.mockResolvedValue({ count: 100 });
      mockPrismaService.userSession.deleteMany.mockResolvedValue({ count: 50 });

      await service.handleCron();

      expect(mockCacheService.releaseLock).toHaveBeenCalledWith('retention:cleanup:lock');
      // releaseLock should be called after cleanup operations
      const releaseCallOrder = mockCacheService.releaseLock.mock.invocationCallOrder[0];
      const cleanupCallOrder = mockPrismaService.appointment.updateMany.mock.invocationCallOrder[0];
      expect(releaseCallOrder).toBeGreaterThan(cleanupCallOrder);
    });

    it('should release lock in finally block even when cleanup fails', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockPrismaService.appointment.updateMany.mockRejectedValue(new Error('DB error'));
      mockPrismaService.systemLog.deleteMany.mockResolvedValue({ count: 100 });
      mockPrismaService.userSession.deleteMany.mockResolvedValue({ count: 50 });

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await service.handleCron();

      expect(mockCacheService.releaseLock).toHaveBeenCalledWith('retention:cleanup:lock');
      errorSpy.mockRestore();
    });

    it('should release lock in finally block when all cleanup tasks fail', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockPrismaService.appointment.updateMany.mockRejectedValue(new Error('DB error 1'));
      mockPrismaService.systemLog.deleteMany.mockRejectedValue(new Error('DB error 2'));
      mockPrismaService.userSession.deleteMany.mockRejectedValue(new Error('DB error 3'));

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(service.handleCron()).resolves.not.toThrow();

      expect(mockCacheService.releaseLock).toHaveBeenCalledWith('retention:cleanup:lock');
      errorSpy.mockRestore();
    });

    it('should continue execution when one task fails (lock acquired)', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockPrismaService.appointment.updateMany.mockRejectedValue(new Error('DB error'));
      mockPrismaService.systemLog.deleteMany.mockResolvedValue({ count: 100 });
      mockPrismaService.userSession.deleteMany.mockResolvedValue({ count: 50 });

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await service.handleCron();

      expect(mockPrismaService.systemLog.deleteMany).toHaveBeenCalled();
      expect(mockPrismaService.userSession.deleteMany).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should handle all tasks failing gracefully (lock acquired)', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockPrismaService.appointment.updateMany.mockRejectedValue(new Error('DB error 1'));
      mockPrismaService.systemLog.deleteMany.mockRejectedValue(new Error('DB error 2'));
      mockPrismaService.userSession.deleteMany.mockRejectedValue(new Error('DB error 3'));

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(service.handleCron()).resolves.not.toThrow();

      expect(errorSpy).toHaveBeenCalledTimes(3);
      errorSpy.mockRestore();
    });
  });
});
