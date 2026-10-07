'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@/lib/api/client';
import type { paths } from '@/lib/api/schema';
import { useAuth } from '@/lib/auth/AuthProvider';

export type StaffProfile = Schemas['StaffProfile'];
export type Weekly = Schemas['StaffSchedule']['weekly'];
export type StaffCreate =
  paths['/api/v1/staff']['post']['requestBody']['content']['application/json'];
export type StaffUpdate =
  paths['/api/v1/staff/{id}']['patch']['requestBody']['content']['application/json'];

// Stylist management for ADMIN (API-030..034).

function useInvalidateStaff() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['staff'] }),
      queryClient.invalidateQueries({ queryKey: ['bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['availability'] }),
    ]);
  };
}

export function useAdminStaff() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['staff', 'admin'],
    queryFn: () =>
      unwrap(api.GET('/api/v1/staff', { params: { query: { includeInactive: 'true' } } })),
  });
}

export function useStaffProfile(id: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['staff', id, 'profile'],
    queryFn: () => unwrap(api.GET('/api/v1/staff/{id}', { params: { path: { id } } })),
  });
}

// STAFF accounts (API-011) to link a new profile to.
export function useStaffAccounts(enabled: boolean) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['users', 'staff-accounts'],
    queryFn: async () =>
      (
        await unwrap(
          api.GET('/api/v1/users', {
            params: { query: { role: 'STAFF', isActive: 'true', pageSize: 100 } },
          }),
        )
      ).data,
    enabled,
  });
}

export function useCreateStaff() {
  const { api } = useAuth();
  const invalidate = useInvalidateStaff();
  return useMutation({
    mutationFn: (body: StaffCreate) => unwrap(api.POST('/api/v1/staff', { body })),
    onSuccess: invalidate,
  });
}

// 422 ACTIVE_BOOKINGS_EXIST when deactivating with future bookings, unless force (BR-014).
export function useUpdateStaff(id: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateStaff();
  return useMutation({
    mutationFn: (body: StaffUpdate) =>
      unwrap(api.PATCH('/api/v1/staff/{id}', { params: { path: { id } }, body })),
    onSuccess: invalidate,
  });
}

export function useSaveSchedule(id: string) {
  const { api } = useAuth();
  const invalidate = useInvalidateStaff();
  return useMutation({
    mutationFn: (weekly: Weekly) =>
      unwrap(
        api.PUT('/api/v1/staff/{id}/schedule', { params: { path: { id } }, body: { weekly } }),
      ),
    onSuccess: invalidate,
  });
}
