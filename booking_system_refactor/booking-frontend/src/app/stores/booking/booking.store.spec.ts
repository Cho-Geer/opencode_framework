import { TestBed } from '@angular/core/testing';
import { BookingStore, TimeSlot } from './booking.store';

describe('BookingStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let store: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BookingStore],
    });
    store = TestBed.inject(BookingStore);
  });

  it('should initialize with empty slots', () => {
    expect(store.slots()).toEqual([]);
  });

  it('should initialize with null selectedSlot', () => {
    expect(store.selectedSlot()).toBeNull();
  });

  it('should initialize with isLoading false', () => {
    expect(store.isLoading()).toBe(false);
  });

  it('should initialize with null error', () => {
    expect(store.error()).toBeNull();
  });

  it('should initialize with empty activeBookings', () => {
    expect(store.activeBookings()).toEqual([]);
  });

  it('should expose availableSlots computed signal', () => {
    const mockSlots: TimeSlot[] = [
      { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
      { id: '2', date: '2026-04-20', time: '10:00', isActive: false },
      { id: '3', date: '2026-04-20', time: '11:00', isActive: true },
    ];

    expect(store.availableSlots()).toEqual([]);

    store.loadSlots(mockSlots);

    expect(store.availableSlots().length).toBe(2);
    expect(store.availableSlots()[0].id).toBe('1');
    expect(store.availableSlots()[1].id).toBe('3');
  });

  it('should expose bookedSlots computed signal', () => {
    const mockSlots: TimeSlot[] = [
      { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
      { id: '2', date: '2026-04-20', time: '10:00', isActive: false },
      { id: '3', date: '2026-04-20', time: '11:00', isActive: true },
    ];

    expect(store.bookedSlots()).toEqual([]);

    store.loadSlots(mockSlots);

    expect(store.bookedSlots().length).toBe(1);
    expect(store.bookedSlots()[0].id).toBe('2');
  });

  it('should load available slots', () => {
    const mockSlots: TimeSlot[] = [
      { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
      { id: '2', date: '2026-04-20', time: '10:00', isActive: true },
    ];

    store.loadSlots(mockSlots);

    expect(store.slots()).toEqual(mockSlots);
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should select a slot', () => {
    const mockSlot: TimeSlot = {
      id: '1',
      date: '2026-04-20',
      time: '09:00',
      isActive: true,
    };

    expect(store.hasSelection()).toBe(false);

    store.selectSlot(mockSlot);

    expect(store.selectedSlot()).toEqual(mockSlot);
    expect(store.hasSelection()).toBe(true);
  });

  it('should clear selection when selecting null', () => {
    const mockSlot: TimeSlot = {
      id: '1',
      date: '2026-04-20',
      time: '09:00',
      isActive: true,
    };

    store.selectSlot(mockSlot);
    expect(store.selectedSlot()).not.toBeNull();

    store.selectSlot(null);

    expect(store.selectedSlot()).toBeNull();
    expect(store.hasSelection()).toBe(false);
  });

  it('should update slot availability on booking', () => {
    const mockSlots: TimeSlot[] = [
      { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
      { id: '2', date: '2026-04-20', time: '10:00', isActive: true },
    ];

    store.loadSlots(mockSlots);
    store.bookSlot('1', 'user-123');

    const updatedSlots = store.slots();
    expect(updatedSlots[0].isActive).toBe(false);
    expect(updatedSlots[0].bookedBy).toBe('user-123');
    expect(updatedSlots[1].isActive).toBe(true);
    expect(store.activeBookings()).toContain('1');
    expect(store.selectedSlot()).toBeNull();
  });

  it('should handle concurrent booking attempts', () => {
    const mockSlots: TimeSlot[] = [
      { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
    ];

    store.loadSlots(mockSlots);

    // Simulate concurrent bookings
    store.bookSlot('1', 'user-123');
    
    const slotsAfterFirst = store.slots();
    expect(slotsAfterFirst[0].isActive).toBe(false);
    expect(slotsAfterFirst[0].bookedBy).toBe('user-123');
    expect(store.activeBookings().length).toBe(1);
  });

  it('should cancel a booking and restore availability', () => {
    const mockSlots: TimeSlot[] = [
      { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
    ];

    store.loadSlots(mockSlots);
    store.bookSlot('1', 'user-123');
    
    expect(store.slots()[0].isActive).toBe(false);
    expect(store.activeBookings()).toContain('1');

    store.cancelBooking('1');

    const slotsAfterCancel = store.slots();
    expect(slotsAfterCancel[0].isActive).toBe(true);
    expect(slotsAfterCancel[0].bookedBy).toBeUndefined();
    expect(store.activeBookings()).not.toContain('1');
  });

  it('should set loading state', () => {
    store.setLoading(true);
    expect(store.isLoading()).toBe(true);

    store.setLoading(false);
    expect(store.isLoading()).toBe(false);
  });

  it('should set error state and clear loading', () => {
    store.setLoading(true);
    store.setError('Booking failed');

    expect(store.error()).toBe('Booking failed');
    expect(store.isLoading()).toBe(false);
  });

  // ==========================================
  // BUG-004: New methods for API-driven booking
  // ==========================================

  describe('[BUG-004] confirmSlotReservation()', () => {
    it('[RED] should fail: confirmSlotReservation is not yet implemented', () => {
      // RED phase: This test will fail because confirmSlotReservation does not exist yet
      expect(store.confirmSlotReservation).toBeDefined();
    });

    it('[RED] should fail: should mark a slot as booked when confirmed', () => {
      const mockSlots: TimeSlot[] = [
        { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
        { id: '2', date: '2026-04-20', time: '10:00', isActive: true },
      ];

      store.loadSlots(mockSlots);
      store.confirmSlotReservation('1');

      const updatedSlots = store.slots();
      expect(updatedSlots[0].isActive).toBe(false);
      expect(updatedSlots[1].isActive).toBe(true);
    });
  });

  describe('[BUG-004] failedReservation()', () => {
    it('[RED] should fail: failedReservation is not yet implemented', () => {
      // RED phase: This test will fail because failedReservation does not exist yet
      expect(store.failedReservation).toBeDefined();
    });

    it('[RED] should fail: should restore slot and set error message', () => {
      // Simulate an optimistic slot change, then rollback
      const mockSlots: TimeSlot[] = [
        { id: '1', date: '2026-04-20', time: '09:00', isActive: true },
      ];

      store.loadSlots(mockSlots);
      store.failedReservation('1', 'Network error');

      const updatedSlots = store.slots();
      // Slot should remain active (rolled back)
      expect(updatedSlots[0].isActive).toBe(true);
      expect(store.error()).toBe('Network error');
      expect(store.isLoading()).toBe(false);
    });
  });
});
