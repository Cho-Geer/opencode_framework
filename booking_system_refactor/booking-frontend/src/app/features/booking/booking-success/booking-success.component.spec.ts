import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BookingSuccessComponent } from './booking-success.component';
import { BookingStore } from '../../../stores/booking/booking.store';
import { AuthStore } from '../../../stores/auth/auth.store';
import { signal } from '@angular/core';

describe('BookingSuccessComponent', () => {
  let fixture: ComponentFixture<BookingSuccessComponent>;
  let component: BookingSuccessComponent;
  let router: Router;

  const mockSlot = {
    id: 'slot-1',
    date: '2026-04-20',
    time: '10:00',
    isActive: false,
    bookedBy: 'user-1',
  };

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['user'],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookingSuccessComponent],
      providers: [
        provideRouter([]),
        {
          provide: BookingStore,
          useValue: {
            selectedSlot: signal(mockSlot),
            hasSelection: signal(true),
          },
        },
        {
          provide: AuthStore,
          useValue: {
            currentUser: signal(mockUser),
            isAuthenticated: signal(true),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookingSuccessComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    jest.spyOn(router, 'navigate').mockReturnValue(Promise.resolve(true));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render "Booking Confirmed!" heading', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Booking Confirmed!');
  });

  it('should display success icon', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const checkmark = compiled.querySelector('.success-checkmark');
    expect(checkmark).toBeTruthy();
  });

  it('should display booking time when slot is available', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('10:00');
  });

  it('should display confirmation email message', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('test@example.com');
  });

  it('should navigate to "/booking" when viewMyBookings is called', () => {
    component.viewMyBookings();
    expect(router.navigate).toHaveBeenCalledWith(['/booking']);
  });

  it('should navigate to "/booking" when goHome is called', () => {
    component.goHome();
    expect(router.navigate).toHaveBeenCalledWith(['/booking']);
  });
});
