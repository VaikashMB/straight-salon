import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PublicLayout from '@/app/(public)/layout';
import { makeUser, signedInAs } from '../../helpers/api';
import { renderWithProviders } from '../../helpers/render';

const home = (
  <PublicLayout>
    <h1>Page content</h1>
  </PublicLayout>
);

describe('public layout and header', () => {
  it('anonymous: catalogue links, sign-in and register links', async () => {
    renderWithProviders(home);
    expect(screen.getByRole('heading', { level: 1, name: 'Page content' })).toBeInTheDocument();
    expect(await screen.findAllByRole('link', { name: 'Sign in' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Create account' })[0]).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByText(/© \d{4} Straight Salon/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Services' })).toHaveAttribute(
      'href',
      '/services',
    );
    expect(within(nav).getByRole('link', { name: 'Stylists' })).toHaveAttribute(
      'href',
      '/stylists',
    );
    expect(within(nav).getByRole('link', { name: 'Book now' })).toHaveAttribute('href', '/book');
  });

  it.each([
    ['CUSTOMER', 'My bookings', '/account'],
    ['STAFF', 'My day', '/staff'],
    ['RECEPTIONIST', 'Dashboard', '/admin'],
  ] as const)('signed in as %s: a link to their area and sign out', async (role, label, href) => {
    signedInAs(makeUser({ role }));
    renderWithProviders(home);
    expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', href);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
