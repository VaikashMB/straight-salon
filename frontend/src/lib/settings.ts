'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { unwrap, type Schemas } from './api/client';
import { useAuth } from './auth/AuthProvider';
import { formatDate, formatDateTime, formatMoney, formatTime } from './format';

// Public salon settings (API-016): timezone and currency drive all formatting (05 §1, §7).

export type PublicSettings = Schemas['PublicSettings'];

export const publicSettingsKey = ['settings', 'public'] as const;

export function usePublicSettings() {
  const { api } = useAuth();
  return useQuery({
    queryKey: publicSettingsKey,
    queryFn: () => unwrap(api.GET('/api/v1/settings/public')),
    staleTime: 10 * 60_000, // the API caches it for 10 min too (08 §2)
  });
}

// Formatters bound to the salon's timezone and currency; null until settings have loaded.
export function useSalonFormat() {
  const { data } = usePublicSettings();
  return useMemo(() => {
    if (!data) return null;
    const { timezone, currency } = data;
    return {
      timezone,
      currency,
      money: (amountMinor: number) => formatMoney(amountMinor, currency),
      dateTime: (instant: Date | string) => formatDateTime(instant, timezone),
      time: (instant: Date | string) => formatTime(instant, timezone),
      date: (instant: Date | string) => formatDate(instant, timezone),
    };
  }, [data]);
}
