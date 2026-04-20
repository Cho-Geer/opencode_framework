import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed, inject } from '@angular/core';

/**
 * User interface aligned with PII encryption contract (Scheme C v4).
 * - email and phone fields contain MASKED values only (never plain text)
 * - e.g., email: "us***@example.com", phone: "138****5678"
 */
export interface User {
  id: string;
  name: string;
  role: string;
  email?: string;   // masked value from backend (e.g., "us***@example.com")
  phone?: string;   // masked value from backend (e.g., "138****5678")
  createdAt?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;
}

export const initialAuthState: AuthState = {
  user: null,
  token: null,
  refreshToken: null,
  isLoading: false,
  error: null,
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(initialAuthState),
  withComputed(({ user, token, refreshToken }) => ({
    isAuthenticated: computed(() => user() !== null && token() !== null),
    currentUser: computed(() => user()),
    currentToken: computed(() => token()),
    currentRefreshToken: computed(() => refreshToken()),
  })),
  withMethods((store) => ({
    /**
     * Login success - store tokens only (no user object in auth response)
     * User profile should be fetched separately via /users/profile
     */
    loginSuccess(token: string, refreshToken?: string) {
      patchState(store, {
        token,
        refreshToken: refreshToken ?? null,
        isLoading: false,
        error: null,
      });
    },
    /**
     * Set user profile after fetching from /users/profile
     */
    setUserProfile(user: User) {
      patchState(store, { user });
    },
    logout() {
      patchState(store, {
        user: null,
        token: null,
        refreshToken: null,
        isLoading: false,
        error: null,
      });
    },
    setLoading(isLoading: boolean) {
      patchState(store, { isLoading });
    },
    setError(error: string | null) {
      patchState(store, { error, isLoading: false });
    },
  }))
);
