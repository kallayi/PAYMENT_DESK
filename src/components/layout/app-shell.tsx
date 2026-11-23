'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CheckCircle2,
  Clock,
  Settings,
  Receipt,
  Building2,
  LogOut,
  Loader2,
} from 'lucide-react';
import { logout } from '@/actions/auth';
import type { Profile, UserRole } from '@/types/database';

interface AppShellProps {
  profile: Profile;
  pendingCount?: number;
  children: React.ReactNode;
}

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'OWNER':
      return 'Owner / Admin';
    case 'ACCOUNTANT':
      return 'Accountant';
    default:
      return role;
  }
}

function getNavItems(role: UserRole, pendingCount: number = 0): NavItem[] {
  if (role === 'OWNER') {
    return [
      { id: 'approvals', label: 'Approvals', href: '/approvals', icon: CheckCircle2, badge: pendingCount },
      { id: 'history', label: 'History', href: '/history', icon: Clock },
      { id: 'vendors', label: 'Vendors', href: '/vendors', icon: Building2 },
      { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
    ];
  }
  // ACCOUNTANT
  return [
    { id: 'payments', label: 'Payments', href: '/payments', icon: Receipt, badge: pendingCount },
    { id: 'history', label: 'History', href: '/history', icon: Clock },
    { id: 'vendors', label: 'Vendors', href: '/vendors', icon: Building2 },
  ];
}

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/approvals')) return 'Approvals';
  if (pathname.startsWith('/payments')) return 'Payments';
  if (pathname.startsWith('/history')) return 'History';
  if (pathname.startsWith('/vendors')) return 'Vendors';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'INDFURN';
}

function isItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
}

function DesktopNavLinks({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(item, pathname);

        return (
          <Link
            key={item.id}
            href={item.href}
            className={`w-full h-10 px-3 rounded-lg text-sm font-medium flex items-center justify-between transition-colors ${
              active
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Icon className={`w-4 h-4 ${active ? 'text-slate-900' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </span>
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={`tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-slate-900 text-white' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileBottomNavLinks({
  navItems,
  bottomGridCols,
}: {
  navItems: NavItem[];
  bottomGridCols: string;
}) {
  const pathname = usePathname();

  return (
    <div className={`grid ${bottomGridCols} h-16`}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(item, pathname);

        return (
          <Link
            key={item.id}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
              active ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            <div className="relative">
              <Icon className="w-5 h-5" />
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-600 text-white text-[10px] font-semibold tabular-nums flex items-center justify-center">
                  {item.badge}
                </span>
              )}
            </div>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function AppShell({ profile, pendingCount = 0, children }: AppShellProps) {
  const pathname = usePathname();
  const [isLoggingOut, startLogoutTransition] = React.useTransition();

  const navItems = getNavItems(profile.role, pendingCount);
  const roleLabel = getRoleLabel(profile.role);
  const pageTitle = getPageTitle(pathname);

  const bottomGridCols =
    navItems.length === 2
      ? 'grid-cols-2'
      : navItems.length === 3
        ? 'grid-cols-3'
        : 'grid-cols-4';

  function handleLogout() {
    startLogoutTransition(async () => {
      await logout();
    });
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFC]">
      {/* DESKTOP SLIM LEFT SIDEBAR (w-56, lg+) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        {/* Brand Wordmark */}
        <div className="h-14 px-5 flex items-center border-b border-slate-200/80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="INDFURN Logo"
            className="h-8 max-h-[34px] w-auto object-contain"
          />
        </div>

        {/* Role Navigation Links with Suspense Boundary */}
        <React.Suspense fallback={<nav className="flex-1 px-3 py-4 space-y-1" />}>
          <DesktopNavLinks navItems={navItems} />
        </React.Suspense>

        {/* User Profile & Sign Out */}
        <div className="p-3 border-t border-slate-200/80">
          <div className="px-2.5 py-2 mb-1">
            <div className="text-xs font-semibold text-slate-900 truncate">{profile.full_name}</div>
            <div className="text-[11px] text-slate-500">{roleLabel}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full h-9 px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {isLoggingOut ? (
              <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>{isLoggingOut ? 'Signing Out...' : 'Sign Out'}</span>
          </button>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div className="flex-1 lg:pl-56 flex flex-col min-w-0 pb-20 lg:pb-8">
        {/* MOBILE MINIMAL TOP BAR (h-14, < lg) */}
        <header className="lg:hidden sticky top-0 z-20 h-14 bg-white/95 backdrop-blur border-b border-slate-200 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="INDFURN"
              className="h-7 w-auto object-contain"
            />
            <span className="text-slate-200">|</span>
            <span className="text-sm font-semibold text-slate-900">{pageTitle}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 hidden sm:inline">{profile.full_name}</span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              title="Sign Out"
              className="min-h-[44px] px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isLoggingOut ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
              <span className="text-xs">Sign Out</span>
            </button>
          </div>
        </header>

        {/* MAIN WORKSPACE CONTENT */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
          {children}
        </main>
      </div>

      {/* MOBILE FIXED BOTTOM TAB NAVIGATION (h-16, < lg) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 pb-safe">
        <React.Suspense fallback={<div className={`grid ${bottomGridCols} h-16`} />}>
          <MobileBottomNavLinks
            navItems={navItems}
            bottomGridCols={bottomGridCols}
          />
        </React.Suspense>
      </nav>
    </div>
  );
}
