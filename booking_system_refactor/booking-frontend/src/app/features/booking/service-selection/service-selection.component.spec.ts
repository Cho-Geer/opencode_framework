import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ServiceSelectionComponent } from './service-selection.component';
import { BookingStore, TimeSlot } from '../../../stores/booking/booking.store';
import { BookingService } from '../booking.service';
import { ApiService, Service } from '../../../core/services/api.service';
import { of, throwError, Subject } from 'rxjs';

describe('ServiceSelectionComponent', () => {
  let component: ServiceSelectionComponent;
  let fixture: ComponentFixture<ServiceSelectionComponent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storeMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bookingServiceMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apiServiceMock: any;

  const mockServices: Service[] = [
    { id: 'svc-1', name: 'Haircut', description: 'Standard haircut', durationMinutes: 30, price: 25 },
    { id: 'svc-2', name: 'Coloring', description: 'Hair coloring', durationMinutes: 60, price: 50 },
    { id: 'svc-3', name: 'Styling', description: 'Hair styling', durationMinutes: 45, price: 35 },
  ];

  beforeEach(async () => {
    storeMock = {
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

    bookingServiceMock = {
      generatePreferSeq: jest.fn(() => 3),
      generateIdempotencyKey: jest.fn(() => 'key-123'),
      reserveSlot: jest.fn(),
      cancelBooking: jest.fn(),
    };

    apiServiceMock = {
      getServices: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ServiceSelectionComponent],
      providers: [
        { provide: BookingStore, useValue: storeMock },
        { provide: BookingService, useValue: bookingServiceMock },
        { provide: ApiService, useValue: apiServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceSelectionComponent);
    component = fixture.componentInstance;
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize services signal as empty array', () => {
      expect(component.services()).toEqual([]);
    });

    it('should initialize selectedServiceId signal as null', () => {
      expect(component.selectedServiceId()).toBeNull();
    });

    it('should initialize isLoading signal as false', () => {
      expect(component.isLoading()).toBe(false);
    });

    it('should call loadServices in constructor', () => {
      apiServiceMock.getServices.mockReturnValue(of(mockServices));
      fixture.detectChanges();

      expect(apiServiceMock.getServices).toHaveBeenCalled();
    });
  });

  describe('loadServices()', () => {
    it('should set isLoading to true before API call', () => {
      const subject = new Subject<typeof mockServices>();
      apiServiceMock.getServices.mockReturnValue(subject.asObservable());

      component.isLoading.set(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).loadServices();

      expect(component.isLoading()).toBe(true);

      subject.next(mockServices);
      subject.complete();
    });

    it('should populate services signal on successful API response', () => {
      apiServiceMock.getServices.mockReturnValue(of(mockServices));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).loadServices();

      expect(component.services()).toEqual(mockServices);
    });

    it('should set isLoading to false on successful API response', () => {
      apiServiceMock.getServices.mockReturnValue(of(mockServices));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).loadServices();

      expect(component.isLoading()).toBe(false);
    });

    it('should set isLoading to false on API error', () => {
      apiServiceMock.getServices.mockReturnValue(throwError(() => new Error('Network error')));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).loadServices();

      expect(component.isLoading()).toBe(false);
    });

    it('should handle empty services list', () => {
      apiServiceMock.getServices.mockReturnValue(of([]));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).loadServices();

      expect(component.services()).toEqual([]);
      expect(component.isLoading()).toBe(false);
    });
  });

  describe('selectService()', () => {
    it('should set selectedServiceId to the selected service id', () => {
      const service = mockServices[0];
      component.selectService(service);

      expect(component.selectedServiceId()).toBe('svc-1');
    });

    it('should call store.loadSlots with empty array', () => {
      const service = mockServices[0];
      component.selectService(service);

      expect(storeMock.loadSlots).toHaveBeenCalledWith([]);
    });

    it('should update selection when different service is selected', () => {
      component.selectService(mockServices[0]);
      expect(component.selectedServiceId()).toBe('svc-1');

      component.selectService(mockServices[1]);
      expect(component.selectedServiceId()).toBe('svc-2');
    });

    it('should call loadSlotsForService with the service id', () => {
      const service = mockServices[1];
      jest.spyOn(component as any, 'loadSlotsForService');

      component.selectService(service);

      expect((component as any).loadSlotsForService).toHaveBeenCalledWith('svc-2');
    });
  });

  describe('isSelected()', () => {
    it('should return true for selected service', () => {
      component.selectedServiceId.set('svc-1');
      const service = mockServices[0];

      expect(component.isSelected(service)).toBe(true);
    });

    it('should return false for non-selected service', () => {
      component.selectedServiceId.set('svc-1');
      const service = mockServices[1];

      expect(component.isSelected(service)).toBe(false);
    });

    it('should return false when no service is selected', () => {
      component.selectedServiceId.set(null);

      expect(component.isSelected(mockServices[0])).toBe(false);
    });
  });

  describe('template rendering', () => {
    beforeEach(() => {
      apiServiceMock.getServices.mockReturnValue(of(mockServices));
      fixture.detectChanges();
    });

    it('should render service cards for each service', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      expect(cards.length).toBe(3);
    });

    it('should render service name in each card', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      expect(cards[0].querySelector('h3')?.textContent.trim()).toBe('Haircut');
      expect(cards[1].querySelector('h3')?.textContent.trim()).toBe('Coloring');
      expect(cards[2].querySelector('h3')?.textContent.trim()).toBe('Styling');
    });

    it('should render service description in each card', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      expect(cards[0].querySelector('p')?.textContent.trim()).toBe('Standard haircut');
    });

    it('should render service duration', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      expect(cards[0].querySelector('.duration')?.textContent.trim()).toBe('30 min');
    });

    it('should render service price', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      expect(cards[0].querySelector('.price')?.textContent.trim()).toContain('$25');
    });

    it('should not show loading state when not loading', () => {
      const loading = fixture.nativeElement.querySelector('.loading');
      expect(loading).toBeFalsy();
    });

    it('should show loading state when isLoading is true', () => {
      component.isLoading.set(true);
      fixture.detectChanges();

      const loading = fixture.nativeElement.querySelector('.loading');
      expect(loading).toBeTruthy();
      expect(loading.textContent.trim()).toBe('Loading services...');
    });

    it('should highlight selected service card', () => {
      component.selectService(mockServices[0]);
      fixture.detectChanges();

      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      expect(cards[0].classList.contains('selected')).toBe(true);
      expect(cards[1].classList.contains('selected')).toBe(false);
    });
  });

  describe('user interaction', () => {
    beforeEach(() => {
      apiServiceMock.getServices.mockReturnValue(of(mockServices));
      fixture.detectChanges();
    });

    it('should select service on card click', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      cards[0].click();

      expect(component.selectedServiceId()).toBe('svc-1');
    });

    it('should select service on Enter key press', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      cards[1].dispatchEvent(event);

      expect(component.selectedServiceId()).toBe('svc-2');
    });

    it('should change selection when clicking different cards', () => {
      const cards = fixture.nativeElement.querySelectorAll('.service-card');

      cards[0].click();
      expect(component.selectedServiceId()).toBe('svc-1');

      cards[2].click();
      expect(component.selectedServiceId()).toBe('svc-3');
    });
  });

  describe('error state', () => {
    it('should handle empty services gracefully', () => {
      apiServiceMock.getServices.mockReturnValue(of([]));
      fixture.detectChanges();

      const cards = fixture.nativeElement.querySelectorAll('.service-card');
      expect(cards.length).toBe(0);
    });
  });
});
