import { Injectable, inject } from '@angular/core';
import { BookingStore, ReservationResponse } from '../../stores/booking/booking.store';
import { ApiService } from '../../core/services/api.service';
import { lastValueFrom } from 'rxjs';

/** Default maximum number of slot sequences for reservation */
const DEFAULT_MAX_SLOTS = 10;

@Injectable({ providedIn: 'root' })
export class BookingService {
  private store = inject(BookingStore);
  private apiService = inject(ApiService);

  /**
   * Generates a random preference sequence number for slot reservation
   * Used for抢占 (grab) mechanism in booking system
   */
  generatePreferSeq(maxSlots: number = DEFAULT_MAX_SLOTS): number {
    return Math.floor(Math.random() * maxSlots);
  }

  /**
   * Generates a unique idempotency key for reservation requests
   * Prevents duplicate bookings on network retries
   */
  generateIdempotencyKey(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Reserve a time slot by calling the backend API.
   * On success, confirms the slot in the store.
   * On failure, rolls back the slot and returns error details.
   * Returns a Promise<ReservationResponse> indicating success or failure.
   */
  async reserveSlot(slotId: string, maxSlots: number = DEFAULT_MAX_SLOTS): Promise<ReservationResponse> {
    const preferSeq = this.generatePreferSeq(maxSlots);
    const idempotencyKey = this.generateIdempotencyKey();

    // Set loading state
    this.store.setLoading(true);

    try {
      // Call the backend API to create the appointment
      const response = await lastValueFrom(
        this.apiService.createAppointment({
          timeSlotId: slotId,
          appointmentDate: new Date().toISOString(),
          notes: undefined,
        })
      );

      // On success, confirm the reservation in the store
      this.store.confirmSlotReservation(slotId);

      return {
        status: 'SUCCESS',
        slot: response.slot,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Reservation failed';

      // On failure, rollback the slot and set error
      this.store.failedReservation(slotId, errorMessage);

      return {
        status: 'FAILED',
        slot: { id: slotId, date: '', time: '', isActive: true },
        message: errorMessage,
      };
    }
  }

  /**
   * Cancel an existing booking
   */
  cancelBooking(slotId: string): void {
    this.store.cancelBooking(slotId);
  }
}
