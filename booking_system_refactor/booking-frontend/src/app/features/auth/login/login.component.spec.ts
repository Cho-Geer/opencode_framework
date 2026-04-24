import { ComponentFixture, TestBed, DeferBlockBehavior, DeferBlockState } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthStore, User } from '../../../stores/auth/auth.store';
import { ApiService } from '../../../core/services/api.service';
import { SocketService } from '../../../core/services/socket.service';
import { AuthFormComponent } from '../../../shared/components/molecules/auth-form/auth-form.component';
import { of, throwError } from 'rxjs';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authStoreMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apiServiceMock: any;
  let socketServiceMock: { connect: jest.Mock };
  let router: Router;

  const mockUser: User = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
  };

  const mockLoginResponse = {
    accessToken: 'jwt-token-123',
    refreshToken: 'refresh-token-123',
    expiresIn: 900,
    tokenType: 'Bearer' as const,
  };

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
      loginPassword: jest.fn(),
      loginSendCode: jest.fn(),
      loginVerifyCode: jest.fn(),
      getUserProfile: jest.fn(),
    };

    socketServiceMock = {
      connect: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        LoginComponent,
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

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize the password form with contact and password fields', () => {
      expect(component.passwordForm).toBeTruthy();
      expect(component.passwordForm.get('contact')).toBeTruthy();
      expect(component.passwordForm.get('password')).toBeTruthy();
    });

    it('should initialize the code login form with contact and code fields', () => {
      expect(component.codeLoginForm).toBeTruthy();
      expect(component.codeLoginForm.get('contact')).toBeTruthy();
      expect(component.codeLoginForm.get('code')).toBeTruthy();
    });

    it('should initialize form fields as empty', () => {
      expect(component.passwordForm.get('contact')?.value).toBe('');
      expect(component.passwordForm.get('password')?.value).toBe('');
      expect(component.codeLoginForm.get('contact')?.value).toBe('');
      expect(component.codeLoginForm.get('code')?.value).toBe('');
    });

    it('should reference store isLoading signal', () => {
      expect(component.isLoading).toBe(authStoreMock.isLoading);
    });

    it('should reference store error signal', () => {
      expect(component.error).toBe(authStoreMock.error);
    });
  });

  describe('tab switching', () => {
    it('should start with password tab active', () => {
      expect(component.activeTab).toBe('password');
    });

    it('should switch to code tab', () => {
      component.switchTab('code');
      expect(component.activeTab).toBe('code');
    });

    it('should switch back to password tab', () => {
      component.switchTab('code');
      component.switchTab('password');
      expect(component.activeTab).toBe('password');
    });

    it('should clear error and reset codeLoginStep when switching tabs', () => {
      component.codeLoginStep = 2;
      authStoreMock.setError.mockClear();
      component.switchTab('code');
      expect(authStoreMock.setError).toHaveBeenCalledWith(null);
      expect(component.codeLoginStep).toBe(1);
    });
  });

  describe('form validation - password form', () => {
    it('should mark contact as invalid when empty', () => {
      const contactControl = component.passwordForm.get('contact');
      expect(contactControl?.invalid).toBe(true);
      expect(contactControl?.errors?.['required']).toBe(true);
    });

    it('should mark contact as valid when filled', () => {
      const contactControl = component.passwordForm.get('contact');
      contactControl?.setValue('test@example.com');
      expect(contactControl?.valid).toBe(true);
    });

    it('should mark password as invalid when empty', () => {
      const passwordControl = component.passwordForm.get('password');
      expect(passwordControl?.invalid).toBe(true);
      expect(passwordControl?.errors?.['required']).toBe(true);
    });

    it('should mark password as invalid when less than 8 characters', () => {
      const passwordControl = component.passwordForm.get('password');
      passwordControl?.setValue('1234567');
      expect(passwordControl?.invalid).toBe(true);
      expect(passwordControl?.errors?.['minlength']).toBeTruthy();
    });

    it('should mark password as valid when 8 or more characters', () => {
      const passwordControl = component.passwordForm.get('password');
      passwordControl?.setValue('password123');
      expect(passwordControl?.valid).toBe(true);
    });
  });

  describe('form validation - code login form', () => {
    it('should mark code as invalid when empty', () => {
      const codeControl = component.codeLoginForm.get('code');
      expect(codeControl?.invalid).toBe(true);
      expect(codeControl?.errors?.['required']).toBe(true);
    });

    it('should mark code as invalid when not 6 digits', () => {
      const codeControl = component.codeLoginForm.get('code');
      codeControl?.setValue('123');
      expect(codeControl?.invalid).toBe(true);
    });

    it('should mark code as valid when 6 digits', () => {
      const codeControl = component.codeLoginForm.get('code');
      codeControl?.setValue('123456');
      expect(codeControl?.valid).toBe(true);
    });
  });

  describe('onPasswordLogin()', () => {
    it('should not submit when form is invalid', () => {
      component.onPasswordLogin();

      expect(apiServiceMock.loginPassword).not.toHaveBeenCalled();
      expect(authStoreMock.setLoading).not.toHaveBeenCalled();
    });

    it('should not submit when terms are not accepted', () => {
      component.passwordForm.patchValue({
        contact: 'test@example.com',
        password: 'password123',
      });
      component.acceptTerms = false;

      component.onPasswordLogin();

      expect(apiServiceMock.loginPassword).not.toHaveBeenCalled();
    });

    it('should call api.loginPassword with credentials when form is valid and terms accepted', () => {
      component.passwordForm.patchValue({
        contact: 'test@example.com',
        password: 'password123',
      });
      component.acceptTerms = true;
      apiServiceMock.loginPassword.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onPasswordLogin();

      expect(apiServiceMock.loginPassword).toHaveBeenCalledWith({
        contact: 'test@example.com',
        contactType: 'email',
        password: 'password123',
      });
    });

    it('should set loading state before making API call', () => {
      component.passwordForm.patchValue({
        contact: 'test@example.com',
        password: 'password123',
      });
      component.acceptTerms = true;
      apiServiceMock.loginPassword.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onPasswordLogin();

      expect(authStoreMock.setLoading).toHaveBeenCalledWith(true);
    });

    it('should call loginSuccess on successful login', () => {
      component.passwordForm.patchValue({
        contact: 'test@example.com',
        password: 'password123',
      });
      component.acceptTerms = true;
      apiServiceMock.loginPassword.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onPasswordLogin();

      expect(authStoreMock.loginSuccess).toHaveBeenCalledWith('jwt-token-123', 'refresh-token-123');
    });

    it('should connect socket service on successful login', () => {
      component.passwordForm.patchValue({
        contact: 'test@example.com',
        password: 'password123',
      });
      component.acceptTerms = true;
      apiServiceMock.loginPassword.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onPasswordLogin();

      expect(socketServiceMock.connect).toHaveBeenCalled();
    });

    it('should navigate to /booking on successful login', () => {
      component.passwordForm.patchValue({
        contact: 'test@example.com',
        password: 'password123',
      });
      component.acceptTerms = true;
      apiServiceMock.loginPassword.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));
      jest.spyOn(router, 'navigate');

      component.onPasswordLogin();

      expect(router.navigate).toHaveBeenCalledWith(['/booking']);
    });

    it('should set error on login failure', () => {
      component.passwordForm.patchValue({
        contact: 'test@example.com',
        password: 'password123',
      });
      component.acceptTerms = true;
      apiServiceMock.loginPassword.mockReturnValue(throwError(() => new Error('Invalid credentials')));

      component.onPasswordLogin();

      expect(authStoreMock.setError).toHaveBeenLastCalledWith('Invalid credentials');
    });
  });

  describe('onSendCode()', () => {
    it('should send verification code when contact is valid', () => {
      component.codeLoginForm.get('contact')?.setValue('test@example.com');
      apiServiceMock.loginSendCode.mockReturnValue(of({ expiresIn: 300 }));

      component.onSendCode();

      expect(apiServiceMock.loginSendCode).toHaveBeenCalledWith({
        contact: 'test@example.com',
        contactType: 'email',
      });
    });

    it('should not send verification code when contact is invalid', () => {
      component.codeLoginForm.get('contact')?.setValue('');
      component.codeLoginForm.get('contact')?.markAsTouched();

      component.onSendCode();

      expect(apiServiceMock.loginSendCode).not.toHaveBeenCalled();
    });

    it('should start countdown after sending code', () => {
      component.codeLoginForm.get('contact')?.setValue('test@example.com');
      apiServiceMock.loginSendCode.mockReturnValue(of({ expiresIn: 300 }));

      component.onSendCode();

      expect(component.countdown).toBe(60);
    });

    it('should advance to step 2 after sending code', () => {
      component.codeLoginForm.get('contact')?.setValue('test@example.com');
      apiServiceMock.loginSendCode.mockReturnValue(of({ expiresIn: 300 }));

      component.onSendCode();

      expect(component.codeLoginStep).toBe(2);
    });

    it('should not send code when countdown is active', () => {
      component.codeLoginForm.get('contact')?.setValue('test@example.com');
      component.countdown = 30;
      apiServiceMock.loginSendCode.mockReturnValue(of({ expiresIn: 300 }));

      component.onSendCode();

      expect(apiServiceMock.loginSendCode).not.toHaveBeenCalled();
    });
  });

  describe('onVerifyCode()', () => {
    it('should call api.loginVerifyCode when code form is valid', () => {
      component.codeLoginForm.patchValue({
        contact: 'test@example.com',
        code: '123456',
      });
      component.acceptTerms = true;
      apiServiceMock.loginVerifyCode.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onVerifyCode();

      expect(apiServiceMock.loginVerifyCode).toHaveBeenCalledWith({
        contact: 'test@example.com',
        contactType: 'email',
        code: '123456',
      });
    });

    it('should not verify code when form is invalid', () => {
      component.onVerifyCode();

      expect(apiServiceMock.loginVerifyCode).not.toHaveBeenCalled();
    });

    it('should navigate to /booking on successful verification', () => {
      component.codeLoginForm.patchValue({
        contact: 'test@example.com',
        code: '123456',
      });
      component.acceptTerms = true;
      apiServiceMock.loginVerifyCode.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));
      jest.spyOn(router, 'navigate');

      component.onVerifyCode();

      expect(router.navigate).toHaveBeenCalledWith(['/booking']);
    });

    it('should set error on verification failure', () => {
      component.codeLoginForm.patchValue({
        contact: 'test@example.com',
        code: '123456',
      });
      component.acceptTerms = true;
      apiServiceMock.loginVerifyCode.mockReturnValue(throwError(() => new Error('Invalid code')));

      component.onVerifyCode();

      expect(authStoreMock.setError).toHaveBeenLastCalledWith('Invalid code');
    });

    it('should call loginSuccess on successful verification', () => {
      component.codeLoginForm.patchValue({
        contact: 'test@example.com',
        code: '123456',
      });
      component.acceptTerms = true;
      apiServiceMock.loginVerifyCode.mockReturnValue(of(mockLoginResponse));
      apiServiceMock.getUserProfile.mockReturnValue(of(null));

      component.onVerifyCode();

      expect(authStoreMock.loginSuccess).toHaveBeenCalledWith('jwt-token-123', 'refresh-token-123');
    });
  });

  describe('onSubmit()', () => {
    it('should call onPasswordLogin when activeTab is password', () => {
      jest.spyOn(component, 'onPasswordLogin');
      component.activeTab = 'password';

      component.onSubmit();

      expect(component.onPasswordLogin).toHaveBeenCalled();
    });

    it('should call onSendCode when activeTab is code and step 1', () => {
      jest.spyOn(component, 'onSendCode');
      component.activeTab = 'code';
      component.codeLoginStep = 1;

      component.onSubmit();

      expect(component.onSendCode).toHaveBeenCalled();
    });

    it('should call onVerifyCode when activeTab is code and step 2', () => {
      jest.spyOn(component, 'onVerifyCode');
      component.activeTab = 'code';
      component.codeLoginStep = 2;

      component.onSubmit();

      expect(component.onVerifyCode).toHaveBeenCalled();
    });
  });

  describe('sendVerifyCode()', () => {
    it('should delegate to onSendCode', () => {
      jest.spyOn(component, 'onSendCode');
      component.sendVerifyCode();
      expect(component.onSendCode).toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('should render auth-form component', () => {
      const authForm = fixture.nativeElement.querySelector('app-auth-form');
      expect(authForm).toBeTruthy();
    });

    it('should not show error message when error is null', () => {
      authStoreMock.error.mockReturnValue(null);
      fixture.detectChanges();

      const globalError = fixture.nativeElement.querySelector('.global-error');
      expect(globalError).toBeFalsy();
    });

    it('should show error message when error has value', () => {
      fixture.destroy();
      fixture = TestBed.createComponent(LoginComponent);
      component = fixture.componentInstance;
      authStoreMock.error.mockReturnValue('Login failed');
      fixture.detectChanges();

      const globalError = fixture.nativeElement.querySelector('.global-error');
      expect(globalError).toBeTruthy();
      expect(globalError.textContent).toContain('Login failed');
    });

    it('should render register link via defer block', async () => {
      const deferBlocks = await fixture.getDeferBlocks();
      await deferBlocks[0].render(DeferBlockState.Complete);
      fixture.detectChanges();

      const link = fixture.nativeElement.querySelector('a[routerLink="/auth/register"]');
      expect(link).toBeTruthy();
      expect(link.textContent.trim()).toBe('注册新账号');
    });
  });
});
