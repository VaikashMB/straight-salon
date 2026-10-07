import { CSRF, unwrap, type ApiClient } from '@/lib/api/client';

// Auth calls that do not change the session (login/register/logout live in AuthProvider).

// API-006: always 202, whether or not the account exists (no user enumeration).
export async function requestPasswordReset(api: ApiClient, email: string): Promise<void> {
  await unwrap(api.POST('/api/v1/auth/forgot-password', { params: CSRF, body: { email } }));
}

// API-007: 204; 400 INVALID_RESET_TOKEN for unknown, used or expired tokens.
export async function resetPassword(
  api: ApiClient,
  token: string,
  newPassword: string,
): Promise<void> {
  await unwrap(
    api.POST('/api/v1/auth/reset-password', { params: CSRF, body: { token, newPassword } }),
  );
}
