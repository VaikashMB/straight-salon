import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PublicLayout from '@/app/(public)/layout';
import HomePage from '@/app/(public)/page';
import { makeUser, signedInAs } from '../../helpers/api';
import { renderWithProviders } from '../../helpers/render';

const home = (
  <PublicLayout>
    <HomePage />
  </PublicLayout>
);

describe('public layout and header', () => {
  it('anonymous: sign-in and register links; the home placeholder', async () => {
    renderWithProviders(home);
    expect(screen.getByRole('heading', { level: 1, name: 'Straight Salon' })).toBeInTheDocument();
    expect(await screen.findAllByRole('link', { name: 'Sign in' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Create account' })[0]).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByText(/© \d{4} Straight Salon/)).toBeInTheDocument();
    // Catalogue links arrive with their pages (Phase 9).
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
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
