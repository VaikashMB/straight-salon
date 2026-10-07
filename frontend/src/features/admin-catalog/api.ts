'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@/lib/api/client';
import type { paths } from '@/lib/api/schema';
import { useAuth } from '@/lib/auth/AuthProvider';

export type Category = Schemas['Category'];
export type Service = Schemas['Service'];
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;
export type ServiceCreate = Json<'/api/v1/services', 'post'>;
export type ServiceUpdate = Json<'/api/v1/services/{id}', 'patch'>;
export type CategoryCreate = Json<'/api/v1/categories', 'post'>;
export type CategoryUpdate = Json<'/api/v1/categories/{id}', 'patch'>;

// The ADMIN catalogue (API-021..026), including inactive entries (never cached, 04 §1).

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
      queryClient.invalidateQueries({ queryKey: ['services'] }),
      queryClient.invalidateQueries({ queryKey: ['staff'] }),
    ]);
  };
}

export function useAdminCategories() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['categories', 'admin'],
    queryFn: () =>
      unwrap(api.GET('/api/v1/categories', { params: { query: { includeInactive: 'true' } } })),
  });
}

export function useAdminServices(query: { page: number; q: string }) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['services', 'admin', query],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/services', {
          params: {
            query: {
              includeInactive: 'true',
              page: query.page,
              pageSize: 25,
              sort: 'name',
              ...(query.q.trim() ? { q: query.q.trim() } : {}),
            },
          },
        }),
      ),
  });
}

export function useSaveService() {
  const { api } = useAuth();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: { id: null; body: ServiceCreate } | { id: string; body: ServiceUpdate }) =>
      input.id === null
        ? unwrap(api.POST('/api/v1/services', { body: input.body }))
        : unwrap(
            api.PATCH('/api/v1/services/{id}', {
              params: { path: { id: input.id } },
              body: input.body,
            }),
          ),
    onSuccess: invalidate,
  });
}

export function useSetServiceActive() {
  const { api } = useAuth();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (active)
        await unwrap(
          api.PATCH('/api/v1/services/{id}', {
            params: { path: { id } },
            body: { isActive: true },
          }),
        );
      else await unwrap(api.DELETE('/api/v1/services/{id}', { params: { path: { id } } }));
    },
    onSuccess: invalidate,
  });
}

export function useSaveCategory() {
  const { api } = useAuth();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (
      input: { id: null; body: CategoryCreate } | { id: string; body: CategoryUpdate },
    ) =>
      input.id === null
        ? unwrap(api.POST('/api/v1/categories', { body: input.body }))
        : unwrap(
            api.PATCH('/api/v1/categories/{id}', {
              params: { path: { id: input.id } },
              body: input.body,
            }),
          ),
    onSuccess: invalidate,
  });
}

export function useSetCategoryActive() {
  const { api } = useAuth();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (active)
        await unwrap(
          api.PATCH('/api/v1/categories/{id}', {
            params: { path: { id } },
            body: { isActive: true },
          }),
        );
      else await unwrap(api.DELETE('/api/v1/categories/{id}', { params: { path: { id } } }));
    },
    onSuccess: invalidate,
  });
}
