'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

export type TimeOff = Schemas['TimeOff'];
export type StaffSchedule = Schemas['StaffSchedule'];

// API-033 (ADMIN, RECEPTIONIST, own STAFF).
export function useSchedule(staffId: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['staff', staffId, 'schedule'],
    queryFn: () =>
      unwrap(api.GET('/api/v1/staff/{id}/schedule', { params: { path: { id: staffId! } } })),
    enabled: staffId !== null,
  });
}

// API-035.
export function useTimeOff(staffId: string | null, from: string, to?: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['staff', staffId, 'time-off', from, to],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/staff/{id}/time-off', {
          params: { path: { id: staffId! }, query: { from, ...(to ? { to } : {}) } },
        }),
      ),
    enabled: staffId !== null,
  });
}

function useInvalidateStaff(staffId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['staff', staffId] }),
      queryClient.invalidateQueries({ queryKey: ['bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['availability'] }),
    ]);
  };
}

// API-036: 422 ACTIVE_BOOKINGS_EXIST over active bookings unless an admin forces it (FR-024).
export function useAddTimeOff(staffId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateStaff(staffId);
  return useMutation({
    mutationFn: (body: { startAt: string; endAt: string; reason?: string; force?: boolean }) =>
      unwrap(api.POST('/api/v1/staff/{id}/time-off', { params: { path: { id: staffId } }, body })),
    onSuccess: invalidate,
  });
}

// API-037.
export function useDeleteTimeOff(staffId: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateStaff(staffId);
  return useMutation({
    mutationFn: (timeOffId: string) =>
      unwrap(
        api.DELETE('/api/v1/staff/{id}/time-off/{timeOffId}', {
          params: { path: { id: staffId, timeOffId } },
        }),
      ),
    onSuccess: invalidate,
  });
}
