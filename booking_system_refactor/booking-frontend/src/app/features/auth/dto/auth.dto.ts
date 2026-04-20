/**
 * Auth DTOs for PII Encryption (Scheme C v4)
 * 
 * Aligns with contract.yaml pii_encryption_contract.auth_endpoints
 * - No plain text PII in responses
 * - camelCase field naming
 * - AuthResponse contains only token info (no user object)
 */

// Contact type enumeration
export enum ContactType {
  PHONE = 'phone',
  EMAIL = 'email',
}

// Register Step 1: Send verification code
export interface RegisterSendCodeDto {
  contact: string;
  contactType: ContactType;
}

// Register Step 2: Complete registration
export interface RegisterCompleteDto {
  contact: string;
  contactType: ContactType;
  code: string;
  password: string;
  name: string;
}

// Code Login Step 1: Send verification code
export interface LoginSendCodeDto {
  contact: string;
  contactType: ContactType;
}

// Code Login Step 2: Verify code
export interface LoginVerifyCodeDto {
  contact: string;
  contactType: ContactType;
  code: string;
}

// Password Login
export interface LoginPasswordDto {
  contact: string;
  contactType: ContactType;
  password: string;
}

// Auth response (no user object, token only)
export interface AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

// Register send code response
export interface RegisterSendCodeResponse {
  maskedContact: string;
  expiresIn: number;
}

// Login send code response
export interface LoginSendCodeResponse {
  expiresIn: number;
}

// Logout response
export interface LogoutResponse {
  message: string;
}
