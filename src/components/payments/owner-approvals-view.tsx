'use client';

import * as React from 'react';
import {
  Check,
  Clock,
  Loader2,
  AlertTriangle,
  Building2,
  ChevronRight,
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
import {
  ownerApprovePayment,
  ownerHoldPayment,
  ownerRejectPayment,
  ownerSwitchBank,
} from '@/actions/payments';
import { formatHumanDate, formatINR } from '@/lib/format';
import type { CompanyBank, PaymentItem } from '@/types/database';

interface OwnerApprovalsViewProps {
  initialPayments: PaymentItem[];
  banks: CompanyBank[];
}

export function OwnerApprovalsView({
  initialPayments,
  banks,
}: OwnerApprovalsViewProps) {
  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [activeTab, setActiveTab] = React.useState<'PENDING_APPROVAL' | 'ON_HOLD'>('PENDING_APPROVAL');

  // Synchronize when initial props change
  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  // Dialog & Drawer States
  const [approvingItem, setApprovingItem] = React.useState<PaymentItem | null>(null);
  const [isApproving, setIsApproving] = React.useState<boolean>(false);

  const [rejectingItem, setRejectingItem] = React.useState<PaymentItem | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState<string>('');
  const [isRejecting, setIsRejecting] = React.useState<boolean>(false);

  const [viewingItem, setViewingItem] = React.useState<PaymentItem | null>(null);
  const [actionLoadingId, setActionLoadingId] = React.useState<string | null>(null);

  // Compute counts & totals
  const pendingItems = payments.filter((p) => p.status === 'PENDING_APPROVAL');
  const holdItems = payments.filter((p) => p.status === 'ON_HOLD');

  const totalPendingAmount = pendingItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  // Bank-wise split for pending items
  const bankSplits = banks.map((b) => {
    const total = pendingItems
      .filter((p) => p.source_bank_id === b.id)
      .reduce((acc, p) => acc + (Number(p.net_payable) || 0), 0);
    return { bank: b, total };
  });

  const visibleItems = activeTab === 'PENDING_APPROVAL' ? pendingItems : holdItems;

  // Group items by sheet_date descending
  const groupedByDate: Record<string, PaymentItem[]> = {};
  visibleItems.forEach((item) => {
    const dateKey = item.sheet_date || 'Undated';
    if (!groupedByDate[dateKey]) {
      groupedByDate[dateKey] = [];
    }
    groupedByDate[dateKey].push(item);
  });
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  // Handler: Confirm Approve
  const handleConfirmApprove = async () => {
    if (!approvingItem) return;

    setIsApproving(true);
    try {
      const res = await ownerApprovePayment(approvingItem.id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      toast.success(
        `Approved ${formatINR(approvingItem.net_payable)} for ${approvingItem.vendor?.name || 'Vendor'}`
      );

      setPayments((prev) =>
        prev.map((p) => (p.id === approvingItem.id ? res.data : p))
      );
      setApprovingItem(null);
    } catch {
      toast.error('Failed to approve payment.');
    } finally {
      setIsApproving(false);
    }
  };

  // Handler: Hold / Resume
  const handleToggleHold = async (item: PaymentItem) => {
    setActionLoadingId(item.id);
    try {
      const res = await ownerHoldPayment(item.id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      const isNowHold = res.data.status === 'ON_HOLD';
      toast.success(
        isNowHold
          ? `Placed payment for ${item.vendor?.name || 'Vendor'} on hold`
          : `Resumed payment for ${item.vendor?.name || 'Vendor'} to pending queue`
      );

      setPayments((prev) =>
        prev.map((p) => (p.id === item.id ? res.data : p))
      );
    } catch {
      toast.error('Failed to update hold status.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handler: Confirm Reject
  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingItem) return;

    if (!rejectionReason.trim()) {
      toast.error('Rejection reason is required.');
      return;
    }

    setIsRejecting(true);
    try {
      const res = await ownerRejectPayment(rejectingItem.id, rejectionReason.trim());
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      toast.success(`Payment rejected and returned to Accounts team`);
      setPayments((prev) =>
        prev.map((p) => (p.id === rejectingItem.id ? res.data : p))
      );
      setRejectingItem(null);
      setRejectionReason('');
    } catch {
      toast.error('Failed to reject payment.');
    } finally {
      setIsRejecting(false);
    }
  };

  // Handler: Inline Bank Switch
  const handleBankSwitch = async (item: PaymentItem, newBankId: string) => {
    if (item.source_bank_id === newBankId) return;

    const chosenBank = banks.find((b) => b.id === newBankId);
    setActionLoadingId(item.id);
    try {
      const res = await ownerSwitchBank(item.id, newBankId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      toast.success(
        `Disbursement bank switched to ${chosenBank?.short_name || 'Bank'}`
      );

      setPayments((prev) =>
        prev.map((p) => (p.id === item.id ? res.data : p))
      );
    } catch {
      toast.error('Failed to switch bank.');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="w-full space-y-5">
      {/* DESKTOP TITLE */}
      <div className="hidden lg:flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Approvals
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Review incoming payment requests and authorize bank transfers.
          </p>
        </div>
      </div>

      {/* COMPACT TOP SUMMARY STRIP (Screen B & ui-reference.html) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div>
          <div className="text-xs font-medium text-slate-500">Pending Approval</div>
          <div className="mt-0.5 flex items-baseline gap-2.5">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {formatINR(totalPendingAmount)}
            </span>
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              {pendingItems.length} item{pendingItems.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {/* BANK-WISE SPLIT PILLS */}
        <div className="flex flex-wrap items-center gap-2">
          {bankSplits.map((s) => {
            const isAxis = s.bank.short_name.toLowerCase() === 'axis';
            const isSib = s.bank.short_name.toLowerCase() === 'sib';
            const dotColor = isAxis
              ? 'bg-[#97144D]'
              : isSib
                ? 'bg-[#B91C1C]'
                : 'bg-slate-600';

            return (
              <div
                key={s.bank.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs shadow-2xs"
              >
                <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                <span className="font-medium text-slate-600">{s.bank.short_name}:</span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {formatINR(s.total)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2-TAB PILL TOGGLE */}
      <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200/80">
        <button
          type="button"
          onClick={() => setActiveTab('PENDING_APPROVAL')}
          className={`min-h-[38px] px-3.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'PENDING_APPROVAL'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>Pending</span>
          <span
            className={`tabular-nums text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'PENDING_APPROVAL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {pendingItems.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ON_HOLD')}
          className={`min-h-[38px] px-3.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'ON_HOLD'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>On Hold</span>
          <span
            className={`tabular-nums text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'ON_HOLD'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {holdItems.length}
          </span>
        </button>
      </div>

      {/* DATE-GROUPED 4-ROW APPROVAL CARDS */}
      {sortedDates.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center shadow-xs">
          <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <Check className="w-5 h-5" />
          </div>
          <div className="text-sm font-semibold text-slate-900">
            {activeTab === 'PENDING_APPROVAL'
              ? 'All pending payments cleared'
              : 'No payments on hold'}
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {activeTab === 'PENDING_APPROVAL'
              ? 'New requests submitted by the Accounts team will appear here automatically.'
              : 'Items placed on hold for review will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((date) => {
            const dateItems = groupedByDate[date];
            return (
              <section key={date} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 tabular-nums">
                    {formatHumanDate(date)}
                  </h2>
                  <span className="text-xs text-slate-400">
                    ({dateItems.length} item{dateItems.length === 1 ? '' : 's'})
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {dateItems.map((item) => (
                    <OwnerApprovalCard
                      key={item.id}
                      item={item}
                      banks={banks}
                      onApprove={(it) => setApprovingItem(it)}
                      onHold={handleToggleHold}
                      onReject={(it) => {
                        setRejectingItem(it);
                        setRejectionReason('');
                      }}
                      onBankSwitch={handleBankSwitch}
                      onViewBill={(it) => setViewingItem(it)}
                      isActionLoading={actionLoadingId === item.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* APPROVE CONFIRMATION DIALOG */}
      <Dialog
        open={Boolean(approvingItem)}
        onOpenChange={(open) => {
          if (!open) setApprovingItem(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-900">
              Confirm Payment Approval
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Approved payments cannot be edited and become immediately ready for
              bank disbursement by the Accountant.
            </DialogDescription>
          </DialogHeader>

          {approvingItem && (
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Vendor</span>
                <span className="font-semibold text-slate-900">
                  {approvingItem.vendor?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice Ref</span>
                <span className="font-medium text-slate-900 tabular-nums">
                  {approvingItem.invoice_ref}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Disbursing Bank</span>
                <span className="font-medium text-slate-900">
                  {approvingItem.source_bank?.full_name} (
                  {approvingItem.source_bank?.short_name})
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="text-slate-700 font-medium">Net Payable</span>
                <span className="text-base font-bold text-slate-900 tabular-nums">
                  {formatINR(approvingItem.net_payable)}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <button
              type="button"
              disabled={isApproving}
              onClick={() => setApprovingItem(null)}
              className="flex-1 sm:flex-initial min-h-[40px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isApproving}
              onClick={handleConfirmApprove}
              className="flex-1 sm:flex-initial min-h-[40px] px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
            >
              {isApproving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Confirm Approve</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REJECT MODAL (MANDATORY REASON) */}
      <Dialog
        open={Boolean(rejectingItem)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingItem(null);
            setRejectionReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleConfirmReject} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-rose-900">
                Reject Payment Request
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                This item will be rejected and sent back with your reason to the
                Accountant ledger.
              </DialogDescription>
            </DialogHeader>

            {rejectingItem && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex justify-between items-center">
                <span className="font-semibold text-slate-900">
                  {rejectingItem.vendor?.name}
                </span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {formatINR(rejectingItem.net_payable)}
                </span>
              </div>
            )}

            <div>
              <label
                htmlFor="reject-reason"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Rejection Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="reject-reason"
                required
                autoFocus
                rows={3}
                placeholder="e.g., Bank details incorrect, rate mismatch, or hold pending delivery"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 resize-none transition-colors"
              />
            </div>

            <DialogFooter className="flex-row gap-2 sm:justify-end">
              <button
                type="button"
                disabled={isRejecting}
                onClick={() => {
                  setRejectingItem(null);
                  setRejectionReason('');
                }}
                className="flex-1 sm:flex-initial min-h-[40px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRejecting || !rejectionReason.trim()}
                className="flex-1 sm:flex-initial min-h-[40px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
              >
                {isRejecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : null}
                <span>Confirm Reject</span>
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DETAIL DRAWER WITH SIGNED URLS & AUDIT TIMELINE */}
      <PaymentDetailDrawer
        open={Boolean(viewingItem)}
        onOpenChange={(open) => {
          if (!open) setViewingItem(null);
        }}
        payment={viewingItem}
      />
    </div>
  );
}
