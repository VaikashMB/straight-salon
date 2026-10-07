import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import LoginPage from '@/app/(public)/login/page';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import { router, setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

function loginReturns(user = makeUser()) {
  server.use(
    http.post(api('/auth/login'), async ({ request }) => {
      const body = (await request.json()) as { email: string; password: string };
      if (request.headers.get('x-requested-with') !== 'straight-salon-web')
        return problem(403, 'FORBIDDEN');
      return body.password === 'Fade-and-Trim7'
        ? HttpResponse.json({ user, accessToken: 'tok' })
        : problem(401, 'UNAUTHENTICATED');
    }),
  );
}

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('login page (API-002, 05 §5)', () => {
  it('validates inline before calling the API', async () => {
    renderWithProviders(<LoginPage />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('a customer lands on /account, with a welcome toast', async () => {
    loginReturns();
    renderWithProviders(<LoginPage />);
    await fill('Ananya@example.com', 'Fade-and-Trim7');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/account'));
    expect(toast.success).toHaveBeenCalledWith('Welcome back, Ananya');
  });

  it('honours ?next when the role may go there; staff roles land in their area', async () => {
    loginReturns(makeUser({ role: 'RECEPTIONIST' }));
    setLocation('/login', 'next=/admin/bookings');
    renderWithProviders(<LoginPage />);
    await fill('desk@example.com', 'Fade-and-Trim7');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/bookings'));
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?next=%2Fadmin%2Fbookings',
    );
  });

  it('wrong credentials: one generic message (06 §2)', async () => {
    loginReturns();
    renderWithProviders(<LoginPage />);
    await fill('ananya@example.com', 'wrong-pass1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('lockout and outages use the mapped messages', async () => {
    server.use(http.post(api('/auth/login'), () => problem(429, 'RATE_LIMITED')));
    renderWithProviders(<LoginPage />);
    await fill('ananya@example.com', 'Fade-and-Trim7');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('already signed in: goes straight to the role’s area', async () => {
    signedInAs(makeUser({ role: 'STAFF' }));
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/staff'));
  });
});
