import { IsString, IsEnum, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { ContactType } from "./register-send-code.dto";
import { IsStrongPassword } from "../../../common/validators/password.validator";

export class LoginPasswordDto {
  @ApiProperty({
    description: "联系方式（手机号或邮箱原文）",
    example: "13800138000",
  })
  @IsString()
  @IsNotEmpty({ message: "Contact is required" })
  contact!: string;

  @ApiProperty({
    description: "联系方式类型",
    enum: ContactType,
    example: "phone",
  })
  @IsEnum(ContactType, { message: "Contact type must be phone or email" })
  contactType!: ContactType;

  @ApiProperty({
    description:
      "密码（至少12个字符，包含大小写字母、数字、特殊字符）",
    example: "SecurePass123!",
    minLength: 12,
  })
  @IsString()
  @IsStrongPassword({
    message: "Password does not meet security requirements",
  })
  password!: string;
}
