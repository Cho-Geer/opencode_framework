import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { HashService } from './hash.service';

@Module({
  providers: [EncryptionService, HashService],
  exports: [EncryptionService, HashService],
})
export class EncryptionModule {}
