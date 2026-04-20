/**
 * User DTOs
 * 与 backend-api 契约保持一致
 * @see contract.yaml -> api.auth / api.users
 */

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN'
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  user: User;
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
}

export interface UpdateProfileResponse {
  user: User;
}
