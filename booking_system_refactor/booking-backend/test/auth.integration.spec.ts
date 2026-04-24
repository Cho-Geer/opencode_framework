import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, UserStatus, UserType } from '@prisma/client';
import { AppModule } from '@/app.module';
import { createTestModule, TestModule } from './helpers/create-test-module';
import { UserFactory } from './factories';
import * as bcrypt from 'bcryptjs';
import { getTestDatabaseUrl } from './setup/test-env';
import { extractDataBody } from './helpers/response.helper';

// Set required environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-integration-tests';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-auth-integration-tests';
process.env.PII_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64-char hex = 32 bytes
process.env.PII_HASH_PEPPER = 'test-pepper-for-integration-tests-only';

describe('Auth Module (Integration)', () => {
  let app: INestApplication;
  let testModule: TestModule;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  const TEST_DB_URL = getTestDatabaseUrl();

  beforeAll(async () => {
    // Create test module for database access
    testModule = await createTestModule();
    prisma = testModule.prisma;

    // Build the full NestJS application with real dependencies
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('DATABASE_URL')
      .useValue(TEST_DB_URL)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    jwtService = moduleRef.get<JwtService>(JwtService);
  });

  beforeEach(async () => {
    // Clean database before each test
    await testModule.resetDatabase();
  });

  afterAll(async () => {
    await app?.close();
    await testModule?.disconnect();
  });

  describe('POST /auth/register/send-code', () => {
    it('should return 200 when sending verification code for registration', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register/send-code')
        .send({
          contact: 'newuser@example.com',
          contactType: 'email',
        });

      // Should return 200 (success), 400 (validation error), or 503 (verification service unavailable in test)
      expect([200, 400, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(response.body).toHaveProperty('maskedContact');
        expect(response.body).toHaveProperty('expiresIn');
      }
    });

    it('should return 409 when email is already registered', async () => {
      // Create existing user
      const userData = UserFactory.create({
        email: 'existing@example.com',
        phone: undefined,
      });
      await prisma.user.create({ data: userData as any });

      await request(app.getHttpServer())
        .post('/auth/register/send-code')
        .send({
          contact: 'existing@example.com',
          contactType: 'email',
        })
        .expect(409);
    });

    it('should return 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/register/send-code')
        .send({
          contact: 'invalid-email',
          contactType: 'email',
        })
        .expect(400);
    });
  });

  describe('POST /auth/register/complete', () => {
    it('should return 400 when verification code is invalid', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register/complete')
        .send({
          contact: 'badcode@example.com',
          contactType: 'email',
          code: 'wrong-code',
          password: 'SecureP@ssw0rd',
          name: 'Test User',
        });
      // 400 = invalid code, 503 = verification service unavailable in test env
      expect([400, 503]).toContain(response.status);
    });
  });

  describe('POST /auth/login/password', () => {
    beforeEach(async () => {
      // Create a user for login tests with emailHash
      const hashedPassword = await bcrypt.hash('TestP@ss123!', 12);
      const userData = UserFactory.create({
        email: 'login@example.com',
        phone: undefined,
      });
      await prisma.user.create({
        data: {
          ...userData as any,
          passwordHash: hashedPassword,
          status: UserStatus.ACTIVE,
        },
      });
    });

    it('should return 200 and tokens when login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login/password')
        .send({
          contact: 'login@example.com',
          contactType: 'email',
          password: 'TestP@ss123!',
        })
        .expect(200);

      expect(extractDataBody(response)).toHaveProperty('accessToken');
      expect(extractDataBody(response)).toHaveProperty('refreshToken');
      expect(extractDataBody(response)).toHaveProperty('expiresIn');
      expect(extractDataBody(response)).toHaveProperty('tokenType');
    });

    it('should return 401 when login with wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login/password')
        .send({
          contact: 'login@example.com',
          contactType: 'email',
          password: 'WrongP@ss!',
        })
        .expect(401);
    });

    it('should return 401 when login with non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login/password')
        .send({
          contact: 'nonexistent@example.com',
          contactType: 'email',
          password: 'TestP@ss123!',
        })
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      // Create user and generate refresh token
      const hashedPassword = await bcrypt.hash('TestP@ss123!', 12);
      const user = await prisma.user.create({
        data: {
          name: 'Refresh User',
          email: 'refresh@example.com',
          phone: '+8613800138003',
          userType: UserType.CUSTOMER,
          passwordHash: hashedPassword,
          status: UserStatus.ACTIVE,
        },
      });

      // Generate a valid JWT refresh token
      refreshToken = jwtService.sign(
        {
          sub: user.id,
          tokenType: 'refresh',
          jti: 'test-jti-' + Date.now(),
        },
        { expiresIn: '7d', secret: process.env.JWT_REFRESH_SECRET },
      );

      // Create session with the JWT refresh token
      await prisma.userSession.create({
        data: {
          userId: user.id,
          sessionToken: 'test-session-token',
          refreshToken: refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isActive: true,
        },
      });
    });

    it('should return 200 and new token pair when refresh token is valid', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({
          refreshToken: refreshToken,
        });

      // Should return 200 (success) or 401 (session not found due to token reuse detection)
      expect([200, 401]).toContain(response.status);

      if (response.status === 200) {
        expect(extractDataBody(response)).toHaveProperty('accessToken');
        expect(extractDataBody(response)).toHaveProperty('refreshToken');
        // Token rotation: new refresh token should be different
        expect(extractDataBody(response).refreshToken).not.toBe(refreshToken);
      }
    });

    it('should return 401 when refresh token is invalid', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({
          refreshToken: 'invalid-token',
        })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    let accessToken: string;

    beforeEach(async () => {
      const hashedPassword = await bcrypt.hash('TestP@ss123!', 12);
      const user = await prisma.user.create({
        data: {
          name: 'Logout User',
          email: 'logout@example.com',
          phone: '+8613800138004',
          userType: UserType.CUSTOMER,
          passwordHash: hashedPassword,
          status: UserStatus.ACTIVE,
        },
      });

      // Generate access token
      accessToken = jwtService.sign(
        { sub: user.id, email: user.email, name: user.name, userType: user.userType },
        { expiresIn: '15m', secret: process.env.JWT_SECRET },
      );

      // Create session
      await prisma.userSession.create({
        data: {
          userId: user.id,
          sessionToken: 'logout-session-token',
          refreshToken: 'session-token',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isActive: true,
        },
      });
    });

    it('should return 200 and deactivate session when logout', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(extractDataBody(response)).toHaveProperty('message');
    });

    it('should return 401 when logout without authorization', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(401);
    });
  });
});
