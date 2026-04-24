import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';

export interface TimeSlot {
  id: string;
  date: string;
  time: string;
  isActive: boolean;
  bookedBy?: string;
}

export interface ReservationResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  slot: TimeSlot;
  message?: string;
}

export interface BookingState {
  slots: TimeSlot[];
  selectedSlot: TimeSlot | null;
  isLoading: boolean;
  error: string | null;
  activeBookings: string[];
}

export const initialBookingState: BookingState = {
  slots: [],
  selectedSlot: null,
  isLoading: false,
  error: null,
  activeBookings: [],
};

export const BookingStore = signalStore(
  { providedIn: 'root' },
  withState<BookingState>(initialBookingState),
  withComputed(({ slots, selectedSlot, activeBookings }) => ({
    availableSlots: computed(() => slots().filter(slot => slot.isActive)),
    bookedSlots: computed(() => slots().filter(slot => !slot.isActive)),
    hasSelection: computed(() => selectedSlot() !== null),
  })),
  withMethods((store) => ({
    loadSlots(slots: TimeSlot[]) {
      patchState(store, {
        slots,
        isLoading: false,
        error: null,
      });
    },
    selectSlot(slot: TimeSlot | null) {
      patchState(store, { selectedSlot: slot });
    },
    bookSlot(slotId: string, userId: string) {
      const currentSlots = store.slots();
      const updatedSlots = currentSlots.map(slot =>
        slot.id === slotId
          ? { ...slot, isActive: false, bookedBy: userId }
          : slot
      );
      
      patchState(store, {
        slots: updatedSlots,
        activeBookings: [...store.activeBookings(), slotId],
        selectedSlot: null,
        isLoading: false,
        error: null,
      });
    },
    cancelBooking(slotId: string) {
      const currentSlots = store.slots();
      const updatedSlots = currentSlots.map(slot =>
        slot.id === slotId
          ? { ...slot, isActive: true, bookedBy: undefined }
          : slot
      );
      
      patchState(store, {
        slots: updatedSlots,
        activeBookings: store.activeBookings().filter(id => id !== slotId),
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
    reserveSlot(params: { slotId: string; preferSeq: number }): ReservationResponse {
      const currentSlots = store.slots();
      const targetSlot = currentSlots.find(slot => slot.id === params.slotId);
      
      if (!targetSlot || !targetSlot.isActive) {
        return {
          status: 'FAILED',
          slot: targetSlot ?? { id: params.slotId, date: '', time: '', isActive: false },
          message: 'Slot is no longer available',
        };
      }
      
      const updatedSlots = currentSlots.map(slot =>
        slot.id === params.slotId
          ? { ...slot, isActive: false }
          : slot
      );
      
      patchState(store, {
        slots: updatedSlots,
        isLoading: false,
        error: null,
      });

      return {
        status: 'SUCCESS',
        slot: { ...targetSlot, isActive: false },
      };
    },

    /**
     * Confirm a slot reservation after successful API call.
     * Marks the slot as booked and adds to activeBookings.
     */
    confirmSlotReservation(slotId: string): void {
      const currentSlots = store.slots();
      const updatedSlots = currentSlots.map(slot =>
        slot.id === slotId
          ? { ...slot, isActive: false }
          : slot
      );

      patchState(store, {
        slots: updatedSlots,
        activeBookings: [...store.activeBookings(), slotId],
        selectedSlot: null,
        isLoading: false,
        error: null,
      });
    },

    /**
     * Handle a failed reservation after API call error.
     * Restores the slot to active state and records the error.
     */
    failedReservation(slotId: string, error: string): void {
      const currentSlots = store.slots();
      const updatedSlots = currentSlots.map(slot =>
        slot.id === slotId
          ? { ...slot, isActive: true }
          : slot
      );

      patchState(store, {
        slots: updatedSlots,
        error,
        isLoading: false,
      });
    },
  }))
);
