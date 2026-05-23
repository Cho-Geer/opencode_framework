import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { filter } from 'rxjs/operators';
import { AuthStore } from '../../../../stores/auth/auth.store';
import { AdminStore } from '../../../../features/admin/stores/admin.store';
import { AppHeaderComponent, NavLink } from '../app-header/app-header.component';
import { AppSidebarComponent, SidebarItem, SidebarSection } from '../app-sidebar/app-sidebar.component';
import { TranslationService } from '../../../../core/services/translation.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, AppHeaderComponent, AppSidebarComponent],
  templateUrl: './app-layout.component.html',
  styleUrl: './app-layout.component.scss',
})
export class AppLayoutComponent implements OnInit {
  private authStore = inject(AuthStore);
  private router = inject(Router);
  private adminStore = inject(AdminStore);
  private translationService = inject(TranslationService);

  readonly user = this.authStore.currentUser;
  readonly isAuthenticated = this.authStore.isAuthenticated;

  readonly userName = computed(() => this.user()?.name);
  readonly userRole = computed(() => this.user()?.role);
  readonly isAdmin = computed(
    () => this.userRole() === 'ADMIN' || this.userRole() === 'SUPER_ADMIN',
  );

  readonly currentUrl = signal(this.router.url);
  readonly isAdminRoute = computed(() => this.currentUrl().startsWith('/admin'));

  readonly notificationCount = computed(() => {
    if (!this.isAdminRoute()) return 0;
    return this.adminStore.unreadCount();
 
  });
  readonly messageCount = computed(() => {
    if (!this.isAdminRoute()) return 0;
    return this.adminStore.messageCount();
  });

  readonly messages = computed<any[]>(() => {
    return [];
  });

  readonly navLinks = computed<NavLink[]>(() => {
    if (this.isAdmin()) {
      return [
        { label: 'sidebar.dashboard', route: '/admin/dashboard', icon: 'pi pi-chart-bar' },
        { label: 'sidebar.booking', route: '/booking/services', icon: 'pi pi-calendar' },
        { label: 'sidebar.myBookings', route: '/my-bookings', icon: 'pi pi-list' },
        { label: 'sidebar.profile', route: '/profile', icon: 'pi pi-user' },
      ];
    }
    return [
      { label: 'sidebar.booking', route: '/booking/services', icon: 'pi pi-calendar' },
      { label: 'sidebar.myBookings', route: '/my-bookings', icon: 'pi pi-list' },
      { label: 'sidebar.profile', route: '/profile', icon: 'pi pi-user' },
    ];
  });

  /** Sidebar items for customer (non-admin) users */
  readonly customerSidebarItems: SidebarItem[] = [
    { label: 'sidebar.bookingServices', route: '/booking/services', icon: 'pi pi-calendar' },
    { label: 'sidebar.myBookings', route: '/my-bookings', icon: 'pi pi-list' },
    { label: 'sidebar.profile', route: '/profile', icon: 'pi pi-user' },
  ];

  /** Sidebar items for admin users */
  readonly adminSidebarItems: SidebarItem[] = [
    { label: 'sidebar.dashboard', route: '/admin/dashboard', icon: 'pi pi-chart-bar' },
    { label: 'sidebar.bookings', route: '/admin/appointments', icon: 'pi pi-calendar' },
    { label: 'sidebar.users', route: '/admin/users', icon: 'pi pi-users' },
    { label: 'sidebar.services', route: '/admin/services', icon: 'pi pi-briefcase' },
    { label: 'sidebar.reports', route: '/admin/analytics', icon: 'pi pi-chart-line' },
    { label: 'sidebar.history', route: '/admin/history', icon: 'pi pi-history' },
    { label: 'sidebar.settings', route: '/admin/settings', icon: 'pi pi-cog' },
  ];

  readonly sidebarItems = computed<SidebarItem[]>(() => {
    if (this.isAdmin()) {
      return this.adminSidebarItems;
    }
    return this.customerSidebarItems;
  });

  readonly sidebarSections = computed<SidebarSection[]>(() => {
    return [];
  });

  /** Whether sidebar should use solid (non-transparent) background */
  readonly sidebarSolid = computed(() => this.isAdminRoute());

  /** Whether to show search bar in header */
  readonly showSearchInHeader = computed(() => !this.isAdminRoute());

  readonly menuItems = computed<MenuItem[]>(() => [
    {
      label: this.userName() ?? 'User',
      items: [
        {
          label: this.translationService.t('sidebar', 'profile'),
          icon: 'pi pi-user',
          routerLink: '/profile',
        },
        {
          label: this.translationService.t('sidebar', 'security'),
          icon: 'pi pi-lock',
          command: () => this.router.navigate(['/profile']),
        },
        { separator: true },
        {
          label: this.translationService.t('sidebar', 'logout'),
          icon: 'pi pi-sign-out',
          command: () => this.onLogout(),
        },
      ],
    },
  ]);

  sidebarOpen = false;

  onMenuToggle(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  async onLogout(): Promise<void> {
    await this.authStore.logout();
    await this.router.navigate(['/auth/login']);
  }

  async ngOnInit(): Promise<void> {
    // Track current route for admin mode detection
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
      });

    // Attempt to restore session via HttpOnly refresh cookie on app boot
    if (!this.isAuthenticated()) {
      await this.authStore.restoreSession();
    }

    // Load unread message count for the header badge
    await this.adminStore.loadMessageCount();
  }
}
