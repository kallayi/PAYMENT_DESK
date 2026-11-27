'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Check,
  Clock,
  PauseCircle,
  Search,
  X,
} from 'lucide-react';
import { formatINR, formatShortDate } from '@/lib/format';
import { PaymentModeBadge } from '@/components/payments/payment-status-badge';
import type { PaymentItem, PaymentMode, PaymentStatus, UserRole } from '@/types/database';

interface LiveWorkflowTrackerProps {
  initialPayments: PaymentItem[];
  companyName: string;
  userRole: UserRole;
  isAdmin: boolean;
}

type TrackerStageFilter =
  | 'ALL'
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'ON_HOLD'
  | 'APPROVED';

const ACTIVE_STAGE_SET = new Set<PaymentStatus>([
  'DRAFT',
  'PENDING_VERIFICATION',
  'PENDING_APPROVAL',
  'ON_HOLD',
  'APPROVED',
]);

function isOverdue(dueDateStr: string | null | undefined): boolean {
  if (!dueDateStr) return false;
  const today = new Date().toISOString().split('T')[0];
  return dueDateStr < today;
}

function formatStageTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return '';
  }
}

function formatWaitingDuration(isoString: string | null | undefined, nowMs: number | null): string {
  if (!isoString || nowMs === null) return 'Active';
  try {
    const targetMs = new Date(isoString).getTime();
    if (isNaN(targetMs)) return 'Active';
    const diffMin = Math.max(0, Math.floor((nowMs - targetMs) / 60000));
    if (diffMin < 1) return 'Waiting <1m';
    if (diffMin < 60) return `Waiting ${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `Waiting ${diffHr}h`;
    const diffDays = Math.floor(diffHr / 24);
    return `Waiting ${diffDays}d`;
  } catch {
    return 'Active';
  }
}

function getStageUpdatedAt(item: PaymentItem): string {
  switch (item.status) {
    case 'DRAFT':
      return item.created_at;
    case 'PENDING_VERIFICATION':
      return item.submitted_at || item.updated_at || item.created_at;
    case 'PENDING_APPROVAL':
      return item.verified_at || item.submitted_at || item.updated_at;
    case 'ON_HOLD':
      return item.updated_at;
    case 'APPROVED':
      return item.approved_at || item.updated_at;
    default:
      return item.updated_at;
  }
}

function getDeskStatusMeta(status: PaymentStatus): {
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  switch (status) {
    case 'DRAFT':
      return {
        label: 'With Preparer · Draft not submitted',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
        dotClass: 'bg-slate-400',
      };
    case 'PENDING_VERIFICATION':
      return {
        label: 'At Verifier · Awaiting verification',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
        dotClass: 'bg-blue-500 animate-pulse',
      };
    case 'PENDING_APPROVAL':
      return {
        label: 'At Approver · Awaiting approval',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
        dotClass: 'bg-amber-500 animate-pulse',
      };
    case 'ON_HOLD':
      return {
        label: 'On Hold · Paused by Approver',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        dotClass: 'bg-rose-500',
      };
    case 'APPROVED':
      return {
        label: 'With Preparer · Approved, awaiting payment & UTR',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dotClass: 'bg-emerald-500 animate-pulse',
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
        dotClass: 'bg-slate-400',
      };
  }
}

function getQuickJumpAction(
  item: PaymentItem,
  userRole: UserRole,
  isAdmin: boolean
): { label: string; href: string } | null {
  switch (item.status) {
    case 'DRAFT':
      if (userRole === 'PREPARER' || isAdmin) {
        return {
          label: 'Open Draft',
          href: `/payments?tab=DRAFT&highlight=${encodeURIComponent(item.id)}`,
        };
      }
      return null;
    case 'PENDING_VERIFICATION':
      if (userRole === 'VERIFIER' || isAdmin) {
        return {
          label: 'Open in Verify',
          href: `/verify?highlight=${encodeURIComponent(item.id)}`,
        };
      }
      return null;
    case 'PENDING_APPROVAL':
      if (userRole === 'APPROVER' || isAdmin) {
        return {
          label: 'Open in Approvals',
          href: `/approvals?highlight=${encodeURIComponent(item.id)}`,
        };
      }
      return null;
    case 'ON_HOLD':
      if (userRole === 'APPROVER' || isAdmin) {
        return {
          label: 'Open in Approvals',
          href: `/approvals?tab=ON_HOLD&highlight=${encodeURIComponent(item.id)}`,
        };
      }
      return null;
    case 'APPROVED':
      if (userRole === 'PREPARER' || isAdmin) {
        return {
          label: 'Pay Now',
          href: `/payments?tab=APPROVED&highlight=${encodeURIComponent(item.id)}`,
        };
      }
      return null;
    default:
      return null;
  }
}

type StepVisualState = 'completed' | 'active' | 'paused' | 'pending';

interface StepDescriptor {
  title: string;
  actor: string;
  timestamp: string;
  state: StepVisualState;
}

function buildStepsForPayment(item: PaymentItem): StepDescriptor[] {
  const status = item.status;
  const pastDraft = status !== 'DRAFT';
  const pastVerify =
    status === 'PENDING_APPROVAL' || status === 'ON_HOLD' || status === 'APPROVED';
  const isApproved = status === 'APPROVED';

  const step1: StepDescriptor = {
    title: 'Drafted',
    actor: item.creator?.full_name || 'Preparer',
    timestamp: formatStageTimestamp(item.created_at),
    state: pastDraft ? 'completed' : 'active',
  };

  const step2: StepDescriptor = {
    title: 'Verified',
    actor: pastVerify
      ? item.verifier?.full_name || (isApproved && !item.verified_by ? 'Approver Override' : 'Verified')
      : status === 'PENDING_VERIFICATION'
        ? 'At Verifier'
        : 'Pending',
    timestamp: formatStageTimestamp(item.verified_at),
    state: pastVerify
      ? 'completed'
      : status === 'PENDING_VERIFICATION'
        ? 'active'
        : 'pending',
  };

  const step3: StepDescriptor = {
    title: 'Approved',
    actor: isApproved
      ? item.approver?.full_name || 'Approver'
      : status === 'ON_HOLD'
        ? 'Paused by Approver'
        : status === 'PENDING_APPROVAL'
          ? 'At Approver'
          : 'Pending',
    timestamp: formatStageTimestamp(item.approved_at),
    state: isApproved
      ? 'completed'
      : status === 'ON_HOLD'
        ? 'paused'
        : status === 'PENDING_APPROVAL'
          ? 'active'
          : 'pending',
  };

  const step4: StepDescriptor = {
    title: 'Pay & UTR',
    actor: isApproved ? 'At Preparer' : 'Pending',
    timestamp: '',
    state: isApproved ? 'active' : 'pending',
  };

  return [step1, step2, step3, step4];
}

export function LiveWorkflowTracker({
  initialPayments,
  companyName,
  userRole,
  isAdmin,
}: LiveWorkflowTrackerProps) {
  const [payments, setPayments] = React.useState<PaymentItem[]>(() =>
    initialPayments.filter((p) => ACTIVE_STAGE_SET.has(p.status))
  );
  const [stageFilter, setStageFilter] = React.useState<TrackerStageFilter>('ALL');
  const [modeFilter, setModeFilter] = React.useState<'ALL' | PaymentMode>('ALL');
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [nowMs, setNowMs] = React.useState<number | null>(null);

  // Live prop synchronization triggered by RealtimeSync router.refresh()
  React.useEffect(() => {
    setPayments(initialPayments.filter((p) => ACTIVE_STAGE_SET.has(p.status)));
  }, [initialPayments]);

  // Client-only relative wait clock refreshed every minute
  React.useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const stageSummary = React.useMemo(() => {
    const calc = (status?: PaymentStatus) => {
      const subset = status ? payments.filter((p) => p.status === status) : payments;
      const total = subset.reduce((sum, p) => sum + Number(p.net_payable || 0), 0);
      return { count: subset.length, total };
    };

    return [
      { id: 'ALL' as const, label: 'All Active', ...calc() },
      { id: 'DRAFT' as const, label: 'Draft (Preparer)', ...calc('DRAFT') },
      { id: 'PENDING_VERIFICATION' as const, label: 'At Verifier', ...calc('PENDING_VERIFICATION') },
      { id: 'PENDING_APPROVAL' as const, label: 'At Approver', ...calc('PENDING_APPROVAL') },
      { id: 'ON_HOLD' as const, label: 'On Hold', ...calc('ON_HOLD') },
      { id: 'APPROVED' as const, label: 'Ready to Pay (Preparer)', ...calc('APPROVED') },
    ];
  }, [payments]);

  const visiblePayments = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return payments
      .filter((p) => (stageFilter === 'ALL' ? true : p.status === stageFilter))
      .filter((p) => (modeFilter === 'ALL' ? true : (p.payment_mode || 'NEFT_RTGS') === modeFilter))
      .filter((p) => {
        if (!q) return true;
        const party = (p.vendor?.party_name || p.vendor?.name || '').toLowerCase();
        const ref = (p.invoice_ref || '').toLowerCase();
        const purpose = (p.purpose || '').toLowerCase();
        return party.includes(q) || ref.includes(q) || purpose.includes(q);
      });
  }, [payments, stageFilter, modeFilter, searchQuery]);

  const totalVisibleAmount = React.useMemo(
    () => visiblePayments.reduce((sum, p) => sum + Number(p.net_payable || 0), 0),
    [visiblePayments]
  );

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 sm:space-y-5">
      {/* Page Header (Full on Desktop, Hidden on Mobile < 640px since top bar displays title) */}
      <div className="hidden sm:flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Live Workflow Tracker — {companyName}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand/10 text-brand">
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              <span>{payments.length} active</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Monitor every active disbursement&apos;s exact stage and current desk ownership in real time. Completed (Paid) bills move automatically to History.
          </p>
        </div>
      </div>

      {/* Stage Summary Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap pb-1 -mx-3 px-3 sm:mx-0 sm:px-0">
        {stageSummary.map((chip) => {
          const isSelected = stageFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setStageFilter(chip.id)}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
                isSelected
                  ? 'bg-brand text-white border-brand shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <span>{chip.label}</span>
              <span
                className={`tabular-nums text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {chip.count}
              </span>
              <span
                className={`tabular-nums text-[11px] font-medium ${
                  isSelected ? 'text-white/90' : 'text-slate-500'
                }`}
              >
                {formatINR(chip.total)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & Live View Summary Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search party name, invoice ref, or purpose..."
              className="w-full min-h-[38px] pl-8 pr-8 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 self-start sm:self-auto">
            {(
              [
                { id: 'ALL', label: 'All' },
                { id: 'NEFT_RTGS', label: 'NEFT / RTGS' },
                { id: 'IMPS', label: 'IMPS' },
                { id: 'CHEQUE', label: 'Cheque' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setModeFilter(pill.id)}
                className={`min-h-[32px] px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  modeFilter === pill.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-600 px-1">
          <span>
            Showing{' '}
            <strong className="text-slate-900 tabular-nums">{visiblePayments.length}</strong>{' '}
            in-flight {visiblePayments.length === 1 ? 'item' : 'items'}
          </span>
          <span className="text-slate-300">·</span>
          <span className="tabular-nums">
            Total:{' '}
            <strong className="text-slate-900">{formatINR(totalVisibleAmount)}</strong>
          </span>
        </div>
      </div>

      {/* Active Workflow Cards */}
      {visiblePayments.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 sm:p-12 text-center shadow-sm">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2.5 text-slate-400">
            <Activity className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-900">
            No active payments in this stage
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            {payments.length === 0
              ? 'All in-flight disbursements have been completed. Settled payments appear under History.'
              : 'Try clearing your search or selecting another stage filter above.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visiblePayments.map((item) => {
            const partyName = item.vendor?.party_name || item.vendor?.name || 'Unknown Party';
            const bankCode = item.source_bank?.short_code || item.source_bank?.short_name || 'Bank';
            const overdue = isOverdue(item.due_date);
            const deskMeta = getDeskStatusMeta(item.status);
            const waitingText = formatWaitingDuration(getStageUpdatedAt(item), nowMs);
            const steps = buildStepsForPayment(item);
            const quickAction = getQuickJumpAction(item, userRole, isAdmin);

            return (
              <article
                key={item.id}
                className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-5 shadow-sm space-y-3.5 transition-colors hover:border-slate-300"
              >
                {/* Card Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-snug break-words">
                        {partyName}
                      </h2>
                      {overdue && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 uppercase shrink-0">
                          Overdue
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                        {bankCode}
                      </span>
                      <PaymentModeBadge mode={item.payment_mode} compact />
                    </div>

                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono font-medium text-slate-700">
                        {item.invoice_ref}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="truncate max-w-[260px] sm:max-w-md">{item.purpose}</span>
                      <span className="text-slate-300">·</span>
                      <span className="tabular-nums">
                        Due: <strong className="font-medium text-slate-700">{formatShortDate(item.due_date)}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-baseline sm:items-end justify-between gap-2 pt-1.5 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                    <div className="text-base sm:text-lg font-bold text-slate-900 tabular-nums">
                      {formatINR(item.net_payable)}
                    </div>
                    {item.tds > 0 && (
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        TDS: {formatINR(item.tds)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Currently Waiting On Pill + Wait Duration + Role-Aware Quick Jump */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center flex-wrap gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${deskMeta.badgeClass}`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${deskMeta.dotClass}`} />
                      <span>{deskMeta.label}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 tabular-nums">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{waitingText}</span>
                    </span>
                  </div>

                  {quickAction && (
                    <Link
                      href={quickAction.href}
                      className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <span>{quickAction.label}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>

                {/* 4-Step Horizontal Visual Progress Stepper */}
                <div className="pt-2.5 border-t border-slate-100">
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
                    {steps.map((step, idx) => {
                      const isDone = step.state === 'completed';
                      const isActive = step.state === 'active';
                      const isPaused = step.state === 'paused';

                      return (
                        <div key={step.title} className="relative flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                isDone
                                  ? 'bg-emerald-600 text-white'
                                  : isPaused
                                    ? 'bg-amber-500 text-white'
                                    : isActive
                                      ? 'bg-brand text-white ring-4 ring-brand/15 animate-pulse'
                                      : 'bg-slate-100 text-slate-400 border border-slate-200'
                              }`}
                            >
                              {isDone ? (
                                <Check className="w-3 h-3" />
                              ) : isPaused ? (
                                <PauseCircle className="w-3 h-3" />
                              ) : (
                                idx + 1
                              )}
                            </span>

                            {idx < steps.length - 1 && (
                              <div
                                className={`h-[2px] flex-1 rounded-full ${
                                  isDone ? 'bg-emerald-500/60' : 'bg-slate-200'
                                }`}
                              />
                            )}
                          </div>

                          <div className="mt-1.5 min-w-0 pr-1">
                            <div
                              className={`text-[11px] sm:text-xs font-semibold truncate ${
                                isDone
                                  ? 'text-slate-900'
                                  : isActive || isPaused
                                    ? 'text-brand font-bold'
                                    : 'text-slate-400'
                              }`}
                            >
                              {step.title}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {step.actor}
                            </div>
                            {step.timestamp && (
                              <div className="hidden sm:block text-[10px] text-slate-400 tabular-nums">
                                {step.timestamp}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
