import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { requestIdInterceptor } from './request-id.interceptor';

describe('RequestIdInterceptor', () => {
  let httpMock: HttpTestingController;
  let httpClient: HttpClient;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withInterceptors([requestIdInterceptor]),
        ),
        provideHttpClientTesting(),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    httpClient = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should add X-Request-ID header to every request', () => {
    httpClient.get('/api/test').subscribe();

    const req = httpMock.expectOne('/api/test');
    const requestId = req.request.headers.get('X-Request-ID');

    expect(requestId).toBeTruthy();
    expect(requestId).toMatch(/^req-/);
    req.flush({});
  });

  it('should generate unique X-Request-ID for each request', () => {
    const requestIds: string[] = [];

    httpClient.get('/api/test1').subscribe();
    const req1 = httpMock.expectOne('/api/test1');
    requestIds.push(req1.request.headers.get('X-Request-ID')!);
    req1.flush({});

    httpClient.get('/api/test2').subscribe();
    const req2 = httpMock.expectOne('/api/test2');
    requestIds.push(req2.request.headers.get('X-Request-ID')!);
    req2.flush({});

    expect(requestIds[0]).not.toBe(requestIds[1]);
  });

  it('should generate requestId in correct format: req-{uuid}', () => {
    httpClient.post('/api/data', { name: 'test' }).subscribe();

    const req = httpMock.expectOne('/api/data');
    const requestId = req.request.headers.get('X-Request-ID');

    expect(requestId).toMatch(/^req-[a-f0-9-]+$/);
    req.flush({});
  });

  it('should not modify other request properties', () => {
    const testBody = { key: 'value' };

    httpClient.post('/api/submit', testBody).subscribe();

    const req = httpMock.expectOne('/api/submit');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(testBody);
    expect(req.request.headers.get('X-Request-ID')).toBeTruthy();
    req.flush({ success: true });
  });
});
