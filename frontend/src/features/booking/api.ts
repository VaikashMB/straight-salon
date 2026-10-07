'use client';

import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@/lib/api/client';
import type { paths } from '@/lib/api/schema';
import { useAuth } from '@/lib/auth/AuthProvider';
import { dayRanges } from './slots';

// Client reads for the booking flow (wizard, reschedule, walk-ins).

export type Service = Schemas['Service'];
export type Category = Schemas['Category'];
export type Stylist = Schemas['Staff'];
export type Booking = Schemas['Booking'];
export type Slot = Schemas['Availability']['slots'][number];

export function useCategories() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['categories', 'public'],
    queryFn: () => unwrap(api.GET('/api/v1/categories')),
    staleTime: 5 * 60_000,
  });
}

export function useServices() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['services', 'public'],
    queryFn: async () =>
      (
        await unwrap(
          api.GET('/api/v1/services', { params: { query: { pageSize: 100, sort: 'name' } } }),
        )
      ).data,
    staleTime: 5 * 60_000,
  });
}

export function useStylists() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['staff', 'public'],
    queryFn: () => unwrap(api.GET('/api/v1/staff')),
    staleTime: 5 * 60_000,
  });
}

// Stylists who can perform every chosen service (BR-007, 05 §4.1 step 2).
export const qualifiedFor = (stylists: Stylist[], serviceIds: string[]) =>
  stylists.filter((s) => serviceIds.every((id) => s.serviceIds.includes(id)));

// Dates with at least one slot (API-041), over a window split into 31-day requests.
export function useAvailableDays(serviceIds: string[], staffId: string, dates: string[]) {
  const { api } = useAuth();
  const services = serviceIds.join(',');
  const queries = useQueries({
    queries: dayRanges(dates).map(({ from, to }) => ({
      queryKey: ['availability', 'days', services, staffId, from, to],
      queryFn: () =>
        unwrap(
          api.GET('/api/v1/availability/days', {
            params: { query: { serviceIds: services, staffId, from, to } },
          }),
        ),
      enabled: serviceIds.length > 0 && dates.length > 0,
      staleTime: 60_000,
    })),
  });
  return {
    isPending: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
    refetch: () => queries.forEach((q) => void q.refetch()),
    availableDates: new Set(queries.flatMap((q) => q.data?.availableDates ?? [])),
  };
}

// Start times on one date (API-040).
export function useAvailability(serviceIds: string[], staffId: string, date: string | null) {
  const { api } = useAuth();
  const services = serviceIds.join(',');
  return useQuery({
    queryKey: ['availability', 'slots', services, staffId, date],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/availability', {
          params: { query: { serviceIds: services, staffId, date: date! } },
        }),
      ),
    enabled: serviceIds.length > 0 && date !== null,
    staleTime: 30_000,
  });
}

export function useBooking(id: string | null) {
  const { api, status } = useAuth();
  return useQuery({
    queryKey: ['bookings', 'detail', id],
    queryFn: () => unwrap(api.GET('/api/v1/bookings/{id}', { params: { path: { id: id! } } })),
    enabled: id !== null && status === 'authenticated',
  });
}

// Idempotency-Key for POST /bookings (03 §9): 8–100 characters of [A-Za-z0-9_-].
export const newIdempotencyKey = (): string => crypto.randomUUID();

export type BookingQuery = NonNullable<paths['/api/v1/bookings']['get']['parameters']['query']>;

// API-052 for staff, reception and admin (STAFF are limited to their own bookings by the API).
export function useBookingSearch(
  query: BookingQuery,
  options: { refetchInterval?: number; enabled?: boolean } = {},
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['bookings', 'list', query],
    queryFn: () => unwrap(api.GET('/api/v1/bookings', { params: { query } })),
    placeholderData: keepPreviousData,
    ...options,
  });
}
