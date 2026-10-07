import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './helpers/api';
import { resetNavigation } from './helpers/next-navigation';

// jsdom has no matchMedia (the toaster follows the OS colour scheme). Node-environment tests
// (proxy.test.ts) have no window at all.
if (typeof window !== 'undefined')
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

// Charts (Recharts' ResponsiveContainer) measure their box with ResizeObserver.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub });
}

vi.mock('next/navigation', () => import('./helpers/next-navigation'));
vi.mock('sonner', async (original) => ({
  ...(await original<typeof import('sonner')>()),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetNavigation();
  vi.clearAllMocks();
});
afterAll(() => server.close());
