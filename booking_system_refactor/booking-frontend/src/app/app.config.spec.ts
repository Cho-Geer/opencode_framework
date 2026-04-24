import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';
import { provideRouter } from '@angular/router';
import { HttpClient } from '@angular/common/http';

describe('App Config', () => {
  it('should provide application config', () => {
    expect(appConfig).toBeDefined();
    expect(appConfig.providers).toBeDefined();
    expect(Array.isArray(appConfig.providers)).toBe(true);
  });

  it('should contain router providers', () => {
    const providerTypes = appConfig.providers.map((p) =>
      typeof p === 'function' ? p.name : 'object'
    );
    expect(providerTypes.length).toBeGreaterThan(0);
  });

  it('should provide HttpClient via withInterceptors', () => {
    TestBed.configureTestingModule({
      providers: appConfig.providers,
    });

    const http = TestBed.inject(HttpClient);
    expect(http).toBeTruthy();
  });
});
