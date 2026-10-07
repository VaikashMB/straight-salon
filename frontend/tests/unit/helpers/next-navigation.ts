import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';

// Stand-in for next/navigation in component tests (installed in setup.ts). Tests steer the
// current path and query, and assert on router calls. push/replace really navigate, so pages
// that keep state in the URL (the booking wizard, 05 §4.1) re-render like they would in Next.

interface Location {
  pathname: string;
  search: URLSearchParams;
}

let location: Location = { pathname: '/', search: new URLSearchParams() };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setLocation(pathname: string, search = ''): void {
  location = { pathname, search: new URLSearchParams(search) };
  emit();
}

function navigate(href: string): void {
  const url = new URL(href, 'http://localhost:3000');
  setLocation(url.pathname, url.search);
}

export const router = {
  push: vi.fn(navigate),
  replace: vi.fn(navigate),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export function resetNavigation(): void {
  location = { pathname: '/', search: new URLSearchParams() };
  for (const fn of Object.values(router)) fn.mockClear();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => location;

export const useRouter = () => router;
export const usePathname = () => useSyncExternalStore(subscribe, snapshot).pathname;
export const useSearchParams = () => useSyncExternalStore(subscribe, snapshot).search;
export const redirect = vi.fn();
export const notFound = vi.fn();
