import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notifications/notification.service';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';
import { AppointmentStatus } from '@prisma/client';
import { isIntegrationMode } from '../../../test/setup/test-env';
import { createTestModule, TestModule } from '../../../test/helpers/create-test-module';
import {
  createTestUser,
  createTestService,
  createTestTimeSlot,
  createTestAppointment,
} from '../../../test/fixtures/database.fixture';

// Mock PrismaService
const mockPrismaService = {
  appointment: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  timeSlot: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

// Mock EmailService
const mockEmailService = {
  sendAppointmentConfirmation: jest.fn(),
  sendAppointmentCancellation: jest.fn(),
};

// Mock NotificationService
const mockNotificationService = {
  notifyBookingConfirmation: jest.fn(),
  notifyAppointmentUpdate: jest.fn(),
  notifyCancellation: jest.fn(),
};

// Mock Logger
const mockLogger = {
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let prisma: typeof mockPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: Logger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockTimeSlot = {
    id: 'slot-1',
    serviceId: 'service-1',
    slotTime: '2024-06-15T09:00:00.000Z',
    endTime: new Date('2024-06-15T09:30:00.000Z'),
    isActive: true,
    currentSequence: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockService = {
    id: 'service-1',
    name: 'Haircut',
    durationMinutes: 30,
    price: 25.00,
    isActive: true,
  };

  const mockAppointment = {
    id: 'apt-1',
    userId: 'user-1',
    timeSlotId: 'slot-1',
    serviceId: 'service-1',
    customerInfo: {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '1234567890',
    },
    remarks: 'Test notes',
    status: AppointmentStatus.PENDING,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    timeSlot: mockTimeSlot,
    service: mockService,
  };

  describe('create', () => {
    const createAppointmentDto: CreateAppointmentDto = {
      timeSlotId: 'slot-1',
      serviceId: 'service-1',
      customerName: 'John Doe',
      customerEmail: 'john@example.com',
      customerPhone: '1234567890',
      notes: 'Test notes',
    };

    it('should throw NotFoundException if time slot does not exist', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue(null);

      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow(NotFoundException);
      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow('Time slot not found');

      expect(prisma.timeSlot.findUnique).toHaveBeenCalledWith({
        where: { id: createAppointmentDto.timeSlotId },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if time slot is not available', async () => {
      const unavailableSlot = { ...mockTimeSlot, isActive: false };
      prisma.timeSlot.findUnique.mockResolvedValue(unavailableSlot);

      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow(ConflictException);
      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow('Time slot is not available');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create appointment in a transaction', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue(mockTimeSlot);
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const result = await service.create(createAppointmentDto, 'user-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockTx.appointment.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          timeSlotId: createAppointmentDto.timeSlotId,
          serviceId: createAppointmentDto.serviceId,
          customerInfo: {
            name: createAppointmentDto.customerName,
            email: createAppointmentDto.customerEmail,
            phone: createAppointmentDto.customerPhone,
          },
          remarks: createAppointmentDto.notes,
          status: AppointmentStatus.PENDING,
          appointmentDate: expect.any(Date),
          slotSequence: expect.any(Number),
          appointmentNumber: expect.stringMatching(/^APT-/),
        },
        include: {
          timeSlot: true,
          service: true,
        },
      });
    });

    it('should set appointment status to PENDING', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue(mockTimeSlot);
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await service.create(createAppointmentDto, 'user-1');

      expect(mockTx.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AppointmentStatus.PENDING,
          }),
        }),
      );
    });

    it('should return created appointment with timeSlot and service', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue(mockTimeSlot);
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const result = await service.create(createAppointmentDto, 'user-1');

      expect(result).toEqual(mockAppointment);
      expect(result.timeSlot).toEqual(mockTimeSlot);
      expect(result.service).toEqual(mockService);
    });

    it('should create appointment without notes when not provided', async () => {
      const dtoWithoutNotes: CreateAppointmentDto = {
        timeSlotId: 'slot-1',
        serviceId: 'service-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '1234567890',
      };
      prisma.timeSlot.findUnique.mockResolvedValue(mockTimeSlot);
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue({ ...mockAppointment, remarks: undefined }),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: false }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await service.create(dtoWithoutNotes, 'user-1');

      expect(mockTx.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            remarks: undefined,
          }),
        }),
      );
    });

    it('should retry on optimistic lock conflict and succeed on second attempt', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue({ ...mockTimeSlot, currentSequence: 0 });

      // First attempt: conflict (count=0), second attempt: success (count=1)
      let callCount = 0;
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockImplementation(async () => {
            callCount++;
            return { count: callCount === 1 ? 0 : 1 };
          }),
        },
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      // Mock sleep to resolve immediately
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      const result = await service.create(createAppointmentDto, 'user-1');

      // Should have been called twice (conflict then success)
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(mockTx.timeSlot.updateMany).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockAppointment);
    });

    it('should throw ConflictException after max retries exhausted', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue({ ...mockTimeSlot, currentSequence: 0 });

      // All attempts fail with conflict
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      // Mock sleep to resolve immediately
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow(ConflictException);
      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow(/maximum retries exceeded/);

      // Should have attempted MAX_RETRIES (3) times
      expect(prisma.$transaction).toHaveBeenCalledTimes(6); // 3 attempts per call × 2 calls
    });

    it('should use ReadCommitted isolation level for transaction', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue(mockTimeSlot);
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback, options) => {
        expect(options).toEqual({
          maxWait: 5000,
          timeout: 10000,
          isolationLevel: 'ReadCommitted',
        });
        return callback(mockTx);
      });

      await service.create(createAppointmentDto, 'user-1');
    });

    it('should increment slot sequence on successful booking', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue({ ...mockTimeSlot, currentSequence: 5 });
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await service.create(createAppointmentDto, 'user-1');

      // Verify updateMany was called with correct sequence
      expect(mockTx.timeSlot.updateMany).toHaveBeenCalledWith({
        where: {
          id: createAppointmentDto.timeSlotId,
          isActive: true,
          currentSequence: 5,
        },
        data: {
          currentSequence: { increment: 1 },
        },
      });
    });

    it('should succeed even if email service fails', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue(mockTimeSlot);
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });
      mockEmailService.sendAppointmentConfirmation.mockRejectedValue(new Error('Email service error'));

      const result = await service.create(createAppointmentDto, 'user-1');

      expect(result).toEqual(mockAppointment);
      expect(mockEmailService.sendAppointmentConfirmation).toHaveBeenCalled();
    });

    it('should succeed even if notification service fails', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue(mockTimeSlot);
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });
      mockNotificationService.notifyBookingConfirmation.mockImplementation(() => {
        throw new Error('Notification service error');
      });

      const result = await service.create(createAppointmentDto, 'user-1');

      expect(result).toEqual(mockAppointment);
      expect(mockNotificationService.notifyBookingConfirmation).toHaveBeenCalled();
    });

    it('should retry on transaction timeout and succeed', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue({ ...mockTimeSlot, currentSequence: 0 });

      let attemptCount = 0;
      prisma.$transaction.mockImplementation(async (callback) => {
        attemptCount++;
        if (attemptCount < 2) {
          const timeoutError: any = new Error('Transaction timeout');
          timeoutError.code = 'P2034';
          throw timeoutError;
        }
        const mockTx = {
          appointment: {
            create: jest.fn().mockResolvedValue(mockAppointment),
          },
          timeSlot: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(mockTx);
      });

      // Mock sleep to resolve immediately
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      const result = await service.create(createAppointmentDto, 'user-1');
      expect(result).toEqual(mockAppointment);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException after transaction timeout and all retries exhausted', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue({ ...mockTimeSlot, currentSequence: 0 });

      const timeoutError: any = new Error('Transaction timeout');
      timeoutError.code = 'P2034';
      prisma.$transaction.mockRejectedValue(timeoutError);

      // Mock sleep to resolve immediately
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow(ConflictException);
      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow(/Database timeout/);
      expect(prisma.$transaction).toHaveBeenCalledTimes(6); // 3 attempts per call × 2 calls
    });

    it('should retry on version conflict and succeed on third attempt', async () => {
      prisma.timeSlot.findUnique.mockResolvedValue({ ...mockTimeSlot, currentSequence: 0 });

      let callCount = 0;
      const mockTx = {
        appointment: {
          create: jest.fn().mockResolvedValue(mockAppointment),
        },
        timeSlot: {
          updateMany: jest.fn().mockImplementation(async () => {
            callCount++;
            return { count: callCount === 3 ? 1 : 0 };
          }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      // Mock sleep to resolve immediately
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      const result = await service.create(createAppointmentDto, 'user-1');
      expect(result).toEqual(mockAppointment);
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('findAll', () => {
    const mockAppointments = [
      { ...mockAppointment, id: 'apt-1' },
      { ...mockAppointment, id: 'apt-2', customerInfo: { name: 'Jane Smith', email: 'jane@example.com', phone: '0987654321' } },
    ];

    it('should return paginated appointments with default pagination', async () => {
      prisma.appointment.findMany.mockResolvedValue(mockAppointments);
      prisma.appointment.count.mockResolvedValue(2);

      const result = await service.findAll();

      expect(prisma.appointment.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        where: {},
        include: {
          timeSlot: true,
          service: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.appointment.count).toHaveBeenCalledWith({ where: {} });
      expect(result).toEqual({
        data: mockAppointments,
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });
    });

    it('should filter by status when provided', async () => {
      prisma.appointment.findMany.mockResolvedValue(mockAppointments);
      prisma.appointment.count.mockResolvedValue(2);

      await service.findAll(1, 10, AppointmentStatus.CONFIRMED);

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: AppointmentStatus.CONFIRMED },
        }),
      );
      expect(prisma.appointment.count).toHaveBeenCalledWith({
        where: { status: AppointmentStatus.CONFIRMED },
      });
    });

    it('should filter by userId when provided', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointments[0]]);
      prisma.appointment.count.mockResolvedValue(1);

      await service.findAll(1, 10, undefined, 'user-1');

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        }),
      );
    });

    it('should filter by both status and userId', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointments[0]]);
      prisma.appointment.count.mockResolvedValue(1);

      await service.findAll(1, 10, AppointmentStatus.PENDING, 'user-1');

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: AppointmentStatus.PENDING,
            userId: 'user-1',
          },
        }),
      );
    });

    it('should support custom pagination', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointments[0]]);
      prisma.appointment.count.mockResolvedValue(2);

      const result = await service.findAll(2, 1);

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          take: 1,
        }),
      );
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(1);
    });

    it('should return empty data when no appointments exist', async () => {
      prisma.appointment.findMany.mockResolvedValue([]);
      prisma.appointment.count.mockResolvedValue(0);

      const result = await service.findAll();

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });
    });

    it('should include timeSlot and service in returned appointments', async () => {
      prisma.appointment.findMany.mockResolvedValue(mockAppointments);
      prisma.appointment.count.mockResolvedValue(2);

      const result = await service.findAll();

      expect(result.data[0]).toHaveProperty('timeSlot');
      expect(result.data[0]).toHaveProperty('service');
    });

    it('should order results by createdAt descending', async () => {
      prisma.appointment.findMany.mockResolvedValue(mockAppointments);
      prisma.appointment.count.mockResolvedValue(2);

      await service.findAll();

      expect(prisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should calculate totalPages correctly', async () => {
      prisma.appointment.findMany.mockResolvedValue(mockAppointments);
      prisma.appointment.count.mockResolvedValue(25);

      const result = await service.findAll(1, 10);

      expect(result.totalPages).toBe(3);
    });
  });

  describe('findOne', () => {
    it('should return appointment by id with timeSlot and service', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);

      const result = await service.findOne('apt-1');

      expect(prisma.appointment.findUnique).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        include: {
          timeSlot: true,
          service: true,
        },
      });
      expect(result).toEqual(mockAppointment);
      expect(result.timeSlot).toEqual(mockTimeSlot);
      expect(result.service).toEqual(mockService);
    });

    it('should throw NotFoundException if appointment not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent-id')).rejects.toThrow('Appointment with ID nonexistent-id not found');
    });
  });

  describe('update', () => {
    const updateAppointmentDto: UpdateAppointmentDto = {
      status: AppointmentStatus.CONFIRMED,
    };

    it('should throw NotFoundException if appointment not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      await expect(service.update('nonexistent-id', updateAppointmentDto)).rejects.toThrow(NotFoundException);
      await expect(service.update('nonexistent-id', updateAppointmentDto)).rejects.toThrow('Appointment with ID nonexistent-id not found');
    });

    it('should update appointment status', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const updatedAppointment = { ...mockAppointment, status: AppointmentStatus.CONFIRMED };
      prisma.appointment.update.mockResolvedValue(updatedAppointment);

      const result = await service.update('apt-1', updateAppointmentDto);

      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        data: updateAppointmentDto,
        include: {
          timeSlot: true,
          service: true,
        },
      });
      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    });

    it('should store cancellation reason in remarks when status is CANCELLED', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const cancelledAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
        remarks: 'Customer requested cancellation',
      };
      prisma.appointment.update.mockResolvedValue(cancelledAppointment);

      const result = await service.update('apt-1', { status: AppointmentStatus.CANCELLED, cancelReason: 'Customer requested cancellation' });

      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            remarks: 'Customer requested cancellation',
          }),
        }),
      );
      expect(result.remarks).toBe('Customer requested cancellation');
    });

    it('should update cancelReason in remarks when provided', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const updatedAppointment = {
        ...mockAppointment,
        remarks: 'Customer requested cancellation',
      };
      prisma.appointment.update.mockResolvedValue(updatedAppointment);

      await service.update('apt-1', { cancelReason: 'Customer requested cancellation' });

      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: 'Customer requested cancellation',
          }),
        }),
      );
    });

    it('should include timeSlot and service in updated response', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      prisma.appointment.update.mockResolvedValue(mockAppointment);

      const result = await service.update('apt-1', { status: AppointmentStatus.CONFIRMED });

      expect(result).toHaveProperty('timeSlot');
      expect(result).toHaveProperty('service');
    });

    it('should update to COMPLETED status', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const completedAppointment = { ...mockAppointment, status: AppointmentStatus.COMPLETED };
      prisma.appointment.update.mockResolvedValue(completedAppointment);

      const result = await service.update('apt-1', { status: AppointmentStatus.COMPLETED });

      expect(result.status).toBe(AppointmentStatus.COMPLETED);
    });

    it('should trigger notification when status changes', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const updatedAppointment = { ...mockAppointment, status: AppointmentStatus.CONFIRMED };
      prisma.appointment.update.mockResolvedValue(updatedAppointment);

      await service.update('apt-1', { status: AppointmentStatus.CONFIRMED });

      expect(mockNotificationService.notifyAppointmentUpdate).toHaveBeenCalledWith({
        appointmentId: 'apt-1',
        userId: 'user-1',
        serviceName: 'Haircut',
        date: '2024-06-15',
        time: '2024-06-15T09:00:00.000Z',
        status: AppointmentStatus.CONFIRMED,
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
      });
    });

    it('should not trigger notification when status does not change', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      prisma.appointment.update.mockResolvedValue(mockAppointment);

      await service.update('apt-1', { cancelReason: 'Some reason' });

      expect(mockNotificationService.notifyAppointmentUpdate).not.toHaveBeenCalled();
    });

    it('should succeed even if update notification fails', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const updatedAppointment = { ...mockAppointment, status: AppointmentStatus.CONFIRMED };
      prisma.appointment.update.mockResolvedValue(updatedAppointment);
      mockNotificationService.notifyAppointmentUpdate.mockImplementation(() => {
        throw new Error('Notification service error');
      });

      const result = await service.update('apt-1', { status: AppointmentStatus.CONFIRMED });

      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
      expect(mockNotificationService.notifyAppointmentUpdate).toHaveBeenCalled();
    });

    it('should update status from PENDING to CONFIRMED', async () => {
      const pendingAppointment = { ...mockAppointment, status: AppointmentStatus.PENDING };
      const confirmedAppointment = { ...mockAppointment, status: AppointmentStatus.CONFIRMED };
      prisma.appointment.findUnique.mockResolvedValue(pendingAppointment);
      prisma.appointment.update.mockResolvedValue(confirmedAppointment);

      const result = await service.update('apt-1', { status: AppointmentStatus.CONFIRMED });

      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
      expect(mockNotificationService.notifyAppointmentUpdate).toHaveBeenCalled();
    });

    it('should update status from CONFIRMED to COMPLETED', async () => {
      const confirmedAppointment = { ...mockAppointment, status: AppointmentStatus.CONFIRMED };
      const completedAppointment = { ...mockAppointment, status: AppointmentStatus.COMPLETED };
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppointment);
      prisma.appointment.update.mockResolvedValue(completedAppointment);

      const result = await service.update('apt-1', { status: AppointmentStatus.COMPLETED });

      expect(result.status).toBe(AppointmentStatus.COMPLETED);
      expect(mockNotificationService.notifyAppointmentUpdate).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should throw NotFoundException if appointment not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      await expect(service.cancel('nonexistent-id', 'Reason')).rejects.toThrow(NotFoundException);
      await expect(service.cancel('nonexistent-id', 'Reason')).rejects.toThrow('Appointment with ID nonexistent-id not found');
    });

    it('should throw BadRequestException if appointment is already cancelled', async () => {
      const cancelledAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
      };
      prisma.appointment.findUnique.mockResolvedValue(cancelledAppointment);

      await expect(service.cancel('apt-1', 'Double cancellation')).rejects.toThrow(BadRequestException);
      await expect(service.cancel('apt-1', 'Double cancellation')).rejects.toThrow('Appointment is already cancelled');
    });

    it('should cancel appointment in a transaction', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue({
            ...mockAppointment,
            status: AppointmentStatus.CANCELLED,
            remarks: 'Customer request',
          }),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const result = await service.cancel('apt-1', 'Customer request');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockTx.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        data: {
          status: AppointmentStatus.CANCELLED,
          remarks: 'Customer request',
        },
        include: {
          timeSlot: true,
          service: true,
        },
      });
    });

    it('should return cancelled appointment with timeSlot and service', async () => {
      const cancelledResult = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
        remarks: 'Customer request',
      };
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue(cancelledResult),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const result = await service.cancel('apt-1', 'Customer request');

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(result.remarks).toBe('Customer request');
    });

    it('should include cancel reason in cancelled appointment remarks', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue({
            ...mockAppointment,
            status: AppointmentStatus.CANCELLED,
            remarks: 'Emergency',
          }),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const result = await service.cancel('apt-1', 'Emergency');

      expect(result.remarks).toBe('Emergency');
    });

    it('should handle cancellation of COMPLETED appointment', async () => {
      const completedAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.COMPLETED,
      };
      prisma.appointment.findUnique.mockResolvedValue(completedAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue({
            ...completedAppointment,
            status: AppointmentStatus.CANCELLED,
            remarks: 'Admin cancellation',
          }),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const result = await service.cancel('apt-1', 'Admin cancellation');

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
    });

    it('should send cancellation email on successful cancellation', async () => {
      const cancelledAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
        remarks: 'Customer request',
      };
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue(cancelledAppointment),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await service.cancel('apt-1', 'Customer request');

      expect(mockEmailService.sendAppointmentCancellation).toHaveBeenCalledWith({
        appointmentId: 'apt-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        serviceName: 'Haircut',
        date: '2024-06-15',
        time: '2024-06-15T09:00:00.000Z',
        cancelReason: 'Customer request',
      });
    });

    it('should send cancellation notification on successful cancellation', async () => {
      const cancelledAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
        remarks: 'Customer request',
      };
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue(cancelledAppointment),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await service.cancel('apt-1', 'Customer request');

      expect(mockNotificationService.notifyCancellation).toHaveBeenCalledWith({
        appointmentId: 'apt-1',
        userId: 'user-1',
        serviceName: 'Haircut',
        date: '2024-06-15',
        time: '2024-06-15T09:00:00.000Z',
        cancelReason: 'Customer request',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
      });
    });

    it('should succeed even if cancellation email fails', async () => {
      const cancelledAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
        remarks: 'Customer request',
      };
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue(cancelledAppointment),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });
      mockEmailService.sendAppointmentCancellation.mockRejectedValue(new Error('Email service error'));

      const result = await service.cancel('apt-1', 'Customer request');

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(mockEmailService.sendAppointmentCancellation).toHaveBeenCalled();
    });

    it('should succeed even if cancellation notification fails', async () => {
      const cancelledAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
        remarks: 'Customer request',
      };
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      const mockTx = {
        appointment: {
          update: jest.fn().mockResolvedValue(cancelledAppointment),
        },
        timeSlot: {
          update: jest.fn().mockResolvedValue({ ...mockTimeSlot, isActive: true }),
        },
      };
      prisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });
      mockNotificationService.notifyCancellation.mockImplementation(() => {
        throw new Error('Notification service error');
      });

      const result = await service.cancel('apt-1', 'Customer request');

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
      expect(mockNotificationService.notifyCancellation).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException if appointment not found', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(NotFoundException);
      await expect(service.remove('nonexistent-id')).rejects.toThrow('Appointment with ID nonexistent-id not found');
    });

    it('should delete appointment and return success message', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      prisma.appointment.delete.mockResolvedValue(mockAppointment);

      const result = await service.remove('apt-1');

      expect(prisma.appointment.delete).toHaveBeenCalledWith({ where: { id: 'apt-1' } });
      expect(result).toEqual({ message: 'Appointment deleted successfully' });
    });

    it('should check existence before deletion', async () => {
      prisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      prisma.appointment.delete.mockResolvedValue(mockAppointment);

      await service.remove('apt-1');

      expect(prisma.appointment.findUnique).toHaveBeenCalledWith({ where: { id: 'apt-1' } });
      expect(prisma.appointment.delete).toHaveBeenCalled();
    });
  });
});

// ============================================================
// Integration Tests (uses real database via Testcontainers)
// ============================================================
if (isIntegrationMode()) {
  describe('AppointmentsService (Integration - Real Database)', () => {
    let testModule: TestModule;
    let appointmentsService: AppointmentsService;

    beforeAll(async () => {
      testModule = await createTestModule();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: testModule.prisma,
          },
          {
            provide: EmailService,
            useValue: { sendAppointmentConfirmation: jest.fn(), sendAppointmentCancellation: jest.fn() },
          },
          {
            provide: NotificationService,
            useValue: { notifyBookingConfirmation: jest.fn(), notifyAppointmentUpdate: jest.fn(), notifyCancellation: jest.fn() },
          },
          {
            provide: Logger,
            useValue: mockLogger,
          },
        ],
      }).compile();

      appointmentsService = module.get<AppointmentsService>(AppointmentsService);
    });

    afterAll(async () => {
      await testModule?.disconnect();
    });

    beforeEach(async () => {
      await testModule.resetDatabase();
    });

    describe('create (Integration)', () => {
      it('should create an appointment in the real database', async () => {
        const user = await createTestUser(testModule.prisma, 'CUSTOMER');
        const service = await createTestService(testModule.prisma);
        const timeSlot = await createTestTimeSlot(testModule.prisma, service.id);

        const result = await appointmentsService.create({
          serviceId: service.id,
          timeSlotId: timeSlot.id,
          customerName: user.name,
          customerEmail: user.email || 'test@example.com',
          customerPhone: user.phone || '1234567890',
        }, user.id);

        expect(result).toHaveProperty('id');
        expect(result.serviceId).toBe(service.id);
        expect(result.timeSlotId).toBe(timeSlot.id);
        expect(result.status).toBe(AppointmentStatus.PENDING);
      });
    });

    describe('findAll (Integration)', () => {
      it('should return paginated appointments from real database', async () => {
        const user = await createTestUser(testModule.prisma, 'CUSTOMER');
        const service = await createTestService(testModule.prisma);
        const timeSlot = await createTestTimeSlot(testModule.prisma, service.id);

        await createTestAppointment(testModule.prisma, {
          userId: user.id,
          serviceId: service.id,
          timeSlotId: timeSlot.id,
        });

        const result = await appointmentsService.findAll();
        expect(result).toHaveProperty('data');
        expect(result.total).toBeGreaterThanOrEqual(1);
      });
    });

    describe('findOne (Integration)', () => {
      it('should return appointment by id from real database', async () => {
        const appointment = await createTestAppointment(testModule.prisma);

        const result = await appointmentsService.findOne(appointment.id);
        expect(result.id).toBe(appointment.id);
      });

      it('should throw NotFoundException for non-existent appointment', async () => {
        await expect(
          appointmentsService.findOne('00000000-0000-0000-0000-000000000000')
        ).rejects.toThrow(NotFoundException);
      });
    });
  });
}
