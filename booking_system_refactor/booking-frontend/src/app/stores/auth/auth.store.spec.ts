import { TestBed } from '@angular/core/testing';
import { AuthStore, User } from './auth.store';

describe('AuthStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let store: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthStore],
    });
    store = TestBed.inject(AuthStore);
  });

  it('should initialize with null user', () => {
    expect(store.user()).toBeNull();
  });

  it('should initialize with null token', () => {
    expect(store.token()).toBeNull();
  });

  it('should initialize with null refreshToken', () => {
    expect(store.refreshToken()).toBeNull();
  });

  it('should initialize with isLoading false', () => {
    expect(store.isLoading()).toBe(false);
  });

  it('should initialize with null error', () => {
    expect(store.error()).toBeNull();
  });

  it('should expose isAuthenticated computed signal that is false initially', () => {
    expect(store.isAuthenticated()).toBe(false);
  });

  it('should set token and refreshToken on login success', () => {
    const mockToken = 'jwt-token-123';
    const mockRefreshToken = 'jwt-refresh-token-456';

    // LoginSuccess stores tokens only (user is set separately via setUserProfile)
    // isAuthenticated requires both user AND token, so it stays false until setUserProfile
    store.loginSuccess(mockToken, mockRefreshToken);

    expect(store.token()).toBe(mockToken);
    expect(store.refreshToken()).toBe(mockRefreshToken);
    expect(store.isAuthenticated()).toBe(false); // user not yet set
    expect(store.error()).toBeNull();
    expect(store.isLoading()).toBe(false);
  });

  it('should set user via setUserProfile', () => {
    const mockUser: User = {
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    };

    store.loginSuccess('jwt-token-123', 'jwt-refresh-token-456');
    store.setUserProfile(mockUser);

    expect(store.user()).toEqual(mockUser);
    expect(store.isAuthenticated()).toBe(true);
  });

  it('should handle loginSuccess without refreshToken (backward compatible)', () => {
    const mockToken = 'jwt-token-123';

    store.loginSuccess(mockToken);

    expect(store.token()).toBe(mockToken);
    expect(store.refreshToken()).toBeNull();
    expect(store.isAuthenticated()).toBe(false); // user not yet set
  });

  it('should clear user and tokens on logout', () => {
    const mockUser: User = {
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    };

    store.loginSuccess('jwt-token-123', 'jwt-refresh-token-456');
    store.setUserProfile(mockUser);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.user()).toEqual(mockUser);

    store.logout();

    expect(store.user()).toBeNull();
    expect(store.token()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.isLoading()).toBe(false);
  });

  it('should set loading state', () => {
    store.setLoading(true);
    expect(store.isLoading()).toBe(true);

    store.setLoading(false);
    expect(store.isLoading()).toBe(false);
  });

  it('should set error state and clear loading', () => {
    store.setLoading(true);
    store.setError('Login failed');

    expect(store.error()).toBe('Login failed');
    expect(store.isLoading()).toBe(false);
  });

  it('should expose currentUser computed signal', () => {
    const mockUser: User = {
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    };

    expect(store.currentUser()).toBeNull();

    store.loginSuccess('jwt-token-123', 'refresh-token');
    store.setUserProfile(mockUser);

    expect(store.currentUser()).toEqual(mockUser);
  });

  it('should expose currentToken computed signal', () => {
    const mockToken = 'jwt-token-123';

    expect(store.currentToken()).toBeNull();

    store.loginSuccess(mockToken, 'refresh-token');

    expect(store.currentToken()).toBe(mockToken);
  });

  it('should expose currentRefreshToken computed signal', () => {
    const mockRefreshToken = 'jwt-refresh-token-456';

    expect(store.currentRefreshToken()).toBeNull();

    store.loginSuccess('jwt-token-123', mockRefreshToken);

    expect(store.currentRefreshToken()).toBe(mockRefreshToken);
  });
});
