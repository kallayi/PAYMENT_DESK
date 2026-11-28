'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check,
  Clock,
  Loader2,
  AlertTriangle,
  Building2,
  ChevronRight,
  Landmark,
  Search,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  ArrowRight,
  Filter,
  DollarSign,
  FileCheck2,
  BellRing,
} from 'lucide-react';
import { toast } from 'sonner';
import { OwnerApprovalCard } from '@/components/payments/owner-approval-card';
import { PaymentDetailDrawer } from '@/components/payments/payment-detail-drawer';
import { PaymentUrlSync, usePaymentHighlight } from '@/components/layout/payment-url-sync';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  ownerApprovePayment,
  ownerHoldPayment,
  ownerRejectPayment,
  ownerSwitchBank,
  bulkApprovePayments,
  notifyPreparerBankReleased,
} from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { formatHumanDate, formatINR, formatShortDate } from '@/lib/format';
import type { CompanyBank, PaymentItem, PaymentMode } from '@/types/database';

interface OwnerApprovalsViewProps {
  initialPayments: PaymentItem[];
  banks: CompanyBank[];
  companyName?: string;
}

type ApproverTab =
  | 'PENDING_APPROVAL'
  | 'ON_HOLD'
  | 'PENDING_VERIFICATION'
  | 'APPROVED';

export function OwnerApprovalsView({
  initialPayments,
  banks,
  companyName = 'INDFURN',
}: OwnerApprovalsViewProps) {
  const router = useRouter();
  const [, startRefreshTransition] = React.useTransition();
  const refreshServerState = React.useCallback(() => {
    startRefreshTransition(() => {
      router.refresh();
    });
  }, [router]);

  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [activeTab, setActiveTab] = React.useState<ApproverTab>('PENDING_APPROVAL');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [showOverdueOnly, setShowOverdueOnly] = React.useState<boolean>(false);
  const [selectedBankFilter, setSelectedBankFilter] = React.useState<string>('ALL');
  const [selectedModeFilter, setSelectedModeFilter] = React.useState<'ALL' | PaymentMode>('ALL');

  // Multi-select & Bank OTP alert state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = React.useState<boolean>(false);
  const [isNotifyingAccounts, setIsNotifyingAccounts] = React.useState<boolean>(false);

  // Dialog & Drawer States
  const [rejectingItem, setRejectingItem] = React.useState<PaymentItem | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState<string>('');
  const [isRejecting, setIsRejecting] = React.useState<boolean>(false);

  const [viewingItem, setViewingItem] = React.useState<PaymentItem | null>(null);
  const [actionLoadingId, setActionLoadingId] = React.useState<string | null>(null);
  const [switchingBankItemId, setSwitchingBankItemId] = React.useState<string | null>(null);
  const [isViewingBill, setIsViewingBill] = React.useState<boolean>(false);

  // Bank balance popover / drawer
  const [showBankBreakdown, setShowBankBreakdown] = React.useState<boolean>(false);

  const { highlightedId, triggerHighlight } = usePaymentHighlight();
  const paymentsRef = React.useRef(payments);
  paymentsRef.current = payments;

  const handleUrlParams = React.useCallback(
    ({ tab, highlightId }: { tab: string | null; highlightId: string | null }) => {
      const normalizedTab = tab?.toUpperCase() || null;
      if (
        normalizedTab &&
        ['PENDING_APPROVAL', 'ON_HOLD', 'PENDING_VERIFICATION', 'APPROVED'].includes(normalizedTab)
      ) {
        setActiveTab(normalizedTab as ApproverTab);
      } else if (highlightId) {
        const target = paymentsRef.current.find((p) => p.id === highlightId);
        if (
          target &&
          ['PENDING_APPROVAL', 'ON_HOLD', 'PENDING_VERIFICATION', 'APPROVED'].includes(target.status)
        ) {
          setActiveTab(target.status as ApproverTab);
        }
      }

      if (highlightId) {
        triggerHighlight(highlightId);
      }
    },
    [triggerHighlight]
  );

  // Synchronize when initial props change
  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  // Clear selections when tab changes
  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  // Active banks & active bank filter scope
  const activeBanks = banks.filter((b) => b.is_active);
  const scopedBanks =
    selectedBankFilter === 'ALL'
      ? activeBanks
      : activeBanks.filter((b) => b.id === selectedBankFilter);
  const selectedBankObj =
    selectedBankFilter === 'ALL'
      ? null
      : activeBanks.find((b) => b.id === selectedBankFilter) || null;
  const scopedBankCode = selectedBankObj
    ? selectedBankObj.short_code || selectedBankObj.short_name
    : null;
  const matchesBankFilter = (p: PaymentItem) =>
    selectedBankFilter === 'ALL' || p.source_bank_id === selectedBankFilter;

  // Item buckets
  const pendingApprovalItems = payments.filter((p) => p.status === 'PENDING_APPROVAL');
  const holdItems = payments.filter((p) => p.status === 'ON_HOLD');
  const pendingVerificationItems = payments.filter((p) => p.status === 'PENDING_VERIFICATION');
  const readyToPayItems = payments.filter((p) => p.status === 'APPROVED');

  const scopedPendingVerificationItems = pendingVerificationItems.filter(matchesBankFilter);
  const scopedPendingApprovalItems = pendingApprovalItems.filter(matchesBankFilter);
  const scopedReadyToPayItems = readyToPayItems.filter(matchesBankFilter);

  // FINANCIAL TOTALS (Scoped to selectedBankFilter)
  const scopedAvailableBalance = scopedBanks.reduce(
    (sum, b) => sum + (Number(b.available_balance) || 0),
    0
  );

  const scopedPendingVerificationTotal = scopedPendingVerificationItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  const scopedPendingApprovalTotal = scopedPendingApprovalItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  const scopedReadyToPayTotal = scopedReadyToPayItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  const readyToPayTotal = readyToPayItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  // Selected totals (exclude already-APPROVED items from projection to prevent double-counting)
  const selectedItemsList = Array.from(selectedIds)
    .map((id) => payments.find((p) => p.id === id))
    .filter((item): item is PaymentItem => Boolean(item));

  const selectedBatchTotal = selectedItemsList.reduce(
    (sum, item) => sum + (Number(item.net_payable) || 0),
    0
  );

  const selectedScopedTotal = selectedItemsList
    .filter((item) => item.status !== 'APPROVED' && matchesBankFilter(item))
    .reduce((sum, item) => sum + (Number(item.net_payable) || 0), 0);

  // Dual-mode Projected Remaining Balance:
  // - Live Selection Mode (selectedIds.size > 0): Ready-to-pay + selected non-approved items
  // - Default Queue Forecast Mode (selectedIds.size === 0): Ready-to-pay + all pending approval
  const activeOutflow =
    selectedIds.size > 0
      ? scopedReadyToPayTotal + selectedScopedTotal
      : scopedReadyToPayTotal + scopedPendingApprovalTotal;

  const projectedRemainingBalance = scopedAvailableBalance - activeOutflow;

  // Per-bank projected balance & individual bank shortfall detection
  const bankProjections = scopedBanks.map((bank) => {
    const bankAvailable = Number(bank.available_balance) || 0;
    const bankReadyToPay = readyToPayItems
      .filter((p) => p.source_bank_id === bank.id)
      .reduce((sum, p) => sum + (Number(p.net_payable) || 0), 0);

    const bankPendingOrSelected =
      selectedIds.size > 0
        ? selectedItemsList
            .filter((p) => p.status !== 'APPROVED' && p.source_bank_id === bank.id)
            .reduce((sum, p) => sum + (Number(p.net_payable) || 0), 0)
        : pendingApprovalItems
            .filter((p) => p.source_bank_id === bank.id)
            .reduce((sum, p) => sum + (Number(p.net_payable) || 0), 0);

    const bankOutflow = bankReadyToPay + bankPendingOrSelected;
    const bankProjectedLeft = bankAvailable - bankOutflow;

    return {
      bank,
      bankAvailable,
      bankReadyToPay,
      bankPendingOrSelected,
      bankOutflow,
      bankProjectedLeft,
    };
  });

  const shortfallBanks = bankProjections.filter((bp) => bp.bankProjectedLeft < 0);
  const isProjectedNegative = projectedRemainingBalance < 0;
  const hasBankShortfall = !isProjectedNegative && shortfallBanks.length > 0;

  // Filter visible items according to current tab
  let currentTabItems: PaymentItem[] = [];
  if (activeTab === 'PENDING_APPROVAL') currentTabItems = pendingApprovalItems;
  else if (activeTab === 'ON_HOLD') currentTabItems = holdItems;
  else if (activeTab === 'PENDING_VERIFICATION') currentTabItems = pendingVerificationItems;
  else if (activeTab === 'APPROVED') currentTabItems = readyToPayItems;

  // Prune any selected IDs that were processed on another device via live refresh
  React.useEffect(() => {
    const validTabIds = new Set(
      currentTabItems
        .filter((item) => item.status !== 'APPROVED' && item.status !== 'PAID')
        .map((item) => item.id)
    );
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validTabIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentTabItems]);

  const todayStr = new Date().toISOString().split('T')[0];

  const visibleItems = currentTabItems
    .filter((p) => {
      if (showOverdueOnly) {
        return p.due_date && p.due_date < todayStr;
      }
      return true;
    })
    .filter((p) => {
      if (selectedBankFilter !== 'ALL') {
        return p.source_bank_id === selectedBankFilter;
      }
      return true;
    })
    .filter((p) => {
      if (selectedModeFilter !== 'ALL') {
        return (p.payment_mode || 'NEFT_RTGS') === selectedModeFilter;
      }
      return true;
    })
    .filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const party = (p.vendor?.party_name || p.vendor?.name || '').toLowerCase();
      const ref = (p.invoice_ref || '').toLowerCase();
      const purpose = (p.purpose || '').toLowerCase();
      return party.includes(q) || ref.includes(q) || purpose.includes(q);
    });

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === visibleItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleItems.map((p) => p.id)));
    }
  };

  // Handler: Bulk Approve (Optimistic UI)
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;

    const eligibleItems = selectedItemsList.filter(
      (item) => item.status !== 'APPROVED' && item.status !== 'PAID'
    );
    if (eligibleItems.length === 0) {
      setSelectedIds(new Set());
      toast.info('Selected payments are already approved.');
      return;
    }

    const idsToApprove = eligibleItems.map((item) => item.id);
    const eligibleBatchTotal = eligibleItems.reduce(
      (sum, item) => sum + (Number(item.net_payable) || 0),
      0
    );
    const count = idsToApprove.length;
    const previous = payments;
    const nowIso = new Date().toISOString();

    // Optimistic UI update
    setPayments((prev) =>
      prev.map((p) =>
        idsToApprove.includes(p.id)
          ? { ...p, status: 'APPROVED', approved_at: nowIso }
          : p
      )
    );
    setSelectedIds(new Set());
    toast.success(`Bulk approved ${count} payment${count === 1 ? '' : 's'} (${formatINR(eligibleBatchTotal)}).`);

    setIsBulkApproving(true);
    try {
      const res = await bulkApprovePayments(idsToApprove);
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to bulk approve payments.');
        return;
      }
      refreshServerState();
    } catch {
      setPayments(previous);
      toast.error('Network error during bulk approval. Rolled back.');
    } finally {
      setIsBulkApproving(false);
    }
  };

  // Handler: Single Approve (Optimistic UI)
  const handleApprove = async (targetItem: PaymentItem) => {
    if (targetItem.status === 'APPROVED' || targetItem.status === 'PAID') {
      toast.info('This payment is already approved.');
      return;
    }

    const previous = payments;
    const optimisticApproved: PaymentItem = {
      ...targetItem,
      status: 'APPROVED',
      approved_at: new Date().toISOString(),
    };

    setPayments((prev) =>
      prev.map((p) => (p.id === targetItem.id ? optimisticApproved : p))
    );
    toast.success(
      `Approved ${formatINR(targetItem.net_payable)} for ${targetItem.vendor?.party_name || targetItem.vendor?.name}`
    );

    try {
      const res = await ownerApprovePayment(targetItem.id);
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to approve payment.');
        return;
      }
      setPayments((prev) =>
        prev.map((p) => (p.id === targetItem.id ? res.data : p))
      );
      refreshServerState();
    } catch {
      setPayments(previous);
      toast.error('Failed to approve payment. Rolled back.');
    }
  };

  // Handler: Hold / Resume (Optimistic UI)
  const handleToggleHold = async (item: PaymentItem) => {
    const previous = payments;
    const willBeOnHold = item.status !== 'ON_HOLD';
    const optimisticStatus = willBeOnHold ? 'ON_HOLD' : 'PENDING_APPROVAL';

    setPayments((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, status: optimisticStatus } : p))
    );

    toast.success(
      willBeOnHold
        ? `Placed payment on hold`
        : `Resumed payment to pending approval`
    );

    setActionLoadingId(item.id);
    try {
      const res = await ownerHoldPayment(item.id);
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to update hold status.');
        return;
      }
      setPayments((prev) =>
        prev.map((p) => (p.id === item.id ? res.data : p))
      );
      refreshServerState();
    } catch {
      setPayments(previous);
      toast.error('Failed to update hold status. Rolled back.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handler: Confirm Reject (Modal + Optimistic UI)
  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingItem) return;

    if (!rejectionReason.trim()) {
      toast.error('Rejection reason is required.');
      return;
    }

    const item = rejectingItem;
    const reason = rejectionReason.trim();
    const previous = payments;

    setPayments((prev) =>
      prev.map((p) =>
        p.id === item.id ? { ...p, status: 'REJECTED', rejection_reason: reason } : p
      )
    );
    setRejectingItem(null);
    setRejectionReason('');
    toast.success('Payment rejected with reason.');

    try {
      const res = await ownerRejectPayment(item.id, reason);
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to reject payment.');
        return;
      }
      setPayments((prev) =>
        prev.map((p) => (p.id === item.id ? res.data : p))
      );
      refreshServerState();
    } catch {
      setPayments(previous);
      toast.error('Failed to reject payment. Rolled back.');
    }
  };

  // Handler: Inline Bank Switch (Optimistic UI)
  const handleBankSwitch = async (item: PaymentItem, newBankId: string) => {
    if (item.source_bank_id === newBankId) return;

    const chosenBank = banks.find((b) => b.id === newBankId);
    const previous = payments;

    setPayments((prev) =>
      prev.map((p) =>
        p.id === item.id
          ? {
            ...p,
            source_bank_id: newBankId,
            source_bank: chosenBank || p.source_bank,
          }
          : p
      )
    );

    toast.success(`Disbursement bank switched to ${chosenBank?.short_code || chosenBank?.short_name || 'Bank'}`);

    setActionLoadingId(item.id);
    setSwitchingBankItemId(item.id);
    try {
      const res = await ownerSwitchBank(item.id, newBankId);
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to switch bank.');
        return;
      }
      setPayments((prev) =>
        prev.map((p) => (p.id === item.id ? res.data : p))
      );
      refreshServerState();
    } catch {
      setPayments(previous);
      toast.error('Failed to switch bank. Rolled back.');
    } finally {
      setActionLoadingId(null);
      setSwitchingBankItemId(null);
    }
  };

  const handleNotifyAccountsOtpDone = async () => {
    if (isNotifyingAccounts || readyToPayItems.length === 0) return;
    setIsNotifyingAccounts(true);
    try {
      const res = await notifyPreparerBankReleased({
        paymentIds: readyToPayItems.map((p) => p.id),
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success('Accounts Preparer notified — ready to download UTRs');
    } catch {
      toast.error('Failed to notify Accounts team.');
    } finally {
      setIsNotifyingAccounts(false);
    }
  };

  // Handler: View Bill
  const handleViewBill = async (item: PaymentItem) => {
    if (!item.invoice_file_path) {
      toast.info('No invoice file attached to this payment.');
      return;
    }
    setIsViewingBill(true);
    try {
      const res = await getSignedFileUrl('supplier-invoices', item.invoice_file_path);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not preview attached bill.');
    } finally {
      setIsViewingBill(false);
    }
  };

  return (
    <div className={`w-full space-y-4 sm:space-y-6 ${selectedIds.size > 0 ? 'pb-44 lg:pb-24' : 'pb-24 lg:pb-8'}`}>
      <PaymentUrlSync onParams={handleUrlParams} />
      {/* HEADER (Desktop/tablet — mobile top bar already shows active title) */}
      <div className="hidden sm:flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              Authorization & Approvals — {companyName}
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] sm:text-xs font-semibold bg-brand/10 text-brand shrink-0">
              Approver Authorization
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Authorize disbursements with real-time available cash balance projection. Zero manual edits to maintain audit trail.
          </p>
        </div>
      </div>

      {/* 4-CARD FINANCIAL OVERVIEW STRIP (Compact 2x2 on Mobile) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {/* Card 1: Total Available Balance */}
        <div
          onClick={() => setShowBankBreakdown(!showBankBreakdown)}
          className="p-2.5 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between cursor-pointer hover:border-slate-300 transition-colors min-w-0"
          title="Click to toggle bank-by-bank balances"
        >
          <div className="flex items-start justify-between gap-1.5 text-slate-500">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
                Available Balance
              </span>
              {scopedBankCode && (
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[9px] font-bold uppercase tracking-wide shrink-0">
                  {scopedBankCode} only
                </span>
              )}
            </div>
            <Landmark className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
          </div>
          <div className="mt-1 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 tabular-nums break-words leading-tight">
              {formatINR(scopedAvailableBalance)}
            </div>
            <div className="text-[10px] sm:text-[11px] text-brand font-medium mt-1 flex items-center gap-1 flex-wrap">
              <span className="hidden sm:inline">
                {scopedBanks.length} {scopedBanks.length === 1 ? 'bank' : 'banks'}
              </span>
              <span className="hidden sm:inline">•</span>
              <span className="underline">{showBankBreakdown ? 'Hide split' : 'View split'}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Pending Verification */}
        <div
          onClick={() => setActiveTab('PENDING_VERIFICATION')}
          className="p-2.5 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between cursor-pointer hover:border-slate-300 transition-colors min-w-0"
        >
          <div className="flex items-start justify-between gap-1.5 text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
              Pending Verification
            </span>
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-500 shrink-0" />
          </div>
          <div className="mt-1 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 tabular-nums break-words leading-tight">
              {formatINR(scopedPendingVerificationTotal)}
            </div>
            <div className="hidden sm:block text-[11px] text-amber-700 font-medium mt-1 leading-tight">
              {scopedPendingVerificationItems.length} with Verifier
            </div>
          </div>
        </div>

        {/* Card 3: Pending Approval */}
        <div
          onClick={() => setActiveTab('PENDING_APPROVAL')}
          className="p-2.5 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between cursor-pointer hover:border-slate-300 transition-colors min-w-0"
        >
          <div className="flex items-start justify-between gap-1.5 text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
              Pending Approval
            </span>
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand shrink-0" />
          </div>
          <div className="mt-1 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 tabular-nums break-words leading-tight">
              {formatINR(scopedPendingApprovalTotal)}
            </div>
            <div className="hidden sm:block text-[11px] text-brand font-medium mt-1 leading-tight">
              {scopedPendingApprovalItems.length} awaiting Approval
            </div>
          </div>
        </div>

        {/* Card 4: Projected Remaining Balance */}
        <div
          className={`p-2.5 sm:p-4 rounded-xl border shadow-sm flex flex-col justify-between transition-colors min-w-0 ${isProjectedNegative
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : hasBankShortfall
                ? 'bg-amber-50/70 border-amber-300 text-amber-950'
                : 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
            }`}
        >
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
                Projected Remaining
              </span>
              {selectedIds.size > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[9px] font-bold uppercase tracking-wide shrink-0">
                  Live
                </span>
              )}
              {scopedBankCode && (
                <span className="px-1.5 py-0.5 rounded bg-white/80 border border-current/15 text-[9px] font-bold uppercase tracking-wide shrink-0">
                  {scopedBankCode} only
                </span>
              )}
            </div>
            {isProjectedNegative ? (
              <ShieldAlert className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-600 animate-pulse shrink-0" />
            ) : hasBankShortfall ? (
              <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 shrink-0" />
            )}
          </div>
          <div className="mt-1 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold tabular-nums break-words leading-tight">
              {formatINR(projectedRemainingBalance)}
            </div>
            <div className="text-[10px] sm:text-[11px] font-medium mt-1 leading-tight space-y-1">
              {isProjectedNegative ? (
                <div className="text-rose-700 font-bold">
                  Cash shortfall: {formatINR(Math.abs(projectedRemainingBalance))}
                </div>
              ) : hasBankShortfall ? (
                <button
                  type="button"
                  onClick={() => setShowBankBreakdown(true)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200/80 text-amber-900 font-bold text-[10px] text-left cursor-pointer transition-colors"
                >
                  <span>
                    ⚠️ {shortfallBanks.map((s) => s.bank.short_code || s.bank.short_name).join(', ')} short — click to inspect
                  </span>
                </button>
              ) : (
                <div className="hidden sm:block text-emerald-700 font-semibold">
                  Surplus cash remaining
                </div>
              )}
              <div
                className={`hidden sm:block text-[10px] tabular-nums leading-snug ${isProjectedNegative
                    ? 'text-rose-700/85'
                    : hasBankShortfall
                      ? 'text-amber-800/90'
                      : 'text-emerald-800/80'
                  }`}
              >
                {selectedIds.size > 0
                  ? `After ${selectedIds.size} selected + ${formatINR(scopedReadyToPayTotal)} ready to pay`
                  : `After all pending (${formatINR(scopedPendingApprovalTotal)}) + ready to pay (${formatINR(scopedReadyToPayTotal)})`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BANK BREAKDOWN EXPANDED STRIP (Optional click-to-expand) */}
      {showBankBreakdown && (
        <div className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5 animate-in fade-in-50">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-semibold text-slate-700">
              Bank-by-Bank Cash Projection ({selectedIds.size > 0 ? 'Live Selection' : 'Full Queue Forecast'}):
            </div>
            <button
              type="button"
              onClick={() => setShowBankBreakdown(false)}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline cursor-pointer"
            >
              Hide split
            </button>
          </div>
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-2.5">
            {bankProjections.map(({ bank: b, bankAvailable, bankOutflow, bankProjectedLeft }) => {
              const isBankShort = bankProjectedLeft < 0;
              return (
                <div
                  key={b.id}
                  className={`p-3 rounded-lg bg-white border text-xs min-w-0 space-y-2 ${isBankShort ? 'border-rose-300 ring-1 ring-rose-200/70' : 'border-slate-200'
                    }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-bold text-slate-800 truncate">
                        {b.bank_name || b.full_name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold shrink-0">
                        {b.short_code || b.short_name}
                      </span>
                    </div>
                    {b.account_number_masked && (
                      <div className="font-mono text-slate-400 text-[10px] truncate mt-0.5">
                        {b.account_number_masked}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 pt-1.5 border-t border-slate-100 text-[11px] tabular-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Available:</span>
                      <span className="font-semibold text-slate-800">{formatINR(bankAvailable)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Queued / Selected:</span>
                      <span className="font-medium text-slate-700">- {formatINR(bankOutflow)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                      <span className="font-semibold text-slate-700">Projected Left:</span>
                      <span
                        className={`font-bold ${isBankShort ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                      >
                        {formatINR(bankProjectedLeft)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUBTLE PENDING UTR BANNER */}
      {readyToPayItems.length > 0 && activeTab !== 'APPROVED' && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start sm:items-center gap-2 min-w-0">
            <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              <strong>{readyToPayItems.length} payments ({formatINR(readyToPayTotal)})</strong> have been authorized and are awaiting UTR / Cheque settlement.
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
            <button
              type="button"
              onClick={() => setActiveTab('APPROVED')}
              className="text-emerald-800 font-bold hover:underline cursor-pointer"
            >
              View Approved ({readyToPayItems.length})
            </button>
            <Link
              href="/history"
              className="text-emerald-700 font-semibold hover:underline"
            >
              View in History &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* STATUS TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1.5 border-b border-slate-200 scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab('PENDING_APPROVAL')}
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 cursor-pointer ${activeTab === 'PENDING_APPROVAL'
              ? 'bg-brand text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
        >
          <span>Pending Approval</span>
          <span
            className={`tabular-nums text-[11px] px-1.5 py-0.5 rounded-full ${activeTab === 'PENDING_APPROVAL'
                ? 'bg-white/20 text-white'
                : 'bg-rose-100 text-brand'
              }`}
          >
            {pendingApprovalItems.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ON_HOLD')}
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 cursor-pointer ${activeTab === 'ON_HOLD'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
        >
          <span>On Hold</span>
          <span className="tabular-nums text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
            {holdItems.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('PENDING_VERIFICATION')}
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 cursor-pointer ${activeTab === 'PENDING_VERIFICATION'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          title="Approver direct override when Senior Accountant is absent"
        >
          <span>Awaiting Verification (Override)</span>
          <span className="tabular-nums text-[11px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-800">
            {pendingVerificationItems.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('APPROVED')}
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 cursor-pointer ${activeTab === 'APPROVED'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          title="Approved payments awaiting Bank OTP release or UTR settlement"
        >
          <span>Approved</span>
          <span
            className={`tabular-nums text-[11px] px-1.5 py-0.5 rounded-full ${activeTab === 'APPROVED'
              ? 'bg-white/20 text-white'
              : 'bg-emerald-100 text-emerald-800'
              }`}
          >
            {readyToPayItems.length}
          </span>
        </button>
      </div>

      {/* OPTIONAL APPROVER REPLY STRIP ON APPROVED TAB */}
      {activeTab === 'APPROVED' && readyToPayItems.length > 0 && (
        <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-950">
              {readyToPayItems.length} approved payment{readyToPayItems.length === 1 ? '' : 's'} awaiting Bank OTP / UTR entry ({formatINR(readyToPayTotal)})
            </p>
            <p className="text-[11px] text-emerald-800/80 mt-0.5">
              Optional: Once you complete the OTP release in Axis Bank Neo, alert Accounts so they can download UTRs.
            </p>
          </div>
          <button
            type="button"
            onClick={handleNotifyAccountsOtpDone}
            disabled={isNotifyingAccounts}
            className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-100/70 disabled:opacity-50 text-emerald-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 shadow-2xs transition-colors cursor-pointer"
          >
            {isNotifyingAccounts ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BellRing className="w-3.5 h-3.5" />
            )}
            <span>Notify Accounts: Bank OTP Done</span>
          </button>
        </div>
      )}

      {/* SEARCH & FILTERS BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Select All Checkbox for Bulk Actions */}
          {(activeTab === 'PENDING_APPROVAL' || activeTab === 'PENDING_VERIFICATION') && (
            <label className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={visibleItems.length > 0 && selectedIds.size === visibleItems.length}
                onChange={handleSelectAll}
                className="w-4 h-4 rounded text-brand focus:ring-brand border-slate-300"
              />
              <span>Select All ({visibleItems.length})</span>
            </label>
          )}

          {/* Overdue filter */}
          <button
            type="button"
            onClick={() => setShowOverdueOnly(!showOverdueOnly)}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${showOverdueOnly
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Overdue Only</span>
          </button>

          {/* Bank Filter Dropdown */}
          <select
            value={selectedBankFilter}
            onChange={(e) => setSelectedBankFilter(e.target.value)}
            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:border-brand max-w-full"
          >
            <option value="ALL">All Banks</option>
            {banks.filter((b) => b.is_active).map((b) => (
              <option key={b.id} value={b.id}>
                {b.short_code || b.short_name}
              </option>
            ))}
          </select>

          {/* Mode Filter Dropdown */}
          <select
            aria-label="Filter by disbursement mode"
            value={selectedModeFilter}
            onChange={(e) => setSelectedModeFilter(e.target.value as 'ALL' | PaymentMode)}
            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:border-brand max-w-full"
          >
            <option value="ALL">All Modes</option>
            <option value="NEFT_RTGS">NEFT / RTGS</option>
            <option value="IMPS">IMPS</option>
            <option value="CHEQUE">Cheque</option>
          </select>
        </div>

        {/* Instant Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search party, ref, or purpose..."
            className="w-full min-h-[38px] pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
          />
        </div>
      </div>

      {/* ITEMS LIST */}
      {visibleItems.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-900">
            No entries in this view
          </p>
          <p className="text-xs text-slate-500 mt-1">
            All items matching your current filters have been processed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <OwnerApprovalCard
              key={item.id}
              item={item}
              banks={banks.filter((b) => b.is_active)}
              isSelected={selectedIds.has(item.id)}
              isHighlighted={highlightedId === item.id}
              onToggleSelect={
                activeTab === 'PENDING_APPROVAL' || activeTab === 'PENDING_VERIFICATION'
                  ? () => handleToggleSelect(item.id)
                  : undefined
              }
              onApprove={handleApprove}
              onHold={handleToggleHold}
              onReject={(target) => {
                setRejectingItem(target);
                setRejectionReason('');
              }}
              onBankSwitch={handleBankSwitch}
              onViewBill={handleViewBill}
              isActionLoading={actionLoadingId === item.id}
              isBankSwitching={switchingBankItemId === item.id}
              isOverrideTab={activeTab === 'PENDING_VERIFICATION'}
            />
          ))}
        </div>
      )}

      {/* STICKY BOTTOM BULK APPROVE BAR */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 lg:left-60 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-3 py-3 sm:px-6 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] animate-in slide-in-from-bottom-5">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex items-center justify-between sm:justify-start gap-x-4 gap-y-1 flex-wrap">
              <div>
                <span className="text-xs sm:text-sm font-bold text-slate-900">
                  {selectedIds.size} selected
                </span>
                <span className="text-xs text-slate-500 ml-1.5 sm:ml-2 tabular-nums">
                  Total: <strong className="text-slate-900 font-bold">{formatINR(selectedBatchTotal)}</strong>
                </span>
              </div>

              <div className="text-xs sm:border-l sm:border-slate-200 sm:pl-4">
                <span className="text-slate-500">Projected Remaining: </span>
                <strong
                  className={`tabular-nums font-bold ${isProjectedNegative
                      ? 'text-rose-600'
                      : hasBankShortfall
                        ? 'text-amber-600'
                        : 'text-emerald-700'
                    }`}
                >
                  {formatINR(projectedRemainingBalance)}
                </strong>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                disabled={isBulkApproving}
                className="min-h-[40px] flex-1 sm:flex-initial text-xs"
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={handleBulkApprove}
                disabled={isBulkApproving}
                className="min-h-[40px] flex-[2] sm:flex-initial bg-emerald-700 hover:bg-emerald-800 text-white font-semibold shadow-sm text-xs"
              >
                {isBulkApproving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Authorizing...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1.5" />
                    Approve Selected ({selectedIds.size})
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      <Dialog
        open={Boolean(rejectingItem)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingItem(null);
            setRejectionReason('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-900">
              Reject Payment Request
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Please state why this disbursement cannot be authorized.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmReject} className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-slate-900">
                {rejectingItem?.vendor?.party_name || rejectingItem?.vendor?.name}
              </div>
              <div className="text-slate-500">
                Invoice Ref: {rejectingItem?.invoice_ref} • Net Amount: {formatINR(rejectingItem?.net_payable || 0)}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Rejection <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g., Hold until goods physically verified at warehouse, budget exceeded for this month, price discrepancy..."
                className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRejectingItem(null)}
                disabled={isRejecting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isRejecting}
                className="bg-rose-600 hover:bg-rose-700 text-white font-medium"
              >
                {isRejecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Rejecting...
                  </>
                ) : (
                  'Confirm Rejection'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
