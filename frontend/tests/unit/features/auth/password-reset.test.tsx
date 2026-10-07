import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import ForgotPasswordPage from '@/app/(public)/forgot-password/page';
import ResetPasswordPage from '@/app/(public)/reset-password/page';
import { api, problem, server } from '../../helpers/api';
import { router, setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

describe('forgot password (API-006, FR-004)', () => {
  it('always confirms, without revealing whether the account exists', async () => {
    let body: unknown;
    server.use(
      http.post(api('/auth/forgot-password'), async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 202 });
      }),
    );
    renderWithProviders(<ForgotPasswordPage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'Someone@Example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Reset link sent')).toBeInTheDocument();
    expect(screen.getByText(/If an account exists for someone@example.com/)).toBeInTheDocument();
    expect(body).toEqual({ email: 'someone@example.com' });
  });

  it('shows rate limiting and validation errors', async () => {
    server.use(http.post(api('/auth/forgot-password'), () => problem(429, 'RATE_LIMITED')));
    renderWithProviders(<ForgotPasswordPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });
});

describe('reset password (API-007)', () => {
  async function submit(password: string, confirm = password) {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), password);
    await user.type(screen.getByLabelText('Confirm new password'), confirm);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
  }

  it('sets the new password with the token from the link, then asks to sign in', async () => {
    let body: unknown;
    server.use(
      http.post(api('/auth/reset-password'), async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setLocation('/reset-password', `token=${'t'.repeat(43)}`);
    renderWithProviders(<ResetPasswordPage />);
    await submit('New-Pass-2026');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(body).toEqual({ token: 't'.repeat(43), newPassword: 'New-Pass-2026' });
    expect(toast.success).toHaveBeenCalled();
  });

  it('mismatched passwords are caught inline', async () => {
    setLocation('/reset-password', 'token=abc');
    renderWithProviders(<ResetPasswordPage />);
    await submit('New-Pass-2026', 'New-Pass-2027');
    expect(await screen.findByText("The passwords don't match")).toBeInTheDocument();
  });

  it('an expired or used link offers a new one; field errors land on the field', async () => {
    server.use(http.post(api('/auth/reset-password'), () => problem(400, 'INVALID_RESET_TOKEN')));
    setLocation('/reset-password', 'token=abc');
    renderWithProviders(<ResetPasswordPage />);
    await submit('New-Pass-2026');
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );

    server.use(
      http.post(api('/auth/reset-password'), () =>
        problem(400, 'VALIDATION_FAILED', {
          errors: [{ path: 'newPassword', message: 'This password is too common' }],
        }),
      ),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('This password is too common')).toBeInTheDocument();

    server.use(
      http.post(api('/auth/reset-password'), () => problem(503, 'TEMPORARILY_UNAVAILABLE')),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('busy right now');
  });

  it('without a token, points to the forgot-password page', async () => {
    renderWithProviders(<ResetPasswordPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('needs the link');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
