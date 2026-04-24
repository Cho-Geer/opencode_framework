import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { BookingConfirmationComponent } from './booking-confirmation.component';
import { BookingStore, TimeSlot } from '../../../stores/booking/booking.store';
import { AuthStore, User } from '../../../stores/auth/auth.store';
import { BookingService } from '../booking.service';
import { signal } from '@angular/core';

describe('BookingConfirmationComponent', () => {
  let component: BookingConfirmationComponent;
  let fixture: ComponentFixture<BookingConfirmationComponent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bookingStoreMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authStoreMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bookingServiceMock: any;
  let router: Router;

  const mockSlot: TimeSlot = {
    id: 'slot-1',
    date: '2026-04-20',
    time: '09:00',
    isActive: true,
  };

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
  };

  beforeEach(async () => {
    bookingStoreMock = {
      slots: jest.fn(() => []),
      selectedSlot: jest.fn(() => null),
      isLoading: jest.fn(() => false),
      error: jest.fn(() => null),
      activeBookings: jest.fn(() => []),
      availableSlots: jest.fn(() => []),
      bookedSlots: jest.fn(() => []),
      hasSelection: jest.fn(() => false),
      loadSlots: jest.fn(),
      selectSlot: jest.fn(),
      bookSlot: jest.fn(),
      cancelBooking: jest.fn(),
      setLoading: jest.fn(),
      setError: jest.fn(),
    };

    authStoreMock = {
      user: jest.fn(() => null),
      token: jest.fn(() => null),
      isAuthenticated: jest.fn(() => false),
      currentUser: jest.fn(() => null),
      currentToken: jest.fn(() => null),
      loginSuccess: jest.fn(),
      logout: jest.fn(),
      setLoading: jest.fn(),
      setError: jest.fn(),
    };

    bookingServiceMock = {
      generatePreferSeq: jest.fn(),
      generateIdempotencyKey: jest.fn(),
      reserveSlot: jest.fn(),
      cancelBooking: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        BookingConfirmationComponent,
      ],
      providers: [
        provideRouter([]),
        { provide: BookingStore, useValue: bookingStoreMock },
        { provide: AuthStore, useValue: authStoreMock },
        { provide: BookingService, useValue: bookingServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookingConfirmationComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
  });

  describe('initialization', () => {
    it('should create the component', () => {
      fixture.detectChanges();
      expect(component).toBeTruthy();
    });

    it('should reference bookingStore signals', () => {
      expect(component.hasSelection).toBe(bookingStoreMock.hasSelection);
      expect(component.selectedSlot).toBe(bookingStoreMock.selectedSlot);
      expect(component.error).toBe(bookingStoreMock.error);
      expect(component.isProcessing).toBe(bookingStoreMock.isLoading);
    });

    it('should have default service name', () => {
      expect(component.selectedServiceName()).toBe('Standard Service');
    });

    it('should have default service duration', () => {
      expect(component.serviceDuration()).toBe(30);
    });

    it('should have default service price', () => {
      expect(component.servicePrice()).toBe(50);
    });
  });

  describe('slot confirmation flow', () => {
    beforeEach(() => {
      bookingStoreMock.hasSelection.mockReturnValue(true);
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
    });

    it('should show empty state when no slot is selected', () => {
      bookingStoreMock.hasSelection.mockReturnValue(false);
      bookingStoreMock.selectedSlot.mockReturnValue(null);
      fixture.detectChanges(false);

      const emptyState = fixture.nativeElement.querySelector('.empty-state');
      expect(emptyState).toBeTruthy();
      expect(emptyState.querySelector('h2')?.textContent.trim()).toBe('No booking selected');
    });

    it('should show confirmation card when slot is selected', () => {
      fixture.detectChanges(false);

      const confirmationCard = fixture.nativeElement.querySelector('.confirmation-card');
      expect(confirmationCard).toBeTruthy();
    });

    it('should display booking details when slot is selected', () => {
      fixture.detectChanges(false);

      const details = fixture.nativeElement.querySelector('.booking-details');
      expect(details).toBeTruthy();
    });

    it('should display service name in booking details', () => {
      fixture.detectChanges(false);

      const values = fixture.nativeElement.querySelectorAll('.value');
      expect(values[0]?.textContent.trim()).toBe('Standard Service');
    });

    it('should display slot time in booking details', () => {
      fixture.detectChanges(false);

      const values = fixture.nativeElement.querySelectorAll('.value');
      // Time is the 3rd value (after service name and date)
      expect(values[2]?.textContent.trim()).toBe('09:00');
    });

    it('should display service duration in booking details', () => {
      fixture.detectChanges(false);

      const values = fixture.nativeElement.querySelectorAll('.value');
      expect(values[3]?.textContent.trim()).toBe('30 minutes');
    });

    it('should display service price in booking details', () => {
      fixture.detectChanges(false);

      const values = fixture.nativeElement.querySelectorAll('.value');
      expect(values[4]?.textContent.trim()).toContain('$50');
    });

    it('should call bookSlot on confirmBooking with valid slot and user', () => {
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
      authStoreMock.user.mockReturnValue(mockUser);

      component.confirmBooking();

      expect(bookingStoreMock.bookSlot).toHaveBeenCalledWith('slot-1', 'user-123');
    });

    it('should navigate to /booking/success on confirmBooking', () => {
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
      authStoreMock.user.mockReturnValue(mockUser);
      jest.spyOn(router, 'navigate');

      component.confirmBooking();

      expect(router.navigate).toHaveBeenCalledWith(['/booking/success']);
    });

    it('should not call bookSlot when slot is null', () => {
      bookingStoreMock.selectedSlot.mockReturnValue(null);
      authStoreMock.user.mockReturnValue(mockUser);
      jest.spyOn(router, 'navigate');

      component.confirmBooking();

      expect(bookingStoreMock.bookSlot).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should not call bookSlot when user is null', () => {
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
      authStoreMock.user.mockReturnValue(null);
      jest.spyOn(router, 'navigate');

      component.confirmBooking();

      expect(bookingStoreMock.bookSlot).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('booking cancellation', () => {
    it('should call selectSlot(null) on cancelBooking', () => {
      component.cancelBooking();

      expect(bookingStoreMock.selectSlot).toHaveBeenCalledWith(null);
    });

    it('should navigate to /booking on cancelBooking', () => {
      jest.spyOn(router, 'navigate');

      component.cancelBooking();

      expect(router.navigate).toHaveBeenCalledWith(['/booking']);
    });
  });

  describe('navigation', () => {
    it('should have back to booking link in empty state', () => {
      bookingStoreMock.hasSelection.mockReturnValue(false);
      bookingStoreMock.selectedSlot.mockReturnValue(null);
      fixture.detectChanges(false);

      const link = fixture.nativeElement.querySelector('button[routerLink="/booking"]');
      expect(link).toBeTruthy();
      expect(link.textContent.trim()).toBe('Back to Booking');
    });
  });

  describe('display of booking details', () => {
    beforeEach(() => {
      bookingStoreMock.hasSelection.mockReturnValue(true);
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
    });

    it('should render all detail rows', () => {
      fixture.detectChanges(false);

      const rows = fixture.nativeElement.querySelectorAll('.detail-row');
      expect(rows.length).toBe(5); // Service, Date, Time, Duration, Price
    });

    it('should render labels for each detail', () => {
      fixture.detectChanges(false);

      const labels = fixture.nativeElement.querySelectorAll('.label');
      expect(labels[0]?.textContent.trim()).toBe('Service:');
      expect(labels[1]?.textContent.trim()).toBe('Date:');
      expect(labels[2]?.textContent.trim()).toBe('Time:');
      expect(labels[3]?.textContent.trim()).toBe('Duration:');
      expect(labels[4]?.textContent.trim()).toBe('Price:');
    });

    it('should render action buttons', () => {
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.actions button');
      expect(buttons.length).toBe(2);
    });
  });

  describe('empty state handling', () => {
    beforeEach(() => {
      bookingStoreMock.hasSelection.mockReturnValue(false);
      bookingStoreMock.selectedSlot.mockReturnValue(null);
    });

    it('should not show confirmation card when no selection', () => {
      fixture.detectChanges(false);

      const confirmationCard = fixture.nativeElement.querySelector('.confirmation-card');
      expect(confirmationCard).toBeFalsy();
    });

    it('should show empty state heading', () => {
      fixture.detectChanges(false);

      const emptyState = fixture.nativeElement.querySelector('.empty-state');
      expect(emptyState.querySelector('h2')?.textContent).toContain('No booking selected');
    });

    it('should show empty state description', () => {
      fixture.detectChanges(false);

      const emptyState = fixture.nativeElement.querySelector('.empty-state');
      expect(emptyState.querySelector('p')?.textContent).toContain('select a time slot');
    });
  });

  describe('error display', () => {
    beforeEach(() => {
      bookingStoreMock.hasSelection.mockReturnValue(true);
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
      bookingStoreMock.error.mockReturnValue(null);
    });

    it('should not show error message when error is null', () => {
      fixture.detectChanges(false);

      const errorMessage = fixture.nativeElement.querySelector('.error-message');
      expect(errorMessage).toBeFalsy();
    });

    it('should show error message when error has value', () => {
      bookingStoreMock.error.mockReturnValue('Booking failed');
      fixture.detectChanges(false);

      const errorMessage = fixture.nativeElement.querySelector('.error-message');
      expect(errorMessage).toBeTruthy();
      expect(errorMessage.textContent).toContain('Booking failed');
    });
  });

  describe('processing state', () => {
    beforeEach(() => {
      bookingStoreMock.hasSelection.mockReturnValue(true);
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
    });

    it('should disable buttons when isProcessing is true', () => {
      bookingStoreMock.isLoading.mockReturnValue(true);
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.actions button');
      buttons.forEach((btn: HTMLButtonElement) => {
        expect(btn.disabled).toBe(true);
      });
    });

    it('should enable buttons when isProcessing is false', () => {
      bookingStoreMock.isLoading.mockReturnValue(false);
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.actions button');
      buttons.forEach((btn: HTMLButtonElement) => {
        expect(btn.disabled).toBe(false);
      });
    });

    it('should show "Processing..." text when processing', () => {
      bookingStoreMock.isLoading.mockReturnValue(true);
      fixture.detectChanges(false);

      const confirmButton = fixture.nativeElement.querySelector('.btn-primary');
      expect(confirmButton.textContent.trim()).toBe('Processing...');
    });

    it('should show "Confirm Booking" text when not processing', () => {
      bookingStoreMock.isLoading.mockReturnValue(false);
      fixture.detectChanges(false);

      const confirmButton = fixture.nativeElement.querySelector('.btn-primary');
      expect(confirmButton.textContent.trim()).toBe('Confirm Booking');
    });
  });

  describe('template rendering', () => {
    beforeEach(() => {
      bookingStoreMock.hasSelection.mockReturnValue(true);
      bookingStoreMock.selectedSlot.mockReturnValue(mockSlot);
    });

    it('should render confirmation card heading', () => {
      fixture.detectChanges(false);

      const heading = fixture.nativeElement.querySelector('.confirmation-card h2');
      expect(heading?.textContent.trim()).toBe('Booking Confirmation');
    });

    it('should render Cancel button', () => {
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.actions button');
      const cancelButton = (Array.from(buttons) as HTMLButtonElement[]).find(
        (btn) => btn.textContent.trim() === 'Cancel'
      );
      expect(cancelButton).toBeTruthy();
    });

    it('should render Confirm Booking button', () => {
      fixture.detectChanges(false);

      const buttons = fixture.nativeElement.querySelectorAll('.actions button');
      const confirmButton = (Array.from(buttons) as HTMLButtonElement[]).find(
        (btn) => btn.textContent.trim() === 'Confirm Booking'
      );
      expect(confirmButton).toBeTruthy();
    });

    it('should have btn-secondary class on Cancel button', () => {
      fixture.detectChanges(false);

      const cancelButton = fixture.nativeElement.querySelector('.btn-secondary');
      expect(cancelButton).toBeTruthy();
    });

    it('should have btn-primary class on Confirm button', () => {
      fixture.detectChanges(false);

      const confirmButton = fixture.nativeElement.querySelector('.btn-primary');
      expect(confirmButton).toBeTruthy();
    });

    it('should render price with price class', () => {
      fixture.detectChanges(false);

      const priceElement = fixture.nativeElement.querySelector('.value.price');
      expect(priceElement).toBeTruthy();
    });
  });
});
