import { PrismaClient } from "@prisma/client";
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Force database URL from environment at runtime
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }

  /**
   * Initialize the Prisma client connection when the module is loaded.
   */
  async onModuleInit() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      this.logger.warn("DATABASE_URL is not set");
    } else if (process.env.NODE_ENV !== "production") {
      // In non-production environments, log the host info only (safely)
      try {
        const url = new URL(dbUrl);
        this.logger.log(
          `Connecting to database at ${url.host}${url.pathname}`,
        );
      } catch {
        this.logger.log("Connecting to database...");
      }
    } else {
      this.logger.log("Connecting to database...");
    }
    await this.$connect();
  }

  /**
   * Disconnect the Prisma client when the module is destroyed.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
