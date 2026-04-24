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
import { ServicesService } from "./services.service";
import { CreateServiceDto, UpdateServiceDto } from "./dto/service.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserType } from "@prisma/client";
import { RateLimit } from "../rate-limiter/rate-limiter.decorator";

@ApiTags("Services")
@Controller("services")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
@RateLimit({ tier: "public", key: "ip" })
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Create a new service" })
  @ApiResponse({ status: 201, description: "Service created" })
  async create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all services with pagination" })
  @ApiResponse({ status: 200, description: "List of services" })
  async findAll(
    @Query("page", ParseIntPipe) page: number = 1,
    @Query("pageSize", ParseIntPipe) pageSize: number = 10,
    @Query("isActive") isActive?: boolean,
  ) {
    return this.servicesService.findAll(
      page,
      pageSize,
      isActive,
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get service by ID" })
  @ApiResponse({ status: 200, description: "Service found" })
  @ApiResponse({ status: 404, description: "Service not found" })
  async findOne(@Param("id") id: string) {
    return this.servicesService.findOne(id);
  }

  @Patch(":id")
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Update service" })
  @ApiResponse({ status: 200, description: "Service updated" })
  async update(
    @Param("id") id: string,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    return this.servicesService.update(id, updateServiceDto);
  }

  @Delete(":id")
  @Roles(UserType.ADMIN)
  @ApiOperation({ summary: "Delete service" })
  @ApiResponse({ status: 200, description: "Service deleted" })
  async remove(@Param("id") id: string) {
    return this.servicesService.remove(id);
  }
}
