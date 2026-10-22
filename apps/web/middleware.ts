import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/offline', '/manifest.webmanifest', '/sw.js', '/icons', '/favicon'];

/** Send anyone without a session cookie to sign in. Role checks happen in the API on every call. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.get('psebc_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.(?:png|svg|ico|webmanifest|js)$).*)'],
};
