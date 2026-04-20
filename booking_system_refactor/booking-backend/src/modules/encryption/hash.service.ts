import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * SHA-256 + Pepper 哈希服务
 * 用于 PII 字段的唯一性校验和精确查找
 *
 * 哈希算法: SHA-256(value + PII_HASH_PEPPER)
 *
 * 重要: PII_HASH_PEPPER 不可轮换，一旦修改所有已存储的 hash 值将失效
 */
@Injectable()
export class HashService {
  private readonly logger = new Logger(HashService.name);
  private readonly pepper: string;

  constructor(private readonly configService: ConfigService) {
    this.pepper = this.configService.get<string>('PII_HASH_PEPPER', '');
    if (!this.pepper) {
      throw new Error('PII_HASH_PEPPER environment variable is required');
    }
    this.logger.log('HashService initialized with SHA-256 + Pepper');
  }

  /**
   * 使用 SHA-256 + Pepper 计算哈希值
   * @param value - 原始字符串（如手机号、邮箱）
   * @returns SHA-256 哈希值（Hex 编码，64 字符）
   */
  hashWithPepper(value: string): string {
    return crypto
      .createHash('sha256')
      .update(value + this.pepper)
      .digest('hex');
  }

  /**
   * 生成随机的 Pepper 值（Base64 编码）
   * 用于初始化 PII_HASH_PEPPER 环境变量
   *
   * 警告: 此值一旦设置不可更改，否则所有用户将无法登录
   */
  static generatePepper(): string {
    return crypto.randomBytes(32).toString('base64');
  }
}
