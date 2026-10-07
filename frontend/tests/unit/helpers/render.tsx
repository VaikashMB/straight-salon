import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import type { Session } from '@/lib/auth/session';
import { makeQueryClient } from '@/lib/query-client';

// Renders with the app's real providers (query client, session) against the MSW API.
export function renderWithProviders(
  ui: ReactElement,
  options: { session?: Session } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { session, ...renderOptions } = options;
  const queryClient = makeQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider {...(session ? { session } : {})}>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...render(ui, { wrapper, ...renderOptions }) };
}
