'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CSRF, unwrap, type ApiClient, type Schemas } from '../api/client';
import { readClaims } from './claims';
import { loginPathFor } from './roles';
import { createSession, type Session } from './session';

// Session state for React (05 §5). On load, one refresh tells us whether the user is signed in;
// then /auth/me says who they are.

export type User = Schemas['User'];
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  staffId: string | null; // STAFF only: their stylist profile, from the token (06 §1)
  api: ApiClient; // authenticated client: bearer token + refresh-and-retry
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void; // after PATCH /users/me
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  session: injected,
}: {
  children: ReactNode;
  session?: Session; // tests
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [session] = useState(() => injected ?? createSession());
  const [state, setState] = useState<{
    status: AuthStatus;
    user: User | null;
    staffId: string | null;
  }>({ status: 'loading', user: null, staffId: null });

  // Bootstrap: a valid refresh cookie means a session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await session.refresh();
      const user = token
        ? await unwrap(session.api.GET('/api/v1/auth/me')).catch(() => null)
        : null;
      if (!cancelled) {
        setState({
          status: user ? 'authenticated' : 'anonymous',
          user,
          staffId: user ? readClaims(session.getToken()).staffId : null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // The session ended while using the app: clear everything and ask to sign in again.
  useEffect(
    () =>
      session.onExpired(() => {
        setState({ status: 'anonymous', user: null, staffId: null });
        queryClient.clear();
        router.replace(loginPathFor(pathname));
      }),
    [session, queryClient, router, pathname],
  );

  const startSession = useCallback(
    (result: { user: User; accessToken: string }) => {
      session.setToken(result.accessToken);
      setState({
        status: 'authenticated',
        user: result.user,
        staffId: readClaims(result.accessToken).staffId,
      });
      return result.user;
    },
    [session],
  );

  const login = useCallback(
    async (email: string, password: string) =>
      startSession(
        await unwrap(
          session.publicApi.POST('/api/v1/auth/login', { params: CSRF, body: { email, password } }),
        ),
      ),
    [session, startSession],
  );

  const register = useCallback(
    async (input: RegisterInput) =>
      startSession(
        await unwrap(
          session.publicApi.POST('/api/v1/auth/register', { params: CSRF, body: input }),
        ),
      ),
    [session, startSession],
  );

  const logout = useCallback(async () => {
    // Signing out locally must work even if the API is unreachable.
    await session.publicApi.POST('/api/v1/auth/logout', { params: CSRF }).catch(() => undefined);
    session.setToken(null);
    setState({ status: 'anonymous', user: null, staffId: null });
    queryClient.clear();
  }, [session, queryClient]);

  const updateUser = useCallback((user: User) => setState((s) => ({ ...s, user })), []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, api: session.api, login, register, logout, updateUser }),
    [state, session, login, register, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
