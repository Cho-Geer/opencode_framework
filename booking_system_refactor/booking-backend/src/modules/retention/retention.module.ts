import { Module } from "@nestjs/common";
import { RetentionService } from "./retention.service";
import { DatabaseModule } from "../../common/database/database.module";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [DatabaseModule, CacheModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
