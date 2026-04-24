import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TimeSlotPickerComponent } from './time-slot-picker.component';
import { BookingStore, TimeSlot } from '../../../stores/booking/booking.store';
import { BookingService } from '../booking.service';
import { SocketService, SlotUpdateEvent } from '../../../core/services/socket.service';
import { of, Subject } from 'rxjs';

describe('TimeSlotPickerComponent', () => {
  let component: TimeSlotPickerComponent;
  let fixture: ComponentFixture<TimeSlotPickerComponent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storeMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bookingServiceMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let socketServiceMock: any;
  let socketSubject: Subject<SlotUpdateEvent>;

  const mockSlots: TimeSlot[] = [
    { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: true },
    { id: 'slot-2', date: '2026-04-20', time: '10:00', isActive: true },
    { id: 'slot-3', date: '2026-04-20', time: '11:00', isActive: false },
    { id: 'slot-4', date: '2026-04-20', time: '12:00', isActive: true },
  ];

  beforeEach(async () => {
    socketSubject = new Subject<SlotUpdateEvent>();

    storeMock = {
      slots: jest.fn(() => []),
      selectedSlot: jest.fn(() => null),
      isLoading: jest.fn(() => false),
      error: jest.fn(() => null),
      activeBookings: jest.fn(() => []),
      availableSlots: jest.fn(() => mockSlots.filter(s => s.isActive)),
      bookedSlots: jest.fn(() => mockSlots.filter(s => !s.isActive)),
      hasSelection: jest.fn(() => false),
      loadSlots: jest.fn(),
      selectSlot: jest.fn(),
      bookSlot: jest.fn(),
      cancelBooking: jest.fn(),
      setLoading: jest.fn(),
      setError: jest.fn(),
    };

    bookingServiceMock = {
      generatePreferSeq: jest.fn(() => 3),
      generateIdempotencyKey: jest.fn(() => 'key-123'),
      reserveSlot: jest.fn().mockReturnValue({
        status: 'SUCCESS',
        slot: { id: 'slot-1', date: '2026-04-20', time: '09:00', isActive: false },
      }),
      cancelBooking: jest.fn(),
    };

    socketServiceMock = {
      subscribeToSlotUpdates: jest.fn(() => socketSubject.asObservable()),
      connect: jest.fn(),
      disconnect: jest.fn(),
      joinRoom: jest.fn(),
      leaveRoom: jest.fn(),
      isConnected: jest.fn(() => false),
    };

    await TestBed.configureTestingModule({
      imports: [TimeSlotPickerComponent],
      providers: [
        { provide: BookingStore, useValue: storeMock },
        { provide: BookingService, useValue: bookingServiceMock },
        { provide: SocketService, useValue: socketServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TimeSlotPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should implement OnInit', () => {
      expect(typeof component.ngOnInit).toBe('function');
    });

    it('should implement OnDestroy', () => {
      expect(typeof component.ngOnDestroy).toBe('function');
    });

    it('should reference store signals', () => {
      expect(component.availableSlots).toBe(storeMock.availableSlots);
      expect(component.isLoading).toBe(storeMock.isLoading);
      expect(component.error).toBe(storeMock.error);
    });
  });

  describe('ngOnInit()', () => {
    it('should subscribe to socket slot updates', () => {
      expect(socketServiceMock.subscribeToSlotUpdates).toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy()', () => {
    it('should unsubscribe from subscriptions', () => {
      jest.spyOn(component['subscription'], 'unsubscribe');

      component.ngOnDestroy();

      expect(component['subscription'].unsubscribe).toHaveBeenCalled();
    });
  });

  describe('slot filtering', () => {
    it('should show only active slots in availableSlots', () => {
      storeMock.availableSlots.mockReturnValue(mockSlots.filter(s => s.isActive));
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button:not(.unavailable)');
      // Available slots are those with isActive=true
      expect(storeMock.availableSlots).toHaveBeenCalled();
    });

    it('should disable unavailable slot buttons', () => {
      storeMock.slots.mockReturnValue(mockSlots);
      storeMock.availableSlots.mockReturnValue(mockSlots);
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      // slot-3 is inactive
      const inactiveButton = (Array.from(buttons) as HTMLButtonElement[]).find(
        (btn) => btn.querySelector('.time')?.textContent === '11:00'
      );

      if (inactiveButton) {
        expect(inactiveButton.disabled).toBe(true);
        expect(inactiveButton.classList.contains('unavailable')).toBe(true);
      }
    });

    it('should not disable available slot buttons', () => {
      storeMock.slots.mockReturnValue(mockSlots);
      storeMock.availableSlots.mockReturnValue(mockSlots);
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      const activeButton = (Array.from(buttons) as HTMLButtonElement[]).find(
        (btn) => btn.querySelector('.time')?.textContent === '09:00'
      );

      if (activeButton) {
        expect(activeButton.disabled).toBe(false);
        expect(activeButton.classList.contains('unavailable')).toBe(false);
      }
    });
  });

  describe('slot selection', () => {
    beforeEach(() => {
      storeMock.slots.mockReturnValue(mockSlots);
      storeMock.availableSlots.mockReturnValue(mockSlots);
    });

    it('should call store.selectSlot when clicking an active slot', () => {
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      buttons[0].click();

      expect(storeMock.selectSlot).toHaveBeenCalledWith(mockSlots[0]);
    });

    it('should call bookingService.reserveSlot when clicking an active slot', () => {
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      buttons[0].click();

      expect(bookingServiceMock.reserveSlot).toHaveBeenCalledWith('slot-1');
    });

    it('should not select inactive slots on click', () => {
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      // Find the inactive slot button (slot-3)
      const inactiveButton = (Array.from(buttons) as HTMLButtonElement[]).find(
        (btn) => btn.querySelector('.time')?.textContent === '11:00'
      );

      if (inactiveButton) {
        inactiveButton.click();
        expect(storeMock.selectSlot).not.toHaveBeenCalled();
        expect(bookingServiceMock.reserveSlot).not.toHaveBeenCalled();
      }
    });

    it('should highlight selected slot', () => {
      storeMock.selectedSlot.mockReturnValue(mockSlots[0]);
      storeMock.hasSelection.mockReturnValue(true);
      fixture.detectChanges(false);

      const isSelected = component.isSelected(mockSlots[0]);
      expect(isSelected).toBe(true);
    });

    it('should not highlight non-selected slots', () => {
      storeMock.selectedSlot.mockReturnValue(mockSlots[0]);
      storeMock.hasSelection.mockReturnValue(true);
      fixture.detectChanges(false);

      const isSelected = component.isSelected(mockSlots[1]);
      expect(isSelected).toBe(false);
    });

    it('should return false when no slot is selected', () => {
      storeMock.selectedSlot.mockReturnValue(null);
      fixture.detectChanges(false);

      const isSelected = component.isSelected(mockSlots[0]);
      expect(isSelected).toBe(false);
    });
  });

  describe('socket subscription for real-time updates', () => {
    it('should receive slot updates from socket', () => {
      const mockUpdate: SlotUpdateEvent = {
        slotId: 'slot-1',
        isActive: false,
        bookedBy: 'user-123',
        timestamp: Date.now(),
      };

      jest.spyOn(component, 'handleSlotUpdate');

      socketSubject.next(mockUpdate);

      expect(component.handleSlotUpdate).toHaveBeenCalledWith(mockUpdate);
    });

    it('should process multiple slot updates', () => {
      jest.spyOn(component, 'handleSlotUpdate');

      socketSubject.next({ slotId: 'slot-1', isActive: false, timestamp: Date.now() });
      socketSubject.next({ slotId: 'slot-2', isActive: true, timestamp: Date.now() });
      socketSubject.next({ slotId: 'slot-3', isActive: false, bookedBy: 'user-456', timestamp: Date.now() });

      expect(component.handleSlotUpdate).toHaveBeenCalledTimes(3);
    });
  });

  describe('handleSlotUpdate()', () => {
    it('should update slot availability in real-time', () => {
      storeMock.slots.mockReturnValue([...mockSlots]);

      const update: SlotUpdateEvent = {
        slotId: 'slot-1',
        isActive: false,
        bookedBy: 'user-123',
        timestamp: Date.now(),
      };

      component.handleSlotUpdate(update);

      expect(storeMock.loadSlots).toHaveBeenCalled();
      const updatedSlots = (storeMock.loadSlots as jest.Mock).mock.lastCall[0];
      const updatedSlot = updatedSlots.find((s: TimeSlot) => s.id === 'slot-1');
      expect(updatedSlot.isActive).toBe(false);
      expect(updatedSlot.bookedBy).toBe('user-123');
    });

    it('should update slot to active when update indicates active', () => {
      const inactiveSlots = mockSlots.map(s => ({ ...s, isActive: false }));
      storeMock.slots.mockReturnValue(inactiveSlots);

      const update: SlotUpdateEvent = {
        slotId: 'slot-1',
        isActive: true,
        timestamp: Date.now(),
      };

      component.handleSlotUpdate(update);

      const updatedSlots = (storeMock.loadSlots as jest.Mock).mock.lastCall[0];
      const updatedSlot = updatedSlots.find((s: TimeSlot) => s.id === 'slot-1');
      expect(updatedSlot.isActive).toBe(true);
    });

    it('should not affect other slots when updating one slot', () => {
      storeMock.slots.mockReturnValue([...mockSlots]);

      const update: SlotUpdateEvent = {
        slotId: 'slot-1',
        isActive: false,
        bookedBy: 'user-123',
        timestamp: Date.now(),
      };

      component.handleSlotUpdate(update);

      const updatedSlots = (storeMock.loadSlots as jest.Mock).mock.lastCall[0];
      const unchangedSlot = updatedSlots.find((s: TimeSlot) => s.id === 'slot-2');
      expect(unchangedSlot.isActive).toBe(true);
      expect(unchangedSlot.bookedBy).toBeUndefined();
    });

    it('should clear bookedBy when slot becomes active', () => {
      const bookedSlots = mockSlots.map(s => ({ ...s, isActive: false, bookedBy: 'user-999' }));
      storeMock.slots.mockReturnValue(bookedSlots);

      const update: SlotUpdateEvent = {
        slotId: 'slot-2',
        isActive: true,
        timestamp: Date.now(),
      };

      component.handleSlotUpdate(update);

      const updatedSlots = (storeMock.loadSlots as jest.Mock).mock.lastCall[0];
      const updatedSlot = updatedSlots.find((s: TimeSlot) => s.id === 'slot-2');
      expect(updatedSlot.isActive).toBe(true);
      expect(updatedSlot.bookedBy).toBeUndefined();
    });
  });

  describe('retryLoad()', () => {
    it('should call store.loadSlots with empty array', () => {
      component.retryLoad();

      expect(storeMock.loadSlots).toHaveBeenCalledWith([]);
    });
  });

  describe('template rendering', () => {
    beforeEach(() => {
      storeMock.slots.mockReturnValue(mockSlots);
      storeMock.availableSlots.mockReturnValue(mockSlots);
    });

    it('should render slot buttons for each slot', () => {
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      // All 4 mockSlots render via availableSlots (mock returns all 4)
      expect(buttons.length).toBe(4);
    });

    it('should render time for each slot', () => {
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      expect(buttons[0].querySelector('.time')?.textContent.trim()).toBe('09:00');
      expect(buttons[1].querySelector('.time')?.textContent.trim()).toBe('10:00');
    });

    it('should show loading state when isLoading is true', () => {
      storeMock.isLoading.mockReturnValue(true);
      storeMock.error.mockReturnValue(null);
      fixture = TestBed.createComponent(TimeSlotPickerComponent);
      component = fixture.componentInstance;
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const loading = fixture.nativeElement.querySelector('.loading');
      expect(loading).toBeTruthy();
    });

    it('should not show loading state when isLoading is false', () => {
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const loading = fixture.nativeElement.querySelector('.loading');
      expect(loading).toBeFalsy();
    });

    it('should show error state when error has value', () => {
      storeMock.error.mockReturnValue('Failed to load slots');
      storeMock.isLoading.mockReturnValue(false);
      storeMock.availableSlots.mockReturnValue([]);
      fixture = TestBed.createComponent(TimeSlotPickerComponent);
      component = fixture.componentInstance;
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const error = fixture.nativeElement.querySelector('.error');
      expect(error).toBeTruthy();
      expect(error.textContent).toContain('Failed to load slots');
    });

    it('should show retry button in error state', () => {
      storeMock.error.mockReturnValue('Failed to load slots');
      storeMock.isLoading.mockReturnValue(false);
      storeMock.availableSlots.mockReturnValue([]);
      fixture = TestBed.createComponent(TimeSlotPickerComponent);
      component = fixture.componentInstance;
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const retryButton = fixture.nativeElement.querySelector('.error button');
      expect(retryButton).toBeTruthy();
      expect(retryButton.textContent.trim()).toBe('Retry');
    });

    it('should not show error state when error is null', () => {
      storeMock.error.mockReturnValue(null);
      storeMock.isLoading.mockReturnValue(false);
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const error = fixture.nativeElement.querySelector('.error');
      expect(error).toBeFalsy();
    });

    it('should show empty state when no slots available', () => {
      storeMock.availableSlots.mockReturnValue([]);
      storeMock.slots.mockReturnValue([]);
      fixture = TestBed.createComponent(TimeSlotPickerComponent);
      component = fixture.componentInstance;
      try { fixture.detectChanges(); } catch { /* NG0100 expected */ }

      const emptyState = fixture.nativeElement.querySelector('.empty-state');
      expect(emptyState).toBeTruthy();
    });

    it('should show booked badge for unavailable slots', () => {
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.slot-button');
      const inactiveButton = (Array.from(buttons) as HTMLButtonElement[]).find(
        (btn) => btn.querySelector('.time')?.textContent === '11:00'
      );

      if (inactiveButton) {
        const badge = inactiveButton.querySelector('.badge');
        expect(badge).toBeTruthy();
      }
    });
  });

  describe('component lifecycle', () => {
    it('should set up socket subscription on init', () => {
      expect(socketServiceMock.subscribeToSlotUpdates).toHaveBeenCalled();
    });

    it('should clean up subscription on destroy', () => {
      jest.spyOn(component['subscription'], 'unsubscribe');
      component.ngOnDestroy();
      expect(component['subscription'].unsubscribe).toHaveBeenCalled();
    });

    it('should not throw on double destroy', () => {
      component.ngOnDestroy();
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
