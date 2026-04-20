import { ApiProperty } from '@nestjs/swagger';

/**
 * 认证响应 DTO
 * 符合 pii_encryption_contract 规范：不含 user 对象
 */
export class AuthResponseDto {
  @ApiProperty({ description: 'JWT Access Token' })
  accessToken!: string;

  @ApiProperty({ description: 'JWT Refresh Token' })
  refreshToken!: string;

  @ApiProperty({ description: 'Access Token 过期时间（秒）', example: 900 })
  expiresIn!: number;

  @ApiProperty({ description: 'Token 类型', example: 'Bearer' })
  tokenType!: string;
}

/**
 * Refresh Token 请求 DTO
 */
export class RefreshTokenRequestDto {
  @ApiProperty({ description: 'Refresh Token' })
  refreshToken!: string;
}

/**
 * 登出响应 DTO
 */
export class LogoutResponseDto {
  @ApiProperty({ description: '登出成功消息', example: '登出成功' })
  message!: string;
}

/**
 * 发送验证码响应 DTO
 */
export class SendCodeResponseDto {
  @ApiProperty({
    description: '脱敏后的联系方式',
    example: '138****5678',
    required: false,
  })
  maskedContact?: string;

  @ApiProperty({ description: '验证码过期时间（秒）', example: 300 })
  expiresIn!: number;
}
