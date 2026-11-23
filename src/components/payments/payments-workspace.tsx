'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Plus,
  Printer,
  Paperclip,
  Trash2,
  Send,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Edit2,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { PaymentFormSheet } from '@/components/payments/payment-form-sheet';
import { PaymentDetailDrawer } from '@/components/payments/payment-detail-drawer';
import { MarkPaidModal } from '@/components/payments/mark-paid-modal';
import { PaymentStatusBadge, BankBadge } from '@/components/payments/payment-status-badge';
import { deleteDraftPayment, submitPayment } from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { formatHumanDate, formatShortDate, formatINR } from '@/lib/format';
import type {
  CompanyBank,
  PaymentItem,
  PaymentStatus,
  Vendor,
} from '@/types/database';

interface PaymentsWorkspaceProps {
  initialPayments: PaymentItem[];
  vendors: Vendor[];
  banks: CompanyBank[];
}

type AccountantTab =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PAID'
  | 'REJECTED';

export function PaymentsWorkspace({
  initialPayments,
  vendors: initialVendors,
  banks,
}: PaymentsWorkspaceProps) {
  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [vendors, setVendors] = React.useState<Vendor[]>(initialVendors);

  // Active Tab: Defaults to DRAFT
  const [activeTab, setActiveTab] = React.useState<AccountantTab>('DRAFT');

  // Drawer & modal state
  const [isDrawerOpen, setIsDrawerOpen] = React.useState<boolean>(false);
  const [selectedEditPayment, setSelectedEditPayment] =
    React.useState<PaymentItem | null>(null);
  const [detailPayment, setDetailPayment] = React.useState<PaymentItem | null>(null);
  const [utrPayment, setUtrPayment] = React.useState<PaymentItem | null>(null);

  // Action loading states
  const [submittingPaymentId, setSubmittingPaymentId] = React.useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = React.useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = React.useState<string | null>(null);

  // Synchronize when initial props change
  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  // Tab live counts
  const draftCount = payments.filter((p) => p.status === 'DRAFT').length;
  const pendingCount = payments.filter(
    (p) => p.status === 'PENDING_APPROVAL' || p.status === 'ON_HOLD'
  ).length;
  const approvedCount = payments.filter((p) => p.status === 'APPROVED').length;
  const paidCount = payments.filter((p) => p.status === 'PAID').length;
  const rejectedCount = payments.filter((p) => p.status === 'REJECTED').length;

  const tabs: Array<{ id: AccountantTab; label: string; count: number }> = [
    { id: 'DRAFT', label: 'Draft', count: draftCount },
    { id: 'PENDING_APPROVAL', label: 'Pending', count: pendingCount },
    { id: 'APPROVED', label: 'Ready to Pay', count: approvedCount },
    { id: 'PAID', label: 'Paid', count: paidCount },
    { id: 'REJECTED', label: 'Rejected', count: rejectedCount },
  ];

  // Open drawer for new entry
  const handleOpenNewEntry = () => {
    setSelectedEditPayment(null);
    setIsDrawerOpen(true);
  };

  // Open drawer to edit a draft payment
  const handleEditPayment = (payment: PaymentItem) => {
    setSelectedEditPayment(payment);
    setIsDrawerOpen(true);
  };

  // Handle successful save from drawer
  const handleDrawerSuccess = (savedPayment: PaymentItem) => {
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

  // Quick submit a draft payment directly from table row (Optimistic UI)
  const handleSubmitDraft = async (paymentId: string) => {
    const previousPayments = payments;

    // Immediate UI update
    setPayments((prev) =>
      prev.map((p) =>
        p.id === paymentId
          ? { ...p, status: 'PENDING_APPROVAL', submitted_at: new Date().toISOString() }
          : p
      )
    );
    toast.success('Payment submitted for Owner approval');

    setSubmittingPaymentId(paymentId);
    try {
      const res = await submitPayment(paymentId);
      if (!res.success) {
        // Rollback on error
        setPayments(previousPayments);
        toast.error(res.error || 'Failed to submit payment.');
        return;
      }
      setPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? res.data : p))
      );
    } catch {
      setPayments(previousPayments);
      toast.error('Failed to submit payment. Rolled back.');
    } finally {
      setSubmittingPaymentId(null);
    }
  };

  // Delete draft payment (Optimistic UI)
  const handleDeleteDraft = async (paymentId: string) => {
    if (!window.confirm('Are you sure you want to delete this draft entry?')) {
      return;
    }

    const previousPayments = payments;

    // Immediate UI update
    setPayments((prev) => prev.filter((p) => p.id !== paymentId));
    toast.success('Draft payment deleted');

    setDeletingPaymentId(paymentId);
    try {
      const res = await deleteDraftPayment(paymentId);
      if (!res.success) {
        // Rollback on error
        setPayments(previousPayments);
        toast.error(res.error || 'Failed to delete draft payment.');
        return;
      }
    } catch {
      setPayments(previousPayments);
      toast.error('Failed to delete draft payment. Rolled back.');
    } finally {
      setDeletingPaymentId(null);
    }
  };

  // Preview an attached invoice file using signed URL
  const handleViewInvoiceFile = async (
    targetId: string,
    bucket: 'supplier-invoices' | 'bank-receipts',
    filePath: string
  ) => {
    setViewingFileId(targetId);
    try {
      const res = await getSignedFileUrl(bucket, filePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not open file preview.');
    } finally {
      setViewingFileId(null);
    }
  };

  // Filter payment items according to the active tab
  let filteredRows: PaymentItem[] = [];
  if (activeTab === 'PENDING_APPROVAL') {
    filteredRows = payments.filter(
      (p) => p.status === 'PENDING_APPROVAL' || p.status === 'ON_HOLD'
    );
  } else {
    filteredRows = payments.filter((p) => p.status === activeTab);
  }

  // Calculate sum of net payable for visible items
  const totalVisibleNet = filteredRows.reduce(
    (sum, p) => sum + Number(p.net_payable || 0),
    0
  );

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-12">
      {/* WORKSPACE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Payments Workspace
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Prepare payment entries, verify invoices, and submit for Owner approval.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/history">
            <button
              type="button"
              className="min-h-[44px] sm:min-h-[38px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-500" />
              <span>Print Form</span>
            </button>
          </Link>
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

      {/* SINGLE-ROW STATUS TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200/80 scrollbar-none">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap inline-flex items-center gap-2 transition-colors cursor-pointer ${
                isActive
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`tabular-nums text-[11px] px-1.5 py-0.2 rounded-full ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT: PAYMENTS TABLE / CARDS */}
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
                <Plus className="w-4 h-4" />
                <span>Create Draft Entry</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* DESKTOP TABLE VIEW (>= 768px) */}
            <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3.5">Date</th>
                    <th className="py-3 px-3.5">Vendor</th>
                    <th className="py-3 px-3.5">Invoice / Ref</th>
                    <th className="py-3 px-3.5">Purpose</th>
                    <th className="py-3 px-3.5 text-right">Net Payable</th>
                    <th className="py-3 px-3.5 text-center">Bank</th>
                    <th className="py-3 px-3.5 text-right w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((item) => {
                    const isSubmitting = submittingPaymentId === item.id;
                    const isDeleting = deletingPaymentId === item.id;
                    const isViewingFile = viewingFileId === item.id;

                    return (
                      <tr
                        key={item.id}
                        onClick={() => setDetailPayment(item)}
                        className="hover:bg-slate-50/60 transition-colors cursor-pointer group"
                      >
                        {/* 1. Date */}
                        <td className="py-3 px-3.5 tabular-nums text-slate-600 whitespace-nowrap">
                          {formatHumanDate(item.sheet_date)}
                        </td>

                        {/* 2. Vendor */}
                        <td className="py-3 px-3.5 font-medium text-slate-900 max-w-[180px] truncate">
                          {item.vendor?.name || 'Unknown Vendor'}
                        </td>

                        {/* 3. Invoice / Ref + File Link */}
                        <td className="py-3 px-3.5 tabular-nums text-slate-600 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-slate-700">
                              {item.invoice_ref}
                            </span>
                            {item.invoice_file_path && (
                              <button
                                type="button"
                                title="View attached invoice"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewInvoiceFile(
                                    item.id,
                                    'supplier-invoices',
                                    item.invoice_file_path!
                                  );
                                }}
                                disabled={isViewingFile}
                                className="text-slate-400 hover:text-blue-600 p-0.5 rounded cursor-pointer"
                              >
                                {isViewingFile ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                                ) : (
                                  <Paperclip className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 4. Purpose */}
                        <td className="py-3 px-3.5 text-slate-600 max-w-[160px] truncate">
                          {item.purpose}
                        </td>

                        {/* 5. Net Payable */}
                        <td className="py-3 px-3.5 text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                          {formatINR(item.net_payable)}
                        </td>

                        {/* 6. Bank */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          <BankBadge
                            shortName={item.source_bank?.short_name}
                            fullName={item.source_bank?.full_name}
                          />
                        </td>

                        {/* 7. Actions */}
                        <td
                          className="py-3 px-3.5 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            {/* DRAFT Actions: Edit, Delete, Submit */}
                            {item.status === 'DRAFT' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEditPayment(item)}
                                  title="Edit draft payment"
                                  className="h-8 w-8 p-0 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 inline-flex items-center justify-center transition-colors cursor-pointer"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDraft(item.id)}
                                  disabled={isDeleting}
                                  title="Delete draft payment"
                                  className="h-8 w-8 p-0 rounded-md border border-slate-200 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 inline-flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                  {isDeleting ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSubmitDraft(item.id)}
                                  disabled={isSubmitting}
                                  className="h-8 px-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                  {isSubmitting ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Send className="w-3 h-3" />
                                  )}
                                  <span>Submit</span>
                                </button>
                              </>
                            )}

                            {/* READY TO PAY (APPROVED) Action: Mark as Paid & Enter UTR */}
                            {item.status === 'APPROVED' && (
                              <button
                                type="button"
                                onClick={() => setUtrPayment(item)}
                                className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Mark Paid</span>
                              </button>
                            )}

                            {/* PAID Action: View UTR info */}
                            {item.status === 'PAID' && (
                              <button
                                type="button"
                                onClick={() => setDetailPayment(item)}
                                className="h-8 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-mono text-slate-700 inline-flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <span>UTR: {item.utr_number || 'View'}</span>
                              </button>
                            )}

                            {/* Other Statuses (PENDING, REJECTED): View Details */}
                            {item.status !== 'DRAFT' &&
                              item.status !== 'APPROVED' &&
                              item.status !== 'PAID' && (
                                <button
                                  type="button"
                                  onClick={() => setDetailPayment(item)}
                                  className="h-8 w-8 p-0 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 inline-flex items-center justify-center transition-colors cursor-pointer"
                                  title="View details"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50/80 border-t-2 border-slate-200 font-bold text-slate-900 text-xs">
                    <td colSpan={4} className="py-3 px-3.5 text-right uppercase tracking-wider text-[11px] text-slate-600">
                      Total ({tabs.find((t) => t.id === activeTab)?.label})
                    </td>
                    <td className="py-3 px-3.5 text-right tabular-nums text-slate-900 font-bold">
                      {formatINR(totalVisibleNet)}
                    </td>
                    <td colSpan={2} className="py-3 px-3.5 text-slate-400 font-normal">
                      {filteredRows.length} item{filteredRows.length === 1 ? '' : 's'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* MOBILE STACKED CARDS VIEW (< 768px) */}
            <div className="md:hidden space-y-2.5">
              {filteredRows.map((item) => {
                const isSubmitting = submittingPaymentId === item.id;
                const isDeleting = deletingPaymentId === item.id;

                return (
                  <div
                    key={item.id}
                    onClick={() => setDetailPayment(item)}
                    className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3 cursor-pointer active:scale-[0.99] transition-transform"
                  >
                    {/* Header Row: Vendor Name + Net Amount */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-900 truncate">
                          {item.vendor?.name || 'Unknown Vendor'}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-mono">
                          <span>{formatShortDate(item.sheet_date)}</span>
                          <span>•</span>
                          <span className="truncate">{item.invoice_ref}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-sm text-slate-900 tabular-nums">
                          {formatINR(item.net_payable)}
                        </div>
                        <div className="mt-0.5">
                          <PaymentStatusBadge status={item.status} />
                        </div>
                      </div>
                    </div>

                    {/* Purpose and Bank */}
                    <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                      <span className="truncate max-w-[200px]">{item.purpose}</span>
                      <BankBadge
                        shortName={item.source_bank?.short_name}
                        fullName={item.source_bank?.full_name}
                      />
                    </div>

                    {/* Mobile Action Buttons */}
                    <div
                      className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.status === 'DRAFT' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDeleteDraft(item.id)}
                            disabled={isDeleting}
                            className="min-h-[44px] px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditPayment(item)}
                            className="min-h-[44px] px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 flex items-center gap-1 cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSubmitDraft(item.id)}
                            disabled={isSubmitting}
                            className="flex-1 min-h-[44px] px-4 rounded-lg bg-slate-900 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {isSubmitting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>Submit for Approval</span>
                          </button>
                        </>
                      )}

                      {item.status === 'APPROVED' && (
                        <button
                          type="button"
                          onClick={() => setUtrPayment(item)}
                          className="w-full min-h-[44px] px-4 rounded-lg bg-emerald-600 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Mark Paid & Enter UTR</span>
                        </button>
                      )}

                      {item.status === 'PAID' && item.utr_number && (
                        <div className="w-full text-right text-xs font-mono text-slate-600">
                          UTR: <span className="font-semibold text-slate-900">{item.utr_number}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* PAYMENT ENTRY SLIDE-OVER DRAWER */}
      <PaymentFormSheet
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        vendors={vendors}
        banks={banks}
        editPayment={selectedEditPayment}
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
