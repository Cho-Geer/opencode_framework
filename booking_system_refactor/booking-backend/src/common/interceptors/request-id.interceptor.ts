import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import { ClsService } from "nestjs-cls";

/**
 * Intercepts incoming HTTP requests to extract or generate a request ID
 * for distributed tracing. The ID is stored in the CLS (Continuation Local Storage)
 * context, making it accessible to all downstream interceptors, guards, pipes,
 * controllers, and exception filters.
 *
 * Priority for request ID:
 * 1. X-Request-ID header from frontend
 * 2. CLS-generated ID (from ClsMiddleware)
 * 3. Auto-generated UUID fallback
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  /**
   * Extracts or generates request ID and stores it in CLS context.
   * @param context - The execution context of the request
   * @param next - The call handler to proceed with request processing
   * @returns An observable of the response
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest();

    const requestId =
      request.headers["x-request-id"] ??
      this.cls.getId() ??
      `req-${crypto.randomUUID()}`;

    this.cls.set("requestId", requestId);

    return next.handle();
  }
}
