import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
} from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * HTTP interceptor that generates and attaches a unique X-Request-ID
 * to every outgoing HTTP request for distributed tracing.
 *
 * The requestId format follows the contract: req-{uuid-v4}
 */
@Injectable()
export class RequestIdInterceptor implements HttpInterceptor {
  /**
   * Intercepts outgoing HTTP requests and adds X-Request-ID header.
   * @param req - The outgoing HTTP request
   * @param next - The next handler in the chain
   * @returns An observable of the HTTP event
   */
  intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    const requestId = `req-${crypto.randomUUID()}`;

    const cloned = req.clone({
      setHeaders: {
        'X-Request-ID': requestId,
      },
    });

    return next.handle(cloned);
  }
}
