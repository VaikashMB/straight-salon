'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import type { StatusAction } from './status';

// Booking changes shared by the customer, staff and admin areas. Each one refreshes every
// booking list and the availability it frees or takes (05 §6).

function useInvalidateBookings() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['availability'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };
}

export interface CancelInput {
  reason?: string;
  override?: boolean;
}

export function useCancelBooking(id: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: (body: CancelInput) =>
      unwrap(api.POST('/api/v1/bookings/{id}/cancel', { params: { path: { id } }, body })),
    onSuccess: invalidate,
  });
}

export interface RescheduleInput {
  startAt: string;
  staffId?: string;
  override?: boolean;
  reason?: string;
}

export function useRescheduleBooking(id: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: (body: RescheduleInput) =>
      unwrap(api.POST('/api/v1/bookings/{id}/reschedule', { params: { path: { id } }, body })),
    onSuccess: invalidate,
  });
}

export function useChangeStatus(id: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: (body: { status: StatusAction; note?: string }) =>
      unwrap(api.POST('/api/v1/bookings/{id}/status', { params: { path: { id } }, body })),
    onSuccess: invalidate,
  });
}

// Changes inside the cancellation cut-off need an override with a reason (BR-006); only
// reception and admin may give one.
export function insideCutoff(startAt: string, cutoffMin: number, now: Date = new Date()): boolean {
  return new Date(startAt).getTime() - now.getTime() < cutoffMin * 60_000;
}
