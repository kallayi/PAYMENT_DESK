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

  // 0. Completely bypass middleware for static assets, PWA files, icons, fonts, and images
  if (
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

  // 1. Unauthenticated users:
  if (!user) {
    if (pathname === '/login') {
      return response;
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  // 2. Fetch authenticated user role & admin status strictly from admin-controlled app_metadata:
  const role: UserRole | string | null = (user.app_metadata?.role as UserRole) || null;
  const isAdmin: boolean = Boolean(user.app_metadata?.is_admin);

  // If role is not in app_metadata, do not guess; allow request to pass to Server Component
  // layer (getCurrentUserContext()), which reads public.profiles and syncs app_metadata in background.
  if (!role) {
    if (pathname === '/login') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/';
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  const landingRoute = getRoleLandingRoute(role);

  // 3. Authenticated user visiting /login -> redirect to landing route
  if (pathname === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.searchParams.delete('error');
    redirectUrl.pathname = landingRoute;
    return NextResponse.redirect(redirectUrl);
  }

  // 4. Authenticated user visiting root / -> redirect to role landing route
  if (pathname === '/') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = landingRoute;
    return NextResponse.redirect(redirectUrl);
  }

  // 5. Strict Role Guards (ONLY when role is definitively known)
  // Admins with is_admin = true have access across routes
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
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - manifest.webmanifest (PWA manifest)
     * - sw.js (service worker)
     * - public files (icons, images, fonts)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|logo\\.png|icon-192\\.png|icon-512\\.png|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|woff|woff2|ttf|eot)$).*)',
  ],
};
