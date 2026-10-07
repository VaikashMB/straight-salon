import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { useAuth } from '@/lib/auth/AuthProvider';
import { createSession } from '@/lib/auth/session';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import { router, setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

function Probe() {
  const { status, user } = useAuth();
  return (
    <p>
      {status}:{user?.name ?? '-'}
    </p>
  );
}

function Capture({ onValue }: { onValue: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  useEffect(() => {
    onValue(auth);
  });
  return <Probe />;
}

const session = () => {
  let value: ReturnType<typeof useAuth> | null = null;
  renderWithProviders(<Capture onValue={(v) => (value = v)} />);
  return () => value!;
};

describe('AuthProvider (05 §5)', () => {
  it('without a refresh cookie the visitor is anonymous', async () => {
    renderWithProviders(<Probe />);
    expect(screen.getByText('loading:-')).toBeInTheDocument();
    expect(await screen.findByText('anonymous:-')).toBeInTheDocument();
  });

  it('a valid refresh cookie restores the session on load', async () => {
    signedInAs(makeUser({ name: 'Priya Nair', role: 'STAFF' }));
    renderWithProviders(<Probe />);
    expect(await screen.findByText('authenticated:Priya Nair')).toBeInTheDocument();
  });

  it('login and register start a session; failures throw ApiError', async () => {
    const user = makeUser();
    server.use(
      http.post(api('/auth/login'), async ({ request }) => {
        const body = (await request.json()) as { password: string };
        return body.password === 'right'
          ? HttpResponse.json({ user, accessToken: 'a1' })
          : problem(401, 'UNAUTHENTICATED');
      }),
      http.post(api('/auth/register'), () =>
        HttpResponse.json(
          { user: { ...user, name: 'New Person' }, accessToken: 'a2' },
          { status: 201 },
        ),
      ),
    );
    const auth = session();
    await screen.findByText('anonymous:-');
    await expect(act(() => auth().login('a@b.co', 'wrong'))).rejects.toMatchObject({ status: 401 });
    await act(() => auth().login('a@b.co', 'right'));
    expect(screen.getByText('authenticated:Ananya Rao')).toBeInTheDocument();
    await act(() =>
      auth().register({
        name: 'New Person',
        email: 'n@b.co',
        phone: '+919000000000',
        password: 'x',
      }),
    );
    expect(screen.getByText('authenticated:New Person')).toBeInTheDocument();
  });

  it('logout ends the session even if the API is unreachable', async () => {
    signedInAs(makeUser());
    server.use(http.post(api('/auth/logout'), () => HttpResponse.error()));
    const auth = session();
    await screen.findByText('authenticated:Ananya Rao');
    await act(() => auth().logout());
    expect(screen.getByText('anonymous:-')).toBeInTheDocument();
  });

  it('an expired session mid-use signs out and sends the user to sign in with ?next', async () => {
    const s = createSession();
    signedInAs(makeUser());
    setLocation('/account/history');
    renderWithProviders(<Probe />, { session: s });
    await screen.findByText('authenticated:Ananya Rao');
    // The token stops working and the refresh cookie is gone.
    server.use(
      http.get(api('/auth/me'), () => problem(401, 'TOKEN_EXPIRED')),
      http.post(api('/auth/refresh'), () => problem(401, 'UNAUTHENTICATED')),
    );
    await act(() => s.api.GET('/api/v1/auth/me'));
    await waitFor(() => expect(screen.getByText('anonymous:-')).toBeInTheDocument());
    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Faccount%2Fhistory');
  });

  it('useAuth outside the provider is a programming error', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/inside <AuthProvider>/);
  });
});
