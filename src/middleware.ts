import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, UserRole } from '@/types/database';

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

  // 2. Authenticated users:
  // Role is read from user_metadata without expensive database queries on every navigation.
  // Full database role & is_active verification is cached in (dashboard)/layout.tsx.
  const role: UserRole = (user.user_metadata?.role as UserRole) || 'ACCOUNTANT';
  const defaultRoute = role === 'OWNER' ? '/approvals' : '/payments';

  // Redirect authenticated user visiting / or /login to default role route
  if (pathname === '/' || pathname === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = defaultRoute;
    redirectUrl.searchParams.delete('error');
    return NextResponse.redirect(redirectUrl);
  }

  // Strict role guards
  if (role === 'ACCOUNTANT') {
    const accountantBlocked =
      pathname === '/approvals' ||
      pathname.startsWith('/approvals/') ||
      pathname === '/settings' ||
      pathname.startsWith('/settings/');

    if (accountantBlocked) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/payments';
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
