import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  ParseIntPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { CreateUserDto, UpdateUserDto, UserResponseDto } from "./dto/user.dto";
import { ProfileResponseDto } from "./dto/profile-response.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserType } from "@prisma/client";
import { RateLimit } from "../rate-limiter/rate-limiter.decorator";
import { Request } from "express";
import { ClsService } from "nestjs-cls";

interface JwtUser {
  id: string;
  roles?: string[];
  userType?: string;
}

/**
 * 检查请求者是否有权限访问目标用户资源
 * @param reqUser 当前 JWT 认证用户
 * @param targetUserId 目标用户 ID
 * @param actionDescription 操作描述（用于错误消息）
 * @throws ForbiddenException 如果没有权限
 */
function enforceOwnership(
  reqUser: JwtUser | undefined,
  targetUserId: string,
  actionDescription = "access",
): void {
  if (!reqUser) {
    throw new ForbiddenException("User not authenticated");
  }
  const isOwner = reqUser.id === targetUserId;
  const isAdmin =
    reqUser.roles?.includes("ADMIN") || reqUser.roles?.includes("SUPER_ADMIN");
  if (!isOwner && !isAdmin) {
    throw new ForbiddenException(
      `You can only ${actionDescription} your own profile`,
    );
  }
}

@ApiTags("Users")
@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth("JWT-auth")
@RateLimit({ tier: "api", key: "user" })
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly cls: ClsService,
  ) {}

  @Post()
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Create a new user" })
  @ApiResponse({
    status: 201,
    description: "User created successfully",
    type: UserResponseDto,
  })
  @ApiResponse({ status: 409, description: "User with email already exists" })
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Get all users with pagination" })
  @ApiResponse({ status: 200, description: "List of users" })
  async findAll(
    @Query("page", ParseIntPipe) page: number = 1,
    @Query("pageSize", ParseIntPipe) pageSize: number = 10,
  ) {
    return this.usersService.findAll(page, pageSize);
  }

  @Get("profile")
  @ApiOperation({ summary: "获取当前用户资料" })
  @ApiBearerAuth("JWT-auth")
  @ApiResponse({
    status: 200,
    description: "获取成功",
    type: ProfileResponseDto,
  })
  @ApiResponse({ status: 401, description: "未授权" })
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: Request) {
    const user = req.user as JwtUser | undefined;
    if (!user) {
      throw new ForbiddenException("User not authenticated");
    }

    const profile = await this.usersService.getProfile(user.id);

    return {
      statusCode: 200,
      message: "获取成功",
      data: profile,
      timestamp: new Date().toISOString(),
      requestId: this.cls.get("requestId") ?? `req-${crypto.randomUUID()}`,
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user by ID" })
  @ApiResponse({
    status: 200,
    description: "User found",
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async findOne(@Param("id") id: string, @Req() req: Request) {
    // FIX-P0-003 REFACTOR: 使用统一的所有权检查函数
    enforceOwnership(req.user as JwtUser | undefined, id, "access");
    return this.usersService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update user" })
  @ApiResponse({
    status: 200,
    description: "User updated",
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async update(
    @Param("id") id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: Request,
  ) {
    // FIX-P0-003 REFACTOR: 使用统一的所有权检查函数
    enforceOwnership(req.user as JwtUser | undefined, id, "update");
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(":id")
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Delete user" })
  @ApiResponse({ status: 200, description: "User deleted" })
  @ApiResponse({ status: 404, description: "User not found" })
  async remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }

  @Post(":id/change-password")
  @ApiOperation({ summary: "Change user password" })
  @ApiResponse({ status: 200, description: "Password changed" })
  @ApiResponse({ status: 400, description: "Current password is incorrect" })
  async changePassword(
    @Param("id") id: string,
    @Body() body: { oldPassword: string; newPassword: string },
    @Req() req: Request,
  ) {
    // FIX-P0-003 REFACTOR: 使用统一的所有权检查函数
    enforceOwnership(req.user as JwtUser | undefined, id, "change");
    return this.usersService.updatePassword(
      id,
      body.oldPassword,
      body.newPassword,
    );
  }
}
