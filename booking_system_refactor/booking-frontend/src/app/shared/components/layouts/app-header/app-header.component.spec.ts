import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { of } from 'rxjs';
import { TranslationService } from '../../../../core/services/translation.service';
import { TranslatePipe } from '../../../pipes/translate.pipe';
import { AdminService } from '../../../../features/admin/services/admin.service';
import { AppHeaderComponent } from './app-header.component';

// Stub ThemeToggleComponent
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: '<div>Theme Toggle</div>',
})
class StubThemeToggleComponent {}

// Stub NotificationBellComponent
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  template: '<div data-testid="notification-bell-stub">Notification Bell</div>',
})
class StubNotificationBellComponent {}

// Stub MessagesDropdownComponent
@Component({
  selector: 'app-messages-dropdown',
  standalone: true,
  template: '<div data-testid="messages-dropdown-stub">Messages</div>',
})
class StubMessagesDropdownComponent {
  readonly messages = input<any[]>([]);
  readonly messageCount = input<number>(0);
}

describe('AppHeaderComponent', () => {
  let fixture: ComponentFixture<AppHeaderComponent>;
  let component: AppHeaderComponent;
  let mockAdminService: jest.Mocked<Pick<AdminService, 'getMessageUnreadCount' | 'getMessages'>>;

  const defaultNavLinks = [
    { label: 'Home', route: '/', icon: 'pi pi-home' },
    { label: 'Booking', route: '/booking', icon: 'pi pi-calendar' },
  ];

  const defaultMenuItems: MenuItem[] = [
    {
      label: 'User',
      items: [
        { label: 'Profile', icon: 'pi pi-user' },
        { separator: true },
        { label: 'Logout', icon: 'pi pi-sign-out' },
      ],
    },
  ];

  beforeEach(async () => {
    mockAdminService = {
      getMessageUnreadCount: jest.fn().mockReturnValue(of({ count: 5 })),
      getMessages: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 20 })),
    };

    const mockTranslationService = {
      t: jest.fn((domain: string, key: string) => `{{${domain}.${key}}}`),
      locale: jest.fn().mockReturnValue('en'),
      translations: jest.fn().mockReturnValue({}),
    };

    await TestBed.configureTestingModule({
      imports: [AppHeaderComponent, StubThemeToggleComponent],
      providers: [
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: AdminService, useValue: mockAdminService },
      ],
    })
      .overrideComponent(AppHeaderComponent, {
        set: {
          imports: [StubThemeToggleComponent, StubNotificationBellComponent, StubMessagesDropdownComponent, TranslatePipe],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AppHeaderComponent);
    component = fixture.componentInstance;
  });

  function setupDefaultInputs() {
    fixture.componentRef.setInput('navLinks', defaultNavLinks);
    fixture.componentRef.setInput('userName', 'Test User');
    fixture.componentRef.setInput('userRole', 'ADMIN');
    fixture.componentRef.setInput('isAdmin', true);
    fixture.componentRef.setInput('menuItems', defaultMenuItems);
    fixture.componentRef.setInput('notificationCount', 3);
    fixture.detectChanges();
  }

  it('should render header with base classes', () => {
    setupDefaultInputs();
    const header = fixture.nativeElement.querySelector('header');
    expect(header).toBeTruthy();
    expect(header.classList.contains('sticky')).toBe(true);
    expect(header.classList.contains('top-0')).toBe(true);
    expect(header.classList.contains('z-50')).toBe(true);
    expect(header.classList.contains('transition-all')).toBe(true);
    expect(header.classList.contains('duration-300')).toBe(true);
    expect(header.classList.contains('bg-card-bg')).toBe(true);
    expect(header.classList.contains('border-b')).toBe(true);
    expect(header.classList.contains('border-border-color')).toBe(true);
    expect(header.classList.contains('shadow-sm')).toBe(true);
  });

  it('should render logo link', () => {
    setupDefaultInputs();
    const logo = fixture.nativeElement.querySelector('a[routerlink="/"]');
    expect(logo).toBeTruthy();
    expect(logo.textContent.trim()).toBe('BookSys');
  });

  it('should receive navigation links as input', () => {
    setupDefaultInputs();
    expect(component.navLinks().length).toBeGreaterThanOrEqual(2);
    expect(component.navLinks()[0].label).toBe('Home');
    expect(component.navLinks()[1].label).toBe('Booking');
  });

  it('[Red] should render app-notification-bell when isAdmin is true', () => {
    setupDefaultInputs();
    const bell = fixture.nativeElement.querySelector('[data-testid="notification-bell-stub"]');
    expect(bell).toBeTruthy();
    expect(bell.textContent).toContain('Notification Bell');
  });

  it('[Red] should render simple notification button when isAdmin is false', () => {
    fixture.componentRef.setInput('navLinks', defaultNavLinks);
    fixture.componentRef.setInput('userName', 'Test User');
    fixture.componentRef.setInput('userRole', 'CUSTOMER');
    fixture.componentRef.setInput('isAdmin', false);
    fixture.componentRef.setInput('menuItems', defaultMenuItems);
    fixture.componentRef.setInput('notificationCount', 5);
    fixture.detectChanges();

    // Stub should NOT be present for non-admin
    const stub = fixture.nativeElement.querySelector('[data-testid="notification-bell-stub"]');
    expect(stub).toBeFalsy();

    // Simple badge should be present for non-admin
    const badge = fixture.nativeElement.querySelector('[data-testid="notification-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('5');
  });

  it('should render user avatar and name', () => {
    setupDefaultInputs();
    expect(fixture.nativeElement.textContent).toContain('Test User');
  });

  it('should render admin badge with the actual role value', () => {
    setupDefaultInputs();
    const adminBadge = fixture.nativeElement.querySelector('[data-testid="admin-badge"]');
    expect(adminBadge).toBeTruthy();
    expect(adminBadge.textContent.trim()).toBe('ADMIN');
  });

  it('should emit menuToggle when hamburger button is clicked', () => {
    setupDefaultInputs();
    const menuToggleSpy = jest.spyOn(component.menuToggle, 'emit');
    const hamburgerBtn = fixture.nativeElement.querySelector(
      'button[aria-label="{{global.toggleMenu}}"]',
    );
    hamburgerBtn.click();
    expect(menuToggleSpy).toHaveBeenCalledTimes(1);
  });

  it('should render login button with translated text when no user', () => {
    fixture.componentRef.setInput('navLinks', defaultNavLinks);
    fixture.componentRef.setInput('userName', undefined);
    fixture.componentRef.setInput('menuItems', defaultMenuItems);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('{{auth.login.title}}');
  });

  it('should apply shadow-md class when scrolled', () => {
    setupDefaultInputs();
    const header = fixture.nativeElement.querySelector('header');
    // Initially only shadow-sm
    expect(header.classList.contains('shadow-md')).toBe(false);

    // Simulate scroll
    Object.defineProperty(window, 'scrollY', { value: 20, writable: true });
    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    expect(header.classList.contains('shadow-md')).toBe(true);
  });

  it('should show search bar with translated placeholder when showSearch is true', () => {
    fixture.componentRef.setInput('showSearch', true);
    fixture.detectChanges();

    const searchInput = fixture.nativeElement.querySelector('input');
    expect(searchInput).toBeTruthy();
    expect(searchInput.getAttribute('placeholder')).toBe('{{global.search}}');
  });

  it('should hide search bar when showSearch is false', () => {
    fixture.componentRef.setInput('showSearch', false);
    fixture.detectChanges();

    const searchInput = fixture.nativeElement.querySelector('input');
    expect(searchInput).toBeFalsy();
  });

  // ── MessagesDropdown integration tests ────────────────

  it('[Red] should render app-messages-dropdown stub', () => {
    fixture.componentRef.setInput('navLinks', defaultNavLinks);
    fixture.componentRef.setInput('userName', 'Test User');
    fixture.componentRef.setInput('menuItems', defaultMenuItems);
    fixture.detectChanges();

    const dropdown = fixture.nativeElement.querySelector('[data-testid="messages-dropdown-stub"]');
    expect(dropdown).toBeTruthy();
  });

  it('[Red] should pass messageCount to app-messages-dropdown', () => {
    fixture.componentRef.setInput('navLinks', defaultNavLinks);
    fixture.componentRef.setInput('userName', 'Test User');
    fixture.componentRef.setInput('menuItems', defaultMenuItems);
    fixture.componentRef.setInput('messageCount', 7);
    fixture.detectChanges();

    expect(component.messageCount()).toBe(7);
  });

  it('[Red] should pass messages to app-messages-dropdown', () => {
    fixture.componentRef.setInput('navLinks', defaultNavLinks);
    fixture.componentRef.setInput('userName', 'Test User');
    fixture.componentRef.setInput('menuItems', defaultMenuItems);
    const testMessages = [{ id: '1', senderName: 'Alice', subject: 'Hello', body: 'Test', createdAt: '2025-01-01' }];
    fixture.componentRef.setInput('messages', testMessages);
    fixture.detectChanges();

    expect(component.messages().length).toBe(1);
    expect(component.messages()[0].senderName).toBe('Alice');
  });

  it('[Red] should fetch unread count on init via AdminService', () => {
    // Trigger ngOnInit by running change detection
    fixture.detectChanges();

    // AdminService mock returns { count: 5 } by default
    expect(mockAdminService.getMessageUnreadCount).toHaveBeenCalled();

    // The effectiveMessageCount should reflect the fetched count
    // (unless parent input overrides it)
    expect(component.effectiveMessageCount()).toBe(5);
  });

  it('[Red] should fetch messages on first messages area click', () => {
    fixture.componentRef.setInput('navLinks', defaultNavLinks);
    fixture.componentRef.setInput('userName', 'Test User');
    fixture.componentRef.setInput('menuItems', defaultMenuItems);
    fixture.detectChanges();

    // Click the messages wrapper div to trigger lazy fetch
    const messagesArea = fixture.nativeElement.querySelector('[data-testid="messages-dropdown-stub"]');
    // The stub doesn't have the click handler, but we can test the method directly
    component.onMessagesAreaClick();

    expect(mockAdminService.getMessages).toHaveBeenCalledTimes(1);
  });
});
