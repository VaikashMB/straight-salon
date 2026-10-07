'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CSRF, unwrap } from '@/lib/api/client';
import type { paths } from '@/lib/api/schema';
import { useAuth } from '@/lib/auth/AuthProvider';

export type Scope = 'upcoming' | 'past';

// API-051: the customer's own bookings, paginated.
export function useMyBookings(scope: Scope, page: number) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['bookings', 'me', scope, page],
    queryFn: () =>
      unwrap(api.GET('/api/v1/bookings/me', { params: { query: { scope, page, pageSize: 10 } } })),
    placeholderData: keepPreviousData,
  });
}

// API-060 (BR-012).
export function useLeaveReview(bookingId: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { rating: number; comment?: string }) =>
      unwrap(
        api.POST('/api/v1/bookings/{id}/review', { params: { path: { id: bookingId } }, body }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export type ProfileUpdate =
  paths['/api/v1/users/me']['patch']['requestBody']['content']['application/json'];

// API-010.
export function useUpdateProfile() {
  const { api, updateUser } = useAuth();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => unwrap(api.PATCH('/api/v1/users/me', { body })),
    onSuccess: updateUser,
  });
}

// API-008: other devices are signed out; this one gets a fresh session.
export function useChangePassword() {
  const { api } = useAuth();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      unwrap(api.POST('/api/v1/auth/change-password', { params: CSRF, body })),
  });
}

// API-005.
export function useLogoutAll() {
  const { api } = useAuth();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/auth/logout-all', { params: CSRF })),
  });
}
