import { describe, expect, it } from 'vitest';
import {
  areaOf,
  canUseArea,
  landingFor,
  loginPathFor,
  postLoginPath,
  safeNextPath,
} from '@/lib/auth/roles';

describe('role landing and areas (05 §5)', () => {
  it('lands each role in its area', () => {
    expect(landingFor('CUSTOMER')).toBe('/account');
    expect(landingFor('STAFF')).toBe('/staff');
    expect(landingFor('RECEPTIONIST')).toBe('/admin');
    expect(landingFor('ADMIN')).toBe('/admin');
  });

  it('knows which area a path is in and who may use it', () => {
    expect(areaOf('/account/history')).toBe('account');
    expect(areaOf('/admin')).toBe('admin');
    expect(areaOf('/staffing')).toBeNull();
    expect(areaOf('/')).toBeNull();
    expect(canUseArea('RECEPTIONIST', 'admin')).toBe(true);
    expect(canUseArea('STAFF', 'admin')).toBe(false);
    expect(canUseArea('ADMIN', 'account')).toBe(false);
  });

  it('only same-site, non-auth paths are honoured as ?next (no open redirect)', () => {
    expect(safeNextPath('/book?services=a')).toBe('/book?services=a');
    for (const bad of [
      null,
      undefined,
      '',
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'account',
      '/login',
      '/register?next=/x',
      '/reset-password',
    ]) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
    expect(safeNextPath('/logins')).toBe('/logins');
  });

  it('after sign-in: back to ?next if allowed for the role, else the role’s area', () => {
    expect(postLoginPath('CUSTOMER', '/book?date=2026-10-12')).toBe('/book?date=2026-10-12');
    expect(postLoginPath('CUSTOMER', '/account/history')).toBe('/account/history');
    expect(postLoginPath('CUSTOMER', '/admin/reports')).toBe('/account');
    expect(postLoginPath('RECEPTIONIST', '/admin/bookings?x=1')).toBe('/admin/bookings?x=1');
    expect(postLoginPath('STAFF', null)).toBe('/staff');
    expect(loginPathFor('/admin/reports?from=a&to=b')).toBe(
      '/login?next=%2Fadmin%2Freports%3Ffrom%3Da%26to%3Db',
    );
  });
});
