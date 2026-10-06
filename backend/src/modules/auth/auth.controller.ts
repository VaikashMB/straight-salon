import type { Request, Response } from 'express';
import {
  clearSessionCookies,
  readRefreshCookie,
  setSessionCookies,
  type CookieConfig,
} from '../../shared/auth/cookies.js';
import { requireAuth } from '../../shared/auth/middleware.js';
import { validatedPart } from '../../shared/http/validate.js';
import type { Clock } from '../../shared/time/clock.js';
import type { UsersService } from '../users/users.service.js';
import type { AuthService, ClientMeta } from './auth.service.js';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
} from './auth.schemas.js';

// HTTP <-> service mapping only (03 §2): cookies in, cookies out.
export function createAuthController(deps: {
  auth: AuthService;
  users: UsersService;
  cookies: CookieConfig;
  clock: Clock;
}) {
  const { auth, users, cookies, clock } = deps;
  const meta = (req: Request): ClientMeta => ({ userAgent: req.get('user-agent'), ip: req.ip });

  return {
    register: async (req: Request, res: Response) => {
      const session = await auth.register(validatedPart<RegisterBody>(req, 'body'), meta(req));
      setSessionCookies(
        res,
        cookies,
        session.refresh.token,
        session.refresh.expiresAt,
        clock.now(),
      );
      res.status(201).json({ user: session.user, accessToken: session.accessToken });
    },

    login: async (req: Request, res: Response) => {
      const { email, password } = validatedPart<LoginBody>(req, 'body');
      const session = await auth.login(email, password, meta(req));
      setSessionCookies(
        res,
        cookies,
        session.refresh.token,
        session.refresh.expiresAt,
        clock.now(),
      );
      res.status(200).json({ user: session.user, accessToken: session.accessToken });
    },

    refresh: async (req: Request, res: Response) => {
      try {
        const result = await auth.refresh(readRefreshCookie(req), meta(req));
        setSessionCookies(
          res,
          cookies,
          result.refresh.token,
          result.refresh.expiresAt,
          clock.now(),
        );
        res.status(200).json({ accessToken: result.accessToken });
      } catch (err) {
        clearSessionCookies(res, cookies); // a dead session should not keep the indicator cookie
        throw err;
      }
    },

    logout: async (req: Request, res: Response) => {
      await auth.logout(readRefreshCookie(req));
      clearSessionCookies(res, cookies);
      res.status(204).end();
    },

    logoutAll: async (req: Request, res: Response) => {
      await auth.logoutAll(requireAuth(req).userId);
      clearSessionCookies(res, cookies);
      res.status(204).end();
    },

    forgotPassword: async (req: Request, res: Response) => {
      await auth.forgotPassword(validatedPart<ForgotPasswordBody>(req, 'body').email);
      res.status(202).end();
    },

    resetPassword: async (req: Request, res: Response) => {
      const { token, newPassword } = validatedPart<ResetPasswordBody>(req, 'body');
      await auth.resetPassword(token, newPassword);
      clearSessionCookies(res, cookies);
      res.status(204).end();
    },

    changePassword: async (req: Request, res: Response) => {
      const { currentPassword, newPassword } = validatedPart<ChangePasswordBody>(req, 'body');
      const refresh = await auth.changePassword(
        requireAuth(req).userId,
        currentPassword,
        newPassword,
        meta(req),
      );
      setSessionCookies(res, cookies, refresh.token, refresh.expiresAt, clock.now());
      res.status(204).end();
    },

    me: async (req: Request, res: Response) => {
      res.json(await users.getMe(requireAuth(req).userId));
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
