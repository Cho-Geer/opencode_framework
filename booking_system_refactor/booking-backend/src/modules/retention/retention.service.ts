import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service";
import { CacheService } from "../cache/cache.service";
import {
  withDistributedLock,
  processSettledResults,
} from "../../common/utils/lock.util";

export interface RetentionConfig {
  appointmentRetentionDays: number;
  systemLogRetentionDays: number;
  sessionRetentionDays: number;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly config: RetentionConfig = {
    appointmentRetentionDays: 90,
    systemLogRetentionDays: 30,
    sessionRetentionDays: 30,
  };

  private readonly LOCK_KEY = "retention:cleanup:lock";
  private readonly LOCK_TTL = 3600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron(): Promise<void> {
    await withDistributedLock(
      this.cacheService,
      { key: this.LOCK_KEY, ttl: this.LOCK_TTL, logger: this.logger },
      async () => {
        this.logger.log("Starting daily data retention cleanup...");

        const results = await Promise.allSettled([
          this.cleanupExpiredAppointments(),
          this.cleanupOldSystemLogs(),
          this.cleanupInactiveSessions(),
        ]);

        processSettledResults(results, [
          "Archived expired appointments",
          "Deleted old system logs",
          "Cleaned inactive sessions",
        ], this.logger);

        this.logger.log("Daily data retention cleanup completed");
      },
    );
  }

  async cleanupExpiredAppointments(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(
      cutoffDate.getDate() - this.config.appointmentRetentionDays,
    );

    const result = await this.prisma.appointment.updateMany({
      where: {
        status: {
          in: ["COMPLETED", "CANCELLED", "EXPIRED"],
        },
        updatedAt: {
          lt: cutoffDate,
        },
      },
      data: {
        remarks: "[ARCHIVED] Data retention cleanup",
      },
    });

    this.logger.log(
      `Archived ${result.count} expired appointments older than ${cutoffDate.toISOString()}`,
    );
    return result.count;
  }

  async cleanupOldSystemLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(
      cutoffDate.getDate() - this.config.systemLogRetentionDays,
    );

    const result = await this.prisma.systemLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(
      `Deleted ${result.count} system logs older than ${cutoffDate.toISOString()}`,
    );
    return result.count;
  }

  async cleanupInactiveSessions(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.sessionRetentionDays);

    const result = await this.prisma.userSession.deleteMany({
      where: {
        OR: [
          {
            isActive: false,
            createdAt: {
              lt: cutoffDate,
            },
          },
          {
            expiresAt: {
              lt: new Date(),
            },
          },
        ],
      },
    });

    this.logger.log(
      `Deleted ${result.count} inactive sessions older than ${cutoffDate.toISOString()}`,
    );
    return result.count;
  }

  async cleanupOldActivityLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(
      cutoffDate.getDate() - this.config.systemLogRetentionDays,
    );

    const result = await this.prisma.activityLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(
      `Deleted ${result.count} activity logs older than ${cutoffDate.toISOString()}`,
    );
    return result.count;
  }

  getConfig(): RetentionConfig {
    return { ...this.config };
  }
}
