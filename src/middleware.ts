import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, UserRole } from '@/types/database';

function getRoleLandingRoute(role: UserRole | string | null): string {
  switch (role) {
    case 'APPROVER':
      return '/approvals';
    case 'PREPARER':
      return '/payments';
    case 'VERIFIER':
      return '/verify';
    case 'AUDITOR':
      return '/audit';
    default:
      return '/';
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 0. Bypass middleware for static assets, PWA files, and Cron endpoints (enforces CRON_SECRET in route handler)
  if (
    pathname.startsWith('/api/cron/') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname === '/favicon.ico' ||
    pathname === '/logo.png' ||
    pathname === '/icon-192.png' ||
    pathname === '/icon-512.png' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons/') ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|woff|woff2|ttf|eot)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  }) as unknown as SupabaseClient<Database>;

  // Session refresh & verification
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 1. Unauthenticated requests: JSON 401 for /api/*, redirect to /login for pages
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }
    if (pathname === '/login') {
      return response;
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  // 2. Immediate Disabled-User Block
  if (user.app_metadata?.is_active === false) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized. Account is disabled.' },
        { status: 401 }
      );
    }
    if (pathname === '/login') {
      return response;
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('error', 'account_disabled');
    return NextResponse.redirect(redirectUrl);
  }

  // 3. Fetch authenticated user role & admin status strictly from admin-controlled app_metadata
  const role: UserRole | string | null = (user.app_metadata?.role as UserRole) || null;
  const isAdmin: boolean = Boolean(user.app_metadata?.is_admin);

  // If role is not yet cached in app_metadata, allow page/API request to reach server layer
  if (!role) {
    if (pathname === '/login') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/';
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  const landingRoute = getRoleLandingRoute(role);

  // 4. Authenticated user visiting /login -> redirect to landing route
  if (pathname === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.searchParams.delete('error');
    redirectUrl.pathname = landingRoute;
    return NextResponse.redirect(redirectUrl);
  }

  // 5. Authenticated user visiting root / -> redirect to role landing route
  if (pathname === '/') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = landingRoute;
    return NextResponse.redirect(redirectUrl);
  }

  // 6. Strict Role Guards (Admins with is_admin = true have access across routes)
  if (isAdmin) {
    return response;
  }

  // Guard /settings: Strictly requires is_admin === true
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = landingRoute;
    return NextResponse.redirect(redirectUrl);
  }

  // Guard /reminders: Requires PREPARER or VERIFIER role
  if (pathname === '/reminders' || pathname.startsWith('/reminders/')) {
    if (role !== 'PREPARER' && role !== 'VERIFIER') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = landingRoute;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Explicit Auditor Guard: non-admin AUDITOR may not access /tracker or /requests
  if (role === 'AUDITOR') {
    if (
      pathname === '/tracker' ||
      pathname.startsWith('/tracker/') ||
      pathname === '/requests' ||
      pathname.startsWith('/requests/')
    ) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/audit';
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Guard /approvals: APPROVER only
  if (pathname === '/approvals' || pathname.startsWith('/approvals/')) {
    if (role !== 'APPROVER') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = landingRoute;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Guard /verify: VERIFIER only
  if (pathname === '/verify' || pathname.startsWith('/verify/')) {
    if (role !== 'VERIFIER') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = landingRoute;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Guard /audit: AUDITOR only
  if (pathname === '/audit' || pathname.startsWith('/audit/')) {
    if (role !== 'AUDITOR') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = landingRoute;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Guard /payments: PREPARER only
  if (pathname === '/payments' || pathname.startsWith('/payments/')) {
    if (role !== 'PREPARER') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = landingRoute;
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|logo\\.png|icon-192\\.png|icon-512\\.png|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|woff|woff2|ttf|eot)$).*)',
  ],
};
