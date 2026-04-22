import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { ClsService } from "nestjs-cls";

/**
 * Logging interceptor that records request method, URL, and response time.
 * Automatically logs all incoming requests and their duration.
 * Includes requestId from CLS context for distributed tracing.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(private readonly cls: ClsService) {}

  /**
   * Intercept incoming HTTP requests and log their duration.
   * @param context - The execution context of the request
   * @param next - The call handler to proceed with request processing
   * @returns An observable of the response
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const responseTime = Date.now() - now;
        const requestId = this.cls.get("requestId") ?? "no-request-id";
        this.logger.log(`[${requestId}] ${method} ${url} - ${responseTime}ms`);
      }),
    );
  }
}
