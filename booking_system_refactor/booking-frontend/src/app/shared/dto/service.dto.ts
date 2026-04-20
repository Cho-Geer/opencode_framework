/**
 * Service DTOs
 * 与 backend-api 契约保持一致
 * @see contract.yaml -> api.services
 */

export interface Service {
  id: string;
  name: string;
  description: string;
  duration: number;
  durationMinutes: number; // Alias for backward compatibility
  price: number;
  active: boolean;
}

export type ServiceListResponse = Service[];
