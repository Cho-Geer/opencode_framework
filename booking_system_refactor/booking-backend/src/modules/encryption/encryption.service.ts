import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * AES-256-GCM 加密/解密服务
 * 用于 PII 字段（phone、email）的应用层加密
 *
 * 加密格式:
 * - IV: 16 bytes (Base64)
 * - Auth Tag: 16 bytes (Base64)
 * - Ciphertext: 变长 (Base64)
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly encryptionKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const keyBase64 = this.configService.get<string>('PII_ENCRYPTION_KEY');
    if (!keyBase64) {
      throw new Error('PII_ENCRYPTION_KEY environment variable is required');
    }
    // 支持 32 字节 raw key 或 Base64 编码的 key
    if (keyBase64.length === 64) {
      // Hex encoded 32-byte key
      this.encryptionKey = Buffer.from(keyBase64, 'hex');
    } else {
      // Base64 encoded key
      this.encryptionKey = Buffer.from(keyBase64, 'base64');
    }

    if (this.encryptionKey.length !== 32) {
      throw new Error(
        `PII_ENCRYPTION_KEY must be 32 bytes, got ${this.encryptionKey.length} bytes`,
      );
    }

    this.logger.log('EncryptionService initialized with AES-256-GCM');
  }

  /**
   * 使用 AES-256-GCM 加密明文
   * @param plaintext - 待加密的原始字符串
   * @returns 加密结果，包含 IV、Auth Tag 和密文（均为 Base64 编码）
   */
  async encrypt(plaintext: string): Promise<EncryptedPayload> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext,
    };
  }

  /**
   * 使用 AES-256-GCM 解密密文
   * @param iv - Base64 编码的初始化向量
   * @param authTag - Base64 编码的认证标签
   * @param ciphertext - Base64 编码的密文
   * @returns 解密后的原始字符串
   */
  async decrypt(
    iv: string,
    authTag: string,
    ciphertext: string,
  ): Promise<string> {
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.encryptionKey,
      Buffer.from(iv, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  }

  /**
   * 生成 32 字节的随机加密密钥（Base64 编码）
   * 用于初始化 PII_ENCRYPTION_KEY 环境变量
   */
  static generateKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }
}
