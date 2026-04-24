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
  ParseIntPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { TimeSlotsService } from "./time-slots.service";
import { CreateTimeSlotDto, UpdateTimeSlotDto } from "./dto/time-slot.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserType } from "@prisma/client";
import { RateLimit } from "../rate-limiter/rate-limiter.decorator";

@ApiTags("Time Slots")
@Controller("time-slots")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
@RateLimit({ tier: "public", key: "ip" })
export class TimeSlotsController {
  constructor(private readonly timeSlotsService: TimeSlotsService) {}

  @Post()
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Create a new time slot" })
  @ApiResponse({ status: 201, description: "Time slot created" })
  @ApiResponse({ status: 409, description: "Time slot already exists" })
  async create(@Body() createTimeSlotDto: CreateTimeSlotDto) {
    return this.timeSlotsService.create(createTimeSlotDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all time slots with pagination" })
  @ApiResponse({ status: 200, description: "List of time slots" })
  async findAll(
    @Query("serviceId") serviceId?: string,
    @Query("isActive") isActive?: boolean,
    @Query("page", ParseIntPipe) page: number = 1,
    @Query("pageSize", ParseIntPipe) pageSize: number = 10,
  ) {
    return this.timeSlotsService.findAll(
      serviceId,
      isActive,
      page,
      pageSize,
    );
  }

  @Get("available")
  @ApiOperation({ summary: "Get available time slots for a service" })
  @ApiResponse({ status: 200, description: "List of available time slots" })
  async getAvailableSlots(
    @Query("serviceId") serviceId: string,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
  ) {
    return this.timeSlotsService.getAvailableSlots(
      serviceId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get time slot by ID" })
  @ApiResponse({ status: 200, description: "Time slot found" })
  @ApiResponse({ status: 404, description: "Time slot not found" })
  async findOne(@Param("id") id: string) {
    return this.timeSlotsService.findOne(id);
  }

  @Patch(":id")
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Update time slot" })
  @ApiResponse({ status: 200, description: "Time slot updated" })
  async update(
    @Param("id") id: string,
    @Body() updateTimeSlotDto: UpdateTimeSlotDto,
  ) {
    return this.timeSlotsService.update(id, updateTimeSlotDto);
  }

  @Delete(":id")
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Delete time slot" })
  @ApiResponse({ status: 200, description: "Time slot deleted" })
  async remove(@Param("id") id: string) {
    return this.timeSlotsService.remove(id);
  }
}
