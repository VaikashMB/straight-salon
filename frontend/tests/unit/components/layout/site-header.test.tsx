import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import PublicLayout from '@/app/(public)/layout';
import { api, makeUser, server, signedInAs } from '../../helpers/api';
import { router, setLocation } from '../../helpers/next-navigation';
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
  ] as const)(
    'signed in as %s: the profile menu holds who is signed in, their area and sign out',
    async (role, label, href) => {
      signedInAs(makeUser({ role }));
      const user = userEvent.setup();
      renderWithProviders(home);
      const trigger = await screen.findByRole('button', { name: 'Account menu for Ananya Rao' });
      expect(within(trigger).getByText('Ananya')).toBeInTheDocument();
      expect(within(trigger).getByText('AR')).toHaveAttribute('aria-hidden');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();

      await user.click(trigger);
      const menu = await screen.findByRole('menu');
      expect(within(menu).getByText('ananya@example.com')).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: label })).toHaveAttribute('href', href);
      expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    },
  );

  it('signing out from the profile menu ends the session (API-004)', async () => {
    let loggedOut = false;
    signedInAs(makeUser({ role: 'CUSTOMER' }));
    server.use(
      http.post(api('/auth/logout'), () => {
        loggedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(home);
    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(loggedOut).toBe(true);
  });

  it('marks the current section with aria-current, including its sub-pages', () => {
    setLocation('/services/haircut');
    renderWithProviders(home);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Services' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Stylists' })).not.toHaveAttribute('aria-current');
  });

  it('puts the theme toggle in the header', () => {
    renderWithProviders(home);
    expect(screen.getByRole('button', { name: /System theme/ })).toBeInTheDocument();
  });
});

describe('mobile menu', () => {
  const menuButton = () => screen.getByRole('button', { name: /^(Menu|Close menu)$/ });

  it('opens a panel with the links, session actions and theme toggle; Escape closes it', async () => {
    const user = userEvent.setup();
    setLocation('/stylists');
    renderWithProviders(home);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();

    await user.click(menuButton());
    expect(menuButton()).toHaveAccessibleName('Close menu');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(menuButton().getAttribute('aria-controls')!)!;
    const nav = within(panel).getByRole('navigation', { name: 'Mobile' });
    // Focus moves to the first link; the current section is marked.
    expect(within(nav).getByRole('link', { name: 'Services' })).toHaveFocus();
    expect(within(nav).getByRole('link', { name: 'Stylists' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await within(panel).findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(within(panel).getByRole('button', { name: /theme/ })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
    expect(menuButton()).toHaveAccessibleName('Menu');
    expect(menuButton()).toHaveFocus();
  });

  it('closes on a link click, on route change and with the button', async () => {
    const user = userEvent.setup();
    renderWithProviders(home);
    await user.click(menuButton());
    await user.click(
      within(screen.getByRole('navigation', { name: 'Mobile' })).getByRole('link', {
        name: 'Book now',
      }),
    );
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();

    await user.click(menuButton());
    expect(screen.getByRole('navigation', { name: 'Mobile' })).toBeInTheDocument();
    act(() => setLocation('/services'));
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton());
    await user.click(menuButton());
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
  });

  it('signed in: the area link and sign out are in the panel', async () => {
    signedInAs(makeUser({ role: 'CUSTOMER' }));
    const user = userEvent.setup();
    renderWithProviders(home);
    await screen.findByRole('button', { name: /Account menu/ });
    await user.click(menuButton());
    const panel = document.getElementById('mobile-menu')!;
    expect(within(panel).getByRole('link', { name: 'My bookings' })).toHaveAttribute(
      'href',
      '/account',
    );
    expect(within(panel).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(panel).getByText('Signed in as')).toBeInTheDocument();
    expect(within(panel).getByText('Ananya Rao')).toBeInTheDocument();
    expect(within(panel).getByText(/· Customer/)).toBeInTheDocument();
  });
});
