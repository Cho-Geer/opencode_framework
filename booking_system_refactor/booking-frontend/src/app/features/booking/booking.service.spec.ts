import { TestBed } from '@angular/core/testing';
import { BookingService } from './booking.service';
import { BookingStore, ReservationResponse } from '../../stores/booking/booking.store';
import { ApiService } from '../../core/services/api.service';
import { of, throwError } from 'rxjs';

describe('BookingService', () => {
  let service: BookingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storeMock: any;
  let apiServiceMock: jest.Mocked<ApiService>;

  beforeEach(() => {
    const mockReservationResponse: ReservationResponse = {
      status: 'SUCCESS',
      slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
    };

    storeMock = {
      slots: jest.fn(() => []),
      reserveSlot: jest.fn().mockReturnValue(mockReservationResponse),
      confirmSlotReservation: jest.fn(),
      failedReservation: jest.fn(),
      cancelBooking: jest.fn(),
      selectSlot: jest.fn(),
      loadSlots: jest.fn(),
      bookSlot: jest.fn(),
      setLoading: jest.fn(),
      setError: jest.fn(),
    };

    apiServiceMock = {
      createAppointment: jest.fn(),
    } as unknown as jest.Mocked<ApiService>;

    TestBed.configureTestingModule({
      providers: [
        BookingService,
        { provide: BookingStore, useValue: storeMock },
        { provide: ApiService, useValue: apiServiceMock },
      ],
    });
    service = TestBed.inject(BookingService);
  });

  describe('generatePreferSeq()', () => {
    it('should return a number between 0 and maxSlots - 1', () => {
      const maxSlots = 10;
      for (let i = 0; i < 50; i++) {
        const seq = service.generatePreferSeq(maxSlots);
        expect(seq).toBeGreaterThanOrEqual(0);
        expect(seq).toBeLessThan(maxSlots);
      }
    });

    it('should return a number between 0 and 9 by default', () => {
      for (let i = 0; i < 50; i++) {
        const seq = service.generatePreferSeq();
        expect(seq).toBeGreaterThanOrEqual(0);
        expect(seq).toBeLessThan(10);
      }
    });

    it('should return different values on consecutive calls (randomness)', () => {
      const values = new Set<number>();
      for (let i = 0; i < 100; i++) {
        values.add(service.generatePreferSeq(1000));
      }
      // With 100 calls and 1000 possible values, we should get multiple unique values
      expect(values.size).toBeGreaterThan(1);
    });

    it('should always return 0 when maxSlots is 1', () => {
      for (let i = 0; i < 10; i++) {
        expect(service.generatePreferSeq(1)).toBe(0);
      }
    });

    it('should return integer values (not floats)', () => {
      for (let i = 0; i < 50; i++) {
        const seq = service.generatePreferSeq();
        expect(Number.isInteger(seq)).toBe(true);
      }
    });
  });

  describe('generateIdempotencyKey()', () => {
    it('should return a non-empty string', () => {
      const key = service.generateIdempotencyKey();
      expect(key).toBeTruthy();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    it('should include a timestamp prefix', () => {
      const key = service.generateIdempotencyKey();
      const parts = key.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(2);
      const timestamp = parseInt(parts[0], 10);
      expect(timestamp).toBeGreaterThan(0);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should generate unique keys on consecutive calls', () => {
      const key1 = service.generateIdempotencyKey();
      const key2 = service.generateIdempotencyKey();
      expect(key1).not.toBe(key2);
    });

    it('should generate many unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(service.generateIdempotencyKey());
      }
      // All keys should be unique
      expect(keys.size).toBe(100);
    });

    it('should match the expected format (timestamp-randomstring)', () => {
      const key = service.generateIdempotencyKey();
      const regex = /^\d+-[a-z0-9]+$/;
      expect(key).toMatch(regex);
    });
  });

  describe('reserveSlot()', () => {
    it('[RED] should fail: store.reserveSlot should no longer be called directly', async () => {
      // BUG-004: reserveSlot should call apiService.createAppointment() instead of store.reserveSlot()
      // This test proves the old behavior (no API call) no longer applies
      apiServiceMock.createAppointment.mockReturnValue(of({
        status: 'SUCCESS' as const,
        slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
      }));

      await service.reserveSlot('slot-1', 10);

      // The new implementation should call the API, not the store's synchronous reserveSlot
      expect(apiServiceMock.createAppointment).toHaveBeenCalled();
    });

    it('[RED] should fail: should call apiService.createAppointment with correct parameters', async () => {
      apiServiceMock.createAppointment.mockReturnValue(of({
        status: 'SUCCESS' as const,
        slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
      }));

      await service.reserveSlot('slot-1', 10);

      expect(apiServiceMock.createAppointment).toHaveBeenCalledWith(
        expect.objectContaining({
          timeSlotId: 'slot-1',
        })
      );
    });

    it('[RED] should fail: should call store.confirmSlotReservation on API success', async () => {
      apiServiceMock.createAppointment.mockReturnValue(of({
        status: 'SUCCESS' as const,
        slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
      }));

      await service.reserveSlot('slot-1', 10);

      expect(storeMock.confirmSlotReservation).toHaveBeenCalledWith('slot-1');
    });

    it('[RED] should fail: should call store.failedReservation on API failure', async () => {
      apiServiceMock.createAppointment.mockReturnValue(throwError(() => new Error('Network error')));

      const result = await service.reserveSlot('slot-1', 10);

      expect(storeMock.failedReservation).toHaveBeenCalledWith('slot-1', 'Network error');
      expect(result.status).toBe('FAILED');
    });

    it('[RED] should fail: should return ReservationResponse on success', async () => {
      apiServiceMock.createAppointment.mockReturnValue(of({
        status: 'SUCCESS' as const,
        slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
      }));

      const result = await service.reserveSlot('slot-1', 10);

      expect(result).toBeDefined();
      expect(result.status).toBe('SUCCESS');
      expect(result.slot).toBeDefined();
      expect(result.slot.id).toBe('slot-1');
    });
  });

  describe('cancelBooking()', () => {
    it('should call store.cancelBooking with slotId', () => {
      service.cancelBooking('slot-1');

      expect(storeMock.cancelBooking).toHaveBeenCalledWith('slot-1');
    });

    it('should cancel different bookings', () => {
      service.cancelBooking('slot-a');
      service.cancelBooking('slot-b');

      expect(storeMock.cancelBooking).toHaveBeenCalledWith('slot-a');
      expect(storeMock.cancelBooking).toHaveBeenCalledWith('slot-b');
    });
  });
});
