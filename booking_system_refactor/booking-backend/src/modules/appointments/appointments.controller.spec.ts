import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';
import { AppointmentStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// Mock the JwtAuthGuard to always pass, but we can inspect what it attaches to req
const mockJwtAuthGuard = {
  canActivate: jest.fn().mockImplementation((context) => {
    // Attach JWT user to request
    const req = context.switchToHttp().getRequest();
    req.user = { id: 'jwt-user-id', sub: 'jwt-user-id', type: 'USER' };
    return true;
  }),
};

// Mock AppointmentsService
const mockAppointmentsService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  cancel: jest.fn(),
  remove: jest.fn(),
};

describe('AppointmentsController', () => {
  let controller: AppointmentsController;
  let service: typeof mockAppointmentsService;
  let mockReq: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        {
          provide: AppointmentsService,
          useValue: mockAppointmentsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<AppointmentsController>(AppointmentsController);
    service = module.get(AppointmentsService);

    mockReq = { user: { id: 'jwt-user-id', sub: 'jwt-user-id', type: 'USER' } };

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    // BUG-001 Test 1: POST /v1/appointments should ignore body.userId and use JWT userId
    it('[BUG-001] should ignore userId from body and use userId from JWT token', async () => {
      // Arrange: Create a DTO with a fake userId (simulating malicious client)
      const maliciousDto: CreateAppointmentDto = {
        timeSlotId: 'slot-1',
        serviceId: 'service-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '1234567890',
        notes: 'Test appointment',
      };

      const mockAppointment = {
        id: 'apt-1',
        userId: 'jwt-user-id', // This is the CORRECT userId from JWT
        timeSlotId: 'slot-1',
        serviceId: 'service-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '1234567890',
        status: AppointmentStatus.PENDING,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockAppointmentsService.create.mockResolvedValue(mockAppointment);

      // Act: Call controller with the malicious DTO (no userId in DTO)
      const result = await controller.create(maliciousDto, mockReq);

      // Assert: Verify service was called with the JWT userId as second argument
      const actualUserId = mockAppointmentsService.create.mock.calls[0][1];
      expect(actualUserId).toBe('jwt-user-id');
      expect(result).toEqual(mockAppointment);
    });

    it('should call service.create and return the created appointment', async () => {
      const createAppointmentDto: CreateAppointmentDto = {
        timeSlotId: 'slot-1',
        serviceId: 'service-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '1234567890',
        notes: 'Test appointment',
      };

      const mockAppointment = {
        id: 'apt-1',
        userId: 'jwt-user-id',
        timeSlotId: 'slot-1',
        serviceId: 'service-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '1234567890',
        status: AppointmentStatus.PENDING,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockAppointmentsService.create.mockResolvedValue(mockAppointment);

      const result = await controller.create(createAppointmentDto, mockReq);

      expect(service.create).toHaveBeenCalledWith(createAppointmentDto, 'jwt-user-id');
      expect(result).toEqual(mockAppointment);
    });

    it('should propagate NotFoundException from service.create', async () => {
      const createAppointmentDto: CreateAppointmentDto = {
        timeSlotId: 'slot-1',
        serviceId: 'service-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '1234567890',
        notes: 'Test appointment',
      };

      mockAppointmentsService.create.mockRejectedValue(
        new NotFoundException('Time slot not found'),
      );

      await expect(controller.create(createAppointmentDto, mockReq)).rejects.toThrow(NotFoundException);
      await expect(controller.create(createAppointmentDto, mockReq)).rejects.toThrow('Time slot not found');
    });

    it('should propagate ConflictException from service.create', async () => {
      const createAppointmentDto: CreateAppointmentDto = {
        timeSlotId: 'slot-1',
        serviceId: 'service-1',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        customerPhone: '1234567890',
        notes: 'Test appointment',
      };

      mockAppointmentsService.create.mockRejectedValue(
        new (class extends Error {
          statusCode = 409;
          message = 'Time slot is not available';
        })(),
      );

      await expect(controller.create(createAppointmentDto, mockReq)).rejects.toThrow('Time slot is not available');
    });
  });

  describe('findAll', () => {
    const mockAppointments = [
      { id: 'apt-1', status: AppointmentStatus.PENDING },
      { id: 'apt-2', status: AppointmentStatus.CONFIRMED },
    ];

    it('should call service.findAll with default pagination', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: mockAppointments,
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalledWith(1, 10, undefined, undefined);
      expect(result.data).toEqual(mockAppointments);
      expect(result.total).toBe(2);
    });

    it('should call service.findAll with custom pagination', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: [mockAppointments[0]],
        total: 1,
        page: 2,
        pageSize: 5,
        totalPages: 1,
      });

      const result = await controller.findAll(2, 5);

      expect(service.findAll).toHaveBeenCalledWith(2, 5, undefined, undefined);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(5);
    });

    it('should call service.findAll with status filter', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: mockAppointments,
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      await controller.findAll(1, 10, AppointmentStatus.PENDING);

      expect(service.findAll).toHaveBeenCalledWith(1, 10, AppointmentStatus.PENDING, undefined);
    });

    // BUG-001 Test 4: Admin findAll endpoint still supports userId query param for filtering
    it('[BUG-001] should allow userId filter via query param for findAll (admin endpoint)', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: mockAppointments,
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      await controller.findAll(1, 10, undefined, 'filter-user-id');

      expect(service.findAll).toHaveBeenCalledWith(1, 10, undefined, 'filter-user-id');
    });

    it('should call service.findAll with all filters', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });

      await controller.findAll(1, 10, AppointmentStatus.CANCELLED, 'user-2');

      expect(service.findAll).toHaveBeenCalledWith(1, 10, AppointmentStatus.CANCELLED, 'user-2');
    });
  });

  describe('getMyAppointments', () => {
    const mockAppointments = [
      { id: 'apt-1', status: AppointmentStatus.PENDING },
    ];

    // BUG-001 Test 2: GET /v1/appointments/my should use JWT userId, not query param
    it('[BUG-001] should ignore userId from query param and use userId from JWT token', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: mockAppointments,
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      // Act: Call getMyAppointments with mockReq (JWT user)
      // The controller should use JWT user, NOT a query param
      const result = await controller.getMyAppointments(mockReq);

      // Assert: Verify service.findAll was called with JWT userId
      const actualCallArg = mockAppointmentsService.findAll.mock.calls[0];
      expect(actualCallArg).toEqual([1, 10, undefined, 'jwt-user-id']);
      expect(result.data).toEqual(mockAppointments);
    });

    it('should call service.findAll with userId filter', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: mockAppointments,
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      const result = await controller.getMyAppointments(mockReq);

      expect(service.findAll).toHaveBeenCalledWith(1, 10, undefined, 'jwt-user-id');
      expect(result.data).toEqual(mockAppointments);
    });

    it('should call service.findAll with userId and custom pagination', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: mockAppointments,
        total: 1,
        page: 2,
        pageSize: 5,
        totalPages: 1,
      });

      await controller.getMyAppointments(mockReq, 2, 5);

      expect(service.findAll).toHaveBeenCalledWith(2, 5, undefined, 'jwt-user-id');
    });

    it('should return empty list when user has no appointments', async () => {
      mockAppointmentsService.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });

      const result = await controller.getMyAppointments(mockReq);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findOne', () => {
    const mockAppointment = {
      id: 'apt-1',
      status: AppointmentStatus.PENDING,
      userId: 'user-1',
    };

    it('should call service.findOne and return the appointment', async () => {
      mockAppointmentsService.findOne.mockResolvedValue(mockAppointment);

      const result = await controller.findOne('apt-1');

      expect(service.findOne).toHaveBeenCalledWith('apt-1');
      expect(result).toEqual(mockAppointment);
    });

    it('should propagate NotFoundException from service.findOne', async () => {
      mockAppointmentsService.findOne.mockRejectedValue(
        new NotFoundException('Appointment with ID invalid-id not found'),
      );

      await expect(controller.findOne('invalid-id')).rejects.toThrow(NotFoundException);
      await expect(controller.findOne('invalid-id')).rejects.toThrow('Appointment with ID invalid-id not found');
    });
  });

  describe('update', () => {
    const updateAppointmentDto: UpdateAppointmentDto = {
      status: AppointmentStatus.CONFIRMED,
    };

    const mockUpdatedAppointment = {
      id: 'apt-1',
      status: AppointmentStatus.CONFIRMED,
    };

    it('should call service.update and return the updated appointment', async () => {
      mockAppointmentsService.update.mockResolvedValue(mockUpdatedAppointment);

      const result = await controller.update('apt-1', updateAppointmentDto);

      expect(service.update).toHaveBeenCalledWith('apt-1', updateAppointmentDto);
      expect(result).toEqual(mockUpdatedAppointment);
    });

    it('should propagate NotFoundException from service.update', async () => {
      mockAppointmentsService.update.mockRejectedValue(
        new NotFoundException('Appointment with ID invalid-id not found'),
      );

      await expect(controller.update('invalid-id', updateAppointmentDto)).rejects.toThrow(NotFoundException);
    });

    it('should allow updating with cancelReason', async () => {
      const cancelUpdateDto: UpdateAppointmentDto = {
        status: AppointmentStatus.CANCELLED,
        cancelReason: 'Customer requested cancellation',
      };
      mockAppointmentsService.update.mockResolvedValue({
        id: 'apt-1',
        status: AppointmentStatus.CANCELLED,
        remarks: 'Customer requested cancellation',
      });

      const result = await controller.update('apt-1', cancelUpdateDto);

      expect(service.update).toHaveBeenCalledWith('apt-1', cancelUpdateDto);
      expect(result.status).toBe(AppointmentStatus.CANCELLED);
    });
  });

  describe('cancel', () => {
    const mockCancelledAppointment = {
      id: 'apt-1',
      status: AppointmentStatus.CANCELLED,
      remarks: 'Customer no-show',
    };

    it('should call service.cancel with id and reason', async () => {
      mockAppointmentsService.cancel.mockResolvedValue(mockCancelledAppointment);

      const result = await controller.cancel('apt-1', { reason: 'Customer no-show' });

      expect(service.cancel).toHaveBeenCalledWith('apt-1', 'Customer no-show');
      expect(result).toEqual(mockCancelledAppointment);
    });

    it('should propagate NotFoundException from service.cancel', async () => {
      mockAppointmentsService.cancel.mockRejectedValue(
        new NotFoundException('Appointment with ID invalid-id not found'),
      );

      await expect(controller.cancel('invalid-id', { reason: 'test' })).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException for already cancelled appointment', async () => {
      mockAppointmentsService.cancel.mockRejectedValue(
        new BadRequestException('Appointment is already cancelled'),
      );

      await expect(controller.cancel('apt-1', { reason: 'test' })).rejects.toThrow(BadRequestException);
      await expect(controller.cancel('apt-1', { reason: 'test' })).rejects.toThrow('Appointment is already cancelled');
    });
  });

  describe('remove', () => {
    it('should call service.remove and return success message', async () => {
      mockAppointmentsService.remove.mockResolvedValue({ message: 'Appointment deleted successfully' });

      const result = await controller.remove('apt-1');

      expect(service.remove).toHaveBeenCalledWith('apt-1');
      expect(result).toEqual({ message: 'Appointment deleted successfully' });
    });

    it('should propagate NotFoundException from service.remove', async () => {
      mockAppointmentsService.remove.mockRejectedValue(
        new NotFoundException('Appointment with ID invalid-id not found'),
      );

      await expect(controller.remove('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });
});
