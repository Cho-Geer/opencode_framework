import { Component, inject, OnDestroy } from '@angular/core';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthStore } from '../../../stores/auth/auth.store';
import { ApiService } from '../../../core/services/api.service';
import { SocketService } from '../../../core/services/socket.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ContactType,
  RegisterSendCodeDto,
  RegisterCompleteDto,
} from '../dto/auth.dto';

// Password strength validator matching backend requirements
const passwordStrengthValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (!value) return null;

  const hasUpperCase = /[A-Z]/.test(value);
  const hasLowerCase = /[a-z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSpecialChar = /[@$!%*?&]/.test(value);
  const isValidLength = value.length >= 8;

  const valid = hasUpperCase && hasLowerCase && hasNumber && hasSpecialChar && isValidLength;

  return valid ? null : {
    passwordStrength: {
      hasUpperCase,
      hasLowerCase,
      hasNumber,
      hasSpecialChar,
      isValidLength
    }
  };
};

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule, CommonModule, FormsModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent implements OnDestroy {
  private fb = inject(FormBuilder);
  private authStore = inject(AuthStore);
  private api = inject(ApiService);
  private socketService = inject(SocketService);
  private router = inject(Router);

  // Step state: 1 = send code, 2 = complete registration
  currentStep = 1;

  // Contact type selection
  contactType = ContactType.EMAIL;
  ContactType = ContactType; // Expose enum to template

  // Terms acceptance
  acceptTerms = false;

  // Countdown state
  countdown = 0;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  // Step 1 Form: Contact info
  step1Form = this.fb.group({
    contact: ['', [Validators.required]],
  });

  // Step 2 Form: Complete registration
  step2Form = this.fb.group(
    {
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
      password: ['', [Validators.required, passwordStrengthValidator]],
      confirmPassword: ['', [Validators.required]],
      name: ['', [Validators.required, Validators.minLength(2)]],
    },
    { validators: this.passwordMatchValidator }
  );

  // Observable signals (with $ suffix per convention)
  isLoading$ = this.authStore.isLoading;
  error$ = this.authStore.error;

  ngOnDestroy(): void {
    this.clearCountdown();
  }

  // Step 1: Send verification code
  onSendCode(): void {
    if (this.countdown > 0) return;

    const contactControl = this.step1Form.get('contact');
    if (contactControl?.invalid) {
      contactControl.markAsTouched();
      return;
    }

    const contact = contactControl?.value;
    if (!contact) return;

    this.authStore.setLoading(true);
    this.authStore.setError(null);

    const dto: RegisterSendCodeDto = {
      contact: contact.trim(),
      contactType: this.contactType,
    };

    this.api.registerSendCode(dto).subscribe({
      next: () => {
        this.authStore.setLoading(false);
        this.currentStep = 2;
        this.startCountdown();
      },
      error: (err) => {
        this.authStore.setLoading(false);
        this.authStore.setError(err.message || 'Failed to send verification code. Please try again later.');
      },
    });
  }

  // Step 2: Complete registration
  onCompleteRegistration(): void {
    if (this.authStore.isLoading() || this.step2Form.invalid || !this.acceptTerms) return;

    const contact = this.step1Form.get('contact')?.value;
    if (!contact) return;

    const { code, password, name, confirmPassword } = this.step2Form.value;
    if (!code || !password || !name || !confirmPassword) return;

    this.authStore.setLoading(true);
    this.authStore.setError(null);

    const dto: RegisterCompleteDto = {
      contact: contact.trim(),
      contactType: this.contactType,
      code,
      password,
      name,
    };

    this.api.registerComplete(dto).subscribe({
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
        this.authStore.setError(err.message || 'Registration failed. Please check your information and try again.');
      },
    });
  }

  // Go back to step 1
  goToStep1(): void {
    this.currentStep = 1;
    this.authStore.setError(null);
    this.clearCountdown();
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

  passwordMatchValidator(
    control: AbstractControl
  ): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;

    if (password && password !== confirmPassword) {
      control.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }

    return null;
  }

  isStep1FieldInvalid(fieldName: string): boolean {
    const field = this.step1Form.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  isStep2FieldInvalid(fieldName: string): boolean {
    const field = this.step2Form.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  // Password requirements computed property
  get passwordRequirements() {
    const val = this.step2Form.get('password')?.value || '';
    return {
      hasMinLength: val.length >= 8,
      hasUpperCase: /[A-Z]/.test(val),
      hasLowerCase: /[a-z]/.test(val),
      hasNumber: /\d/.test(val),
      hasSpecialChar: /[@$!%*?&]/.test(val),
    };
  }
}
