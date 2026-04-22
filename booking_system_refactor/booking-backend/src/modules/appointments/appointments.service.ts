import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { EmailService } from "../email/email.service";
import { NotificationService } from "../notifications/notification.service";
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from "./dto/appointment.dto";
import { AppointmentStatus, Prisma } from "@prisma/client";

// Configuration constants for high-concurrency slot preemption
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 100;

export interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Create a new appointment with atomic slot preemption for high-concurrency safety.
   * Uses optimistic locking with currentSequence field and exponential backoff retry.
   *
   * Flow:
   * 1. Check if time slot exists and is available
   * 2. Attempt atomic slot reservation with optimistic locking (up to 3 retries)
   * 3. Create appointment in ReadCommitted transaction
   * 4. Send confirmation notifications
   *
   * @param createAppointmentDto - Appointment creation data
   * @returns The created appointment with related entities
   */
  async create(createAppointmentDto: CreateAppointmentDto) {
    // Check if time slot exists and is available
    const timeSlot = await this.prisma.timeSlot.findUnique({
      where: { id: createAppointmentDto.timeSlotId },
    });

    if (!timeSlot) {
      throw new NotFoundException("Time slot not found");
    }

    if (!timeSlot.isActive) {
      throw new ConflictException("Time slot is not available");
    }

    // Attempt atomic slot preemption with retry logic
    const appointment = await this.atomicCreateAppointment(
      createAppointmentDto,
      timeSlot.currentSequence,
    );

    // Extract customer info from JSON
    const customerInfo = appointment.customerInfo as unknown as CustomerInfo;

    // Queue appointment confirmation email
    try {
      await this.emailService.sendAppointmentConfirmation({
        appointmentId: appointment.id,
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
        serviceName: appointment.service.name,
        date: appointment.timeSlot.slotTime.split("T")[0],
        time: appointment.timeSlot.slotTime,
      });
    } catch (error) {
      // Log but don't fail the appointment creation if email queuing fails
      console.error("Failed to queue appointment confirmation email:", error);
    }

    // Send real-time booking confirmation notification
    try {
      this.notificationService.notifyBookingConfirmation({
        appointmentId: appointment.id,
        userId: appointment.userId,
        serviceName: appointment.service.name,
        date: appointment.timeSlot.slotTime.split("T")[0],
        time: appointment.timeSlot.slotTime,
        status: appointment.status,
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
      });
    } catch (error) {
      // Log but don't fail the appointment creation if notification fails
      console.error("Failed to send booking confirmation notification:", error);
    }

    return appointment;
  }

  /**
   * Atomically create an appointment with optimistic locking and retry logic.
   * Prevents double-booking in high-concurrency scenarios.
   */
  private async atomicCreateAppointment(
    createAppointmentDto: CreateAppointmentDto,
    initialSequence: number,
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const targetSeq = initialSequence + attempt;

      try {
        const appointment = await this.prisma.$transaction(
          async (tx) => {
            // Atomic slot reservation using optimistic locking
            const updateResult = await tx.timeSlot.updateMany({
              where: {
                id: createAppointmentDto.timeSlotId,
                isActive: true,
                currentSequence: targetSeq,
              },
              data: {
                currentSequence: { increment: 1 },
              },
            });

            if (updateResult.count === 0) {
              // Collision detected - slot already taken or sequence mismatch
              return { success: false as const, reason: "VERSION_CONFLICT" };
            }

            // Slot claimed successfully - create appointment
            const newAppointment = await tx.appointment.create({
              data: {
                userId: createAppointmentDto.userId,
                timeSlotId: createAppointmentDto.timeSlotId,
                serviceId: createAppointmentDto.serviceId,
                customerInfo: {
                  name: createAppointmentDto.customerName,
                  email: createAppointmentDto.customerEmail,
                  phone: createAppointmentDto.customerPhone,
                },
                remarks: createAppointmentDto.notes,
                status: AppointmentStatus.PENDING,
                appointmentDate: new Date(),
                slotSequence: targetSeq,
                appointmentNumber: `APT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              },
              include: {
                timeSlot: true,
                service: true,
              },
            });

            return { success: true as const, appointment: newAppointment };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5000,
            timeout: 10000,
          },
        );

        if (appointment.success) {
          this.logger.log(
            `Appointment created: slotId=${createAppointmentDto.timeSlotId}, seq=${targetSeq}, userId=${createAppointmentDto.userId}`,
          );
          return appointment.appointment;
        }

        // Collision detected - retry with backoff if attempts remain
        if (attempt < MAX_RETRIES - 1) {
          const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
          this.logger.debug(
            `Collision detected for slot ${createAppointmentDto.timeSlotId}, seq ${targetSeq}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
          );
          await this.sleep(delay);
        }
      } catch (error: unknown) {
        const err = error as Record<string, unknown>;
        // Handle transaction timeout errors
        if (
          err["code"] === "P2034" ||
          (err["message"] as string)?.includes("timeout")
        ) {
          this.logger.warn(
            `Transaction timeout for slot ${createAppointmentDto.timeSlotId}, attempt ${attempt + 1}`,
          );
          if (attempt < MAX_RETRIES - 1) {
            const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
            await this.sleep(delay);
            continue;
          }
          throw new ConflictException(
            "Database timeout. Please try again later.",
          );
        }

        // Re-throw other errors if no retries remain
        if (attempt >= MAX_RETRIES - 1) {
          throw error;
        }

        // Retry with backoff for other errors
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    this.logger.warn(
      `Appointment creation failed after ${MAX_RETRIES} attempts: slotId=${createAppointmentDto.timeSlotId}`,
    );
    throw new ConflictException(
      "Slot reservation failed: maximum retries exceeded. Please try again later.",
    );
  }

  /**
   * Utility function to create a delay.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async findAll(
    page = 1,
    pageSize = 10,
    status?: AppointmentStatus,
    userId?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: Prisma.AppointmentWhereInput = {};

    if (status) {
      where.status = status;
    }
    if (userId) {
      where.userId = userId;
    }

    const [appointments, total] = await Promise.all([
      this.prisma.appointment.findMany({
        skip,
        take: pageSize,
        where,
        include: {
          timeSlot: true,
          service: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      data: appointments,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        timeSlot: true,
        service: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment with ID ${id} not found`);
    }

    return appointment;
  }

  async update(id: string, updateAppointmentDto: UpdateAppointmentDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) {
      throw new NotFoundException(`Appointment with ID ${id} not found`);
    }

    // If cancelling, record cancellation reason in remarks
    const data: Prisma.AppointmentUpdateInput = { ...updateAppointmentDto };
    if (updateAppointmentDto.status === AppointmentStatus.CANCELLED) {
      data.remarks = updateAppointmentDto.cancelReason || appointment.remarks;
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data,
      include: {
        timeSlot: true,
        service: true,
      },
    });

    // Extract customer info from JSON
    const customerInfo = updated.customerInfo as unknown as CustomerInfo;

    // Send real-time appointment update notification if status changed
    if (
      updateAppointmentDto.status &&
      updateAppointmentDto.status !== appointment.status
    ) {
      try {
        this.notificationService.notifyAppointmentUpdate({
          appointmentId: updated.id,
          userId: updated.userId,
          serviceName: updated.service.name,
          date: updated.timeSlot.slotTime.split("T")[0],
          time: updated.timeSlot.slotTime,
          status: updated.status,
          customerName: customerInfo.name,
          customerEmail: customerInfo.email,
        });
      } catch (error) {
        // Log but don't fail the update if notification fails
        console.error("Failed to send appointment update notification:", error);
      }
    }

    return updated;
  }

  async cancel(id: string, reason: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: { timeSlot: true, service: true },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment with ID ${id} not found`);
    }

    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException("Appointment is already cancelled");
    }

    const customerInfo = appointment.customerInfo as unknown as CustomerInfo;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update appointment
      const cancelled = await tx.appointment.update({
        where: { id },
        data: {
          status: AppointmentStatus.CANCELLED,
          remarks: reason,
        },
        include: {
          timeSlot: true,
          service: true,
        },
      });

      return cancelled;
    });

    // Queue appointment cancellation email
    try {
      await this.emailService.sendAppointmentCancellation({
        appointmentId: updated.id,
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
        serviceName: updated.service.name,
        date: updated.timeSlot.slotTime.split("T")[0],
        time: updated.timeSlot.slotTime,
        cancelReason: reason,
      });
    } catch (error) {
      // Log but don't fail the cancellation if email queuing fails
      console.error("Failed to queue appointment cancellation email:", error);
    }

    // Send real-time cancellation notification
    try {
      this.notificationService.notifyCancellation({
        appointmentId: updated.id,
        userId: updated.userId,
        serviceName: updated.service.name,
        date: updated.timeSlot.slotTime.split("T")[0],
        time: updated.timeSlot.slotTime,
        cancelReason: reason,
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
      });
    } catch (error) {
      // Log but don't fail the cancellation if notification fails
      console.error("Failed to send cancellation notification:", error);
    }

    return updated;
  }

  async remove(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) {
      throw new NotFoundException(`Appointment with ID ${id} not found`);
    }

    await this.prisma.appointment.delete({ where: { id } });
    return { message: "Appointment deleted successfully" };
  }
}
