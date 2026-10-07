import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import RegisterPage from '@/app/(public)/register/page';
import { api, makeUser, problem, server } from '../../helpers/api';
import { router, setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

async function fill(values: { name: string; email: string; phone: string; password: string }) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Full name'), values.name);
  await user.type(screen.getByLabelText('Email'), values.email);
  await user.type(screen.getByLabelText('Mobile number'), values.phone);
  await user.type(screen.getByLabelText('Password'), values.password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

const valid = {
  name: 'Ananya Rao',
  email: 'Ananya@Example.com',
  phone: '98765 43212',
  password: 'Fade-and-Trim7',
};

describe('register page (API-001, FR-001)', () => {
  it('sends the normalised details and lands the new customer on /account (or ?next)', async () => {
    let sent: unknown;
    server.use(
      http.post(api('/auth/register'), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ user: makeUser(), accessToken: 'tok' }, { status: 201 });
      }),
    );
    setLocation('/register', 'next=/book');
    renderWithProviders(<RegisterPage />);
    expect(screen.getByText(/we'll assume \+91/)).toBeInTheDocument();
    await fill(valid);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/book'));
    expect(sent).toEqual({
      name: 'Ananya Rao',
      email: 'ananya@example.com',
      phone: '+919876543212',
      password: 'Fade-and-Trim7',
    });
  });

  it('shows the password policy inline', async () => {
    renderWithProviders(<RegisterPage />);
    await fill({ ...valid, password: 'password' });
    expect(await screen.findByText('Use at least one letter and one number')).toBeInTheDocument();
  });

  it('FR-001 a walk-in phone is refused on the phone field', async () => {
    server.use(http.post(api('/auth/register'), () => problem(409, 'PHONE_ALREADY_REGISTERED')));
    renderWithProviders(<RegisterPage />);
    await fill(valid);
    expect(await screen.findByText(/contact the front desk/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-invalid', 'true');
  });

  it('an existing account suggests signing in', async () => {
    server.use(http.post(api('/auth/register'), () => problem(409, 'DUPLICATE')));
    renderWithProviders(<RegisterPage />);
    await fill(valid);
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('server field errors land on their fields; anything else is a form error', async () => {
    server.use(
      http.post(api('/auth/register'), () =>
        problem(400, 'VALIDATION_FAILED', {
          errors: [{ path: 'password', message: 'This password is too common' }],
        }),
      ),
    );
    renderWithProviders(<RegisterPage />);
    await fill(valid);
    expect(await screen.findByText('This password is too common')).toBeInTheDocument();

    server.use(http.post(api('/auth/register'), () => problem(500, 'INTERNAL_ERROR')));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ref: req-123');
  });
});
