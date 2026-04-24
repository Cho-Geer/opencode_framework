import {
  IsString,
  IsEnum,
  IsOptional,
  IsEmail,
  IsNotEmpty,
  MaxLength,
  IsUUID,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AppointmentStatus } from "@prisma/client";

export class CreateAppointmentDto {
  @ApiProperty({ description: "Time slot ID" })
  @IsUUID("4", { message: "timeSlotId must be a valid UUID" })
  timeSlotId: string;

  @ApiProperty({ description: "Service ID" })
  @IsUUID("4", { message: "serviceId must be a valid UUID" })
  serviceId: string;

  @ApiProperty({ description: "Customer name" })
  @IsString()
  @IsNotEmpty({ message: "Customer name is required" })
  @MaxLength(100, { message: "Customer name must not exceed 100 characters" })
  customerName: string;

  @ApiProperty({ description: "Customer email" })
  @IsEmail({}, { message: "Invalid email format" })
  @MaxLength(255, { message: "Email must not exceed 255 characters" })
  customerEmail: string;

  @ApiProperty({ description: "Customer phone" })
  @IsString()
  @IsNotEmpty({ message: "Customer phone is required" })
  @MaxLength(20, { message: "Phone must not exceed 20 characters" })
  customerPhone: string;

  @ApiPropertyOptional({ description: "Notes" })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "Notes must not exceed 500 characters" })
  notes?: string;
}

export class UpdateAppointmentDto {
  @ApiPropertyOptional({
    description: "Appointment status",
    enum: AppointmentStatus,
  })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ description: "Cancel reason" })
  @IsOptional()
  @IsString()
  cancelReason?: string;
}

export class AppointmentResponseDto {
  @ApiProperty({ description: "Appointment ID" })
  id: string;

  @ApiProperty({ description: "User ID" })
  userId: string;

  @ApiProperty({ description: "Time slot ID" })
  timeSlotId: string;

  @ApiProperty({ description: "Service ID" })
  serviceId: string;

  @ApiProperty({ description: "Status", enum: AppointmentStatus })
  status: AppointmentStatus;

  @ApiProperty({ description: "Customer name" })
  customerName: string;

  @ApiProperty({ description: "Customer email" })
  customerEmail: string;

  @ApiProperty({ description: "Customer phone" })
  customerPhone: string;

  @ApiPropertyOptional({ description: "Notes" })
  notes?: string;

  @ApiProperty({ description: "Created at" })
  createdAt: Date;

  @ApiProperty({ description: "Updated at" })
  updatedAt: Date;
}
