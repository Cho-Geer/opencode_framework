import { Injectable, inject } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject, catchError, switchMap, filter, take, finalize } from 'rxjs';
import { AuthStore } from '../../stores/auth/auth.store';
import { ApiService } from '../../core/services/api.service';
import { Router } from '@angular/router';

/**
 * HTTP Interceptor that:
 * 1. Automatically attaches JWT access token to authenticated requests
 * 2. Handles 401 responses with automatic token refresh
 * 3. Retries failed requests after successful refresh
 * 4. Redirects to login on refresh failure
 *
 * Security: Token is read from AuthStore (in-memory Signal), NOT from
 * localStorage/sessionStorage, preventing XSS token theft.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private authStore = inject(AuthStore);
  private apiService = inject(ApiService);
  private router = inject(Router);

  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);

  intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    // Skip auth for public endpoints
    if (this.isPublicEndpoint(req.url)) {
      return next.handle(req);
    }

    const token = this.authStore.currentToken();

    if (!token) {
      return next.handle(req);
    }

    const authReq = this.addToken(req, token);

    return next.handle(authReq).pipe(
      catchError((error) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          return this.handle401Error(req, next);
        }
        return throwError(() => error);
      })
    );
  }

  private addToken(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
      withCredentials: true,
    });
  }

  private isPublicEndpoint(url: string): boolean {
    const publicEndpoints = [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
      '/auth/send-code',
      '/auth/verify-code',
    ];
    return publicEndpoints.some(endpoint => url.includes(endpoint));
  }

  private handle401Error(
    req: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      const refreshToken = this.authStore.currentRefreshToken();

      if (!refreshToken) {
        this.redirectToLogin();
        return throwError(() => new Error('No refresh token available'));
      }

      return this.apiService.refreshToken(refreshToken).pipe(
        switchMap((response) => {
          this.authStore.loginSuccess(response.accessToken, response.refreshToken);
          this.refreshTokenSubject.next(response.accessToken);
          this.isRefreshing = false;
          return next.handle(this.addToken(req, response.accessToken));
        }),
        catchError((err) => {
          this.isRefreshing = false;
          this.authStore.logout();
          this.redirectToLogin();
          return throwError(() => err);
        }),
        finalize(() => {
          this.isRefreshing = false;
        })
      );
    } else {
      // Wait for the refresh token request to complete
      return this.refreshTokenSubject.pipe(
        filter(token => token !== null),
        take(1),
        switchMap((token) => {
          if (!token) {
            this.redirectToLogin();
            return throwError(() => new Error('Token refresh failed'));
          }
          return next.handle(this.addToken(req, token));
        })
      );
    }
  }

  private redirectToLogin(): void {
    this.router.navigate(['/auth/login'], {
      queryParams: { expired: 'true' }
    });
  }
}
