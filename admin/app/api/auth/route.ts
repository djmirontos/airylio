import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (password === process.env.ADMIN_PASSWORD) {
    const response = NextResponse.json({ success: true });
    // The cookie carries a secret rather than a constant. The middleware
    // compares it, so a request cannot get in by simply presenting a cookie of
    // this name - which a literal 'true' would have allowed.
    response.cookies.set('admin_auth', process.env.ADMIN_SESSION_TOKEN ?? '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });
    return response;
  }

  return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
}
