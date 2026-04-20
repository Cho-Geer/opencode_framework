import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UserType, UserStatus } from '@prisma/client';
import { HashService } from '../encryption/hash.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashService: HashService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    // 检查用户是否已存在（使用 hash 查找）
    if (createUserDto.email) {
      const emailHash = this.hashService.hashWithPepper(createUserDto.email);
      const existingUser = await this.prisma.user.findUnique({
        where: { emailHash },
      });

      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }
    }

    if (createUserDto.phone) {
      const phoneHash = this.hashService.hashWithPepper(createUserDto.phone);
      const existingUser = await this.prisma.user.findUnique({
        where: { phoneHash },
      });

      if (existingUser) {
        throw new ConflictException('User with this phone already exists');
      }
    }

    // 创建用户
    return this.prisma.user.create({
      data: {
        name: createUserDto.name,
        userType: createUserDto.userType || UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
      select: this.getSafeUserSelect(),
    });
  }

  async findAll(page = 1, pageSize = 10) {
    const skip = (page - 1) * pageSize;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: pageSize,
        select: this.getSafeUserSelect(),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);

    return {
      data: users,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.getSafeUserSelect(),
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  /**
   * 通过邮箱 hash 查找用户
   * 响应中使用脱敏值
   */
  async findByEmailHash(email: string) {
    const emailHash = this.hashService.hashWithPepper(email);
    return this.prisma.user.findUnique({
      where: { emailHash },
      select: this.getSafeUserSelect(),
    });
  }

  /**
   * 通过手机号 hash 查找用户
   * 响应中使用脱敏值
   */
  async findByPhoneHash(phone: string) {
    const phoneHash = this.hashService.hashWithPepper(phone);
    return this.prisma.user.findUnique({
      where: { phoneHash },
      select: this.getSafeUserSelect(),
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    // 检查用户是否存在
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // 如果更新邮箱，检查唯一性（使用 hash）
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const emailHash = this.hashService.hashWithPepper(updateUserDto.email);
      const existingUser = await this.prisma.user.findUnique({
        where: { emailHash },
      });
      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }
    }

    // 如果更新手机号，检查唯一性（使用 hash）
    if (updateUserDto.phone && updateUserDto.phone !== user.phone) {
      const phoneHash = this.hashService.hashWithPepper(updateUserDto.phone);
      const existingUser = await this.prisma.user.findUnique({
        where: { phoneHash },
      });
      if (existingUser) {
        throw new ConflictException('User with this phone already exists');
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: updateUserDto,
      select: this.getSafeUserSelect(),
    });
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }

  async updatePassword(id: string, oldPassword: string, newPassword: string) {
    throw new BadRequestException('Password management is not supported in the current user model. Please use the authentication service.');
  }

  /**
   * 安全的用户字段选择器
   * 排除: phoneEncrypted, emailEncrypted, passwordHash
   */
  private getSafeUserSelect() {
    return {
      id: true,
      name: true,
      phone: true, // 脱敏值
      email: true, // 脱敏值
      userType: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      remarks: true,
      deviceInfo: true,
    };
  }
}
