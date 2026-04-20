import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterSendCodeDto } from './dto/register-send-code.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { LoginSendCodeDto } from './dto/login-send-code.dto';
import { LoginVerifyCodeDto } from './dto/login-verify-code.dto';
import { LoginPasswordDto } from './dto/login-password.dto';
import { RefreshTokenRequestDto } from './dto/auth-response.dto';
import {
  AuthResponseDto,
  SendCodeResponseDto,
  LogoutResponseDto,
} from './dto/auth-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../rate-limiter/rate-limiter.decorator';

@ApiTags('authentication')
@Controller('auth')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ==================== 注册流程 ====================

  @Public()
  @Post('register/send-code')
  @RateLimit({ tier: 'auth', key: 'email' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '注册第一步：发送验证码' })
  @ApiBody({ type: RegisterSendCodeDto })
  @ApiResponse({
    status: 200,
    description: '验证码发送成功',
    type: SendCodeResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: '手机号/邮箱已注册',
  })
  @ApiResponse({
    status: 429,
    description: '超出限流',
  })
  async registerSendCode(
    @Body() sendDto: RegisterSendCodeDto,
  ): Promise<SendCodeResponseDto> {
    return this.authService.registerSendCode(sendDto);
  }

  @Public()
  @Post('register/complete')
  @RateLimit({ tier: 'auth', key: 'ip' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '注册第二步：完成注册' })
  @ApiBody({ type: RegisterCompleteDto })
  @ApiResponse({
    status: 201,
    description: '注册成功，返回 Token 对',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '验证码无效或已过期',
  })
  @ApiResponse({
    status: 409,
    description: '手机号/邮箱已注册（并发）',
  })
  async registerComplete(
    @Body() completeDto: RegisterCompleteDto,
  ): Promise<AuthResponseDto> {
    return this.authService.registerComplete(completeDto);
  }

  // ==================== 登录流程 ====================

  @Public()
  @Post('login/send-code')
  @RateLimit({ tier: 'auth', key: 'email' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录第一步：发送验证码' })
  @ApiBody({ type: LoginSendCodeDto })
  @ApiResponse({
    status: 200,
    description: '验证码发送成功（防枚举，用户不存在也返回 200）',
    type: SendCodeResponseDto,
  })
  async loginSendCode(
    @Body() sendDto: LoginSendCodeDto,
  ): Promise<SendCodeResponseDto> {
    return this.authService.loginSendCode(sendDto);
  }

  @Public()
  @Post('login/verify-code')
  @RateLimit({ tier: 'auth', key: 'email' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '验证码登录' })
  @ApiBody({ type: LoginVerifyCodeDto })
  @ApiResponse({
    status: 200,
    description: '登录成功，返回 Token 对',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '验证码无效或已过期',
  })
  @ApiResponse({
    status: 404,
    description: '用户不存在',
  })
  async loginVerifyCode(
    @Body() verifyDto: LoginVerifyCodeDto,
  ): Promise<AuthResponseDto> {
    return this.authService.loginVerifyCode(verifyDto);
  }

  @Public()
  @Post('login/password')
  @RateLimit({ tier: 'auth', key: 'email' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '密码登录' })
  @ApiBody({ type: LoginPasswordDto })
  @ApiResponse({
    status: 200,
    description: '登录成功，返回 Token 对',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '凭证无效',
  })
  @ApiResponse({
    status: 429,
    description: '超出限流',
  })
  async loginPassword(
    @Body() loginDto: LoginPasswordDto,
  ): Promise<AuthResponseDto> {
    return this.authService.loginPassword(loginDto);
  }

  // ==================== Token 管理 ====================

  @Public()
  @Post('refresh')
  @RateLimit({ tier: 'auth', key: 'ip' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 Token（旋转模式）' })
  @ApiBody({ type: RefreshTokenRequestDto })
  @ApiResponse({
    status: 200,
    description: '刷新成功，返回新 Token 对',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh Token 无效或已过期',
  })
  async refreshTokens(
    @Body() refreshDto: RefreshTokenRequestDto,
  ): Promise<AuthResponseDto> {
    return this.authService.refreshTokens(refreshDto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登出' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 200,
    description: '登出成功',
    type: LogoutResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '未认证',
  })
  async logout(
    @Headers('Authorization') authHeader: string,
  ): Promise<LogoutResponseDto> {
    const token = authHeader?.replace('Bearer ', '') || '';
    // Extract userId from JWT payload in production
    // For now, placeholder
    const userId = 'temp-user-id';
    return this.authService.logout(userId, token, token);
  }
}
