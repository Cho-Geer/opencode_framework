import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { AppointmentsService } from "./appointments.service";
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from "./dto/appointment.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserType, AppointmentStatus } from "@prisma/client";
import { RateLimit } from "../rate-limiter/rate-limiter.decorator";

@ApiTags("Appointments")
@Controller("appointments")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @RateLimit({ tier: "strict", key: "user" })
  @ApiOperation({ summary: "Create a new appointment" })
  @ApiResponse({ status: 201, description: "Appointment created" })
  @ApiResponse({ status: 409, description: "Time slot not available" })
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @Req() req,
  ) {
    const userId = req?.user?.id;
    return this.appointmentsService.create(createAppointmentDto, userId);
  }

  @Get()
  @RateLimit({ tier: "api", key: "user" })
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Get all appointments" })
  @ApiResponse({ status: 200, description: "List of appointments" })
  async findAll(
    @Query("page", ParseIntPipe) page: number = 1,
    @Query("pageSize", ParseIntPipe) pageSize: number = 10,
    @Query("status") status?: AppointmentStatus,
    @Query("userId") userId?: string,
  ) {
    return this.appointmentsService.findAll(
      page,
      pageSize,
      status,
      userId,
    );
  }

  @Get("my")
  @RateLimit({ tier: "api", key: "user" })
  @ApiOperation({ summary: "Get my appointments" })
  @ApiResponse({ status: 200, description: "List of user appointments" })
  async getMyAppointments(
    @Req() req,
    @Query("page", ParseIntPipe) page: number = 1,
    @Query("pageSize", ParseIntPipe) pageSize: number = 10,
  ) {
    const userId = req?.user?.id;
    return this.appointmentsService.findAll(
      page,
      pageSize,
      undefined,
      userId,
    );
  }

  @Get(":id")
  @RateLimit({ tier: "api", key: "user" })
  @ApiOperation({ summary: "Get appointment by ID" })
  @ApiResponse({ status: 200, description: "Appointment found" })
  @ApiResponse({ status: 404, description: "Appointment not found" })
  async findOne(@Param("id") id: string) {
    return this.appointmentsService.findOne(id);
  }

  @Patch(":id")
  @RateLimit({ tier: "strict", key: "user" })
  @ApiOperation({ summary: "Update appointment" })
  @ApiResponse({ status: 200, description: "Appointment updated" })
  async update(
    @Param("id") id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto);
  }

  @Post(":id/cancel")
  @RateLimit({ tier: "strict", key: "user" })
  @ApiOperation({ summary: "Cancel appointment" })
  @ApiResponse({ status: 200, description: "Appointment cancelled" })
  async cancel(@Param("id") id: string, @Body() body: { reason: string }) {
    return this.appointmentsService.cancel(id, body.reason);
  }

  @Delete(":id")
  @RateLimit({ tier: "strict", key: "user" })
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Delete appointment" })
  @ApiResponse({ status: 200, description: "Appointment deleted" })
  async remove(@Param("id") id: string) {
    return this.appointmentsService.remove(id);
  }
}
