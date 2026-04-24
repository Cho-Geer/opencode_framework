import {
  HttpInterceptorFn,
} from '@angular/common/http';

/**
 * HTTP interceptor (functional) that generates and attaches a unique X-Request-ID
 * to every outgoing HTTP request for distributed tracing.
 *
 * The requestId format follows the contract: req-{uuid-v4}
 */
export const requestIdInterceptor: HttpInterceptorFn = (req, next) => {
  const requestId = `req-${crypto.randomUUID()}`;

  const cloned = req.clone({
    setHeaders: {
      'X-Request-ID': requestId,
    },
  });

  return next(cloned);
};
