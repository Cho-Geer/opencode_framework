import { ComponentFixture, TestBed, DeferBlockBehavior } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { RegisterComponent } from './register.component';
import { AuthStore } from '../../../stores/auth/auth.store';
import { ApiService } from '../../../core/services/api.service';
import { SocketService } from '../../../core/services/socket.service';
import { of, throwError } from 'rxjs';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authStoreMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apiServiceMock: any;
  let socketServiceMock: { connect: jest.Mock };
  let router: Router;

  beforeEach(async () => {
    authStoreMock = {
      isLoading: jest.fn(() => false),
      error: jest.fn(() => null),
      setLoading: jest.fn(),
      setError: jest.fn(),
      loginSuccess: jest.fn(),
      setUserProfile: jest.fn(),
    };

    apiServiceMock = {
      registerSendCode: jest.fn(),
      registerComplete: jest.fn(),
      getUserProfile: jest.fn(),
    };

    socketServiceMock = {
      connect: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        RegisterComponent,
        ReactiveFormsModule,
      ],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: ApiService, useValue: apiServiceMock },
        { provide: SocketService, useValue: socketServiceMock },
      ],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize step1 form with contact field', () => {
      expect(component.step1Form).toBeTruthy();
      expect(component.step1Form.get('contact')).toBeTruthy();
    });

    it('should initialize step2 form with code, password, confirmPassword, name fields', () => {
      expect(component.step2Form).toBeTruthy();
      expect(component.step2Form.get('code')).toBeTruthy();
      expect(component.step2Form.get('password')).toBeTruthy();
      expect(component.step2Form.get('confirmPassword')).toBeTruthy();
      expect(component.step2Form.get('name')).toBeTruthy();
    });

    it('should initialize form fields as empty', () => {
      expect(component.step1Form.get('contact')?.value).toBe('');
      expect(component.step2Form.get('code')?.value).toBe('');
      expect(component.step2Form.get('password')?.value).toBe('');
      expect(component.step2Form.get('confirmPassword')?.value).toBe('');
      expect(component.step2Form.get('name')?.value).toBe('');
    });

    it('should reference store isLoading signal', () => {
      expect(component.isLoading).toBe(authStoreMock.isLoading);
    });

    it('should reference store error signal', () => {
      expect(component.error).toBe(authStoreMock.error);
    });

    it('should start on step 1', () => {
      expect(component.currentStep).toBe(1);
    });
  });

  describe('form validation - step1', () => {
    it('should mark contact as invalid when empty', () => {
      const contactControl = component.step1Form.get('contact');
      expect(contactControl?.invalid).toBe(true);
      expect(contactControl?.errors?.['required']).toBe(true);
    });

    it('should mark contact as valid when filled', () => {
      const contactControl = component.step1Form.get('contact');
      contactControl?.setValue('test@example.com');
      expect(contactControl?.valid).toBe(true);
    });
  });

  describe('form validation - step2', () => {
    it('should mark code as invalid when empty', () => {
      const codeControl = component.step2Form.get('code');
      expect(codeControl?.invalid).toBe(true);
      expect(codeControl?.errors?.['required']).toBe(true);
    });

    it('should mark code as invalid when not 6 digits', () => {
      const codeControl = component.step2Form.get('code');
      codeControl?.setValue('123');
      expect(codeControl?.invalid).toBe(true);
    });

    it('should mark code as valid when 6 digits', () => {
      const codeControl = component.step2Form.get('code');
      codeControl?.setValue('123456');
      expect(codeControl?.valid).toBe(true);
    });

    it('should mark name as invalid when empty', () => {
      const nameControl = component.step2Form.get('name');
      expect(nameControl?.invalid).toBe(true);
      expect(nameControl?.errors?.['required']).toBe(true);
    });

    it('should mark name as valid when filled', () => {
      const nameControl = component.step2Form.get('name');
      nameControl?.setValue('John Doe');
      expect(nameControl?.valid).toBe(true);
    });

    it('should mark password as invalid when empty', () => {
      const passwordControl = component.step2Form.get('password');
      expect(passwordControl?.invalid).toBe(true);
      expect(passwordControl?.errors?.['required']).toBe(true);
    });

    it('should mark password as invalid when not meeting strength requirements', () => {
      const passwordControl = component.step2Form.get('password');
      passwordControl?.setValue('weak');
      expect(passwordControl?.invalid).toBe(true);
      expect(passwordControl?.errors?.['passwordStrength']).toBeTruthy();
    });

    it('should mark password as valid when meeting all strength requirements', () => {
      const passwordControl = component.step2Form.get('password');
      passwordControl?.setValue('StrongP@ss1word');
      expect(passwordControl?.valid).toBe(true);
    });

    it('should mark confirmPassword as invalid when empty', () => {
      const confirmControl = component.step2Form.get('confirmPassword');
      expect(confirmControl?.invalid).toBe(true);
      expect(confirmControl?.errors?.['required']).toBe(true);
    });

    it('should mark confirmPassword as valid when filled', () => {
      const confirmControl = component.step2Form.get('confirmPassword');
      confirmControl?.setValue('StrongP@ss1word');
      expect(confirmControl?.errors?.['required']).toBeFalsy();
    });
  });

  describe('passwordMatchValidator', () => {
    it('should return passwordMismatch error when passwords do not match', () => {
      component.step2Form.patchValue({
        password: 'StrongP@ss1word',
        confirmPassword: 'different',
      });

      const error = component.passwordMatchValidator(component.step2Form);
      expect(error).toEqual({ passwordMismatch: true });
    });

    it('should set passwordMismatch error on confirmPassword control', () => {
      component.step2Form.patchValue({
        password: 'StrongP@ss1word',
        confirmPassword: 'different',
      });

      component.passwordMatchValidator(component.step2Form);

      const confirmErrors = component.step2Form.get('confirmPassword')?.errors;
      expect(confirmErrors?.['passwordMismatch']).toBe(true);
    });

    it('should return null when passwords match', () => {
      component.step2Form.patchValue({
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
      });

      const error = component.passwordMatchValidator(component.step2Form);
      expect(error).toBeNull();
    });

    it('should return null when both passwords are empty', () => {
      component.step2Form.patchValue({
        password: '',
        confirmPassword: '',
      });

      const error = component.passwordMatchValidator(component.step2Form);
      expect(error).toBeNull();
    });
  });

  describe('isStep1FieldInvalid()', () => {
    it('should return false for pristine fields', () => {
      expect(component.isStep1FieldInvalid('contact')).toBe(false);
    });

    it('should return false for valid fields even when touched', () => {
      component.step1Form.get('contact')?.markAsTouched();
      component.step1Form.get('contact')?.setValue('test@example.com');
      expect(component.isStep1FieldInvalid('contact')).toBe(false);
    });

    it('should return true for invalid, touched fields', () => {
      component.step1Form.get('contact')?.markAsTouched();
      expect(component.isStep1FieldInvalid('contact')).toBe(true);
    });

    it('should return true for invalid, dirty fields', () => {
      component.step1Form.get('contact')?.markAsDirty();
      component.step1Form.get('contact')?.setValue('');
      expect(component.isStep1FieldInvalid('contact')).toBe(true);
    });
  });

  describe('isStep2FieldInvalid()', () => {
    it('should return false for pristine fields', () => {
      expect(component.isStep2FieldInvalid('code')).toBe(false);
      expect(component.isStep2FieldInvalid('name')).toBe(false);
      expect(component.isStep2FieldInvalid('password')).toBe(false);
      expect(component.isStep2FieldInvalid('confirmPassword')).toBe(false);
    });

    it('should return true for invalid, touched fields', () => {
      component.step2Form.get('code')?.markAsTouched();
      expect(component.isStep2FieldInvalid('code')).toBe(true);
    });
  });

  describe('onSendCode()', () => {
    it('should not send code when form is invalid', () => {
      component.onSendCode();

      expect(apiServiceMock.registerSendCode).not.toHaveBeenCalled();
      expect(authStoreMock.setLoading).not.toHaveBeenCalled();
    });

    it('should send verification code when contact is valid', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      apiServiceMock.registerSendCode.mockReturnValue(of({ success: true }));

      component.onSendCode();

      expect(apiServiceMock.registerSendCode).toHaveBeenCalledWith({
        contact: 'test@example.com',
        contactType: 'email',
      });
    });

    it('should set loading state before making API call', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      apiServiceMock.registerSendCode.mockReturnValue(of({ success: true }));

      component.onSendCode();

      expect(authStoreMock.setLoading).toHaveBeenCalledWith(true);
    });

    it('should advance to step 2 on successful send', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      apiServiceMock.registerSendCode.mockReturnValue(of({ success: true }));

      component.onSendCode();

      expect(component.currentStep).toBe(2);
    });

    it('should start countdown after sending code', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      apiServiceMock.registerSendCode.mockReturnValue(of({ success: true }));

      component.onSendCode();

      expect(component.countdown).toBe(60);
    });

    it('should not send code when countdown is active', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.countdown = 30;
      apiServiceMock.registerSendCode.mockReturnValue(of({ success: true }));

      component.onSendCode();

      expect(apiServiceMock.registerSendCode).not.toHaveBeenCalled();
    });
  });

  describe('onCompleteRegistration()', () => {
    it('should not complete registration when step2 form is invalid', () => {
      component.onCompleteRegistration();

      expect(apiServiceMock.registerComplete).not.toHaveBeenCalled();
      expect(authStoreMock.setLoading).not.toHaveBeenCalled();
    });

    it('should not complete registration when terms are not accepted', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.step2Form.patchValue({
        code: '123456',
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
        name: 'Test User',
      });
      component.acceptTerms = false;

      component.onCompleteRegistration();

      expect(apiServiceMock.registerComplete).not.toHaveBeenCalled();
    });

    it('should call api.registerComplete with registration data when form is valid and terms accepted', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.step2Form.patchValue({
        code: '123456',
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
        name: 'Test User',
      });
      component.acceptTerms = true;
      apiServiceMock.registerComplete.mockReturnValue(of({ accessToken: 'token', refreshToken: 'refresh' }));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onCompleteRegistration();

      expect(apiServiceMock.registerComplete).toHaveBeenCalledWith({
        contact: 'test@example.com',
        contactType: 'email',
        code: '123456',
        password: 'StrongP@ss1word',
        name: 'Test User',
      });
    });

    it('should set loading state before making API call', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.step2Form.patchValue({
        code: '123456',
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
        name: 'Test User',
      });
      component.acceptTerms = true;
      apiServiceMock.registerComplete.mockReturnValue(of({ accessToken: 'token', refreshToken: 'refresh' }));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onCompleteRegistration();

      expect(authStoreMock.setLoading).toHaveBeenCalledWith(true);
    });

    it('should navigate to /booking on successful registration', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.step2Form.patchValue({
        code: '123456',
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
        name: 'Test User',
      });
      component.acceptTerms = true;
      apiServiceMock.registerComplete.mockReturnValue(of({ accessToken: 'token', refreshToken: 'refresh' }));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));
      jest.spyOn(router, 'navigate');

      component.onCompleteRegistration();

      expect(router.navigate).toHaveBeenCalledWith(['/booking']);
    });

    it('should call loginSuccess with tokens on successful registration', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.step2Form.patchValue({
        code: '123456',
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
        name: 'Test User',
      });
      component.acceptTerms = true;
      apiServiceMock.registerComplete.mockReturnValue(of({ accessToken: 'token', refreshToken: 'refresh' }));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onCompleteRegistration();

      expect(authStoreMock.loginSuccess).toHaveBeenCalledWith('token', 'refresh');
    });

    it('should connect socket service on successful registration', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.step2Form.patchValue({
        code: '123456',
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
        name: 'Test User',
      });
      component.acceptTerms = true;
      apiServiceMock.registerComplete.mockReturnValue(of({ accessToken: 'token', refreshToken: 'refresh' }));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onCompleteRegistration();

      expect(socketServiceMock.connect).toHaveBeenCalled();
    });

    it('should set error on registration failure', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      component.step2Form.patchValue({
        code: '123456',
        password: 'StrongP@ss1word',
        confirmPassword: 'StrongP@ss1word',
        name: 'Test User',
      });
      component.acceptTerms = true;
      apiServiceMock.registerComplete.mockReturnValue(throwError(() => new Error('Email already exists')));

      component.onCompleteRegistration();

      // setError is called twice (once with null to clear, then with error message)
      expect(authStoreMock.setError).toHaveBeenLastCalledWith('Email already exists');
    });
  });

  describe('sendVerifyCode()', () => {
    it('should delegate to onSendCode', () => {
      jest.spyOn(component, 'onSendCode');
      component.sendVerifyCode();
      expect(component.onSendCode).toHaveBeenCalled();
    });
  });

  describe('goToStep1()', () => {
    it('should reset to step 1 and clear error', () => {
      component.currentStep = 2;
      component.countdown = 30;
      component.goToStep1();

      expect(component.currentStep).toBe(1);
      expect(authStoreMock.setError).toHaveBeenCalledWith(null);
      expect(component.countdown).toBe(0);
    });
  });

  describe('loading state', () => {
    it('should disable submit button when form is invalid (step1)', () => {
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector('button[type="submit"]');
      expect(button.disabled).toBe(true);
    });

    it('should disable submit button when isLoading is true', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      authStoreMock.isLoading.mockReturnValue(true);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button[type="submit"]');
      expect(button.disabled).toBe(true);
    });

    it('should enable submit button when form is valid and not loading', () => {
      component.step1Form.get('contact')?.setValue('test@example.com');
      authStoreMock.isLoading.mockReturnValue(false);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button[type="submit"]');
      expect(button.disabled).toBe(false);
    });
  });

  describe('template rendering', () => {
    it('should render step 1 by default', () => {
      const form = fixture.nativeElement.querySelector('form');
      expect(form).toBeTruthy();
    });

    it('should render step 2 when currentStep is 2', () => {
      // Use detectChanges without checkNoChanges by re-creating fixture
      fixture.destroy();

      fixture = TestBed.createComponent(RegisterComponent);
      component = fixture.componentInstance;
      component.currentStep = 2;
      fixture.detectChanges();

      const appRegisterForm = fixture.nativeElement.querySelector('app-register-form');
      expect(appRegisterForm).toBeTruthy();
    });

    it('should render contact input field', () => {
      const contactInput = fixture.nativeElement.querySelector('#contact');
      expect(contactInput).toBeTruthy();
      expect(contactInput.type).toBe('email');
    });

    it('should not show error message when error is null', () => {
      const globalError = fixture.nativeElement.querySelector('.global-error');
      expect(globalError).toBeFalsy();
    });

    it('should show error message when error has value', () => {
      fixture.destroy();

      fixture = TestBed.createComponent(RegisterComponent);
      component = fixture.componentInstance;
      router = TestBed.inject(Router);
      // Set error before first detectChanges so template renders with it
      authStoreMock.error.mockReturnValue('Registration failed');
      fixture.detectChanges();

      const globalError = fixture.nativeElement.querySelector('.global-error');
      expect(globalError).toBeTruthy();
      expect(globalError.textContent).toContain('Registration failed');
    });

    it('should show login link', () => {
      const link = fixture.nativeElement.querySelector('a[routerLink="/auth/login"]');
      expect(link).toBeTruthy();
      expect(link.textContent.trim()).toBe('登录');
    });
  });
});
