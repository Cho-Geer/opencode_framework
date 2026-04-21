import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentService } from './appointment.service';

describe('AppointmentService', () => {
  let service: AppointmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppointmentService],
    }).compile();

    service = module.get<AppointmentService>(AppointmentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create appointment successfully', () => {
    // TODO: Implement test
    expect(true).toBe(true);
  });

  it('should throw conflict error when time slot is booked', () => {
    // TODO: Implement test
    expect(true).toBe(true);
  });
});
