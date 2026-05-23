import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessagesDropdownComponent } from './messages-dropdown.component';
import { AdminService } from '../../services/admin.service';
import { of } from 'rxjs';

describe('MessagesDropdownComponent', () => {
  let component: MessagesDropdownComponent;
  let fixture: ComponentFixture<MessagesDropdownComponent>;
  let mockAdminService: jest.Mocked<AdminService>;

  beforeEach(async () => {
    mockAdminService = {
      getMessageUnreadCount: jest.fn().mockReturnValue(of({ count: 5 })),
      getMessages: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 20 })),
    } as unknown as jest.Mocked<AdminService>;

    await TestBed.configureTestingModule({
      imports: [MessagesDropdownComponent],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MessagesDropdownComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── TEST: Component creation ───────────────────────────
  it('[Red] should create the component', () => {
    expect(component).toBeTruthy();
  });

  // ── TEST: Envelope icon button display ──────────────────
  it('[Red] should display envelope icon button', () => {
    const envelopeButton: HTMLButtonElement | null = fixture.nativeElement.querySelector('.envelope-button');
    expect(envelopeButton).toBeTruthy();
  });

  // ── TEST: Dropdown opens when envelope icon is clicked ──
  it('[Red] should open dropdown when envelope icon is clicked', () => {
    expect(component.dropdownOpen()).toBe(false);

    const envelopeButton: HTMLButtonElement | null = fixture.nativeElement.querySelector('.envelope-button');
    expect(envelopeButton).toBeTruthy();
    envelopeButton!.click();
    fixture.detectChanges();

    expect(component.dropdownOpen()).toBe(true);
  });

  // ── TEST: Dropdown closes when envelope icon is clicked again ──
  it('[Red] should close dropdown when envelope icon is clicked again while open', () => {
    // Open dropdown first
    component.toggleDropdown();
    fixture.detectChanges();
    expect(component.dropdownOpen()).toBe(true);

    // Click envelope button again
    const envelopeButton: HTMLButtonElement | null = fixture.nativeElement.querySelector('.envelope-button');
    expect(envelopeButton).toBeTruthy();
    envelopeButton!.click();
    fixture.detectChanges();

    expect(component.dropdownOpen()).toBe(false);
  });

  // ── TEST: Unread count badge display ────────────────────
  it('[Red] should display unread count badge', () => {
    component.messageCount.set(5);
    fixture.detectChanges();

    const badge: HTMLElement | null = fixture.nativeElement.querySelector('.unread-badge');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('5');
  });

  // ── TEST: Close button (X) should close dropdown ────────
  it('[Red] should close dropdown when close button (X) is clicked', () => {
    // Open dropdown first
    component.toggleDropdown();
    fixture.detectChanges();
    expect(component.dropdownOpen()).toBe(true);

    // Find and click the close button (X)
    const closeButton: HTMLButtonElement | null = fixture.nativeElement.querySelector('.close-btn');
    expect(closeButton).toBeTruthy();
    closeButton!.click();
    fixture.detectChanges();

    expect(component.dropdownOpen()).toBe(false);
  });

  // ── TEST: Render message items from input ────────────────
  it('[Red] should render message items from input', () => {
    const testMessages = [
      {
        id: 'msg-1',
        senderName: 'System Admin',
        subject: 'Welcome',
        body: 'Your account has been created.',
        createdAt: '2026-05-19T10:00:00Z',
      },
      {
        id: 'msg-2',
        senderName: 'Support Team',
        subject: 'Maintenance Notice',
        body: 'Scheduled maintenance this weekend.',
        createdAt: '2026-05-18T08:30:00Z',
      },
    ];
    fixture.componentRef.setInput('messages', testMessages);
    fixture.detectChanges();

    // Open the dropdown to see messages
    component.toggleDropdown();
    fixture.detectChanges();

    const messageItems: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.message-item');
    expect(messageItems.length).toBe(2);

    expect(messageItems[0].textContent).toContain('System Admin');
    expect(messageItems[0].textContent).toContain('Welcome');
    expect(messageItems[1].textContent).toContain('Support Team');
    expect(messageItems[1].textContent).toContain('Maintenance Notice');
  });
});
