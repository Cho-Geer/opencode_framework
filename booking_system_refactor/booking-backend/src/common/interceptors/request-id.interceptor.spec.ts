import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { ClsService, ClsModule } from 'nestjs-cls';
import { of } from 'rxjs';
import { RequestIdInterceptor } from './request-id.interceptor';

describe('RequestIdInterceptor', () => {
  let interceptor: RequestIdInterceptor;
  let clsService: ClsService;

  const createMockExecutionContext = (headers: Record<string, string>): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  const createMockCallHandler = () => {
    return {
      handle: jest.fn().mockReturnValue(of({ data: 'test' })),
    } as unknown as CallHandler;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: false,
            generateId: true,
            idGenerator: () => `req-${crypto.randomUUID()}`,
          },
        }),
      ],
      providers: [RequestIdInterceptor],
    }).compile();

    interceptor = module.get<RequestIdInterceptor>(RequestIdInterceptor);
    clsService = module.get<ClsService>(ClsService);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should use X-Request-ID from request header when provided', () => {
    const providedRequestId = 'req-frontend-generated-uuid';
    const mockContext = createMockExecutionContext({
      'x-request-id': providedRequestId,
    });
    const mockCallHandler = createMockCallHandler();

    // Run within CLS context
    clsService.run({} as any, () => {
      interceptor.intercept(mockContext, mockCallHandler).subscribe();

      const storedRequestId = clsService.get('requestId');
      expect(storedRequestId).toBe(providedRequestId);
    });
  });

  it('should generate requestId when X-Request-ID header is missing', () => {
    const mockContext = createMockExecutionContext({});
    const mockCallHandler = createMockCallHandler();

    clsService.run({} as any, () => {
      interceptor.intercept(mockContext, mockCallHandler).subscribe();

      const storedRequestId = clsService.get('requestId');
      expect(storedRequestId).toBeDefined();
      expect(storedRequestId).toMatch(/^req-/);
    });
  });

  it('should store requestId in CLS context with correct key', () => {
    const testRequestId = 'req-test-uuid-12345';
    const mockContext = createMockExecutionContext({
      'x-request-id': testRequestId,
    });
    const mockCallHandler = createMockCallHandler();

    clsService.run({} as any, () => {
      interceptor.intercept(mockContext, mockCallHandler).subscribe();

      expect(clsService.get('requestId')).toBe(testRequestId);
    });
  });

  it('should pass through the request without modifying the response', () => {
    const responseData = { statusCode: 200, data: { id: 1 } };
    const mockContext = createMockExecutionContext({});
    const mockCallHandler = {
      handle: jest.fn().mockReturnValue(of(responseData)),
    } as unknown as CallHandler;

    clsService.run({} as any, () => {
      let result: unknown;
      interceptor
        .intercept(mockContext, mockCallHandler)
        .subscribe((val) => {
          result = val;
        });

      expect(result).toEqual(responseData);
    });
  });
});
