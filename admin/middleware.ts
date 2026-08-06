import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const auth = req.cookies.get('admin_auth');
  const isLoginPage = req.nextUrl.pathname === '/login';
  const isApiAuth = req.nextUrl.pathname === '/api/auth';

  const expected = process.env.ADMIN_SESSION_TOKEN;
  // Compare the value, not merely its presence. Checking presence alone would
  // let anyone through with `Cookie: admin_auth=anything`, since the login
  // form is not consulted again after the cookie is set. Refuse everything if
  // the secret is unset rather than falling open.
  const isAuthed = Boolean(expected) && auth?.value === expected;

  if (!isAuthed && !isLoginPage && !isApiAuth) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
