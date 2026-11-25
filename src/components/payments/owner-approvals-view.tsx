'use client';

import * as React from 'react';
import Link from 'next/link';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { OwnerApprovalCard } from '@/components/payments/owner-approval-card';
import { PaymentDetailDrawer } from '@/components/payments/payment-detail-drawer';
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
} from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { formatHumanDate, formatINR, formatShortDate } from '@/lib/format';
import type { CompanyBank, PaymentItem } from '@/types/database';

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
  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [activeTab, setActiveTab] = React.useState<ApproverTab>('PENDING_APPROVAL');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [showOverdueOnly, setShowOverdueOnly] = React.useState<boolean>(false);
  const [selectedBankFilter, setSelectedBankFilter] = React.useState<string>('ALL');

  // Multi-select state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = React.useState<boolean>(false);

  // Dialog & Drawer States
  const [rejectingItem, setRejectingItem] = React.useState<PaymentItem | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState<string>('');
  const [isRejecting, setIsRejecting] = React.useState<boolean>(false);

  const [viewingItem, setViewingItem] = React.useState<PaymentItem | null>(null);
  const [actionLoadingId, setActionLoadingId] = React.useState<string | null>(null);
  const [isViewingBill, setIsViewingBill] = React.useState<boolean>(false);

  // Bank balance popover / drawer
  const [showBankBreakdown, setShowBankBreakdown] = React.useState<boolean>(false);

  // Synchronize when initial props change
  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  // Clear selections when tab changes
  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  // Item buckets
  const pendingApprovalItems = payments.filter((p) => p.status === 'PENDING_APPROVAL');
  const holdItems = payments.filter((p) => p.status === 'ON_HOLD');
  const pendingVerificationItems = payments.filter((p) => p.status === 'PENDING_VERIFICATION');
  const readyToPayItems = payments.filter((p) => p.status === 'APPROVED');

  // FINANCIAL TOTALS
  const totalAvailableBalance = banks
    .filter((b) => b.is_active)
    .reduce((sum, b) => sum + (Number(b.available_balance) || 0), 0);

  const pendingVerificationTotal = pendingVerificationItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  const pendingApprovalTotal = pendingApprovalItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  const readyToPayTotal = readyToPayItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  // Selected pending total for bulk approval
  const selectedPendingTotal = Array.from(selectedIds).reduce((sum, id) => {
    const item = payments.find((p) => p.id === id);
    return sum + (item ? Number(item.net_payable) || 0 : 0);
  }, 0);

  // Projected Remaining Balance:
  // Available Cash minus already approved (ready to pay) minus current selected batch (or total pending if approving all)
  const projectedRemainingBalance =
    totalAvailableBalance - (readyToPayTotal + selectedPendingTotal);

  const isProjectedNegative = projectedRemainingBalance < 0;

  // Filter visible items according to current tab
  let currentTabItems: PaymentItem[] = [];
  if (activeTab === 'PENDING_APPROVAL') currentTabItems = pendingApprovalItems;
  else if (activeTab === 'ON_HOLD') currentTabItems = holdItems;
  else if (activeTab === 'PENDING_VERIFICATION') currentTabItems = pendingVerificationItems;
  else if (activeTab === 'APPROVED') currentTabItems = readyToPayItems;

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

    const idsToApprove = Array.from(selectedIds);
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
    toast.success(`Bulk approved ${count} payment${count === 1 ? '' : 's'} (${formatINR(selectedPendingTotal)}).`);

    setIsBulkApproving(true);
    try {
      const res = await bulkApprovePayments(idsToApprove);
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to bulk approve payments.');
        return;
      }
    } catch {
      setPayments(previous);
      toast.error('Network error during bulk approval. Rolled back.');
    } finally {
      setIsBulkApproving(false);
    }
  };

  // Handler: Single Approve (Optimistic UI)
  const handleApprove = async (targetItem: PaymentItem) => {
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
    } catch {
      setPayments(previous);
      toast.error('Failed to switch bank. Rolled back.');
    } finally {
      setActionLoadingId(null);
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
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 sm:pb-4 border-b border-slate-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              Authorization & Approvals — {companyName}
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] sm:text-xs font-semibold bg-brand/10 text-brand shrink-0">
              Owner Authorization
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Authorize disbursements with real-time available cash balance projection. Zero manual edits to maintain audit trail.
          </p>
        </div>
      </div>

      {/* 4-CARD FINANCIAL OVERVIEW STRIP (Compact 2x2 on Mobile) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* Card 1: Total Available Balance */}
        <div
          onClick={() => setShowBankBreakdown(!showBankBreakdown)}
          className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between cursor-pointer hover:border-slate-300 transition-colors min-w-0"
          title="Click to toggle bank-by-bank balances"
        >
          <div className="flex items-start justify-between gap-1.5 text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
              Available Balance
            </span>
            <Landmark className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
          </div>
          <div className="mt-1.5 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 tabular-nums break-words leading-tight">
              {formatINR(totalAvailableBalance)}
            </div>
            <div className="text-[10px] sm:text-[11px] text-brand font-medium mt-1 flex items-center gap-1 flex-wrap">
              <span>{banks.filter((b) => b.is_active).length} banks</span>
              <span>•</span>
              <span className="underline">View split</span>
            </div>
          </div>
        </div>

        {/* Card 2: Pending Verification */}
        <div
          onClick={() => setActiveTab('PENDING_VERIFICATION')}
          className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between cursor-pointer hover:border-slate-300 transition-colors min-w-0"
        >
          <div className="flex items-start justify-between gap-1.5 text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
              Pending Verification
            </span>
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-500 shrink-0" />
          </div>
          <div className="mt-1.5 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 tabular-nums break-words leading-tight">
              {formatINR(pendingVerificationTotal)}
            </div>
            <div className="text-[10px] sm:text-[11px] text-amber-700 font-medium mt-1 leading-tight">
              {pendingVerificationItems.length} with Verifier
            </div>
          </div>
        </div>

        {/* Card 3: Pending Approval */}
        <div
          onClick={() => setActiveTab('PENDING_APPROVAL')}
          className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between cursor-pointer hover:border-slate-300 transition-colors min-w-0"
        >
          <div className="flex items-start justify-between gap-1.5 text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
              Pending Approval
            </span>
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand shrink-0" />
          </div>
          <div className="mt-1.5 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 tabular-nums break-words leading-tight">
              {formatINR(pendingApprovalTotal)}
            </div>
            <div className="text-[10px] sm:text-[11px] text-brand font-medium mt-1 leading-tight">
              {pendingApprovalItems.length} awaiting Owner
            </div>
          </div>
        </div>

        {/* Card 4: Projected Remaining Balance */}
        <div
          className={`p-3 sm:p-4 rounded-xl border shadow-sm flex flex-col justify-between transition-colors min-w-0 ${isProjectedNegative
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
            }`}
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider leading-tight">
              Projected Remaining
            </span>
            {isProjectedNegative ? (
              <ShieldAlert className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-600 animate-pulse shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 shrink-0" />
            )}
          </div>
          <div className="mt-1.5 sm:mt-2 min-w-0">
            <div className="text-base sm:text-xl lg:text-2xl font-bold tabular-nums break-words leading-tight">
              {formatINR(projectedRemainingBalance)}
            </div>
            <div className="text-[10px] sm:text-[11px] font-medium mt-1 leading-tight">
              {isProjectedNegative ? (
                <span className="text-rose-700 font-bold">
                  Deficit: exceeds cash
                </span>
              ) : (
                <span className="text-emerald-700">
                  {selectedIds.size > 0
                    ? `After ${selectedIds.size} selected (${formatINR(selectedPendingTotal)})`
                    : 'Surplus cash remaining'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BANK BREAKDOWN EXPANDED STRIP (Optional click-to-expand) */}
      {showBankBreakdown && (
        <div className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 animate-in fade-in-50">
          <div className="text-xs font-semibold text-slate-700">Bank-by-Bank Available Balances:</div>
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-2">
            {banks.filter((b) => b.is_active).map((b) => (
              <div key={b.id} className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs min-w-0">
                <div className="font-bold text-slate-800 truncate">{b.bank_name || b.full_name}</div>
                <div className="font-mono text-slate-400 text-[10px] truncate">
                  {b.short_code || b.short_name} {b.account_number_masked ? `(${b.account_number_masked})` : ''}
                </div>
                <div className="font-bold text-slate-900 tabular-nums mt-1 text-sm">
                  {formatINR(b.available_balance ?? 0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUBTLE PENDING UTR BANNER */}
      {readyToPayItems.length > 0 && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start sm:items-center gap-2 min-w-0">
            <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              <strong>{readyToPayItems.length} payments ({formatINR(readyToPayTotal)})</strong> have been authorized and are awaiting UTR / Cheque settlement.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('APPROVED')}
            className="text-emerald-700 font-bold hover:underline shrink-0 self-start sm:self-center cursor-pointer"
          >
            View Ready to Pay &rarr;
          </button>
        </div>
      )}

      {/* STATUS TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1.5 border-b border-slate-200 scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab('PENDING_APPROVAL')}
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 ${activeTab === 'PENDING_APPROVAL'
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
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 ${activeTab === 'ON_HOLD'
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
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 ${activeTab === 'PENDING_VERIFICATION'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          title="Owner direct override when Senior Accountant is absent"
        >
          <span>Awaiting Verification (Override)</span>
          <span className="tabular-nums text-[11px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-800">
            {pendingVerificationItems.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('APPROVED')}
          className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors shrink-0 ${activeTab === 'APPROVED'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
        >
          <span>Ready to Pay</span>
          <span className="tabular-nums text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
            {readyToPayItems.length}
          </span>
        </button>
      </div>

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
                  Total: <strong className="text-slate-900 font-bold">{formatINR(selectedPendingTotal)}</strong>
                </span>
              </div>

              <div className="text-xs sm:border-l sm:border-slate-200 sm:pl-4">
                <span className="text-slate-500">Projected: </span>
                <strong
                  className={`tabular-nums font-bold ${isProjectedNegative ? 'text-rose-600' : 'text-emerald-700'
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
