import { Component, inject, OnDestroy } from '@angular/core';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthStore } from '../../../stores/auth/auth.store';
import { ApiService } from '../../../core/services/api.service';
import { SocketService } from '../../../core/services/socket.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ContactType,
  LoginPasswordDto,
  LoginSendCodeDto,
  LoginVerifyCodeDto,
} from '../dto/auth.dto';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule, CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnDestroy {
  private fb = inject(FormBuilder);
  private authStore = inject(AuthStore);
  private api = inject(ApiService);
  private socketService = inject(SocketService);
  private router = inject(Router);

  // Tab state: 'password' = password login, 'code' = verification code login
  activeTab: 'password' | 'code' = 'password';

  // Contact type for code login
  contactType = ContactType.EMAIL;
  ContactType = ContactType; // Expose enum to template

  // Terms acceptance
  acceptTerms = false;

  // Countdown state
  countdown = 0;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  // Code login step: 1 = send code, 2 = verify code
  codeLoginStep = 1;

  // Password Login Form
  passwordForm = this.fb.group({
    contact: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  // Code Login Form
  codeLoginForm = this.fb.group({
    contact: ['', [Validators.required]],
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  // Observable signals (with $ suffix per convention)
  isLoading$ = this.authStore.isLoading;
  error$ = this.authStore.error;

  ngOnDestroy(): void {
    this.clearCountdown();
  }

  switchTab(tab: 'password' | 'code'): void {
    this.activeTab = tab;
    this.authStore.setError(null);
    this.clearCountdown();
    this.codeLoginStep = 1;
  }

  // Password Login
  onPasswordLogin(): void {
    if (this.authStore.isLoading() || this.passwordForm.invalid || !this.acceptTerms) return;

    const { contact, password } = this.passwordForm.value;
    if (!contact || !password) return;

    this.authStore.setLoading(true);
    this.authStore.setError(null);

    const dto: LoginPasswordDto = {
      contact: contact.trim(),
      contactType: this.contactType,
      password,
    };

    this.api.loginPassword(dto).subscribe({
      next: (response) => {
        // Store tokens (auth response has no user object)
        this.authStore.loginSuccess(response.accessToken, response.refreshToken);
        
        // Fetch user profile separately
        this.api.getUserProfile().subscribe({
          next: (profile) => {
            this.authStore.setUserProfile({
              id: profile.id,
              name: profile.name,
              role: profile.role,
              email: profile.email,
              phone: profile.phone,
              createdAt: profile.created_at,
            });
            
            // Connect socket and redirect
            this.socketService.connect();
            this.router.navigate(['/booking']);
          },
          error: () => {
            // Even if profile fetch fails, user is logged in
            this.socketService.connect();
            this.router.navigate(['/booking']);
          },
        });
      },
      error: (err) => {
        this.authStore.setError(err.message || 'Login failed. Please check your credentials and try again.');
      },
    });
  }

  // Code Login Step 1: Send verification code
  onSendCode(): void {
    if (this.countdown > 0) return;

    const contactControl = this.codeLoginForm.get('contact');
    if (contactControl?.invalid) {
      contactControl.markAsTouched();
      return;
    }

    const contact = contactControl?.value;
    if (!contact) return;

    this.authStore.setLoading(true);
    this.authStore.setError(null);

    const dto: LoginSendCodeDto = {
      contact: contact.trim(),
      contactType: this.contactType,
    };

    this.api.loginSendCode(dto).subscribe({
      next: () => {
        this.authStore.setLoading(false);
        this.codeLoginStep = 2;
        this.startCountdown();
      },
      error: (err) => {
        this.authStore.setLoading(false);
        this.authStore.setError(err.message || 'Failed to send verification code. Please try again later.');
      },
    });
  }

  // Code Login Step 2: Verify code and login
  onVerifyCode(): void {
    if (this.authStore.isLoading() || this.codeLoginForm.invalid || !this.acceptTerms) return;

    const contact = this.codeLoginForm.get('contact')?.value;
    const code = this.codeLoginForm.get('code')?.value;
    if (!contact || !code) return;

    this.authStore.setLoading(true);
    this.authStore.setError(null);

    const dto: LoginVerifyCodeDto = {
      contact: contact.trim(),
      contactType: this.contactType,
      code,
    };

    this.api.loginVerifyCode(dto).subscribe({
      next: (response) => {
        // Store tokens (auth response has no user object)
        this.authStore.loginSuccess(response.accessToken, response.refreshToken);
        
        // Fetch user profile separately
        this.api.getUserProfile().subscribe({
          next: (profile) => {
            this.authStore.setUserProfile({
              id: profile.id,
              name: profile.name,
              role: profile.role,
              email: profile.email,
              phone: profile.phone,
              createdAt: profile.created_at,
            });
            
            // Connect socket and redirect
            this.socketService.connect();
            this.router.navigate(['/booking']);
          },
          error: () => {
            // Even if profile fetch fails, user is logged in
            this.socketService.connect();
            this.router.navigate(['/booking']);
          },
        });
      },
      error: (err) => {
        this.authStore.setError(err.message || 'Verification failed. Please check your code and try again.');
      },
    });
  }

  onSubmit(): void {
    if (this.activeTab === 'password') {
      this.onPasswordLogin();
    } else {
      if (this.codeLoginStep === 1) {
        this.onSendCode();
      } else {
        this.onVerifyCode();
      }
    }
  }

  sendVerifyCode(): void {
    this.onSendCode();
  }

  startCountdown(): void {
    this.countdown = 60;
    this.countdownTimer = setInterval(() => {
      this.countdown--;
      if (this.countdown <= 0) {
        this.clearCountdown();
      }
    }, 1000);
  }

  clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdown = 0;
  }

  isPasswordFieldInvalid(fieldName: string): boolean {
    const field = this.passwordForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  isCodeFieldInvalid(fieldName: string): boolean {
    const field = this.codeLoginForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }
}
