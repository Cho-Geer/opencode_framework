/**
 * Error DTOs
 * 与 backend-api 契约保持一致
 * @see contract.yaml -> api.error_responses
 */

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}

export enum HttpStatusCode {
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500
}

export const ErrorMessages: Record<HttpStatusCode, string> = {
  [HttpStatusCode.BAD_REQUEST]: 'Bad Request - Validation error',
  [HttpStatusCode.UNAUTHORIZED]: 'Unauthorized - Authentication required',
  [HttpStatusCode.FORBIDDEN]: 'Forbidden - Insufficient permissions',
  [HttpStatusCode.NOT_FOUND]: 'Not Found - Resource not found',
  [HttpStatusCode.CONFLICT]: 'Conflict - Resource conflict (e.g., time slot already booked)',
  [HttpStatusCode.TOO_MANY_REQUESTS]: 'Too Many Requests - Rate limit exceeded',
  [HttpStatusCode.INTERNAL_SERVER_ERROR]: 'Internal Server Error'
};
