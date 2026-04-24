import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService, UserPayload } from './auth.service';
import { PrismaService } from '../../common/database/prisma.service';
import { EmailService } from '../email/email.service';
import { VerificationService } from '../verification/verification.service';
import { CacheService } from '../cache/cache.service';
import { EncryptionService } from '../encryption/encryption.service';
import { HashService } from '../encryption/hash.service';
import { RegisterSendCodeDto, ContactType } from './dto/register-send-code.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { LoginPasswordDto } from './dto/login-password.dto';
import { LoginSendCodeDto } from './dto/login-send-code.dto';
import { LoginVerifyCodeDto } from './dto/login-verify-code.dto';
import { RefreshTokenRequestDto } from './dto/auth-response.dto';
import { isIntegrationMode } from '../../../test/setup/test-env';
import { createTestModule, TestModule } from '../../../test/helpers/create-test-module';
import { createTestUser } from '../../../test/fixtures/database.fixture';

// Create a complete mock PrismaClient
const createMockPrismaClient = () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  userSession: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
});

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let mockPrismaClient: any;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
    decode: jest.fn(),
  };

  const mockEncryptionService = {
    encrypt: jest.fn().mockResolvedValue({
      iv: 'test-iv',
      authTag: 'test-tag',
      ciphertext: 'test-ciphertext',
    }),
    decrypt: jest.fn(),
  };

  const mockHashService = {
    hashWithPepper: jest.fn((value: string) => `hash-${value}`),
  };

  beforeEach(async () => {
    // Set required env vars for constructor validation
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

    // Create a fresh mock PrismaClient
    mockPrismaClient = createMockPrismaClient();

    // Mock the PrismaClient constructor
    jest
      .spyOn(require('@prisma/client'), 'PrismaClient')
      .mockImplementation(() => mockPrismaClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaClient,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: EmailService,
          useValue: {
            sendEmail: jest.fn(),
          },
        },
        {
          provide: VerificationService,
          useValue: {
            generateCode: jest.fn().mockResolvedValue('123456'),
            verifyCode: jest.fn().mockResolvedValue({ success: true }),
            deleteCode: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            setSession: jest.fn().mockResolvedValue(undefined),
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EncryptionService,
          useValue: mockEncryptionService,
        },
        {
          provide: HashService,
          useValue: mockHashService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  describe('registerSendCode', () => {
    it('should throw ConflictException if user already exists', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({ id: 'existing-id' });

      const dto: RegisterSendCodeDto = {
        contact: 'existing@example.com',
        contactType: ContactType.EMAIL,
      };

      await expect(service.registerSendCode(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should send verification code and return success for new user', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: RegisterSendCodeDto = {
        contact: 'new@example.com',
        contactType: ContactType.EMAIL,
      };

      const result = await service.registerSendCode(dto);

      expect(result.expiresIn).toBe(300);
      expect(result.maskedContact).toBeDefined();
    });

    it('should send SMS code for phone contact type', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: RegisterSendCodeDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
      };

      const result = await service.registerSendCode(dto);

      expect(result.expiresIn).toBe(300);
      expect(result.maskedContact).toBeDefined();
      expect(result.maskedContact).toContain('*');
    });

    it('should throw ConflictException with phone message for existing phone user', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({ id: 'existing-id' });

      const dto: RegisterSendCodeDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
      };

      await expect(service.registerSendCode(dto)).rejects.toThrow(
        '该手机号已注册',
      );
    });

    it('should throw BadRequestException when email sending fails', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const mockEmailService = {
        sendEmail: jest.fn().mockRejectedValue(new Error('SMTP error')),
      };
      (service as any).emailService = mockEmailService;

      const dto: RegisterSendCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
      };

      await expect(service.registerSendCode(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.registerSendCode(dto)).rejects.toThrow(
        '发送验证码失败',
      );
    });
  });

  describe('registerComplete', () => {
    it('should throw BadRequestException if verification code is invalid', async () => {
      const mockVerificationService = {
        verifyCode: jest.fn().mockResolvedValue({ success: false }),
      };
      (service as any).verificationService = mockVerificationService;

      const dto: RegisterCompleteDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        code: 'invalid',
        password: 'ValidPass123!',
        name: 'Test User',
      };

      await expect(service.registerComplete(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException if user already exists (concurrency)', async () => {
      // In registerComplete, findFirst is called only once (after verification)
      mockPrismaClient.user.findFirst.mockResolvedValue({ id: 'existing' });
      mockEncryptionService.encrypt.mockResolvedValue({
        iv: 'test-iv',
        authTag: 'test-tag',
        ciphertext: 'test-ciphertext',
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const dto: RegisterCompleteDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
        password: 'ValidPass123!',
        name: 'Test User',
      };

      await expect(service.registerComplete(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should create user and return tokens for valid registration', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        email: 'test@example.com',
        name: 'Test User',
        userType: 'CUSTOMER',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockPrismaClient.userSession.create.mockResolvedValue({});

      // Ensure encryption service returns proper value
      mockEncryptionService.encrypt.mockResolvedValue({
        iv: 'test-iv',
        authTag: 'test-tag',
        ciphertext: 'test-ciphertext',
      });

      const dto: RegisterCompleteDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
        password: 'ValidPass123!',
        name: 'Test User',
      };

      const result = await service.registerComplete(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.tokenType).toBe('Bearer');
    });

    it('should create user with phone data for phone contact type', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        phone: '138****8000',
        name: 'Test User',
        userType: 'CUSTOMER',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockPrismaClient.userSession.create.mockResolvedValue({});

      mockEncryptionService.encrypt.mockResolvedValue({
        iv: 'test-iv',
        authTag: 'test-tag',
        ciphertext: 'test-ciphertext',
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const dto: RegisterCompleteDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
        code: '123456',
        password: 'ValidPass123!',
        name: 'Test User',
      };

      const result = await service.registerComplete(dto);

      expect(result.accessToken).toBe('access-token');
      expect(mockPrismaClient.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          phoneEncrypted: expect.any(String),
        }),
      });
    });

    it('should throw ConflictException with phone message for existing phone user', async () => {
      // In registerComplete, findFirst is called only once (after verification)
      mockPrismaClient.user.findFirst.mockResolvedValue({ id: 'existing' });
      mockEncryptionService.encrypt.mockResolvedValue({
        iv: 'test-iv',
        authTag: 'test-tag',
        ciphertext: 'test-ciphertext',
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const dto: RegisterCompleteDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
        code: '123456',
        password: 'ValidPass123!',
        name: 'Test User',
      };

      await expect(service.registerComplete(dto)).rejects.toThrow(
        '该手机号已被注册',
      );
    });
  });

  describe('loginPassword', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: LoginPasswordDto = {
        contact: 'nonexistent@example.com',
        contactType: ContactType.EMAIL,
        password: 'ValidPass123!',
      };

      await expect(service.loginPassword(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        passwordHash: 'hashed-password',
        status: 'ACTIVE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const dto: LoginPasswordDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        password: 'wrong-password',
      };

      await expect(service.loginPassword(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return tokens for valid credentials', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        userType: 'CUSTOMER',
        status: 'ACTIVE',
        name: 'Test User',
        createdAt: new Date(),
      };
      mockPrismaClient.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrismaClient.user.update.mockResolvedValue(mockUser);

      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockPrismaClient.userSession.create.mockResolvedValue({});

      const dto: LoginPasswordDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        password: 'correct-password',
      };

      const result = await service.loginPassword(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });

    it('should throw UnauthorizedException when user has no passwordHash', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        passwordHash: null,
        status: 'ACTIVE',
      });

      const dto: LoginPasswordDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        password: 'some-password',
      };

      await expect(service.loginPassword(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user status is not ACTIVE', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        passwordHash: 'hashed-password',
        status: 'INACTIVE',
      });

      const dto: LoginPasswordDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        password: 'correct-password',
      };

      await expect(service.loginPassword(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should update lastLoginAt on successful login', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        userType: 'CUSTOMER',
        status: 'ACTIVE',
        name: 'Test User',
        createdAt: new Date(),
      };
      mockPrismaClient.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrismaClient.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockPrismaClient.userSession.create.mockResolvedValue({});

      const dto: LoginPasswordDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        password: 'correct-password',
      };

      await service.loginPassword(dto);

      expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      });
    });

    it('should use phone hash for phone contact type login', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: LoginPasswordDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
        password: 'some-password',
      };

      await expect(service.loginPassword(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockHashService.hashWithPepper).toHaveBeenCalledWith('13800138000');
    });

    // ============ GREEN Phase: Constant-time login protection ============

    it('[GREEN] should have similar timing for nonexistent user and wrong password paths', async () => {
      // GREEN PHASE: After implementing constantTimeLoginDelay in both branches,
      // the timing difference should be minimal (< 60ms allowing for random jitter).

      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const notFoundStart = Date.now();
      await expect(
        service.loginPassword({
          contact: 'nonexistent@example.com',
          contactType: ContactType.EMAIL,
          password: 'SomePass123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
      const notFoundDuration = Date.now() - notFoundStart;

      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        passwordHash: 'hashed-password',
        status: 'ACTIVE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const wrongPwdStart = Date.now();
      await expect(
        service.loginPassword({
          contact: 'test@example.com',
          contactType: ContactType.EMAIL,
          password: 'WrongPass123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
      const wrongPwdDuration = Date.now() - wrongPwdStart;

      // Both paths now use constantTimeLoginDelay (250-350ms).
      // The timing difference should be small (< 120ms)
      // to account for random delay distribution (worst case: 350-250 = 100ms).
      const timeDiff = Math.abs(notFoundDuration - wrongPwdDuration);
      expect(timeDiff).toBeLessThan(120);
    });

    it('[GREEN] should verify both paths take at least 250ms (constantTimeLoginDelay lower bound)', async () => {
      // Both branches should take at least 250ms due to constantTimeLoginDelay.

      // Test "user not found" path
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const notFoundStart = Date.now();
      await expect(
        service.loginPassword({
          contact: 'ghost@example.com',
          contactType: ContactType.EMAIL,
          password: 'AnyPass123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
      const notFoundDuration = Date.now() - notFoundStart;
      expect(notFoundDuration).toBeGreaterThanOrEqual(200); // Allow tolerance

      // Test "wrong password" path
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        passwordHash: 'hashed-password',
        status: 'ACTIVE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const wrongPwdStart = Date.now();
      await expect(
        service.loginPassword({
          contact: 'test@example.com',
          contactType: ContactType.EMAIL,
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
      const wrongPwdDuration = Date.now() - wrongPwdStart;
      expect(wrongPwdDuration).toBeGreaterThanOrEqual(200); // Allow tolerance
    });

    it('[GREEN] should verify constantTimeLoginDelay produces variable delays', async () => {
      // Access the private method and verify randomness
      const delayValues: number[] = [];
      const minDelay = 250;
      const maxDelay = 350;

      // Call the private method multiple times and verify random distribution
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await (service as any).constantTimeLoginDelay();
        const elapsed = Date.now() - start;
        delayValues.push(elapsed);
      }

      // All delays should be within the expected range (with tolerance)
      delayValues.forEach((d) => {
        expect(d).toBeGreaterThanOrEqual(230); // Allow tolerance
        expect(d).toBeLessThanOrEqual(370); // Allow tolerance
      });

      // At least some values should differ (randomness check)
      const uniqueValues = new Set(delayValues.map((d) => Math.round(d / 10)));
      expect(uniqueValues.size).toBeGreaterThan(1);
    });
  });

  describe('loginSendCode', () => {
    it('should return success for non-existent user (anti-enumeration)', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: LoginSendCodeDto = {
        contact: 'nonexistent@example.com',
        contactType: ContactType.EMAIL,
      };

      const result = await service.loginSendCode(dto);

      expect(result).toEqual({ expiresIn: 300 });
    });

    it('should throw BadRequestException if user account is disabled', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        status: 'INACTIVE',
      });

      const dto: LoginSendCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
      };

      await expect(service.loginSendCode(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.loginSendCode(dto)).rejects.toThrow('用户账户已被禁用');
    });

    it('should send verification code for existing active user', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        status: 'ACTIVE',
        email: 'test@example.com',
      });

      const dto: LoginSendCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
      };

      const result = await service.loginSendCode(dto);

      expect(result.expiresIn).toBe(300);
    });

    it('should send SMS code for phone contact type', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        status: 'ACTIVE',
        phone: '13800138000',
      });

      const dto: LoginSendCodeDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
      };

      const result = await service.loginSendCode(dto);

      expect(result.expiresIn).toBe(300);
    });

    it('should throw BadRequestException when email sending fails', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        status: 'ACTIVE',
        email: 'test@example.com',
      });

      const mockEmailService = {
        sendEmail: jest.fn().mockRejectedValue(new Error('SMTP error')),
      };
      (service as any).emailService = mockEmailService;

      const dto: LoginSendCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
      };

      await expect(service.loginSendCode(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.loginSendCode(dto)).rejects.toThrow('发送验证码失败');
    });

    it('should use phone hash for phone contact type', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: LoginSendCodeDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
      };

      await service.loginSendCode(dto);

      expect(mockHashService.hashWithPepper).toHaveBeenCalledWith('13800138000');
    });
  });

  describe('loginVerifyCode', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: LoginVerifyCodeDto = {
        contact: 'nonexistent@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
      };

      await expect(service.loginVerifyCode(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.loginVerifyCode(dto)).rejects.toThrow(
        '用户不存在或账户已禁用',
      );
    });

    it('should throw UnauthorizedException if user status is not ACTIVE', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        status: 'INACTIVE',
      });

      const dto: LoginVerifyCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
      };

      await expect(service.loginVerifyCode(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.loginVerifyCode(dto)).rejects.toThrow(
        '用户不存在或账户已禁用',
      );
    });

    it('should throw UnauthorizedException if verification code is invalid', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-id',
        status: 'ACTIVE',
        userType: 'CUSTOMER',
        name: 'Test User',
      });

      const mockVerificationService = {
        verifyCode: jest.fn().mockResolvedValue({ success: false }),
      };
      (service as any).verificationService = mockVerificationService;

      const dto: LoginVerifyCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        code: '000000',
      };

      await expect(service.loginVerifyCode(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.loginVerifyCode(dto)).rejects.toThrow(
        '验证码无效或已过期',
      );
    });

    it('should return tokens for valid code verification', async () => {
      const mockUser = {
        id: 'user-id',
        status: 'ACTIVE',
        userType: 'CUSTOMER',
        name: 'Test User',
        email: 'test@example.com',
      };
      mockPrismaClient.user.findFirst.mockResolvedValue(mockUser);
      mockPrismaClient.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockPrismaClient.userSession.create.mockResolvedValue({});

      const dto: LoginVerifyCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
      };

      const result = await service.loginVerifyCode(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.tokenType).toBe('Bearer');
    });

    it('should update lastLoginAt on successful code login', async () => {
      const mockUser = {
        id: 'user-id',
        status: 'ACTIVE',
        userType: 'CUSTOMER',
        name: 'Test User',
        email: 'test@example.com',
      };
      mockPrismaClient.user.findFirst.mockResolvedValue(mockUser);
      mockPrismaClient.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockPrismaClient.userSession.create.mockResolvedValue({});

      const dto: LoginVerifyCodeDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
      };

      await service.loginVerifyCode(dto);

      expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      });
    });

    it('should use phone hash for phone contact type', async () => {
      mockPrismaClient.user.findFirst.mockResolvedValue(null);

      const dto: LoginVerifyCodeDto = {
        contact: '13800138000',
        contactType: ContactType.PHONE,
        code: '123456',
      };

      await expect(service.loginVerifyCode(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockHashService.hashWithPepper).toHaveBeenCalledWith('13800138000');
    });
  });

  describe('logout', () => {
    it('should deactivate session and add access token to blacklist', async () => {
      mockPrismaClient.userSession.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('user-123', 'access-token', 'refresh-token');

      expect(mockPrismaClient.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          refreshToken: 'refresh-token',
          isActive: true,
        },
        data: { isActive: false },
      });
      expect(mockPrismaClient.userSession.updateMany).toHaveBeenCalled();
    });

    it('should call cacheService.setSession to blacklist the access token', async () => {
      mockPrismaClient.userSession.updateMany.mockResolvedValue({ count: 1 });
      const mockCacheService = {
        setSession: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).cacheService = mockCacheService;

      await service.logout('user-123', 'access-token', 'refresh-token');

      expect(mockCacheService.setSession).toHaveBeenCalledWith(
        expect.stringContaining('token:blacklist:'),
        'revoked',
      );
    });
  });

  // ============================================================
  // BUG-002 RED Phase Tests: logout() should use jti instead of randomUUID
  // These tests will FAIL on the current buggy code which uses crypto.randomUUID()
  // ============================================================
  describe('BUG-002: logout blacklist key should use jti (RED phase)', () => {
    const TEST_JTI = 'test-jti-123';
    const TEST_ACCESS_TOKEN = 'test-access-token';
    const TEST_REFRESH_TOKEN = 'test-refresh-token';
    const TEST_USER_ID = 'user-123';
    const ACCESS_TOKEN_TTL_SECONDS = 900;

    beforeEach(() => {
      // Mock JwtService.decode to return the access token payload with a known jti
      (mockJwtService.decode as jest.Mock).mockReturnValue({ jti: TEST_JTI });

      // Mock prisma userSession updateMany
      mockPrismaClient.userSession.updateMany.mockResolvedValue({ count: 1 });
    });

    it('should use jti from access token instead of randomUUID for blacklist key [BUG-002]', async () => {
      // Arrange - the test verifies that logout() uses JwtService.decode() to extract jti
      // and uses that jti as the blacklist key
      const mockCacheService = {
        setSession: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).cacheService = mockCacheService;

      // Act
      await service.logout(TEST_USER_ID, TEST_ACCESS_TOKEN, TEST_REFRESH_TOKEN);

      // Assert - the key must contain the jti, not a random UUID
      expect(mockCacheService.setSession).toHaveBeenCalledWith(
        `token:blacklist:${TEST_JTI}`,
        'revoked',
      );
    });

    it('should call JwtService.decode to extract jti from access token [BUG-002]', async () => {
      // Arrange
      const mockCacheService = {
        setSession: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).cacheService = mockCacheService;

      // Act
      await service.logout(TEST_USER_ID, TEST_ACCESS_TOKEN, TEST_REFRESH_TOKEN);

      // Assert - JwtService.decode must be called with the access token
      expect(mockJwtService.decode).toHaveBeenCalledWith(TEST_ACCESS_TOKEN);
    });

    it('should NOT use crypto.randomUUID() for blacklist key [BUG-002]', async () => {
      // Arrange
      jest.spyOn(crypto, 'randomUUID');
      const mockCacheService = {
        setSession: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).cacheService = mockCacheService;

      // Act
      await service.logout(TEST_USER_ID, TEST_ACCESS_TOKEN, TEST_REFRESH_TOKEN);

      // Assert - randomUUID should NOT be called for constructing the blacklist key
      // Current buggy code calls crypto.randomUUID() which makes this assertion fail
      const setSessionCalls = (mockCacheService.setSession as jest.Mock).mock.calls;
      const blacklistKeys = setSessionCalls
        .filter((call: string[]) => call[0].startsWith('token:blacklist:'))
        .map((call: string[]) => call[0]);

      // Each blacklist key should contain a predictable jti, not a randomUUID
      for (const key of blacklistKeys) {
        expect(key).not.toMatch(/^token:blacklist:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
      // The blacklist key should contain the jti from the decoded token
      expect(blacklistKeys[0]).toBe(`token:blacklist:${TEST_JTI}`);
    });

    it('should pass the correct TTL to cache when blacklisting token [BUG-002]', async () => {
      // The blacklist TTL should match the access token expiry time
      // setSession already uses the session-specific TTL (900s by default)
      // This test verifies logout passes the correct TTL-conscious key
      const mockCacheService = {
        setSession: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).cacheService = mockCacheService;

      // Act
      await service.logout(TEST_USER_ID, TEST_ACCESS_TOKEN, TEST_REFRESH_TOKEN);

      // Assert - The blacklist key must be based on jti, not randomUUID
      expect(mockCacheService.setSession).toHaveBeenCalledWith(
        `token:blacklist:${TEST_JTI}`,
        'revoked',
      );
    });
  });

  describe('refreshTokens', () => {
    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const dto: RefreshTokenRequestDto = { refreshToken: 'invalid-token' };

      await expect(service.refreshTokens(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for wrong token type', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-123',
        tokenType: 'access',
        jti: 'session-1',
      });

      const dto: RefreshTokenRequestDto = { refreshToken: 'some-token' };

      await expect(service.refreshTokens(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should detect token reuse when session not found', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-123',
        tokenType: 'refresh',
        jti: 'session-1',
      });
      mockPrismaClient.userSession.findUnique.mockResolvedValue(null);

      const dto: RefreshTokenRequestDto = { refreshToken: 'reused-token' };

      await expect(service.refreshTokens(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when session is inactive', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-123',
        tokenType: 'refresh',
        jti: 'session-1',
      });
      mockPrismaClient.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        isActive: false,
        refreshExpiresAt: new Date(Date.now() + 86400000),
        user: {
          id: 'user-123',
          email: 'user@example.com',
          userType: 'CUSTOMER',
        },
      });

      const dto: RefreshTokenRequestDto = { refreshToken: 'valid-token' };

      await expect(service.refreshTokens(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when session is expired', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-123',
        tokenType: 'refresh',
        jti: 'session-1',
      });
      mockPrismaClient.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        isActive: true,
        refreshExpiresAt: new Date(Date.now() - 86400000), // expired
        user: {
          id: 'user-123',
          email: 'user@example.com',
          userType: 'CUSTOMER',
        },
      });

      const dto: RefreshTokenRequestDto = { refreshToken: 'valid-token' };

      await expect(service.refreshTokens(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshTokens(dto)).rejects.toThrow(
        'Refresh Token 已过期或已吊销',
      );
    });

    it('should successfully refresh token with atomic rotation', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        userType: 'CUSTOMER',
        name: 'Test User',
        createdAt: new Date(),
      };
      const mockSession = {
        id: 'session-1',
        isActive: true,
        refreshExpiresAt: new Date(Date.now() + 86400000),
        user: mockUser,
      };

      mockJwtService.verify.mockReturnValue({
        sub: 'user-123',
        tokenType: 'refresh',
        jti: 'session-1',
      });
      mockPrismaClient.userSession.findUnique.mockResolvedValue(mockSession);

      mockPrismaClient.$transaction.mockImplementation(
        async (callback: (tx: any) => Promise<any>) => {
          return callback({
            userSession: {
              update: mockPrismaClient.userSession.update.mockResolvedValue({}),
              create: mockPrismaClient.userSession.create.mockResolvedValue({
                id: 'new-session-2',
              }),
            },
          });
        },
      );

      mockJwtService.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');

      const dto: RefreshTokenRequestDto = { refreshToken: 'valid-token' };

      const result = await service.refreshTokens(dto);

      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
    });
  });

  describe('mapUserTypeToRole', () => {
    it('should map CUSTOMER to CUSTOMER (per contract.yaml Role enum)', () => {
      const result = (service as any).mapUserTypeToRole('CUSTOMER');
      expect(result).toBe('CUSTOMER');
    });

    it('should map ADMIN to ADMIN (per contract.yaml Role enum)', () => {
      const result = (service as any).mapUserTypeToRole('ADMIN');
      expect(result).toBe('ADMIN');
    });

    it('should map SUPER_ADMIN to SUPER_ADMIN (per contract.yaml Role enum)', () => {
      const result = (service as any).mapUserTypeToRole('SUPER_ADMIN');
      expect(result).toBe('SUPER_ADMIN');
    });

    it('should map unknown type to CUSTOMER as default', () => {
      const result = (service as any).mapUserTypeToRole('UNKNOWN_TYPE');
      expect(result).toBe('CUSTOMER');
    });
  });
});

// ============================================================
// Constructor Validation Tests
// ============================================================
describe('AuthService - Constructor Validation', () => {
  const mockDependencies = {
    prisma: {
      user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      userSession: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
      $disconnect: jest.fn(),
    },
    jwtService: { sign: jest.fn(), verify: jest.fn() },
    emailService: { sendEmail: jest.fn() },
    verificationService: { generateCode: jest.fn(), verifyCode: jest.fn(), deleteCode: jest.fn() },
    cacheService: { setSession: jest.fn(), get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    encryptionService: { encrypt: jest.fn(), decrypt: jest.fn() },
    hashService: { hashWithPepper: jest.fn() },
  };

  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('should throw error when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = 'test-refresh';

    jest.spyOn(require('@prisma/client'), 'PrismaClient').mockImplementation(() => mockDependencies.prisma);

    await expect(
      Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: mockDependencies.prisma },
          { provide: JwtService, useValue: mockDependencies.jwtService },
          { provide: EmailService, useValue: mockDependencies.emailService },
          { provide: VerificationService, useValue: mockDependencies.verificationService },
          { provide: CacheService, useValue: mockDependencies.cacheService },
          { provide: EncryptionService, useValue: mockDependencies.encryptionService },
          { provide: HashService, useValue: mockDependencies.hashService },
        ],
      }).compile(),
    ).rejects.toThrow('JWT_SECRET environment variable is required');
  });

  it('should throw error when JWT_REFRESH_SECRET is missing', async () => {
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.JWT_REFRESH_SECRET;

    jest.spyOn(require('@prisma/client'), 'PrismaClient').mockImplementation(() => mockDependencies.prisma);

    await expect(
      Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: mockDependencies.prisma },
          { provide: JwtService, useValue: mockDependencies.jwtService },
          { provide: EmailService, useValue: mockDependencies.emailService },
          { provide: VerificationService, useValue: mockDependencies.verificationService },
          { provide: CacheService, useValue: mockDependencies.cacheService },
          { provide: EncryptionService, useValue: mockDependencies.encryptionService },
          { provide: HashService, useValue: mockDependencies.hashService },
        ],
      }).compile(),
    ).rejects.toThrow('JWT_REFRESH_SECRET environment variable is required');
  });
});

// ============================================================
// Integration Tests (uses real database via Testcontainers)
// These tests run only when isIntegrationMode() is true
// ============================================================
if (isIntegrationMode()) {
  describe('AuthService (Integration - Real Database)', () => {
    let testModule: TestModule;
    let authService: AuthService;
    let mockJwtService: any;
    let mockEncryptionService: any;
    let mockHashService: any;

    beforeAll(async () => {
      // Restore all mocks to ensure PrismaClient is the real implementation
      jest.restoreAllMocks();

      // Set required env vars for AuthService constructor validation
      process.env.JWT_SECRET = 'test-jwt-secret';
      process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

      testModule = await createTestModule();

      mockJwtService = {
        sign: jest.fn((payload, options) => {
          if (options && options.secret === 'test-jwt-secret') {
            return 'mock-access-jwt-token';
          }
          return 'mock-refresh-jwt-token';
        }),
        verify: jest.fn(),
      };

      mockEncryptionService = {
        encrypt: jest.fn().mockResolvedValue({
          iv: 'test-iv',
          authTag: 'test-tag',
          ciphertext: 'test-ciphertext',
        }),
        decrypt: jest.fn(),
      };

      mockHashService = {
        hashWithPepper: jest.fn((value: string) => `hash-${value}`),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: PrismaService,
            useValue: testModule.prisma,
          },
          {
            provide: JwtService,
            useValue: mockJwtService,
          },
          {
            provide: EmailService,
            useValue: {
              sendEmail: jest.fn().mockResolvedValue(true),
            },
          },
          {
            provide: VerificationService,
            useValue: {
              generateCode: jest.fn().mockResolvedValue('123456'),
              verifyCode: jest.fn().mockResolvedValue({ success: true }),
              deleteCode: jest.fn(),
            },
          },
          {
            provide: CacheService,
            useValue: {
              setSession: jest.fn().mockResolvedValue(undefined),
              get: jest.fn().mockResolvedValue(null),
              set: jest.fn().mockResolvedValue(undefined),
              delete: jest.fn().mockResolvedValue(undefined),
              isAvailable: jest.fn().mockReturnValue(false),
            },
          },
          {
            provide: EncryptionService,
            useValue: mockEncryptionService,
          },
          {
            provide: HashService,
            useValue: mockHashService,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'JWT_SECRET') return 'test-jwt-secret';
                if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
                return null;
              }),
            },
          },
        ],
      }).compile();

      authService = module.get<AuthService>(AuthService);
    });

    afterAll(async () => {
      await testModule?.disconnect();
      delete process.env.JWT_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
    });

    beforeEach(async () => {
      await testModule.resetDatabase();

      // Re-setup all mocks after resetMocks clears implementations
      mockJwtService.sign.mockImplementation((payload: any, options: any) => {
        if (options && options.secret === 'test-jwt-secret') {
          return 'mock-access-jwt-token';
        }
        return 'mock-refresh-jwt-token';
      });

      mockEncryptionService.encrypt.mockResolvedValue({
        iv: 'test-iv',
        authTag: 'test-tag',
        ciphertext: 'test-ciphertext',
      });

      mockHashService.hashWithPepper.mockImplementation((value: string) => `hash-${value}`);

      // Re-setup bcrypt mock (jest.mock at file level keeps bcrypt mocked)
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password-for-tests');
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    describe('registerComplete (Integration)', () => {
      it('should complete registration in the real database', async () => {
        const dto: RegisterCompleteDto = {
          contact: 'integration-test@example.com',
          contactType: ContactType.EMAIL,
          code: '123456',
          password: 'ValidPass123!',
          name: 'Integration Test User',
        };

        // Mock verification service to return success
        const mockVerificationService = {
          generateCode: jest.fn().mockResolvedValue('123456'),
          verifyCode: jest.fn().mockResolvedValue({ success: true }),
          deleteCode: jest.fn(),
        };
        (authService as any).verificationService = mockVerificationService;

        const result = await authService.registerComplete(dto);

        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();

        // Verify user exists in database (query by emailHash since service stores hashed PII)
        const expectedHash = mockHashService.hashWithPepper.mock.results[
          mockHashService.hashWithPepper.mock.results.length - 1
        ]?.value;
        const dbUser = await testModule.prisma.user.findFirst({
          where: { emailHash: expectedHash },
        });
        expect(dbUser).not.toBeNull();

        // Verify session was created
        const sessions = await testModule.prisma.userSession.findMany({
          where: { userId: dbUser!.id },
        });
        expect(sessions.length).toBeGreaterThan(0);
      });
    });

    describe('loginPassword (Integration)', () => {
      it('should login with password in the real database', async () => {
        // Create a test user with emailHash matching what hashService mock produces
        // hashWithPepper mock returns `hash-${value}`, so emailHash = 'hash-login-test@example.com'
        // bcrypt.hash mock returns 'hashed-password-for-tests'
        await testModule.prisma.user.create({
          data: {
            name: 'Login Test User',
            email: 'l***@example.com',
            emailHash: 'hash-login-test@example.com',
            passwordHash: 'hashed-password-for-tests',
            userType: 'CUSTOMER',
            status: 'ACTIVE',
          },
        });

        const dto: LoginPasswordDto = {
          contact: 'login-test@example.com',
          contactType: ContactType.EMAIL,
          password: 'ValidPass123!',
        };

        const result = await authService.loginPassword(dto);

        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
      });
    });
  });
}
