import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { BullModule } from "@nestjs/bullmq";
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { RequestIdInterceptor } from "./common/interceptors/request-id.interceptor";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { DatabaseModule } from "./common/database/database.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { ServicesModule } from "./modules/services/services.module";
import { AppointmentModule } from "./modules/appointments/appointment.module";
import { TimeSlotsModule } from "./modules/time-slots/time-slots.module";
import { EmailModule } from "./modules/email/email.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { StatsModule } from "./modules/stats/stats.module";
import { HealthModule } from "./modules/health/health.module";
import { RateLimiterModule } from "./modules/rate-limiter/rate-limiter.module";
import { RetentionModule } from "./modules/retention/retention.module";
import { VerificationModule } from "./modules/verification/verification.module";
import { EncryptionModule } from "./modules/encryption/encryption.module";

@Module({
  imports: [
    // CLS (Continuation Local Storage) for request context
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: () => `req-${crypto.randomUUID()}`,
      },
    }),

    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.test", ".env.local", ".env"],
    }),

    // BullMQ (Redis-based queue)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get("REDIS_HOST", "localhost"),
          port: parseInt(config.get("REDIS_PORT", "6379"), 10),
          password: config.get("REDIS_PASSWORD", undefined),
          db: parseInt(config.get("REDIS_DB", "0"), 10),
        },
      }),
    }),

    // Database
    DatabaseModule,

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get("RATE_LIMIT_TTL", 60000),
          limit: config.get("RATE_LIMIT_COUNT", 100),
        },
      ],
    }),

    // Feature modules
    AuthModule,
    UsersModule,
    ServicesModule,
    AppointmentModule,
    TimeSlotsModule,
    EmailModule,
    NotificationsModule,
    StatsModule,
    HealthModule,
    RateLimiterModule,
    RetentionModule,
    VerificationModule,
    EncryptionModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // APP_INTERCEPTOR 执行顺序为"后注册先执行"（栈式）：
    // ResponseInterceptor 最先注册 → 最后执行（包装最终响应）
    // LoggingInterceptor    次先注册 → 次后执行（记录响应时间）
    // RequestIdInterceptor  最后注册 → 第一个执行（设置 requestId 到 CLS）
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
  ],
})
export class AppModule {}
