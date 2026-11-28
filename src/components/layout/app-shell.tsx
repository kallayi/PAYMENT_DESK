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
  Bell,
  CalendarClock,
  ShieldCheck,
  Activity,
  Inbox,
} from 'lucide-react';
import { logout } from '@/actions/auth';
import type { Company, Notification, Profile, UserRole } from '@/types/database';
import { PaymentDeskLogo } from '@/components/layout/payment-desk-logo';
import { CompanySwitcher } from '@/components/layout/company-switcher';
import { NotificationBell, PushOptInBanner } from '@/components/layout/notification-bell';
import { ThemeToggle } from '@/components/layout/theme-provider';
import { RealtimeSync } from '@/components/layout/realtime-sync';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AppShellProps {
  profile: Profile;
  pendingCount?: number;
  pendingRequestsCount?: number;
  allowedCompanies?: Company[];
  activeCompany?: Company | null;
  initialNotifications?: Notification[];
  initialUnreadCount?: number;
  children: React.ReactNode;
}

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

function getRoleHomePath(role: UserRole, isAdmin: boolean = false): string {
  switch (role) {
    case 'PREPARER':
      return '/payments';
    case 'VERIFIER':
      return '/verify';
    case 'APPROVER':
      return '/approvals';
    case 'AUDITOR':
      return '/audit';
    default:
      return isAdmin ? '/approvals' : '/payments';
  }
}

function getRoleDisplay(role: UserRole) {
  switch (role) {
    case 'APPROVER':
      return { label: 'Approver', color: 'bg-[#7F1D1D] text-white' };
    case 'VERIFIER':
      return { label: 'Verifier', color: 'bg-amber-100 text-amber-900 border border-amber-200' };
    case 'PREPARER':
      return { label: 'Preparer', color: 'bg-blue-50 text-blue-700 border border-blue-200' };
    case 'AUDITOR':
      return { label: 'Auditor', color: 'bg-purple-100 text-purple-900 border border-purple-200' };
    default:
      return { label: role, color: 'bg-slate-100 text-slate-800' };
  }
}

function getNavItems(
  role: UserRole,
  pendingCount: number = 0,
  isAdmin: boolean = false,
  pendingRequestsCount: number = 0
): NavItem[] {
  // 1. PREPARER: Payments, Requests, Tracker, Vendors, Reminders, History
  if (role === 'PREPARER') {
    const items: NavItem[] = [
      { id: 'payments', label: 'Payments', href: '/payments', icon: Receipt, badge: pendingCount },
      { id: 'requests', label: 'Requests', href: '/requests', icon: Inbox, badge: pendingRequestsCount },
      { id: 'tracker', label: 'Tracker', href: '/tracker', icon: Activity },
      { id: 'vendors', label: 'Vendors', href: '/vendors', icon: Building2 },
      { id: 'reminders', label: 'Reminders', href: '/reminders', icon: CalendarClock },
      { id: 'history', label: 'History', href: '/history', icon: Clock },
    ];
    if (isAdmin) {
      items.push({ id: 'settings', label: 'Settings', href: '/settings', icon: Settings });
    }
    return items;
  }

  // 2. VERIFIER: Verify Queue, Requests, Tracker, Vendors, Reminders, History
  if (role === 'VERIFIER') {
    const items: NavItem[] = [
      { id: 'verify', label: 'Verify Queue', href: '/verify', icon: ShieldCheck, badge: pendingCount },
      { id: 'requests', label: 'Requests', href: '/requests', icon: Inbox, badge: pendingRequestsCount },
      { id: 'tracker', label: 'Tracker', href: '/tracker', icon: Activity },
      { id: 'vendors', label: 'Vendors', href: '/vendors', icon: Building2 },
      { id: 'reminders', label: 'Reminders', href: '/reminders', icon: CalendarClock },
      { id: 'history', label: 'History', href: '/history', icon: Clock },
    ];
    if (isAdmin) {
      items.push({ id: 'settings', label: 'Settings', href: '/settings', icon: Settings });
    }
    return items;
  }

  // 3. APPROVER: Approvals, Requests, Tracker, History
  if (role === 'APPROVER') {
    const items: NavItem[] = [
      { id: 'approvals', label: 'Approvals', href: '/approvals', icon: CheckCircle2, badge: pendingCount },
      { id: 'requests', label: 'Requests', href: '/requests', icon: Inbox, badge: pendingRequestsCount },
      { id: 'tracker', label: 'Tracker', href: '/tracker', icon: Activity },
      { id: 'history', label: 'History', href: '/history', icon: Clock },
    ];
    if (isAdmin) {
      items.push({ id: 'settings', label: 'Settings', href: '/settings', icon: Settings });
    }
    return items;
  }

  // 4. AUDITOR: Audit Queue & History ONLY (unless Admin, who also sees Requests, Tracker & Settings)
  if (role === 'AUDITOR') {
    const items: NavItem[] = [
      { id: 'audit', label: 'Audit Queue', href: '/audit', icon: Clock, badge: pendingCount },
      { id: 'history', label: 'History', href: '/history', icon: Clock },
    ];
    if (isAdmin) {
      items.splice(1, 0, {
        id: 'requests',
        label: 'Requests',
        href: '/requests',
        icon: Inbox,
        badge: pendingRequestsCount,
      });
      items.splice(2, 0, {
        id: 'tracker',
        label: 'Tracker',
        href: '/tracker',
        icon: Activity,
      });
      items.push({ id: 'settings', label: 'Settings', href: '/settings', icon: Settings });
    }
    return items;
  }

  return [];
}

function getMobileNavItems(navItems: NavItem[]): NavItem[] {
  if (navItems.length <= 5) return navItems;
  // Keep primary queue, Requests, Tracker, History (and Settings if Admin) within max 5 mobile bottom tabs
  const hasSettings = navItems.some((item) => item.id === 'settings');
  const excluded = hasSettings ? new Set(['reminders', 'vendors']) : new Set(['reminders']);
  return navItems.filter((item) => !excluded.has(item.id)).slice(0, 5);
}

function getPageTitle(pathname: string, activeCompanyName?: string): string {
  const companyPrefix = activeCompanyName ? `${activeCompanyName} · ` : '';
  if (pathname.startsWith('/requests')) return `${companyPrefix}Requests`;
  if (pathname.startsWith('/tracker')) return `${companyPrefix}Workflow Tracker`;
  if (pathname.startsWith('/approvals')) return `${companyPrefix}Approvals`;
  if (pathname.startsWith('/verify')) return `${companyPrefix}Verify Queue`;
  if (pathname.startsWith('/audit')) return `${companyPrefix}Audit Queue`;
  if (pathname.startsWith('/reminders')) return `${companyPrefix}Reminders`;
  if (pathname.startsWith('/payments')) return `${companyPrefix}Payments`;
  if (pathname.startsWith('/history')) return `${companyPrefix}History`;
  if (pathname.startsWith('/vendors')) return `${companyPrefix}Vendors`;
  if (pathname.startsWith('/settings')) return 'Admin Settings';
  return activeCompanyName || 'Payment Desk';
}

function isItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
}

function DesktopNavLinks({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(item, pathname);

        return (
          <Link
            key={item.id}
            href={item.href}
            prefetch={true}
            className={`w-full h-10 px-3 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${active
              ? 'bg-brand-tint text-brand font-bold border-l-2 border-brand'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
          >
            <span className="flex items-center gap-2.5">
              <Icon className={`w-4 h-4 ${active ? 'text-brand' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </span>
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={`tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-brand text-white' : 'bg-amber-100 text-amber-900 border border-amber-200'
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
            prefetch={true}
            className={`flex flex-col items-center justify-center gap-0.5 min-w-0 px-0.5 text-[10px] leading-tight font-medium transition-colors ${active ? 'text-brand font-bold' : 'text-slate-400 hover:text-slate-700'
              }`}
          >
            <div className="relative">
              <Icon className={`w-5 h-5 ${active ? 'text-brand' : 'text-slate-400'}`} />
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[10px] font-bold tabular-nums flex items-center justify-center">
                  {item.badge}
                </span>
              )}
            </div>
            <span className="truncate max-w-full px-0.5">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function getRoleSubtitle(role: UserRole): string {
  switch (role) {
    case 'APPROVER':
      return 'Approver Review & Approval';
    case 'PREPARER':
      return 'Accounts Preparation & Execution';
    case 'VERIFIER':
      return 'Senior Accountant Verification';
    default:
      return 'Read-Only Financial Auditor';
  }
}

export function AppShell({
  profile,
  pendingCount = 0,
  pendingRequestsCount = 0,
  allowedCompanies = [],
  activeCompany = null,
  initialNotifications = [],
  initialUnreadCount = 0,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [isSignOutOpen, setIsSignOutOpen] = React.useState(false);
  const [isLoggingOut, startLogoutTransition] = React.useTransition();

  const activeCompanyCode = activeCompany?.code?.toUpperCase() || 'INDFURN';

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-company', activeCompanyCode);
    }
  }, [activeCompanyCode]);

  const homePath = getRoleHomePath(profile.role, profile.is_admin);
  const navItems = getNavItems(profile.role, pendingCount, profile.is_admin, pendingRequestsCount);
  const mobileNavItems = getMobileNavItems(navItems);
  const roleDisplay = getRoleDisplay(profile.role);
  const pageTitle = getPageTitle(pathname, activeCompany?.name);

  const bottomGridCols =
    mobileNavItems.length <= 2
      ? 'grid-cols-2'
      : mobileNavItems.length === 3
        ? 'grid-cols-3'
        : mobileNavItems.length === 4
          ? 'grid-cols-4'
          : 'grid-cols-5';

  function handleLogout() {
    startLogoutTransition(async () => {
      await logout();
    });
  }

  return (
    <div data-company={activeCompanyCode} className="min-h-screen flex bg-[#F8FAFC]">
      {/* Signature 2.5px Top Company Accent Bar */}
      <div
        aria-hidden="true"
        className="fixed top-0 inset-x-0 h-[2.5px] bg-brand z-50 pointer-events-none transition-colors"
      />
      {/* DESKTOP SLIM LEFT SIDEBAR (w-60, lg+) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        {/* Brand Wordmark (Clickable to Role Home) */}
        <div className="h-16 px-4 flex flex-col justify-center border-b border-slate-200/80">
          <Link
            href={homePath}
            aria-label="Go to Home Workspace"
            className="inline-flex items-center cursor-pointer hover:opacity-90 active:opacity-80 transition-opacity w-fit"
          >
            <PaymentDeskLogo
              size="sm"
              showWordmark={true}
              showSubtitle={false}
              companyCode={activeCompany?.code}
            />
          </Link>
        </div>

        {/* Role-Appropriate Navigation Links */}
        <React.Suspense fallback={<nav className="flex-1 px-3 py-3 space-y-1" />}>
          <DesktopNavLinks navItems={navItems} />
        </React.Suspense>

        {/* User Profile & Sign Out Footer */}
        <div className="p-3 border-t border-slate-200/80 bg-slate-50/50">
          <div className="px-2.5 py-1.5 mb-1.5">
            <div className="flex items-center justify-between gap-1.5 mb-0.5">
              <span className="text-xs font-bold text-slate-900 truncate">
                {profile.full_name}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {profile.is_admin && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 text-white">
                    Admin
                  </span>
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${roleDisplay.color}`}
                >
                  {roleDisplay.label}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {getRoleSubtitle(profile.role)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsSignOutOpen(true)}
            disabled={isLoggingOut}
            className="w-full h-8 px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
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
      <div className="flex-1 lg:pl-60 flex flex-col min-w-0">
        {/* TOP HEADER BAR (Desktop & Mobile) */}
        <header className="sticky top-0 z-20 min-h-14 pt-[env(safe-area-inset-top)] bg-white/95 dark:bg-[#0e0e11]/95 backdrop-blur-sm border-b border-slate-200 px-3 sm:px-6 gap-2 flex items-center justify-between">
          {/* Left: Mobile Logo (Clickable to Role Home) & Title */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link
              href={homePath}
              aria-label="Go to Home Workspace"
              className="lg:hidden shrink-0 inline-flex items-center cursor-pointer hover:opacity-90 active:opacity-80 transition-opacity"
            >
              <PaymentDeskLogo
                size="sm"
                showWordmark={false}
                companyCode={activeCompany?.code}
              />
            </Link>
            <span className="text-sm font-bold text-slate-900 truncate">
              {pageTitle}
            </span>
          </div>

          {/* Right: Company Switcher + Theme Toggle + Notification Bell + Sign Out */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <CompanySwitcher
              allowedCompanies={allowedCompanies}
              activeCompany={activeCompany}
            />

            <ThemeToggle />

            <NotificationBell
              userId={profile.id}
              userRole={profile.role}
              isAdmin={profile.is_admin}
              initialNotifications={initialNotifications}
              initialUnreadCount={initialUnreadCount}
              allowedCompanies={allowedCompanies}
              activeCompanyId={activeCompany?.id}
            />

            <button
              type="button"
              onClick={() => setIsSignOutOpen(true)}
              disabled={isLoggingOut}
              aria-label="Sign out"
              title="Sign out"
              className="lg:hidden h-9 w-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <div className="hidden lg:flex items-center gap-1.5">
              {profile.is_admin && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 text-white">
                  Admin
                </span>
              )}
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${roleDisplay.color}`}
              >
                {roleDisplay.label}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsSignOutOpen(true)}
              disabled={isLoggingOut}
              title="Sign Out"
              className="hidden lg:flex min-h-[40px] px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isLoggingOut ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              <span className="text-xs">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Zero-Reload Realtime Sync Listener */}
        <RealtimeSync companyId={activeCompany?.id} userId={profile.id} />

        {/* MAIN WORKSPACE CONTENT */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 pt-3.5 sm:py-7 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8 min-w-0">
          <PushOptInBanner />
          {children}
        </main>
      </div>

      {/* MOBILE FIXED BOTTOM TAB NAVIGATION (h-16 + safe area, < lg) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-[#0e0e11] border-t border-slate-200 z-30 pb-[env(safe-area-inset-bottom)]">
        <React.Suspense fallback={<div className={`grid ${bottomGridCols} h-16`} />}>
          <MobileBottomNavLinks
            navItems={mobileNavItems}
            bottomGridCols={bottomGridCols}
          />
        </React.Suspense>
      </nav>

      {/* MINIMAL SIGN OUT CONFIRMATION DIALOG */}
      <Dialog
        open={isSignOutOpen}
        onOpenChange={(open) => {
          if (!isLoggingOut) setIsSignOutOpen(open);
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900">
              Sign out of Payment Desk?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              You can sign back in at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setIsSignOutOpen(false)}
              disabled={isLoggingOut}
              className="flex-1 sm:flex-initial h-9 px-3.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex-1 sm:flex-initial h-9 px-3.5 rounded-lg bg-[#7F1D1D] hover:bg-[#991B1B] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isLoggingOut ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Signing Out...</span>
                </>
              ) : (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
