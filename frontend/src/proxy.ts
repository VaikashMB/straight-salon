import { NextResponse, type NextRequest } from 'next/server';

// Next 16 proxy (formerly middleware), 05 §5:
// 1. /api/* is forwarded to the backend at request time (API_INTERNAL_URL is read per request,
//    never baked in at build time, 11 §5), so the browser only talks to this origin and the
//    refresh cookie stays first-party.
// 2. Coarse protection: /account, /staff and /admin need the ss_session indicator cookie
//    (06 §1), else sign in first. Roles are checked in the area layouts; the API enforces them.

export const SESSION_COOKIE = 'ss_session';
const PROTECTED = /^\/(account|staff|admin)(\/|$)/;

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    const backend = process.env.API_INTERNAL_URL;
    if (!backend) {
      return NextResponse.json(
        {
          type: 'about:blank',
          title: 'Service Unavailable',
          status: 503,
          code: 'TEMPORARILY_UNAVAILABLE',
          detail: 'The API is not configured (API_INTERNAL_URL).',
        },
        { status: 503, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    return NextResponse.rewrite(new URL(`${pathname}${search}`, backend));
  }

  if (PROTECTED.test(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/account/:path*', '/staff/:path*', '/admin/:path*'],
};
