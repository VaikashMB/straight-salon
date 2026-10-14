import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SiteFooter } from '@/components/layout/site-footer';
import { isProtectedPath } from '@/lib/auth/roles';

// next/link's prefetch prop isn't visible in the DOM, so record it on the anchor.
vi.mock('next/link', () => ({
  default: ({
    prefetch,
    href,
    children,
    ...rest
  }: ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a href={String(href)} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

describe('footer links and prefetching (05 §5)', () => {
  it('never prefetches a signed-in area: a cached sign-in redirect would outlive signing in', () => {
    render(<SiteFooter />);
    expect(screen.getByRole('link', { name: 'Your account' })).toHaveAttribute(
      'data-prefetch',
      'false',
    );
    // Public pages keep the default prefetching.
    expect(screen.getByRole('link', { name: 'Services & prices' })).toHaveAttribute(
      'data-prefetch',
      'undefined',
    );
  });

  it('knows which paths are signed-in areas', () => {
    expect(
      ['/account', '/account/history', '/staff', '/admin/bookings'].map(isProtectedPath),
    ).toEqual([true, true, true, true]);
    expect(['/', '/accounts', '/book', '/login'].map(isProtectedPath)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
