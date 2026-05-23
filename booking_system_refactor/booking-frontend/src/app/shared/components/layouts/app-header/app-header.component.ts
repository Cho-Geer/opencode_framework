import { Component, OnInit, computed, inject, input, output, signal, HostListener, TemplateRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { Menu } from 'primeng/menu';
import { ThemeToggleComponent } from '../../molecules/theme-toggle/theme-toggle.component';
import { MessagesDropdownComponent } from '../../../../features/admin/molecules/messages-dropdown/messages-dropdown.component';
import { NotificationBellComponent } from '../../../../features/admin/molecules/notification-bell/notification-bell.component';
import { TranslatePipe } from '../../../pipes/translate.pipe';
import { AdminService } from '../../../../features/admin/services/admin.service';

export interface NavLink {
  label: string;
  route: string;
  icon?: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink,
    Menu,
    ThemeToggleComponent,
    NotificationBellComponent,
    MessagesDropdownComponent,
    NgTemplateOutlet,
    TranslatePipe,
  ],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  host: { class: 'z-50' },
})
export class AppHeaderComponent implements OnInit {
  private adminService = inject(AdminService);

  readonly navLinks = input<NavLink[]>([]);
  readonly userName = input<string>();
  readonly userRole = input<string>();
  readonly userAvatar = input<string>();
  readonly isAdmin = input<boolean>(false);
  readonly menuItems = input<MenuItem[]>([]);
  readonly notificationCount = input<number>(0);
  readonly messageCount = input<number>(0);
  readonly messages = input<any[]>([]);
  readonly showSearch = input<boolean>(true);
  readonly extraActions = input<TemplateRef<unknown> | null>(null);

  readonly menuToggle = output<void>();
  readonly logout = output<void>();

  /** Locally-fetched unread message count (fallback when input not provided) */
  private _localMessageCount = signal<number>(0);

  /** Locally-fetched messages list (fallback when input not provided, or lazy-fetched on open) */
  private _localMessages = signal<any[]>([]);

  /** Whether local messages have been fetched at least once */
  private _messagesFetched = false;

  /**
   * Effective message count: prefer parent input (>0), fallback to locally fetched count.
   * The parent (AppLayout) provides messageCount via adminStore, but the header also
   * fetches independently as a fallback.
   */
  readonly effectiveMessageCount = computed(() => this.messageCount() || this._localMessageCount());

  /**
   * Effective messages: prefer parent input (non-empty), fallback to locally fetched.
   * The header fetches messages lazily when the dropdown is first opened.
   */
  readonly effectiveMessages = computed(() => {
    const parentMessages = this.messages();
    if (parentMessages.length > 0) return parentMessages;
    return this._localMessages();
  });

  sidebarOpen = false;

  readonly scrollY = signal(0);

  constructor() {
    // Use effect to detect when messageCount input changes from parent (e.g., store-loaded value)
  }

  ngOnInit(): void {
    // Fetch unread count on init as fallback/independent source
    this.adminService.getMessageUnreadCount().subscribe({
      next: (result) => {
        this._localMessageCount.set(result.count);
      },
      error: () => {
        this._localMessageCount.set(0);
      },
    });
  }

  /**
   * Called when the messages dropdown wrapper area is interacted with.
   * Lazily fetches messages from the API on first open to avoid
   * unnecessary network requests before the user opens the dropdown.
   */
  onMessagesAreaClick(): void {
    if (this._messagesFetched) return;
    this._messagesFetched = true;

    this.adminService.getMessages().subscribe({
      next: (result) => {
        this._localMessages.set(result.items);
      },
      error: () => {
        this._localMessages.set([]);
      },
    });
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.scrollY.set(window.scrollY);
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
    this.menuToggle.emit();
  }

  onLogout(): void {
    this.logout.emit();
  }
}
