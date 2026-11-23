import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, UserRole } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/admin';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 0. Completely bypass middleware & auth checks for static assets, PWA files, icons, fonts, and images
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

  // Strict: Always use getUser() on server, never getSession() alone
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

  // 2. Fetch authenticated user profile
  let profile: { role: UserRole; is_active: boolean } | null = null;

  const profileRes = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileRes.error) {
    console.error('Middleware profile fetch error:', profileRes.error);
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        const adminRes = await admin
          .from('profiles')
          .select('role, is_active')
          .eq('id', user.id)
          .maybeSingle();

        if (adminRes.data) {
          profile = adminRes.data as { role: UserRole; is_active: boolean };
        } else if (adminRes.error) {
          console.error('Middleware admin profile fallback error:', adminRes.error);
        }
      } catch (adminErr) {
        console.error('Middleware admin client initialization error:', adminErr);
      }
    }
  } else {
    profile = profileRes.data as { role: UserRole; is_active: boolean } | null;
  }

  // If user account is disabled
  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('error', 'disabled');
    return NextResponse.redirect(redirectUrl);
  }

  // Robust role fallback: profile role -> user metadata role -> ACCOUNTANT default
  const fallbackRole = (user.user_metadata?.role as UserRole) || 'ACCOUNTANT';
  const role: UserRole = (profile?.role as UserRole) || fallbackRole;

  const defaultRoute = role === 'OWNER' ? '/approvals' : '/payments';

  // 3. Authenticated user visiting / or /login -> redirect to default role page
  if (pathname === '/' || pathname === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = defaultRoute;
    redirectUrl.searchParams.delete('error');
    return NextResponse.redirect(redirectUrl);
  }

  // 4. Strict Role Guards (Only ACCOUNTANT and OWNER)
  if (role === 'ACCOUNTANT') {
    // ACCOUNTANT cannot visit /approvals or /settings
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
