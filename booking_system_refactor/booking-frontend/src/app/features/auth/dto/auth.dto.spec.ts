import {
  ContactType,
  RegisterSendCodeDto,
  RegisterCompleteDto,
  LoginSendCodeDto,
  LoginVerifyCodeDto,
  LoginPasswordDto,
  AuthResponseDto,
} from './auth.dto';

describe('Auth DTOs (PII Encryption - Scheme C v4)', () => {
  describe('ContactType enum', () => {
    it('should have PHONE value', () => {
      expect(ContactType.PHONE).toBe('phone');
    });

    it('should have EMAIL value', () => {
      expect(ContactType.EMAIL).toBe('email');
    });
  });

  describe('RegisterSendCodeDto', () => {
    it('should accept valid phone number', () => {
      const dto: RegisterSendCodeDto = {
        contact: '13812345678',
        contactType: ContactType.PHONE,
      };
      expect(dto.contact).toBe('13812345678');
      expect(dto.contactType).toBe('phone');
    });

    it('should accept valid email', () => {
      const dto: RegisterSendCodeDto = {
        contact: 'user@example.com',
        contactType: ContactType.EMAIL,
      };
      expect(dto.contact).toBe('user@example.com');
      expect(dto.contactType).toBe('email');
    });
  });

  describe('RegisterCompleteDto', () => {
    it('should accept all required fields', () => {
      const dto: RegisterCompleteDto = {
        contact: 'user@example.com',
        contactType: ContactType.EMAIL,
        code: '123456',
        password: 'StrongP@ss1',
        name: 'Test User',
      };
      expect(dto.code).toBe('123456');
      expect(dto.password).toBe('StrongP@ss1');
      expect(dto.name).toBe('Test User');
    });
  });

  describe('LoginSendCodeDto', () => {
    it('should accept contact and type', () => {
      const dto: LoginSendCodeDto = {
        contact: '13812345678',
        contactType: ContactType.PHONE,
      };
      expect(dto.contact).toBeDefined();
      expect(dto.contactType).toBeDefined();
    });
  });

  describe('LoginVerifyCodeDto', () => {
    it('should accept contact, type, and code', () => {
      const dto: LoginVerifyCodeDto = {
        contact: 'user@example.com',
        contactType: ContactType.EMAIL,
        code: '654321',
      };
      expect(dto.code).toBe('654321');
    });
  });

  describe('LoginPasswordDto', () => {
    it('should accept contact, type, and password', () => {
      const dto: LoginPasswordDto = {
        contact: 'user@example.com',
        contactType: ContactType.EMAIL,
        password: 'MyP@ssw0rd',
      };
      expect(dto.password).toBe('MyP@ssw0rd');
    });
  });

  describe('AuthResponseDto', () => {
    it('should contain only token information (no user object)', () => {
      const response: AuthResponseDto = {
        accessToken: 'eyJhbGciOiJIUzI1NiIs...',
        refreshToken: 'dGhpcyBpcyBhIHJlZnJl...',
        expiresIn: 900,
        tokenType: 'Bearer',
      };
      expect(response.accessToken).toBeDefined();
      expect(response.refreshToken).toBeDefined();
      expect(response.expiresIn).toBe(900);
      expect(response.tokenType).toBe('Bearer');
      // Verify no user property exists
      expect((response as any).user).toBeUndefined();
    });
  });
});
