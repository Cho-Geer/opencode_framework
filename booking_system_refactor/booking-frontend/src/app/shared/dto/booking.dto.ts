/**
 * Booking DTOs
 * 与 backend-api 契约保持一致
 * @see contract.yaml -> api.bookings
 */

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED'
}

export interface Booking {
  id: string;
  userId: string;
  timeSlotId: string;
  appointmentDate: string;
  status: BookingStatus;
  slotSequence?: number;
  createdAt?: string;
  notes?: string;
}

export interface CreateBookingRequest {
  timeSlotId: string;
  appointmentDate: string;
  notes?: string;
}

export interface CreateBookingResponse {
  booking: Booking;
}

export interface BookingListItem {
  id: string;
  timeSlotId: string;
  appointmentDate: string;
  status: BookingStatus;
  serviceName: string;
  timeSlotStart: string;
  timeSlotEnd: string;
}

export interface BookingListQuery {
  startDate?: string;
  endDate?: string;
  status?: BookingStatus;
}

export interface ReservationResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  slot: import('./time-slot.dto').TimeSlot;
  message?: string;
}
