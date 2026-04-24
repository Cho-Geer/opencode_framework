import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, retry } from 'rxjs/operators';
import {
  ContactType,
  RegisterSendCodeDto,
  RegisterCompleteDto,
  LoginSendCodeDto,
  LoginVerifyCodeDto,
  LoginPasswordDto,
  AuthResponseDto,
  RegisterSendCodeResponse,
  LoginSendCodeResponse,
  LogoutResponse,
} from '../../features/auth/dto/auth.dto';
import { Service, TimeSlot, ReservationResponse } from '../../shared/dto';

/**
 * Standard API response envelope as produced by the backend ResponseInterceptor.
 * All backend responses (both GET and POST/DELETE) are wrapped in this format.
 */
export interface ApiResponse<T> {
  success: boolean;
  code: number;
  message: string;
  data: T;
  timestamp: string;
  requestId: string;
}

// Re-export DTOs for backward compatibility
export type {
  ContactType,
  RegisterSendCodeDto,
  RegisterCompleteDto,
  LoginSendCodeDto,
  LoginVerifyCodeDto,
  LoginPasswordDto,
  AuthResponseDto,
  Service,
  TimeSlot,
  ReservationResponse,
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = '/api';

  // ==========================================
  // Auth endpoints (PII Encryption - Scheme C v4)
  // ==========================================

  /**
   * Register Step 1: Send verification code
   * POST /v1/auth/register/send-code
   */
  registerSendCode(dto: RegisterSendCodeDto): Observable<RegisterSendCodeResponse> {
    return this.http
      .post<RegisterSendCodeResponse>(`${this.apiUrl}/auth/register/send-code`, dto)
      .pipe(catchError(this.handleError));
  }

  /**
   * Register Step 2: Complete registration
   * POST /v1/auth/register/complete
   */
  registerComplete(dto: RegisterCompleteDto): Observable<AuthResponseDto> {
    return this.http
      .post<AuthResponseDto>(`${this.apiUrl}/auth/register/complete`, dto)
      .pipe(catchError(this.handleError));
  }

  /**
   * Code Login Step 1: Send verification code
   * POST /v1/auth/login/send-code
   */
  loginSendCode(dto: LoginSendCodeDto): Observable<LoginSendCodeResponse> {
    return this.http
      .post<LoginSendCodeResponse>(`${this.apiUrl}/auth/login/send-code`, dto)
      .pipe(catchError(this.handleError));
  }

  /**
   * Code Login Step 2: Verify code and login
   * POST /v1/auth/login/verify-code
   */
  loginVerifyCode(dto: LoginVerifyCodeDto): Observable<AuthResponseDto> {
    return this.http
      .post<AuthResponseDto>(`${this.apiUrl}/auth/login/verify-code`, dto)
      .pipe(catchError(this.handleError));
  }

  /**
   * Password login
   * POST /v1/auth/login/password
   */
  loginPassword(dto: LoginPasswordDto): Observable<AuthResponseDto> {
    return this.http
      .post<AuthResponseDto>(`${this.apiUrl}/auth/login/password`, dto)
      .pipe(catchError(this.handleError));
  }

  /**
   * Refresh access token
   * POST /v1/auth/refresh
   */
  refreshToken(refreshToken: string): Observable<AuthResponseDto> {
    return this.http
      .post<AuthResponseDto>(`${this.apiUrl}/auth/refresh`, { refreshToken })
      .pipe(catchError(this.handleError));
  }

  /**
   * Logout (notify backend to blacklist token)
   * POST /v1/auth/logout
   */
  logout(): Observable<LogoutResponse> {
    return this.http
      .post<LogoutResponse>(`${this.apiUrl}/auth/logout`, {})
      .pipe(catchError(this.handleError));
  }

  // ==========================================
  // Service endpoints
  // ==========================================

  getServices(): Observable<Service[]> {
    return this.http
      .get<ApiResponse<Service[]>>(`${this.apiUrl}/services`)
      .pipe(
        map(response => response.data),
        retry(2),
        catchError(this.handleError)
      );
  }

  // ==========================================
  // Booking endpoints
  // ==========================================

  /**
   * Create a new appointment via POST /v1/appointments
   * Maps to CreateAppointmentDto on the backend
   */
  createAppointment(dto: {
    timeSlotId: string;
    appointmentDate: string;
    notes?: string;
  }): Observable<ReservationResponse> {
    return this.http
      .post<ReservationResponse>(`${this.apiUrl}/appointments`, dto)
      .pipe(catchError(this.handleError));
  }

  getAvailableSlots(serviceId: string): Observable<TimeSlot[]> {
    const params = new HttpParams().set('serviceId', serviceId);
    return this.http
      .get<ApiResponse<TimeSlot[]>>(`${this.apiUrl}/time-slots/available`, { params })
      .pipe(
        map(response => response.data),
        retry(2),
        catchError(this.handleError)
      );
  }

  reserveSlot(
    slotId: string,
    preferSeq: number,
    idempotencyKey?: string
  ): Observable<ReservationResponse> {
    const headers = idempotencyKey
      ? { 'X-Idempotency-Key': idempotencyKey }
      : undefined;
    return this.http
      .post<ReservationResponse>(`${this.apiUrl}/slots/${slotId}/reserve`, {
        preferSeq,
      }, { headers })
      .pipe(catchError(this.handleError));
  }

  cancelBooking(bookingId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/appointments/${bookingId}`)
      .pipe(catchError(this.handleError));
  }

  // ==========================================
  // User endpoints
  // ==========================================

  /**
   * Get current user profile (call after login/registration)
   * GET /v1/users/profile
   */
  getUserProfile(): Observable<{
    id: string;
    name: string;
    email?: string; // masked value like "us***@example.com"
    phone?: string; // masked value like "138****5678"
    role: string;
    created_at: string;
  }> {
    return this.http
      .get<ApiResponse<{
        id: string;
        name: string;
        email?: string;
        phone?: string;
        role: string;
        created_at: string;
      }>>(`${this.apiUrl}/users/profile`)
      .pipe(
        map(response => response.data),
        catchError(this.handleError)
      );
  }

  private handleError(error: unknown): Observable<never> {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.message || 'An error occurred. Please try again.';
      return throwError(() => new Error(message));
    }
    return throwError(() => new Error('An unexpected error occurred'));
  }
}
