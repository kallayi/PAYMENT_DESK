'use client';

import * as React from 'react';
import {
  Plus,
  Printer,
  Paperclip,
  Loader2,
  Trash2,
  ExternalLink,
  Clock,
  ArrowRight,
  Send,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { PaymentFormSheet } from '@/components/payments/payment-form-sheet';
import { PaymentDetailDrawer } from '@/components/payments/payment-detail-drawer';
import { MarkPaidModal } from '@/components/payments/mark-paid-modal';
import { PaymentStatusBadge, BankBadge } from '@/components/payments/payment-status-badge';
import { dismissIncomingBill } from '@/actions/bills';
import { deleteDraftPayment, submitPayment } from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { formatHumanDate, formatShortDate, formatINR } from '@/lib/format';
import type {
  CompanyBank,
  IncomingBill,
  PaymentItem,
  PaymentStatus,
  Vendor,
} from '@/types/database';

interface PaymentsWorkspaceProps {
  initialPayments: PaymentItem[];
  initialIncomingBills: IncomingBill[];
  vendors: Vendor[];
  banks: CompanyBank[];
}

type AccountantTab =
  | 'INCOMING'
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PAID'
  | 'REJECTED';

export function PaymentsWorkspace({
  initialPayments,
  initialIncomingBills,
  vendors: initialVendors,
  banks,
}: PaymentsWorkspaceProps) {
  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [incomingBills, setIncomingBills] =
    React.useState<IncomingBill[]>(initialIncomingBills);
  const [vendors, setVendors] = React.useState<Vendor[]>(initialVendors);

  // Active Tab
  const [activeTab, setActiveTab] = React.useState<AccountantTab>('INCOMING');

  // Drawer state
  const [isDrawerOpen, setIsDrawerOpen] = React.useState<boolean>(false);
  const [selectedEditPayment, setSelectedEditPayment] =
    React.useState<PaymentItem | null>(null);
  const [selectedIncomingBill, setSelectedIncomingBill] =
    React.useState<IncomingBill | null>(null);
  const [detailPayment, setDetailPayment] = React.useState<PaymentItem | null>(null);
  const [utrPayment, setUtrPayment] = React.useState<PaymentItem | null>(null);

  // Action loading states
  const [dismissingBillId, setDismissingBillId] = React.useState<string | null>(null);
  const [submittingPaymentId, setSubmittingPaymentId] = React.useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = React.useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = React.useState<string | null>(null);

  // Synchronize when initial props change
  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  React.useEffect(() => {
    setIncomingBills(initialIncomingBills);
  }, [initialIncomingBills]);

  // Tab live counts
  const incomingCount = incomingBills.filter((b) => b.status === 'NEW').length;
  const draftCount = payments.filter((p) => p.status === 'DRAFT').length;
  const pendingCount = payments.filter(
    (p) => p.status === 'PENDING_APPROVAL' || p.status === 'ON_HOLD'
  ).length;
  const approvedCount = payments.filter((p) => p.status === 'APPROVED').length;
  const paidCount = payments.filter((p) => p.status === 'PAID').length;
  const rejectedCount = payments.filter((p) => p.status === 'REJECTED').length;

  const tabs: Array<{ id: AccountantTab; label: string; count: number }> = [
    { id: 'INCOMING', label: 'Incoming Bills', count: incomingCount },
    { id: 'DRAFT', label: 'Draft', count: draftCount },
    { id: 'PENDING_APPROVAL', label: 'Pending', count: pendingCount },
    { id: 'APPROVED', label: 'Ready to Pay', count: approvedCount },
    { id: 'PAID', label: 'Paid', count: paidCount },
    { id: 'REJECTED', label: 'Rejected', count: rejectedCount },
  ];

  // Open drawer for new entry
  const handleOpenNewEntry = () => {
    setSelectedEditPayment(null);
    setSelectedIncomingBill(null);
    setIsDrawerOpen(true);
  };

  // Open drawer to convert an incoming bill
  const handleConvertBill = (bill: IncomingBill) => {
    setSelectedEditPayment(null);
    setSelectedIncomingBill(bill);
    setIsDrawerOpen(true);
  };

  // Open drawer to edit a draft payment
  const handleEditPayment = (payment: PaymentItem) => {
    setSelectedIncomingBill(null);
    setSelectedEditPayment(payment);
    setIsDrawerOpen(true);
  };

  // Handle successful save from drawer
  const handleDrawerSuccess = (savedPayment: PaymentItem) => {
    // If we converted an incoming bill, remove it from incoming bills list
    if (savedPayment.incoming_bill_id) {
      setIncomingBills((prev) =>
        prev.filter((b) => b.id !== savedPayment.incoming_bill_id)
      );
    }

    setPayments((prev) => {
      const existsIndex = prev.findIndex((p) => p.id === savedPayment.id);
      if (existsIndex >= 0) {
        const copy = [...prev];
        copy[existsIndex] = savedPayment;
        return copy;
      }
      return [savedPayment, ...prev];
    });

    // Auto-switch to the relevant tab if submitted
    if (savedPayment.status === 'PENDING_APPROVAL') {
      setActiveTab('PENDING_APPROVAL');
    } else if (savedPayment.status === 'DRAFT') {
      setActiveTab('DRAFT');
    }
  };

  // Quick submit a draft payment directly from table row
  const handleSubmitDraft = async (paymentId: string) => {
    setSubmittingPaymentId(paymentId);
    try {
      const res = await submitPayment(paymentId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success('Payment submitted for Owner approval');
      setPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? res.data : p))
      );
    } catch {
      toast.error('Failed to submit payment.');
    } finally {
      setSubmittingPaymentId(null);
    }
  };

  // Delete draft payment
  const handleDeleteDraft = async (paymentId: string) => {
    if (!window.confirm('Are you sure you want to delete this draft entry?')) {
      return;
    }

    setDeletingPaymentId(paymentId);
    try {
      const res = await deleteDraftPayment(paymentId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success('Draft payment deleted');
      setPayments((prev) => prev.filter((p) => p.id !== paymentId));
    } catch {
      toast.error('Failed to delete draft payment.');
    } finally {
      setDeletingPaymentId(null);
    }
  };

  // Dismiss an incoming bill
  const handleDismissBill = async (billId: string) => {
    if (!window.confirm('Dismiss this incoming bill?')) {
      return;
    }

    setDismissingBillId(billId);
    try {
      const res = await dismissIncomingBill(billId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success('Incoming bill dismissed');
      setIncomingBills((prev) => prev.filter((b) => b.id !== billId));
    } catch {
      toast.error('Failed to dismiss bill.');
    } finally {
      setDismissingBillId(null);
    }
  };

  // Preview an attached invoice file using signed URL
  const handleViewInvoiceFile = async (
    targetId: string,
    bucket: 'supplier-invoices' | 'bank-receipts',
    filePath: string | null
  ) => {
    if (!filePath) {
      toast.info('No document attached.');
      return;
    }

    setViewingFileId(targetId);
    try {
      const res = await getSignedFileUrl(bucket, filePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Failed to open document preview.');
    } finally {
      setViewingFileId(null);
    }
  };

  // Filter payment items based on active tab
  let filteredRows: PaymentItem[] = [];
  if (activeTab === 'PENDING_APPROVAL') {
    filteredRows = payments.filter(
      (p) => p.status === 'PENDING_APPROVAL' || p.status === 'ON_HOLD'
    );
  } else if (activeTab !== 'INCOMING') {
    filteredRows = payments.filter((p) => p.status === activeTab);
  }

  const totalVisibleAmount = filteredRows.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  return (
    <div className="w-full space-y-5">
      {/* TOP ACTION BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Payments</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Prepare payment requests, track approvals, and close UTRs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] sm:min-h-[38px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print Form</span>
          </button>
          <button
            type="button"
            onClick={handleOpenNewEntry}
            className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[38px] px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Entry</span>
          </button>
        </div>
      </div>

      {/* SINGLE-ROW STATUS TABS WITH LIVE COUNTS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200 no-scrollbar">
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-medium whitespace-nowrap inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                active
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span>{t.label}</span>
              <span
                className={`tabular-nums text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-700'
                }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT: INCOMING BILLS */}
      {activeTab === 'INCOMING' && (
        <div className="space-y-4">
          {incomingBills.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <Clock className="w-5 h-5" />
              </div>
              <div className="text-sm font-semibold text-slate-900">
                No incoming bills from Stock Staff
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Uploaded supplier invoices will appear here for one-click conversion into
                payment entries.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {incomingBills.map((bill) => {
                const vendorName =
                  bill.vendor?.name || bill.vendor_name_fallback || 'Unknown Supplier';
                const isDismissing = dismissingBillId === bill.id;
                const isViewing = viewingFileId === bill.id;
                const fileExt = bill.file_path.split('.').pop()?.toUpperCase() || 'FILE';

                return (
                  <div
                    key={bill.id}
                    className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs hover:border-slate-300 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">
                          {vendorName}
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums bg-slate-100 px-2 py-0.5 rounded">
                          Ref: {bill.invoice_ref}
                        </span>
                        {bill.estimated_amount && bill.estimated_amount > 0 && (
                          <span className="text-xs font-semibold text-slate-900 tabular-nums">
                            {formatINR(bill.estimated_amount)}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                        <span className="tabular-nums">
                          {formatHumanDate(bill.created_at)}
                        </span>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() =>
                            handleViewInvoiceFile(
                              bill.id,
                              'supplier-invoices',
                              bill.file_path
                            )
                          }
                          disabled={isViewing}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline font-medium cursor-pointer"
                        >
                          {isViewing ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                          ) : (
                            <Paperclip className="w-3 h-3" />
                          )}
                          <span>Invoice {fileExt}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                        </button>
                      </div>

                      {bill.notes && (
                        <p className="text-xs text-slate-600 pt-1 italic">
                          &ldquo;{bill.notes}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDismissBill(bill.id)}
                        disabled={isDismissing}
                        className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 hover:text-rose-600 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                      >
                        {isDismissing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : null}
                        <span>Dismiss</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConvertBill(bill)}
                        className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                      >
                        <span>Create Payment</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: PAYMENTS TABLE / CARDS */}
      {activeTab !== 'INCOMING' && (
        <div>
          {filteredRows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
              <div className="text-sm font-semibold text-slate-900">
                No payment entries found
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Entries matching the &ldquo;{tabs.find((t) => t.id === activeTab)?.label}&rdquo;
                status will appear here.
              </p>
              {activeTab === 'DRAFT' && (
                <button
                  type="button"
                  onClick={handleOpenNewEntry}
                  className="mt-4 min-h-[38px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-800 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create First Draft</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* DESKTOP 7-COLUMN TABLE (md+) */}
              <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="py-3 pl-4 pr-3">Date</th>
                        <th className="py-3 px-3">Vendor & Ref</th>
                        <th className="py-3 px-3">Purpose & Due</th>
                        <th className="py-3 px-3 text-right">Amount (₹)</th>
                        <th className="py-3 px-3">Bank</th>
                        <th className="py-3 px-3">Status / UTR</th>
                        <th className="py-3 pl-3 pr-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredRows.map((item) => {
                        const vendorName = item.vendor?.name || 'Unknown Vendor';
                        const isSubmitting = submittingPaymentId === item.id;
                        const isDeleting = deletingPaymentId === item.id;

                        return (
                          <tr
                            key={item.id}
                            className="hover:bg-slate-50/80 transition-colors"
                          >
                            {/* 1. Date */}
                            <td className="py-3 pl-4 pr-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                              {formatShortDate(item.sheet_date)}
                            </td>

                            {/* 2. Vendor & Ref */}
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-900 leading-snug">
                                {vendorName}
                              </div>
                              <div className="text-xs text-slate-500 tabular-nums mt-0.5 flex items-center gap-1.5">
                                <span>{item.invoice_ref}</span>
                                {item.invoice_file_path && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleViewInvoiceFile(
                                        item.id,
                                        'supplier-invoices',
                                        item.invoice_file_path
                                      )
                                    }
                                    title="View attached invoice"
                                    className="text-slate-400 hover:text-blue-600 transition-colors"
                                  >
                                    <Paperclip className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* 3. Purpose & Due */}
                            <td className="py-3 px-3">
                              <div className="text-xs font-medium text-slate-700">
                                {item.purpose}
                              </div>
                              <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                                Due {formatShortDate(item.due_date)}
                              </div>
                            </td>

                            {/* 4. Amount & TDS */}
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              <div className="font-bold text-slate-900 tabular-nums">
                                {formatINR(item.net_payable)}
                              </div>
                              {item.tds > 0 && (
                                <div className="text-[11px] text-amber-700 tabular-nums mt-0.5">
                                  TDS {formatINR(item.tds)}
                                </div>
                              )}
                            </td>

                            {/* 5. Bank */}
                            <td className="py-3 px-3">
                              <BankBadge
                                shortName={item.source_bank?.short_name}
                                fullName={item.source_bank?.full_name}
                              />
                            </td>

                            {/* 6. Status / UTR */}
                            <td className="py-3 px-3">
                              <div>
                                <PaymentStatusBadge status={item.status} />
                              </div>
                              {item.utr_number && (
                                <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-1 font-medium">
                                  {item.utr_number}
                                </div>
                              )}
                            </td>

                            {/* 7. Action */}
                            <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap">
                              {item.status === 'DRAFT' ? (
                                <div className="inline-flex items-center gap-1.5 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleEditPayment(item)}
                                    className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 transition-colors cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() => handleSubmitDraft(item.id)}
                                    title="Submit for Approval"
                                    className="h-8 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    {isSubmitting ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Send className="w-3 h-3" />
                                    )}
                                    <span>Submit</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isDeleting}
                                    onClick={() => handleDeleteDraft(item.id)}
                                    title="Delete Draft"
                                    className="h-8 w-8 rounded-lg border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-600 hover:bg-rose-50/50 inline-flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
                                  >
                                    {isDeleting ? (
                                      <Loader2 className="w-3 h-3 animate-spin text-rose-600" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              ) : item.status === 'APPROVED' ? (
                                <button
                                  type="button"
                                  onClick={() => setUtrPayment(item)}
                                  className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors cursor-pointer shadow-xs inline-flex items-center gap-1"
                                >
                                  Enter UTR
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setDetailPayment(item)}
                                  className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
                                >
                                  View
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50/90 border-t border-slate-200">
                        <td
                          colSpan={3}
                          className="py-3 pl-4 pr-3 text-xs font-medium text-slate-500"
                        >
                          {filteredRows.length} item{filteredRows.length === 1 ? '' : 's'}
                        </td>
                        <td className="py-3 px-3 text-right text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                          Total: {formatINR(totalVisibleAmount)}
                        </td>
                        <td colSpan={3} className="py-3 px-3"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* MOBILE STACKED CARDS (< md) */}
              <div className="md:hidden space-y-3">
                {filteredRows.map((item) => {
                  const vendorName = item.vendor?.name || 'Unknown Vendor';
                  const isSubmitting = submittingPaymentId === item.id;
                  const isDeleting = deletingPaymentId === item.id;

                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {vendorName}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                            {item.invoice_ref} · {item.purpose}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatINR(item.net_payable)}
                          </div>
                          {item.tds > 0 && (
                            <div className="text-[11px] text-amber-700 tabular-nums">
                              TDS {formatINR(item.tds)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <BankBadge
                            shortName={item.source_bank?.short_name}
                            fullName={item.source_bank?.full_name}
                          />
                          <PaymentStatusBadge status={item.status} />
                        </div>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          Due {formatShortDate(item.due_date)}
                        </span>
                      </div>

                      {item.utr_number && (
                        <div className="text-[11px] text-slate-600 tabular-nums bg-slate-50 px-2.5 py-1.5 rounded-md border border-slate-200/70 font-mono">
                          UTR: <span className="font-semibold">{item.utr_number}</span>
                        </div>
                      )}

                      <div className="pt-1 flex items-center gap-2">
                        {item.status === 'DRAFT' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditPayment(item)}
                              className="flex-1 min-h-[44px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleSubmitDraft(item.id)}
                              className="flex-1 min-h-[44px] rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {isSubmitting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              <span>Submit</span>
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => handleDeleteDraft(item.id)}
                              className="min-h-[44px] w-11 rounded-lg border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-600 flex items-center justify-center"
                            >
                              {isDeleting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </>
                        ) : item.status === 'APPROVED' ? (
                          <button
                            type="button"
                            onClick={() => setUtrPayment(item)}
                            className="w-full min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                          >
                            <span>Enter UTR & Close</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDetailPayment(item)}
                            className="w-full min-h-[44px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors"
                          >
                            View Details
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Mobile Bottom Total Box */}
                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between text-xs shadow-xs">
                  <span className="text-slate-500 font-medium">
                    {filteredRows.length} item{filteredRows.length === 1 ? '' : 's'}
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums text-sm">
                    Total: {formatINR(totalVisibleAmount)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* PAYMENT ENTRY SLIDE-OVER DRAWER */}
      <PaymentFormSheet
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        vendors={vendors}
        banks={banks}
        editPayment={selectedEditPayment}
        incomingBill={selectedIncomingBill}
        onSuccess={handleDrawerSuccess}
        onVendorCreated={(newV) => setVendors((prev) => [newV, ...prev])}
      />

      {/* PAYMENT DETAIL DRAWER */}
      <PaymentDetailDrawer
        open={Boolean(detailPayment)}
        onOpenChange={(open) => {
          if (!open) setDetailPayment(null);
        }}
        payment={detailPayment}
      />

      {/* MARK PAID / ENTER UTR MODAL */}
      <MarkPaidModal
        open={Boolean(utrPayment)}
        onOpenChange={(open) => {
          if (!open) setUtrPayment(null);
        }}
        payment={utrPayment}
        onSuccess={(paidItem) => {
          setPayments((prev) =>
            prev.map((p) => (p.id === paidItem.id ? paidItem : p))
          );
        }}
      />
    </div>
  );
}
