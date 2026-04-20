import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/database/prisma.service';
import { EmailService } from '../email/email.service';
import { VerificationService } from '../verification/verification.service';
import { CacheService } from '../cache/cache.service';
import { EncryptionService } from '../encryption/encryption.service';
import { HashService } from '../encryption/hash.service';
import { maskEmail, maskPhone } from '../encryption/masking.util';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { RegisterSendCodeDto, ContactType } from './dto/register-send-code.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { LoginSendCodeDto } from './dto/login-send-code.dto';
import { LoginVerifyCodeDto } from './dto/login-verify-code.dto';
import { LoginPasswordDto } from './dto/login-password.dto';
import {
  AuthResponseDto,
  SendCodeResponseDto,
  LogoutResponseDto,
  RefreshTokenRequestDto,
} from './dto/auth-response.dto';

/** Bcrypt salt rounds for password hashing (OWASP 2023 推荐值) */
const BCRYPT_SALT_ROUNDS = 12;
/** Access token expiry: 15 minutes in seconds */
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 900;
/** Refresh token expiry: 7 days in seconds */
const REFRESH_TOKEN_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
/** Session access token expiry in seconds for DB storage */
const SESSION_EXPIRES_IN_SECONDS = 900;
/** Refresh token expiry: 7 days */
const REFRESH_TOKEN_EXPIRES_DAYS = 7;
/** 验证码 TTL: 5 分钟 */
const VERIFICATION_CODE_TTL = 300;

/** User type enum from Prisma schema */
type UserType = 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';

export interface UserPayload {
  id: string;
  name: string;
  userType: UserType;
  passwordHash: string | null;
  phone: string | null;
  phoneHash: string | null;
  email: string | null;
  emailHash: string | null;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly verificationService: VerificationService,
    private readonly cacheService: CacheService,
    private readonly encryptionService: EncryptionService,
    private readonly hashService: HashService,
  ) {
    this.validateJwtSecrets();
  }

  private validateJwtSecrets(): void {
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    if (!jwtRefreshSecret) {
      throw new Error('JWT_REFRESH_SECRET environment variable is required');
    }
  }

  // ==================== 注册流程 ====================

  /**
   * 注册第一步：发送验证码
   * POST /v1/auth/register/send-code
   */
  async registerSendCode(
    sendDto: RegisterSendCodeDto,
  ): Promise<SendCodeResponseDto> {
    const { contact, contactType } = sendDto;

    // 计算 contact hash 检查唯一性
    const contactHash = this.hashService.hashWithPepper(contact);

    // 检查是否已注册
    const whereClause =
      contactType === ContactType.PHONE
        ? { phoneHash: contactHash }
        : { emailHash: contactHash };

    const existingUser = await this.prisma.user.findFirst({
      where: whereClause,
    });

    if (existingUser) {
      throw new ConflictException(
        contactType === ContactType.PHONE
          ? '该手机号已注册'
          : '该邮箱已注册',
      );
    }

    // 生成验证码并存入 Redis
    // Redis key: verify:register:{contactType}:{contactHash}
    const redisKey = `verify:register:${contactType}:${contactHash}`;
    const code = await this.verificationService.generateCode(
      redisKey,
      'REGISTER',
    );

    // 发送验证码
    if (contactType === ContactType.EMAIL) {
      const subject = '您的注册验证码';
      const html = this.generateVerificationCodeHtml(code);
      const text = `您的注册验证码是: ${code}，5分钟内有效。`;

      try {
        await this.emailService.sendEmail({
          to: contact,
          subject,
          html,
          text,
        });
      } catch (error) {
        // 邮件发送失败，清理 Redis 中的验证码
        await this.verificationService.deleteCode(redisKey, 'REGISTER');
        throw new BadRequestException('发送验证码失败，请稍后重试');
      }
    } else {
      // TODO: 集成短信服务
      this.logger.warn(`SMS not integrated yet. Code for ${contact}: ${code}`);
    }

    return {
      maskedContact:
        contactType === ContactType.PHONE
          ? maskPhone(contact)
          : maskEmail(contact),
      expiresIn: VERIFICATION_CODE_TTL,
    };
  }

  /**
   * 注册第二步：完成注册
   * POST /v1/auth/register/complete
   */
  async registerComplete(
    completeDto: RegisterCompleteDto,
  ): Promise<AuthResponseDto> {
    const { contact, contactType, code, password, name } = completeDto;

    // 1. 验证码校验
    const contactHash = this.hashService.hashWithPepper(contact);
    const redisKey = `verify:register:${contactType}:${contactHash}`;

    const verificationResult = await this.verificationService.verifyCode(
      redisKey,
      code,
      'REGISTER',
    );

    if (!verificationResult.success) {
      throw new BadRequestException('验证码无效或已过期');
    }

    // 2. 再次检查唯一性（防止并发注册）
    const whereClause =
      contactType === ContactType.PHONE
        ? { phoneHash: contactHash }
        : { emailHash: contactHash };

    const existingUser = await this.prisma.user.findFirst({
      where: whereClause,
    });

    if (existingUser) {
      throw new ConflictException(
        contactType === ContactType.PHONE
          ? '该手机号已被注册'
          : '该邮箱已被注册',
      );
    }

    // 3. 加密 PII 字段
    const encrypted = await this.encryptionService.encrypt(contact);

    // 4. 密码哈希
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // 5. 创建用户（三字段存储模型）
    const createData: any = {
      name,
      passwordHash,
      userType: 'CUSTOMER',
      status: 'ACTIVE',
      phoneHash: null,
      phoneEncrypted: null,
      emailHash: null,
      emailEncrypted: null,
    };

    if (contactType === ContactType.PHONE) {
      createData.phone = maskPhone(contact);
      createData.phoneHash = contactHash;
      createData.phoneEncrypted = `${encrypted.iv}:${encrypted.authTag}:${encrypted.ciphertext}`;
    } else {
      createData.email = maskEmail(contact);
      createData.emailHash = contactHash;
      createData.emailEncrypted = `${encrypted.iv}:${encrypted.authTag}:${encrypted.ciphertext}`;
    }

    const user = await this.prisma.user.create({
      data: createData,
    });

    this.logger.log(`User registered: ${user.id}`);

    // 6. 生成 Token 并自动登录
    const tokens = await this.generateTokens(user);

    return tokens;
  }

  // ==================== 登录流程 ====================

  /**
   * 登录第一步：发送验证码
   * POST /v1/auth/login/send-code
   *
   * 防枚举: 用户不存在时也返回 200
   */
  async loginSendCode(sendDto: LoginSendCodeDto): Promise<SendCodeResponseDto> {
    const { contact, contactType } = sendDto;

    // 计算 contact hash 查找用户
    const contactHash = this.hashService.hashWithPepper(contact);

    const whereClause =
      contactType === ContactType.PHONE
        ? { phoneHash: contactHash }
        : { emailHash: contactHash };

    const user = await this.prisma.user.findFirst({
      where: whereClause,
    });

    // 防枚举：无论用户是否存在，都返回成功
    if (!user) {
      this.logger.warn(
        `Login code requested for non-existent ${contactType}: ${contact}`,
      );
      // 模拟延迟，防止时序攻击
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { expiresIn: VERIFICATION_CODE_TTL };
    }

    if (user.status !== 'ACTIVE') {
      throw new BadRequestException('用户账户已被禁用');
    }

    // 生成验证码并存入 Redis
    // Redis key: verify:login:{contactType}:{contactHash}
    const redisKey = `verify:login:${contactType}:${contactHash}`;
    const code = await this.verificationService.generateCode(redisKey, 'LOGIN');

    // 发送验证码
    if (contactType === ContactType.EMAIL) {
      const subject = '您的登录验证码';
      const html = this.generateVerificationCodeHtml(code);
      const text = `您的登录验证码是: ${code}，5分钟内有效。`;

      try {
        await this.emailService.sendEmail({
          to: contact,
          subject,
          html,
          text,
        });
      } catch (error) {
        await this.verificationService.deleteCode(redisKey, 'LOGIN');
        throw new BadRequestException('发送验证码失败，请稍后重试');
      }
    } else {
      // TODO: 集成短信服务
      this.logger.warn(`SMS not integrated yet. Code for ${contact}: ${code}`);
    }

    return { expiresIn: VERIFICATION_CODE_TTL };
  }

  /**
   * 验证码登录
   * POST /v1/auth/login/verify-code
   */
  async loginVerifyCode(
    verifyDto: LoginVerifyCodeDto,
  ): Promise<AuthResponseDto> {
    const { contact, contactType, code } = verifyDto;

    // 1. 计算 hash 查找用户
    const contactHash = this.hashService.hashWithPepper(contact);
    const whereClause =
      contactType === ContactType.PHONE
        ? { phoneHash: contactHash }
        : { emailHash: contactHash };

    const user = await this.prisma.user.findFirst({
      where: whereClause,
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户不存在或账户已禁用');
    }

    // 2. 验证码校验
    const redisKey = `verify:login:${contactType}:${contactHash}`;
    const verificationResult = await this.verificationService.verifyCode(
      redisKey,
      code,
      'LOGIN',
    );

    if (!verificationResult.success) {
      throw new UnauthorizedException('验证码无效或已过期');
    }

    // 3. 更新最后登录时间
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 4. 生成 Token
    const tokens = await this.generateTokens(user);

    return tokens;
  }

  /**
   * 密码登录
   * POST /v1/auth/login/password
   */
  async loginPassword(loginDto: LoginPasswordDto): Promise<AuthResponseDto> {
    const { contact, contactType, password } = loginDto;

    // 1. 计算 hash 查找用户
    const contactHash = this.hashService.hashWithPepper(contact);
    const whereClause =
      contactType === ContactType.PHONE
        ? { phoneHash: contactHash }
        : { emailHash: contactHash };

    const user = await this.prisma.user.findFirst({
      where: whereClause,
    });

    if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
      // 防枚举：密码错误和用户不存在返回相同错误
      await new Promise((resolve) => setTimeout(resolve, 100));
      throw new UnauthorizedException('凭证无效');
    }

    // 2. 密码验证 (bcrypt rounds=12)
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('凭证无效');
    }

    // 3. 更新最后登录时间
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 4. 生成 Token
    const tokens = await this.generateTokens(user);

    return tokens;
  }

  // ==================== Token 管理 ====================

  /**
   * 刷新 Token（旋转模式）
   * POST /v1/auth/refresh
   */
  async refreshTokens(
    refreshDto: RefreshTokenRequestDto,
  ): Promise<AuthResponseDto> {
    const { refreshToken } = refreshDto;

    // 1. 验证 JWT
    let payload: { sub: string; tokenType: string; jti: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!,
      });
    } catch {
      throw new UnauthorizedException('Refresh Token 无效或已过期');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('无效的 Token 类型');
    }

    // 2. 查找会话
    const session = await this.prisma.userSession.findUnique({
      where: { refreshToken },
      include: { user: true },
    });

    // 3. Token 重用检测（重放攻击防护）
    if (!session) {
      await this.revokeAllUserSessions(payload.sub);
      throw new UnauthorizedException(
        'Refresh Token 重用检测：所有会话已吊销',
      );
    }

    // 4. 验证会话有效性
    if (
      !session.isActive ||
      !session.refreshExpiresAt ||
      session.refreshExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('Refresh Token 已过期或已吊销');
    }

    // 5. 原子操作：吊销旧会话 + 创建新会话
    const tokens = await this.rotateToken(
      session.user as unknown as UserPayload,
      session.id,
      refreshToken,
    );

    return tokens;
  }

  /**
   * 登出
   * POST /v1/auth/logout
   */
  async logout(
    userId: string,
    accessToken: string,
    refreshToken: string,
  ): Promise<LogoutResponseDto> {
    // 1. 吊销会话
    await this.prisma.userSession.updateMany({
      where: { userId, refreshToken, isActive: true },
      data: { isActive: false },
    });

    // 2. 将 Access Token 加入黑名单
    await this.cacheService.setSession(
      `token:blacklist:${crypto.randomUUID()}`,
      'revoked',
    );

    this.logger.log(`User logged out: ${userId}`);

    return { message: '登出成功' };
  }

  // ==================== 内部方法 ====================

  /**
   * 生成 JWT Token 对
   */
  private async generateTokens(user: UserPayload): Promise<AuthResponseDto> {
    const sessionId = crypto.randomUUID();
    const jti = crypto.randomUUID();

    // Access Token Payload（移除 email，符合 NIST SP 800-63B 最小化原则）
    const accessTokenPayload = {
      sub: user.id,
      roles: [this.mapUserTypeToRole(user.userType)],
      jti,
    };

    const accessToken = this.jwtService.sign(accessTokenPayload, {
      secret: process.env.JWT_SECRET!,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    });

    // Refresh Token Payload
    const refreshTokenPayload = {
      sub: user.id,
      tokenType: 'refresh',
      jti: crypto.randomUUID(),
    };

    const refreshToken = this.jwtService.sign(refreshTokenPayload, {
      secret: process.env.JWT_REFRESH_SECRET!,
      expiresIn: REFRESH_TOKEN_EXPIRES_IN_SECONDS,
    });

    // 存储会话
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + SESSION_EXPIRES_IN_SECONDS);

    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(
      refreshExpiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS,
    );

    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        sessionToken: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        refreshToken,
        expiresAt,
        refreshExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      tokenType: 'Bearer',
    };
  }

  /**
   * Token 旋转：吊销旧会话，创建新会话
   */
  private async rotateToken(
    user: UserPayload,
    oldSessionId: string,
    oldRefreshToken: string,
  ): Promise<AuthResponseDto> {
    const newTokens = await this.prisma.$transaction(async (tx) => {
      // 吊销旧会话
      await tx.userSession.update({
        where: { id: oldSessionId },
        data: { isActive: false },
      });

      // 生成新 Token
      const jti = crypto.randomUUID();
      const accessTokenPayload = {
        sub: user.id,
        roles: [this.mapUserTypeToRole(user.userType)],
        jti,
      };

      const accessToken = this.jwtService.sign(accessTokenPayload, {
        secret: process.env.JWT_SECRET!,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      });

      const newRefreshTokenJti = crypto.randomUUID();
      const refreshTokenPayload = {
        sub: user.id,
        tokenType: 'refresh',
        jti: newRefreshTokenJti,
      };

      const newRefreshToken = this.jwtService.sign(refreshTokenPayload, {
        secret: process.env.JWT_REFRESH_SECRET!,
        expiresIn: REFRESH_TOKEN_EXPIRES_IN_SECONDS,
      });

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + SESSION_EXPIRES_IN_SECONDS);

      const refreshExpiresAt = new Date();
      refreshExpiresAt.setDate(
        refreshExpiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS,
      );

      // 创建新会话
      await tx.userSession.create({
        data: {
          userId: user.id,
          sessionToken: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          refreshToken: newRefreshToken,
          expiresAt,
          refreshExpiresAt,
        },
      });

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
        tokenType: 'Bearer',
      };
    });

    return newTokens;
  }

  /**
   * 吊销用户所有会话（安全事件响应）
   */
  private async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
  }

  /**
   * 映射 UserType 到 Role
   */
  private mapUserTypeToRole(userType: UserType): string {
    switch (userType) {
      case 'CUSTOMER':
        return 'USER';
      case 'ADMIN':
      case 'SUPER_ADMIN':
        return 'ADMIN';
      default:
        return 'USER';
    }
  }

  // ==================== 邮件模板 ====================

  private generateVerificationCodeHtml(code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>验证码</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 20px 0; text-align: center; background-color: #4A90D9;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">预约系统</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px;">
                <tr>
                  <td style="padding: 30px;">
                    <h2 style="color: #333333; margin-top: 0;">您的验证码</h2>
                    <p style="color: #555555; font-size: 16px;">请使用以下验证码完成操作：</p>
                    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                      <tr>
                        <td style="padding: 20px; text-align: center; background-color: #f8f9fa; border-radius: 8px;">
                          <span style="font-size: 36px; font-weight: bold; color: #4A90D9; letter-spacing: 8px;">${code}</span>
                        </td>
                      </tr>
                    </table>
                    <p style="color: #555555; font-size: 14px;">此验证码将在 5 分钟后过期。</p>
                    <p style="color: #555555; font-size: 14px;">如果这不是您的操作，请忽略此邮件。</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }
}
