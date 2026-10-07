import { vi } from 'vitest';

// Stand-in for next/navigation in component tests (installed in setup.ts). Tests steer the
// current path and query, and assert on router calls.
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

const location = { pathname: '/', search: new URLSearchParams() };

export function setLocation(pathname: string, search = ''): void {
  location.pathname = pathname;
  location.search = new URLSearchParams(search);
}

export function resetNavigation(): void {
  setLocation('/');
  for (const fn of Object.values(router)) fn.mockReset();
}

export const useRouter = () => router;
export const usePathname = () => location.pathname;
export const useSearchParams = () => location.search;
export const redirect = vi.fn();
export const notFound = vi.fn();
