import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ApiService, ApiResponse } from './api.service';
import { LoginPasswordDto, RegisterCompleteDto, ContactType, AuthResponseDto } from '../../features/auth/dto/auth.dto';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;
  const apiUrl = '/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loginPassword()', () => {
    it('should send POST request to /api/auth/login/password with credentials', () => {
      const mockCredentials: LoginPasswordDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        password: 'password123',
      };
      const mockResponse: AuthResponseDto = {
        accessToken: 'jwt-token-123',
        refreshToken: 'refresh-token-123',
        expiresIn: 900,
        tokenType: 'Bearer',
      };

      service.loginPassword(mockCredentials).subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${apiUrl}/auth/login/password`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockCredentials);
      req.flush(mockResponse);
    });

    it('should handle login error', () => {
      const mockCredentials: LoginPasswordDto = {
        contact: 'test@example.com',
        contactType: ContactType.EMAIL,
        password: 'wrong',
      };

      service.loginPassword(mockCredentials).subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeTruthy();
        },
      });

      const req = httpMock.expectOne(`${apiUrl}/auth/login/password`);
      req.flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('registerComplete()', () => {
    it('should send POST request to /api/auth/register/complete with registration data', () => {
      const mockData: RegisterCompleteDto = {
        contact: 'new@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
        password: 'password123',
        name: 'New User',
      };
      const mockResponse: AuthResponseDto = {
        accessToken: 'jwt-token-456',
        refreshToken: 'refresh-token-456',
        expiresIn: 900,
        tokenType: 'Bearer',
      };

      service.registerComplete(mockData).subscribe((response) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${apiUrl}/auth/register/complete`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockData);
      req.flush(mockResponse);
    });

    it('should handle registration error', () => {
      const mockData: RegisterCompleteDto = {
        contact: 'duplicate@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
        password: 'password123',
        name: 'Duplicate',
      };

      service.registerComplete(mockData).subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeTruthy();
        },
      });

      const req = httpMock.expectOne(`${apiUrl}/auth/register/complete`);
      req.flush({ message: 'Email already exists' }, { status: 409, statusText: 'Conflict' });
    });
  });

  describe('getServices()', () => {
    const mockServices = [
      { id: '1', name: 'Haircut', description: 'Standard haircut', durationMinutes: 30, price: 25 },
      { id: '2', name: 'Coloring', description: 'Hair coloring', durationMinutes: 60, price: 50 },
    ];

    it('should send GET request to /api/services and unwrap ApiResponse', (done) => {
      const wrappedResponse: ApiResponse<typeof mockServices> = {
        success: true,
        code: 200,
        message: 'OK',
        data: mockServices,
        timestamp: '2026-04-24T10:00:00.000Z',
        requestId: 'req-test-uuid',
      };

      service.getServices().subscribe({
        next: (services) => {
          try {
            expect(services.length).toBe(2);
            expect(services[0].name).toBe('Haircut');
            done();
          } catch (e) {
            done(e);
          }
        },
        error: (err) => done('should not error: ' + err),
      });

      const req = httpMock.expectOne(`${apiUrl}/services`);
      expect(req.request.method).toBe('GET');
      req.flush(wrappedResponse);
    });

    it('should retry failed requests up to 2 times', () => {
      service.getServices().subscribe({
        next: () => fail('expected error after retries'),
        error: () => {
          // Expected after 3 total attempts (1 original + 2 retries)
        },
      });

      // retry(2) means 3 total requests: original + 2 retries
      const req1 = httpMock.expectOne(`${apiUrl}/services`);
      req1.flush({ message: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });

      const req2 = httpMock.expectOne(`${apiUrl}/services`);
      req2.flush({ message: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });

      const req3 = httpMock.expectOne(`${apiUrl}/services`);
      req3.flush({ message: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });
    });

    it('should handle network error on getServices', () => {
      service.getServices().subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeTruthy();
        },
      });

      // retry(2) means 3 total requests
      const req1 = httpMock.expectOne(`${apiUrl}/services`);
      req1.flush({ message: 'Network error' }, { status: 500, statusText: 'Internal Server Error' });

      const req2 = httpMock.expectOne(`${apiUrl}/services`);
      req2.flush({ message: 'Network error' }, { status: 500, statusText: 'Internal Server Error' });

      const req3 = httpMock.expectOne(`${apiUrl}/services`);
      req3.flush({ message: 'Network error' }, { status: 500, statusText: 'Internal Server Error' });
    });

    // ============================================================
    // [RED] Tests: API Response Unwrapping (ResponseInterceptor)
    // These prove that the current code does NOT unwrap response.data
    // and will FAIL until the unwrap logic is added to ApiService.
    // ============================================================

    it('[GREEN] should unwrap ApiResponse envelope from backend for getServices', (done) => {
      // Simulate the actual backend ResponseInterceptor response format
      const wrappedResponse: ApiResponse<typeof mockServices> = {
        success: true,
        code: 200,
        message: 'OK',
        data: mockServices,
        timestamp: '2026-04-24T10:00:00.000Z',
        requestId: 'req-test-uuid',
      };
      service.getServices().subscribe({
        next: (services) => {
          try {
            // With unwrapping, services is the data array, not the envelope
            expect(Array.isArray(services)).toBe(true);
            expect(services.length).toBe(2);
            expect(services[0].name).toBe('Haircut');
            done();
          } catch (e) {
            done(e);
          }
        },
        error: (err) => done('should not error on successful response: ' + err),
      });

      const req = httpMock.expectOne(`${apiUrl}/services`);
      expect(req.request.method).toBe('GET');
      req.flush(wrappedResponse);
    });

    it('[GREEN] should return actual data array from wrapped response for getServices', (done) => {
      const wrappedResponse: ApiResponse<typeof mockServices> = {
        success: true,
        code: 200,
        message: 'OK',
        data: mockServices,
        timestamp: '2026-04-24T10:00:00.000Z',
        requestId: 'req-test-uuid',
      };

      service.getServices().subscribe({
        next: (services) => {
          try {
            // With unwrapping, services is the data array
            expect(Array.isArray(services)).toBe(true);
            const names = services.map(s => s.name);
            expect(names).toEqual(['Haircut', 'Coloring']);
            done();
          } catch (e) {
            done(e);
          }
        },
        error: (err) => done('should not error: ' + err),
      });

      const req = httpMock.expectOne(`${apiUrl}/services`);
      req.flush(wrappedResponse);
    });
  });

  describe('getAvailableSlots()', () => {
    const mockSlots = [
      { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: true },
      { id: 'slot-2', date: '2026-04-20', time: '10:00', isActive: true },
    ];

    it('should send GET request to /api/time-slots/available with serviceId param', () => {
      service.getAvailableSlots('svc-1').subscribe((slots) => {
        expect(slots.length).toBe(2);
        expect(slots[0].id).toBe('slot-1');
      });

      const req = httpMock.expectOne((request) => {
        return (
          request.url === `${apiUrl}/time-slots/available` &&
          request.params.get('serviceId') === 'svc-1'
        );
      });
      expect(req.request.method).toBe('GET');
      req.flush(mockSlots);
    });

    it('should retry on failure', () => {
      service.getAvailableSlots('svc-1').subscribe({
        next: () => fail('expected error'),
        error: () => {},
      });

      // retry(2) means 3 total requests
      const req1 = httpMock.expectOne((request) => {
        return (
          request.url === `${apiUrl}/time-slots/available` &&
          request.params.get('serviceId') === 'svc-1'
        );
      });
      req1.flush({ message: 'Error' }, { status: 500, statusText: 'Error' });

      const req2 = httpMock.expectOne((request) => {
        return (
          request.url === `${apiUrl}/time-slots/available` &&
          request.params.get('serviceId') === 'svc-1'
        );
      });
      req2.flush({ message: 'Error' }, { status: 500, statusText: 'Error' });

      const req3 = httpMock.expectOne((request) => {
        return (
          request.url === `${apiUrl}/time-slots/available` &&
          request.params.get('serviceId') === 'svc-1'
        );
      });
      req3.flush({ message: 'Error' }, { status: 500, statusText: 'Error' });
    });

    // ============================================================
    // [RED] Test: getAvailableSlots API Response Unwrapping
    // ============================================================

    it('[GREEN] should unwrap ApiResponse envelope for getAvailableSlots', (done) => {
      const wrappedResponse: ApiResponse<typeof mockSlots> = {
        success: true,
        code: 200,
        message: 'OK',
        data: mockSlots,
        timestamp: '2026-04-24T10:00:00.000Z',
        requestId: 'req-test-uuid',
      };

      service.getAvailableSlots('svc-1').subscribe({
        next: (slots) => {
          try {
            expect(Array.isArray(slots)).toBe(true);
            expect(slots.length).toBe(2);
            expect(slots[0].id).toBe('slot-1');
            done();
          } catch (e) {
            done(e);
          }
        },
        error: (err) => done('should not error: ' + err),
      });

      const req = httpMock.expectOne((request) => {
        return (
          request.url === `${apiUrl}/time-slots/available` &&
          request.params.get('serviceId') === 'svc-1'
        );
      });
      req.flush(wrappedResponse);
    });
  });

  describe('createAppointment()', () => {
    it('[RED] should fail: createAppointment should send POST to /api/appointments', () => {
      const mockResponse = {
        status: 'SUCCESS' as const,
        slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
      };

      service.createAppointment({
        timeSlotId: 'slot-1',
        appointmentDate: '2026-04-20T09:00:00Z',
        notes: 'Test appointment',
      }).subscribe((response) => {
        expect(response.status).toBe('SUCCESS');
      });

      const req = httpMock.expectOne(`${apiUrl}/appointments`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        timeSlotId: 'slot-1',
        appointmentDate: '2026-04-20T09:00:00Z',
        notes: 'Test appointment',
      });
      req.flush(mockResponse);
    });

    it('[RED] should fail: createAppointment should handle API error', () => {
      service.createAppointment({
        timeSlotId: 'slot-1',
        appointmentDate: '2026-04-20T09:00:00Z',
      }).subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeTruthy();
        },
      });

      const req = httpMock.expectOne(`${apiUrl}/appointments`);
      req.flush({ message: 'Time slot not available' }, { status: 409, statusText: 'Conflict' });
    });
  });

  describe('reserveSlot()', () => {
    it('should send POST request to /api/slots/:id/reserve with preferSeq', () => {
      const mockResponse = {
        status: 'SUCCESS' as const,
        slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
      };

      service.reserveSlot('slot-1', 5).subscribe((response) => {
        expect(response.status).toBe('SUCCESS');
      });

      const req = httpMock.expectOne(`${apiUrl}/slots/slot-1/reserve`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ preferSeq: 5 });
      expect(req.request.headers.has('X-Idempotency-Key')).toBe(false);
      req.flush(mockResponse);
    });

    it('should include X-Idempotency-Key header when provided', () => {
      service.reserveSlot('slot-1', 3, 'key-123').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/slots/slot-1/reserve`);
      expect(req.request.headers.get('X-Idempotency-Key')).toBe('key-123');
      req.flush({ status: 'SUCCESS', slot: {} });
    });

    it('should handle reservation failure', () => {
      service.reserveSlot('slot-1', 5).subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeTruthy();
        },
      });

      const req = httpMock.expectOne(`${apiUrl}/slots/slot-1/reserve`);
      req.flush({ message: 'Slot no longer available' }, { status: 409, statusText: 'Conflict' });
    });
  });

  describe('cancelBooking()', () => {
    it('should send DELETE request to /api/appointments/:id', () => {
      service.cancelBooking('booking-1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/appointments/booking-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('should handle cancel error', () => {
      service.cancelBooking('booking-1').subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeTruthy();
        },
      });

      const req = httpMock.expectOne(`${apiUrl}/appointments/booking-1`);
      req.flush({ message: 'Booking not found' }, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('error handling', () => {
    it('should return Error with message from HTTP error response', () => {
      service.getServices().subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe('Service unavailable');
        },
      });

      // retry(2) means 3 total requests
      const req1 = httpMock.expectOne(`${apiUrl}/services`);
      req1.flush({ message: 'Service unavailable' }, { status: 503, statusText: 'Service Unavailable' });

      const req2 = httpMock.expectOne(`${apiUrl}/services`);
      req2.flush({ message: 'Service unavailable' }, { status: 503, statusText: 'Service Unavailable' });

      const req3 = httpMock.expectOne(`${apiUrl}/services`);
      req3.flush({ message: 'Service unavailable' }, { status: 503, statusText: 'Service Unavailable' });
    });

    it('should handle network errors gracefully', () => {
      service.loginPassword({
        contact: 'test@test.com',
        contactType: ContactType.EMAIL,
        password: 'test',
      }).subscribe({
        next: () => fail('expected error'),
        error: (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe('An error occurred. Please try again.');
        },
      });

      const req = httpMock.expectOne(`${apiUrl}/auth/login/password`);
      req.error(new ProgressEvent('Network error'));
    });
  });
});
