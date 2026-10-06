import { parse } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';

// Session cookies (06 §1):
// - ss_rt: opaque refresh token, httpOnly, scoped to /api/v1/auth so it only travels to auth calls.
// - ss_session: "1", path /, httpOnly; only tells the frontend proxy a session exists (05 §5).
export const REFRESH_COOKIE = 'ss_rt';
export const SESSION_COOKIE = 'ss_session';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface CookieConfig {
  secure: boolean;
  domain?: string | undefined;
}

function baseOptions(config: CookieConfig, path: string): CookieOptions {
  const options: CookieOptions = { httpOnly: true, secure: config.secure, sameSite: 'lax', path };
  if (config.domain) options.domain = config.domain;
  return options;
}

export function setSessionCookies(
  res: Response,
  config: CookieConfig,
  refreshToken: string,
  expiresAt: Date,
  now: Date,
): void {
  const maxAge = Math.max(0, expiresAt.getTime() - now.getTime());
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseOptions(config, REFRESH_COOKIE_PATH), maxAge });
  res.cookie(SESSION_COOKIE, '1', { ...baseOptions(config, '/'), maxAge });
}

export function clearSessionCookies(res: Response, config: CookieConfig): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(config, REFRESH_COOKIE_PATH));
  res.clearCookie(SESSION_COOKIE, baseOptions(config, '/'));
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.get('cookie');
  if (!header) return undefined;
  return parse(header)[REFRESH_COOKIE] || undefined;
}
