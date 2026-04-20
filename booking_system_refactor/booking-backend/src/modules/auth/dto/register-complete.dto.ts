import { IsString, IsEnum, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ContactType } from './register-send-code.dto';

export class RegisterCompleteDto {
  @ApiProperty({
    description: '联系方式（手机号或邮箱原文）',
    example: '13800138000',
  })
  @IsString()
  @IsNotEmpty({ message: 'Contact is required' })
  contact!: string;

  @ApiProperty({
    description: '联系方式类型',
    enum: ContactType,
    example: 'phone',
  })
  @IsEnum(ContactType, { message: 'Contact type must be phone or email' })
  contactType!: ContactType;

  @ApiProperty({
    description: '6位数字验证码',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty({ message: 'Verification code is required' })
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code!: string;

  @ApiProperty({
    description: '密码（至少8个字符）',
    example: 'SecurePass123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @ApiProperty({
    description: '用户姓名',
    example: '张三',
  })
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  name!: string;
}
