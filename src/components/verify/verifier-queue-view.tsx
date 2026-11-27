'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  Paperclip,
  ExternalLink,
  Loader2,
  Search,
  AlertTriangle,
  Building2,
  CreditCard,
  Clock,
  UserCheck,
  ShieldCheck,
  Calendar,
  Landmark,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { verifyPayment, ownerRejectPayment } from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { formatINR, formatHumanDate, formatShortDate } from '@/lib/format';
import { BankBadge, PaymentModeBadge } from '@/components/payments/payment-status-badge';
import { PaymentUrlSync, usePaymentHighlight } from '@/components/layout/payment-url-sync';
import type { PaymentItem, CompanyBank, PaymentMode } from '@/types/database';

interface VerifierQueueViewProps {
  initialPayments: PaymentItem[];
  companyName: string;
  banks?: CompanyBank[];
}

function isOverdue(dueDateStr: string): boolean {
  if (!dueDateStr) return false;
  const today = new Date().toISOString().split('T')[0];
  return dueDateStr < today;
}

export function VerifierQueueView({
  initialPayments,
  companyName,
  banks = [],
}: VerifierQueueViewProps) {
  const router = useRouter();
  const [, startRefreshTransition] = React.useTransition();
  const refreshServerState = React.useCallback(() => {
    startRefreshTransition(() => {
      router.refresh();
    });
  }, [router]);

  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [showOverdueOnly, setShowOverdueOnly] = React.useState<boolean>(false);
  const [modeFilter, setModeFilter] = React.useState<'ALL' | PaymentMode>('ALL');
  const [showBankSplit, setShowBankSplit] = React.useState<boolean>(false);

  // Action states
  const [verifyingId, setVerifyingId] = React.useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = React.useState<string | null>(null);

  // Rejection modal state
  const [rejectingItem, setRejectingItem] = React.useState<PaymentItem | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState<string>('');
  const [isRejecting, setIsRejecting] = React.useState<boolean>(false);

  const { highlightedId, triggerHighlight } = usePaymentHighlight();
  const handleUrlParams = React.useCallback(
    ({ highlightId }: { tab: string | null; highlightId: string | null }) => {
      if (highlightId) triggerHighlight(highlightId);
    },
    [triggerHighlight]
  );

  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  // Handle Verify & Forward (Optimistic UI)
  const handleVerify = async (item: PaymentItem) => {
    const previous = payments;
    // Optimistic removal from verification queue
    setPayments((prev) => prev.filter((p) => p.id !== item.id));
    toast.success(`Verified payment for "${item.vendor?.party_name || item.vendor?.name}" and forwarded for Approval.`);

    setVerifyingId(item.id);
    try {
      const res = await verifyPayment(item.id);
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to verify payment.');
        return;
      }
      refreshServerState();
    } catch {
      setPayments(previous);
      toast.error('Network error during verification. Rolled back.');
    } finally {
      setVerifyingId(null);
    }
  };

  // Handle Return / Reject (Modal + Optimistic UI)
  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingItem) return;

    if (!rejectionReason.trim()) {
      toast.error('A rejection reason is required.');
      return;
    }

    const item = rejectingItem;
    const previous = payments;

    setIsRejecting(true);
    setPayments((prev) => prev.filter((p) => p.id !== item.id));
    setRejectingItem(null);

    try {
      const res = await ownerRejectPayment(item.id, rejectionReason.trim());
      if (!res.success) {
        setPayments(previous);
        toast.error(res.error || 'Failed to return payment.');
        return;
      }
      toast.success(`Payment returned to Preparer with reason.`);
      refreshServerState();
    } catch {
      setPayments(previous);
      toast.error('Network error during rejection. Rolled back.');
    } finally {
      setIsRejecting(false);
      setRejectionReason('');
    }
  };

  // Handle View Attached Bill
  const handleViewBill = async (paymentId: string, filePath: string) => {
    setViewingFileId(paymentId);
    try {
      const res = await getSignedFileUrl('supplier-invoices', filePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not preview attached bill.');
    } finally {
      setViewingFileId(null);
    }
  };

  // Computations
  const totalAvailableBalance = banks.reduce(
    (sum, b) => sum + (Number(b.available_balance) || 0),
    0
  );
  const totalItems = payments.length;
  const totalNet = payments.reduce((sum, p) => sum + (Number(p.net_payable) || 0), 0);
  const overdueCount = payments.filter((p) => isOverdue(p.due_date)).length;

  // Filtered rows
  const filtered = payments
    .filter((p) => {
      if (showOverdueOnly) return isOverdue(p.due_date);
      return true;
    })
    .filter((p) => {
      if (modeFilter !== 'ALL') {
        return (p.payment_mode || 'NEFT_RTGS') === modeFilter;
      }
      return true;
    })
    .filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const party = (p.vendor?.party_name || p.vendor?.name || '').toLowerCase();
      const ref = (p.invoice_ref || '').toLowerCase();
      const purpose = (p.purpose || '').toLowerCase();
      const acc = (p.vendor?.account_number || '').toLowerCase();
      return party.includes(q) || ref.includes(q) || purpose.includes(q) || acc.includes(q);
    });

  return (
    <div className="space-y-6">
      <PaymentUrlSync onParams={handleUrlParams} />
      {/* Header (Desktop/tablet — mobile top bar already shows active title) */}
      <div className="hidden sm:flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Verification Queue — {companyName}
            </h1>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-brand/10 text-brand">
              Senior Accountant Review
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Review bills, verify beneficiary account numbers, check TDS, and forward for final Approval.
          </p>
        </div>
      </div>

      {/* KPI Overview Strip */}
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => setShowBankSplit((prev) => !prev)}
            aria-expanded={showBankSplit}
            className={`text-left p-3 sm:p-4 rounded-xl border bg-white shadow-sm flex items-center justify-between gap-2 transition-colors cursor-pointer min-w-0 ${
              showBankSplit
                ? 'border-emerald-300 ring-1 ring-emerald-200 bg-emerald-50/30'
                : 'border-slate-200 hover:border-emerald-200 hover:bg-slate-50/50'
            }`}
          >
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider truncate">
                Available Balance
              </p>
              <p className="text-base sm:text-lg font-bold text-emerald-700 tabular-nums mt-0.5 truncate">
                {formatINR(totalAvailableBalance)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 truncate">
                <span>
                  {banks.length} {banks.length === 1 ? 'bank' : 'banks'}
                </span>
                <span>•</span>
                <span className="font-medium text-emerald-700 inline-flex items-center gap-0.5">
                  {showBankSplit ? 'Hide split' : 'View split'}
                  {showBankSplit ? (
                    <ChevronUp className="w-3 h-3 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  )}
                </span>
              </p>
            </div>
            <div className="p-2 sm:p-2.5 rounded-lg bg-emerald-50 text-emerald-700 shrink-0">
              <Landmark className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </button>

          <div className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider truncate">
                Awaiting Verification
              </p>
              <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                {totalItems} bills
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">Submitted by Preparers</p>
            </div>
            <div className="p-2 sm:p-2.5 rounded-lg bg-slate-100 text-slate-600 shrink-0">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>

          <div className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider truncate">
                Total Net Payable
              </p>
              <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums mt-0.5 truncate">
                {formatINR(totalNet)}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">Pending authorization</p>
            </div>
            <div className="p-2 sm:p-2.5 rounded-lg bg-brand/10 text-brand shrink-0">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>

          <div className="p-3 sm:p-4 rounded-xl border border-rose-200 bg-rose-50/40 shadow-sm flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider truncate">
                Overdue Invoices
              </p>
              <p className="text-base sm:text-lg font-bold text-rose-800 tabular-nums mt-0.5">
                {overdueCount} bills
              </p>
              <p className="text-[11px] text-rose-600 mt-0.5 truncate">Due date is past</p>
            </div>
            <div className="p-2 sm:p-2.5 rounded-lg bg-rose-100 text-rose-700 shrink-0">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
        </div>

        {showBankSplit && (
          <div className="p-3 sm:p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/20 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                Bank-by-Bank Available Balance
              </p>
              <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                {banks.length} active {banks.length === 1 ? 'account' : 'accounts'}
              </span>
            </div>

            {banks.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No active bank accounts found for {companyName}.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {banks.map((b) => {
                  const bankName =
                    b.bank_name || b.full_name || b.short_code || b.short_name || 'Bank';
                  const maskedAc = b.account_number_masked || b.account_mask;
                  const updaterName = b.balance_updater?.full_name;
                  const updatedLabel = b.balance_updated_at
                    ? new Date(b.balance_updated_at).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : null;

                  return (
                    <div
                      key={b.id}
                      className="p-2.5 sm:p-3 rounded-lg border border-slate-200 bg-white min-w-0"
                    >
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <span className="text-xs font-semibold text-slate-800 truncate">
                          {bankName}
                        </span>
                        {(b.short_code || b.short_name) && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold shrink-0">
                            {b.short_code || b.short_name}
                          </span>
                        )}
                      </div>
                      {maskedAc && (
                        <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                          {maskedAc}
                        </div>
                      )}
                      <div className="text-sm sm:text-base font-bold text-slate-900 tabular-nums mt-1.5 truncate">
                        {formatINR(Number(b.available_balance) || 0)}
                      </div>
                      {(updatedLabel || updaterName) && (
                        <div className="text-[10px] text-slate-400 truncate mt-1">
                          {updatedLabel ? `Updated ${updatedLabel}` : ''}
                          {updatedLabel && updaterName ? ' • ' : ''}
                          {updaterName || ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOverdueOnly(false)}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${!showOverdueOnly
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
          >
            All Pending ({totalItems})
          </button>
          <button
            type="button"
            onClick={() => setShowOverdueOnly(true)}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${showOverdueOnly
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-rose-700 hover:bg-rose-50'
              }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Overdue Only ({overdueCount})</span>
          </button>
          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200">
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
                className={`min-h-[34px] px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
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

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search party, invoice ref, or account..."
            className="w-full min-h-[38px] pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
          />
        </div>
      </div>

      {/* Verification Queue List / Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-900">
            {totalItems === 0
              ? 'Verification Queue is Clear!'
              : 'No matching entries found.'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {totalItems === 0
              ? 'All submitted payments have been verified and forwarded to the Approver.'
              : 'Try clearing your search query or switching off the overdue filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Desktop Table View */}
          <div className="hidden lg:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5">Due Date</th>
                  <th className="py-3 px-3.5">Party & Beneficiary Verification</th>
                  <th className="py-3 px-3.5">Invoice / Purpose</th>
                  <th className="py-3 px-3.5 text-right">Gross & TDS</th>
                  <th className="py-3 px-3.5 text-right">Net Payable</th>
                  <th className="py-3 px-3.5 text-center">Source Bank</th>
                  <th className="py-3 px-3.5 text-right w-48">Verification Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => {
                  const overdue = isOverdue(item.due_date);
                  const isVerifying = verifyingId === item.id;
                  const isViewing = viewingFileId === item.id;
                  const vendor = item.vendor;
                  const partyName = vendor?.party_name || vendor?.name || 'Unknown Party';
                  const beneficiary = vendor?.beneficiary_name || partyName;

                  return (
                    <tr
                      key={item.id}
                      data-payment-id={item.id}
                      className={`hover:bg-slate-50/60 transition-colors ${highlightedId === item.id
                        ? 'ring-2 ring-inset ring-brand bg-brand-tint/60 animate-pulse'
                        : ''
                        }`}
                    >
                      {/* Due Date */}
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 tabular-nums">
                            {formatShortDate(item.due_date)}
                          </span>
                          {overdue && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 uppercase">
                              Overdue
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Sheet: {formatShortDate(item.sheet_date)}
                        </div>
                      </td>

                      {/* Party & Beneficiary Strip */}
                      <td className="py-3 px-3.5 max-w-[240px]">
                        <div className="font-bold text-slate-900 truncate">
                          {partyName}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-1 truncate">
                          <CreditCard className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{beneficiary}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          A/C: {vendor?.account_number || 'NA'} • {vendor?.ifsc_code || 'NA'}
                        </div>
                      </td>

                      {/* Invoice & Purpose + Bill Link */}
                      <td className="py-3 px-3.5 max-w-[180px]">
                        <div className="flex items-center gap-1.5 font-mono text-slate-800 font-semibold">
                          <span>{item.invoice_ref}</span>
                          {item.invoice_file_path && (
                            <button
                              type="button"
                              onClick={() => handleViewBill(item.id, item.invoice_file_path!)}
                              disabled={isViewing}
                              title="View attached bill file"
                              className="text-brand hover:underline p-0.5 rounded inline-flex items-center gap-0.5 text-[11px]"
                            >
                              {isViewing ? (
                                <Loader2 className="w-3 h-3 animate-spin text-brand" />
                              ) : (
                                <ExternalLink className="w-3 h-3 text-brand" />
                              )}
                              <span>Bill</span>
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {item.purpose}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          By: {item.creator?.full_name || 'Preparer'}
                        </div>
                      </td>

                      {/* Gross & TDS */}
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <div className="font-medium tabular-nums text-slate-800">
                          {formatINR(item.amount)}
                        </div>
                        <div className="text-[10px] tabular-nums mt-0.5">
                          {item.tds > 0 ? (
                            <span className="text-amber-700 font-medium">TDS: {formatINR(item.tds)}</span>
                          ) : (
                            <span className="text-slate-400">TDS: NA</span>
                          )}
                        </div>
                      </td>

                      {/* Net Payable */}
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <div className="font-bold tabular-nums text-slate-900 text-sm">
                          {formatINR(item.net_payable)}
                        </div>
                      </td>

                      {/* Source Bank & Mode */}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <BankBadge
                            shortName={item.source_bank?.short_code || item.source_bank?.short_name}
                            fullName={item.source_bank?.bank_name || item.source_bank?.full_name}
                          />
                          <PaymentModeBadge mode={item.payment_mode} compact />
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingItem(item);
                              setRejectionReason('');
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                            title="Return to Preparer with correction remarks"
                          >
                            <XCircle className="w-3.5 h-3.5 text-rose-500" />
                            <span>Return</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleVerify(item)}
                            disabled={isVerifying}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                            title="Verify and forward to Approver for approval"
                          >
                            {isVerifying ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            <span>Verify & Forward</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50/80 border-t-2 border-slate-200 font-bold text-slate-900 text-xs">
                  <td colSpan={4} className="py-3 px-3.5 text-right uppercase tracking-wider text-[11px] text-slate-600">
                    Total Queue Net Payable
                  </td>
                  <td className="py-3 px-3.5 text-right tabular-nums text-slate-900 font-bold text-sm">
                    {formatINR(totalNet)}
                  </td>
                  <td colSpan={2} className="py-3 px-3.5 text-slate-400 font-normal">
                    {filtered.length} bill{filtered.length === 1 ? '' : 's'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className="lg:hidden space-y-3">
            {filtered.map((item) => {
              const overdue = isOverdue(item.due_date);
              const isVerifying = verifyingId === item.id;
              const isViewing = viewingFileId === item.id;
              const vendor = item.vendor;
              const partyName = vendor?.party_name || vendor?.name || 'Unknown Party';
              const beneficiary = vendor?.beneficiary_name || partyName;

              return (
                <div
                  key={item.id}
                  data-payment-id={item.id}
                  className={`bg-white rounded-xl border p-4 shadow-sm space-y-3 transition-all ${highlightedId === item.id
                    ? 'border-brand ring-2 ring-brand animate-pulse'
                    : 'border-slate-200'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 truncate">
                          {partyName}
                        </span>
                        {overdue && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 uppercase">
                            Overdue
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        Due: {formatShortDate(item.due_date)} • Ref: {item.invoice_ref}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-sm text-slate-900 tabular-nums">
                        {formatINR(item.net_payable)}
                      </div>
                      <div className="text-[10px] text-slate-400 tabular-nums mt-0.5">
                        {item.tds > 0 ? `TDS: ${formatINR(item.tds)}` : 'TDS: NA'}
                      </div>
                    </div>
                  </div>

                  {/* Beneficiary Details Box */}
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 truncate min-w-0">
                        Beneficiary: {beneficiary}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <PaymentModeBadge mode={item.payment_mode} compact />
                        <BankBadge
                          shortName={item.source_bank?.short_code || item.source_bank?.short_name}
                          fullName={item.source_bank?.bank_name || item.source_bank?.full_name}
                        />
                      </div>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex flex-wrap items-center justify-between gap-1">
                      <span className="break-all">A/C: {vendor?.account_number || 'NA'}</span>
                      <span>IFSC: {vendor?.ifsc_code || 'NA'}</span>
                    </div>
                  </div>

                  {/* Actions & Bill Link */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    {item.invoice_file_path ? (
                      <button
                        type="button"
                        onClick={() => handleViewBill(item.id, item.invoice_file_path!)}
                        disabled={isViewing}
                        className="min-h-[38px] text-xs text-brand font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        {isViewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                        <span>View Bill</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">No bill attached</span>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingItem(item);
                          setRejectionReason('');
                        }}
                        className="min-h-[42px] px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:text-rose-600 hover:border-rose-200 cursor-pointer"
                      >
                        Return
                      </button>
                      <button
                        type="button"
                        onClick={() => handleVerify(item)}
                        disabled={isVerifying}
                        className="min-h-[42px] px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 shadow-sm cursor-pointer disabled:opacity-50"
                      >
                        {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>Verify & Forward</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Return / Reject Modal */}
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
              Return Payment to Preparer
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Provide a clear reason or discrepancy explanation for the Preparer to correct.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmReject} className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-slate-900">
                {rejectingItem?.vendor?.party_name || rejectingItem?.vendor?.name}
              </div>
              <div className="text-slate-500">
                Invoice Ref: {rejectingItem?.invoice_ref} • Amount: {formatINR(rejectingItem?.net_payable || 0)}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Return / Correction <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g., Wrong account number, TDS percentage mismatch with certificate, bill attachment missing page 2..."
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
                    Returning...
                  </>
                ) : (
                  'Confirm Return'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
