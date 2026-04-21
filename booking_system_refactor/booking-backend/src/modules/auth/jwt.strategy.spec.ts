import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/database/prisma.service';

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};

// Mock ConfigService
const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'JWT_SECRET') return 'test-secret-key-for-jwt';
    return undefined;
  }),
};

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: typeof mockConfigService;

  beforeEach(async () => {
    jest.resetAllMocks();

    // Restore ConfigService implementation after reset
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret-key-for-jwt';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const mockPayload = {
      sub: 'user-123',
      email: 'user@example.com',
      userType: 'CUSTOMER',
      iat: 1704067200,
      exp: 1704070800,
    };

    const mockUser = {
      id: 'user-123',
      email: 'user@example.com',
      name: 'John Doe',
      userType: 'CUSTOMER',
      status: 'ACTIVE',
      phone: '1234567890',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    };

    it('should return user object when user is found and active', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await strategy.validate(mockPayload);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockPayload.sub },
        select: expect.any(Object),
      });
      expect(result).toEqual({
        id: mockUser.id,
        name: mockUser.name,
        phone: mockUser.phone,
        email: mockUser.email,
        userType: mockUser.userType,
        roles: undefined,
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate(mockPayload)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(mockPayload)).rejects.toThrow('User not found or inactive');
    });

    it('should throw UnauthorizedException when user status is not ACTIVE', async () => {
      const inactiveUser = { ...mockUser, status: 'INACTIVE' };
      mockPrisma.user.findUnique.mockResolvedValue(inactiveUser);

      await expect(strategy.validate(mockPayload)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(mockPayload)).rejects.toThrow('User not found or inactive');
    });

    it('should throw UnauthorizedException when user status is SUSPENDED', async () => {
      const suspendedUser = { ...mockUser, status: 'SUSPENDED' };
      mockPrisma.user.findUnique.mockResolvedValue(suspendedUser);

      await expect(strategy.validate(mockPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('should return correct user fields for ADMIN type', async () => {
      const adminPayload = { ...mockPayload, sub: 'admin-1', userType: 'ADMIN', roles: ['ADMIN'] };
      const adminUser = { ...mockUser, id: 'admin-1', userType: 'ADMIN', name: 'Admin User' };
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);

      const result = await strategy.validate(adminPayload);

      expect(result).toEqual({
        id: 'admin-1',
        name: 'Admin User',
        phone: adminUser.phone,
        email: adminUser.email,
        userType: 'ADMIN',
        roles: ['ADMIN'],
      });
    });

    it('should return correct user fields for STAFF type', async () => {
      const staffPayload = { ...mockPayload, sub: 'staff-1', userType: 'STAFF', roles: ['STAFF'] };
      const staffUser = { ...mockUser, id: 'staff-1', userType: 'STAFF', name: 'Staff Member' };
      mockPrisma.user.findUnique.mockResolvedValue(staffUser);

      const result = await strategy.validate(staffPayload);

      expect(result).toEqual({
        id: 'staff-1',
        name: 'Staff Member',
        phone: staffUser.phone,
        email: staffUser.email,
        userType: 'STAFF',
        roles: ['STAFF'],
      });
    });

    it('should query database with correct user id from payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await strategy.validate({ ...mockPayload, sub: 'specific-user-id' });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'specific-user-id' },
        select: expect.any(Object),
      });
    });

    it('should return roles from payload when provided', async () => {
      const payloadWithRoles = { ...mockPayload, roles: ['USER', 'PREMIUM'] };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await strategy.validate(payloadWithRoles);

      expect(result.roles).toEqual(['USER', 'PREMIUM']);
    });

    it('should return user with only selected fields (no PII encrypted fields)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await strategy.validate(mockPayload);

      // Verify that the returned object doesn't contain PII encrypted fields
      expect(result).not.toHaveProperty('phoneEncrypted');
      expect(result).not.toHaveProperty('emailEncrypted');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });
});

describe('JwtStrategy - Constructor Validation', () => {
  it('should throw error when JWT_SECRET is missing', async () => {
    const badConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    await expect(
      Test.createTestingModule({
        providers: [
          JwtStrategy,
          {
            provide: ConfigService,
            useValue: badConfigService,
          },
          {
            provide: PrismaService,
            useValue: mockPrisma,
          },
        ],
      }).compile(),
    ).rejects.toThrow('JWT_SECRET environment variable is required');
  });

  it('should initialize successfully when JWT_SECRET is provided', async () => {
    const goodConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'valid-secret';
        return undefined;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: goodConfigService,
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    const strategy = module.get<JwtStrategy>(JwtStrategy);
    expect(strategy).toBeDefined();
  });
});
