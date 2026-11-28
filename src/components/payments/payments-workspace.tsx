'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Paperclip,
  Trash2,
  Send,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Edit2,
  Eye,
  Landmark,
  AlertTriangle,
  Clock,
  ArrowRight,
  Info,
  FileSpreadsheet,
  MessageCircle,
  Layers,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PaymentFormSheet } from '@/components/payments/payment-form-sheet';
import { PaymentDetailDrawer } from '@/components/payments/payment-detail-drawer';
import { MarkPaidModal } from '@/components/payments/mark-paid-modal';
import { BatchSettlementModal } from '@/components/payments/batch-settlement-modal';
import { PaymentAcknowledgementModal } from '@/components/payments/payment-acknowledgement-modal';
import { UpdateBalancesModal } from '@/components/payments/update-balances-modal';
import { ManageBanksModal } from '@/components/payments/manage-banks-modal';
import { BankExcelExportModal } from '@/components/payments/bank-excel-export-modal';
import { PaymentStatusBadge, BankBadge, PaymentModeBadge } from '@/components/payments/payment-status-badge';
import { PaymentUrlSync, usePaymentHighlight } from '@/components/layout/payment-url-sync';
import { deleteDraftPayment, submitPayment } from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { formatHumanDate, formatShortDate, formatINR } from '@/lib/format';
import type {
  Company,
  CompanyBank,
  PaymentItem,
  PaymentMode,
  PaymentPurpose,
  PaymentStatus,
  RecurringReminder,
  Vendor,
} from '@/types/database';

interface PaymentsWorkspaceProps {
  initialPayments: PaymentItem[];
  vendors: Vendor[];
  banks: CompanyBank[];
  reminders?: RecurringReminder[];
  initialPurposes?: PaymentPurpose[];
  companyCode?: string;
  activeCompany?: Company | null;
  currentUserName?: string;
  initialFromReminder?: {
    id: string;
    title: string;
    estimated_amount: number | null;
    vendor_id: string | null;
  } | null;
}

type PreparerTab =
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PAID'
  | 'REJECTED';

function isOverdue(dueDateStr: string, status: PaymentStatus): boolean {
  if (['PAID', 'REJECTED', 'CANCELLED'].includes(status)) return false;
  if (!dueDateStr) return false;
  const today = new Date().toISOString().split('T')[0];
  return dueDateStr < today;
}

export function PaymentsWorkspace({
  initialPayments,
  vendors: initialVendors,
  banks: initialBanks,
  reminders = [],
  initialPurposes = [],
  companyCode = 'INDFURN',
  activeCompany,
  currentUserName = 'Accounts Team',
  initialFromReminder,
}: PaymentsWorkspaceProps) {
  const router = useRouter();
  const [, startRefreshTransition] = React.useTransition();
  const refreshServerState = React.useCallback(() => {
    startRefreshTransition(() => {
      router.refresh();
    });
  }, [router]);

  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [vendors, setVendors] = React.useState<Vendor[]>(initialVendors);
  const [banks, setBanks] = React.useState<CompanyBank[]>(initialBanks);
  const [purposes, setPurposes] = React.useState<PaymentPurpose[]>(initialPurposes);

  // Active Tab: Defaults to DRAFT
  const [activeTab, setActiveTab] = React.useState<PreparerTab>('DRAFT');
  const [modeFilter, setModeFilter] = React.useState<'ALL' | PaymentMode>('ALL');

  // Ready-to-Pay Excel Export Selection State
  const [selectedApprovedIds, setSelectedApprovedIds] = React.useState<Set<string>>(new Set());
  const [isExcelModalOpen, setIsExcelModalOpen] = React.useState<boolean>(false);

  // Drawer & modal state
  const [isDrawerOpen, setIsDrawerOpen] = React.useState<boolean>(Boolean(initialFromReminder));
  const [isBalancesModalOpen, setIsBalancesModalOpen] = React.useState<boolean>(false);
  const [isManageBanksModalOpen, setIsManageBanksModalOpen] = React.useState<boolean>(false);
  const [selectedEditPayment, setSelectedEditPayment] = React.useState<PaymentItem | null>(null);
  const [detailPayment, setDetailPayment] = React.useState<PaymentItem | null>(null);
  const [utrPayment, setUtrPayment] = React.useState<PaymentItem | null>(null);
  const [advicePayment, setAdvicePayment] = React.useState<PaymentItem | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = React.useState<boolean>(false);

  // Action loading states
  const [submittingPaymentId, setSubmittingPaymentId] = React.useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = React.useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = React.useState<string | null>(null);

  const { highlightedId, triggerHighlight } = usePaymentHighlight();
  const paymentsRef = React.useRef(payments);
  paymentsRef.current = payments;

  const handleUrlParams = React.useCallback(
    ({ tab, highlightId }: { tab: string | null; highlightId: string | null }) => {
      const normalizedTab = tab?.toUpperCase() || null;
      if (normalizedTab === 'ON_HOLD') {
        setActiveTab('PENDING_APPROVAL');
      } else if (
        normalizedTab &&
        ['DRAFT', 'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED'].includes(
          normalizedTab
        )
      ) {
        setActiveTab(normalizedTab as PreparerTab);
      } else if (highlightId) {
        const target = paymentsRef.current.find((p) => p.id === highlightId);
        if (target) {
          if (target.status === 'ON_HOLD') {
            setActiveTab('PENDING_APPROVAL');
          } else if (
            ['DRAFT', 'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED'].includes(
              target.status
            )
          ) {
            setActiveTab(target.status as PreparerTab);
          }
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

  React.useEffect(() => {
    setVendors(initialVendors);
  }, [initialVendors]);

  React.useEffect(() => {
    setBanks(initialBanks);
  }, [initialBanks]);

  React.useEffect(() => {
    setPurposes(initialPurposes);
  }, [initialPurposes]);

  React.useEffect(() => {
    setSelectedApprovedIds(new Set());
  }, [activeTab]);

  const approvedItemsList = React.useMemo(
    () => payments.filter((p) => p.status === 'APPROVED'),
    [payments]
  );

  // Prune any selected IDs that are no longer in APPROVED after a live update
  React.useEffect(() => {
    const validIds = new Set(approvedItemsList.map((p) => p.id));
    setSelectedApprovedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [approvedItemsList]);

  const approvedBankGroups = React.useMemo(() => {
    const map = new Map<
      string,
      { bankId: string; label: string; itemIds: string[] }
    >();
    for (const p of approvedItemsList) {
      if (!p.source_bank_id) continue;
      const label =
        p.source_bank?.short_code ||
        p.source_bank?.short_name ||
        p.source_bank?.bank_name ||
        p.source_bank?.full_name ||
        'Bank';
      const existing = map.get(p.source_bank_id);
      if (existing) {
        existing.itemIds.push(p.id);
      } else {
        map.set(p.source_bank_id, {
          bankId: p.source_bank_id,
          label,
          itemIds: [p.id],
        });
      }
    }
    return Array.from(map.values());
  }, [approvedItemsList]);

  const toggleSelectBankApproved = (itemIds: string[]) => {
    const allSelected =
      itemIds.length > 0 && itemIds.every((id) => selectedApprovedIds.has(id));
    if (allSelected) {
      setSelectedApprovedIds(new Set());
    } else {
      setSelectedApprovedIds(new Set(itemIds));
    }
  };

  const toggleSelectApproved = (id: string) => {
    setSelectedApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllApproved = () => {
    if (selectedApprovedIds.size === approvedItemsList.length) {
      setSelectedApprovedIds(new Set());
    } else {
      setSelectedApprovedIds(new Set(approvedItemsList.map((p) => p.id)));
    }
  };

  const itemsForExcelModal = React.useMemo(() => {
    if (selectedApprovedIds.size > 0) {
      return approvedItemsList.filter((p) => selectedApprovedIds.has(p.id));
    }
    return approvedItemsList;
  }, [approvedItemsList, selectedApprovedIds]);

  // Tab live counts
  const draftCount = payments.filter((p) => p.status === 'DRAFT').length;
  const pendingVerificationCount = payments.filter(
    (p) => p.status === 'PENDING_VERIFICATION'
  ).length;
  const pendingApprovalCount = payments.filter(
    (p) => p.status === 'PENDING_APPROVAL' || p.status === 'ON_HOLD'
  ).length;
  const holdCount = payments.filter((p) => p.status === 'ON_HOLD').length;
  const approvedCount = payments.filter((p) => p.status === 'APPROVED').length;
  const paidCount = payments.filter((p) => p.status === 'PAID').length;
  const rejectedCount = payments.filter((p) => p.status === 'REJECTED').length;

  const tabs: Array<{ id: PreparerTab; label: string; count: number; badgeExtra?: React.ReactNode }> = [
    { id: 'DRAFT', label: 'Draft', count: draftCount },
    { id: 'PENDING_VERIFICATION', label: 'Pending Verification', count: pendingVerificationCount },
    {
      id: 'PENDING_APPROVAL',
      label: 'Pending Approval',
      count: pendingApprovalCount,
      badgeExtra:
        holdCount > 0 ? (
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
            {holdCount} on hold
          </span>
        ) : null,
    },
    { id: 'APPROVED', label: 'Ready to Pay (Pending UTR)', count: approvedCount },
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

    if (savedPayment.status === 'PENDING_VERIFICATION') {
      setActiveTab('PENDING_VERIFICATION');
    } else if (savedPayment.status === 'PENDING_APPROVAL') {
      setActiveTab('PENDING_APPROVAL');
    } else if (savedPayment.status === 'DRAFT') {
      setActiveTab('DRAFT');
    }
    refreshServerState();
  };

  // Submit draft payment directly from table row (Optimistic UI)
  const handleSubmitDraft = async (paymentId: string) => {
    const previousPayments = payments;

    setPayments((prev) =>
      prev.map((p) =>
        p.id === paymentId
          ? { ...p, status: 'PENDING_VERIFICATION', submitted_at: new Date().toISOString() }
          : p
      )
    );
    toast.success('Payment submitted for Senior Accountant verification.');

    setSubmittingPaymentId(paymentId);
    try {
      const res = await submitPayment(paymentId);
      if (!res.success) {
        setPayments(previousPayments);
        toast.error(res.error || 'Failed to submit payment.');
        return;
      }
      setPayments((prev) =>
        prev.map((p) => (p.id === paymentId ? res.data : p))
      );
      refreshServerState();
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
    setPayments((prev) => prev.filter((p) => p.id !== paymentId));
    toast.success('Draft payment deleted.');

    setDeletingPaymentId(paymentId);
    try {
      const res = await deleteDraftPayment(paymentId);
      if (!res.success) {
        setPayments(previousPayments);
        toast.error(res.error || 'Failed to delete draft payment.');
        return;
      }
      refreshServerState();
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

  // Filter payment items according to the active tab and mode filter
  const tabRows =
    activeTab === 'PENDING_APPROVAL'
      ? payments.filter(
          (p) => p.status === 'PENDING_APPROVAL' || p.status === 'ON_HOLD'
        )
      : payments.filter((p) => p.status === activeTab);

  const filteredRows =
    modeFilter === 'ALL'
      ? tabRows
      : tabRows.filter((p) => (p.payment_mode || 'NEFT_RTGS') === modeFilter);

  // Calculate sum of net payable for visible items
  const totalVisibleNet = filteredRows.reduce(
    (sum, p) => sum + Number(p.net_payable || 0),
    0
  );

  const activeBanks = banks.filter((b) => b.is_active);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 sm:space-y-5 pb-12">
      <PaymentUrlSync onParams={handleUrlParams} />
      {/* TOP BANK BALANCE STRIP & ACTION HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 min-w-0">
          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              Payments Ledger
            </h1>
            <span className="text-xs text-slate-400 font-medium">
              • Prepare, verify, and track disbursements
            </span>
          </div>

          {/* Live Bank Balance Pills */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            {activeBanks.map((b) => {
              const code = b.short_code || b.short_name || 'BANK';
              const bal = b.available_balance ?? 0;
              return (
                <div
                  key={b.id}
                  className="inline-flex items-center justify-between sm:justify-start gap-1.5 px-2.5 py-1.5 sm:py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs hover:border-slate-300 transition-colors min-w-0"
                  title={`Last updated: ${b.balance_updated_at ? formatHumanDate(b.balance_updated_at) : 'Not updated yet'}`}
                >
                  <span className="font-bold text-slate-700 shrink-0">{code}:</span>
                  <span className="font-bold text-slate-900 tabular-nums truncate">
                    {formatINR(bal)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => setIsBalancesModalOpen(true)}
            className="min-h-[40px] sm:min-h-[36px] flex-1 sm:flex-initial px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
          >
            <Landmark className="w-4 h-4 text-brand shrink-0" />
            <span>Update Balances</span>
          </button>

          <button
            type="button"
            onClick={() => setIsManageBanksModalOpen(true)}
            className="min-h-[40px] sm:min-h-[36px] flex-1 sm:flex-initial px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
          >
            <Settings2 className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Manage Banks</span>
          </button>

          <button
            type="button"
            onClick={handleOpenNewEntry}
            className="min-h-[40px] sm:min-h-[36px] flex-1 sm:flex-initial px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Entry</span>
          </button>
        </div>
      </div>

      {/* SINGLE-ROW STATUS TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1.5 border-b border-slate-200/80 scrollbar-none">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${isActive
                ? 'bg-brand text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
            >
              <span>{tab.label}</span>
              <span
                className={`tabular-nums text-[11px] px-1.5 py-0.2 rounded-full ${isActive
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200/80 text-slate-600'
                  }`}
              >
                {tab.count}
              </span>
              {tab.badgeExtra}
            </button>
          );
        })}
      </div>

      {/* MODE FILTER PILLS */}
      {tabRows.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-500 mr-1">Mode:</span>
          {(
            [
              { id: 'ALL', label: `All (${tabRows.length})` },
              {
                id: 'NEFT_RTGS',
                label: `NEFT / RTGS (${tabRows.filter((p) => (p.payment_mode || 'NEFT_RTGS') === 'NEFT_RTGS').length})`,
              },
              {
                id: 'IMPS',
                label: `IMPS (${tabRows.filter((p) => p.payment_mode === 'IMPS').length})`,
              },
              {
                id: 'CHEQUE',
                label: `Cheque (${tabRows.filter((p) => p.payment_mode === 'CHEQUE').length})`,
              },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setModeFilter(pill.id)}
              className={`min-h-[32px] px-2.5 py-1 rounded-full border text-[11px] font-semibold tabular-nums transition-colors cursor-pointer ${
                modeFilter === pill.id
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      )}

      {/* TAB CONTENT: PAYMENTS TABLE / CARDS */}
      <div>
        {filteredRows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <div className="text-sm font-semibold text-slate-900">
              No entries in &ldquo;{tabs.find((t) => t.id === activeTab)?.label}&rdquo;
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Payment items matching this lifecycle state will appear here.
            </p>
            {activeTab === 'DRAFT' && (
              <button
                type="button"
                onClick={handleOpenNewEntry}
                className="mt-4 px-4 py-2 rounded-lg bg-brand text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-brand-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Create Draft Entry</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* READY TO PAY: BATCH SETTLEMENT & BANK BULK EXCEL EXPORT TOOLBAR */}
            {activeTab === 'APPROVED' && (
              <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={
                        approvedItemsList.length > 0 &&
                        selectedApprovedIds.size === approvedItemsList.length
                      }
                      onChange={toggleSelectAllApproved}
                      className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand"
                    />
                    <span>Select All ({approvedItemsList.length})</span>
                  </label>

                  {approvedBankGroups.length >= 2 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {approvedBankGroups.map((group) => {
                        const isGroupActive =
                          group.itemIds.length > 0 &&
                          group.itemIds.every((id) =>
                            selectedApprovedIds.has(id)
                          ) &&
                          selectedApprovedIds.size === group.itemIds.length;
                        return (
                          <button
                            key={group.bankId}
                            type="button"
                            onClick={() =>
                              toggleSelectBankApproved(group.itemIds)
                            }
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                              isGroupActive
                                ? 'bg-brand-tint text-brand border-brand/40'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {group.label} ({group.itemIds.length})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <span className="text-xs text-slate-500">
                    {selectedApprovedIds.size > 0 ? (
                      <>
                        <strong className="text-slate-900">{selectedApprovedIds.size}</strong> selected ·{' '}
                        <strong className="text-slate-900 tabular-nums">
                          {formatINR(
                            itemsForExcelModal.reduce(
                              (sum, p) => sum + Number(p.net_payable || 0),
                              0
                            )
                          )}
                        </strong>
                      </>
                    ) : (
                      <span>Select payments to settle as a Day Batch or export Axis Excel</span>
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={approvedItemsList.length === 0}
                    onClick={() => setIsBatchModalOpen(true)}
                    className="min-h-[40px] sm:min-h-[38px] px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <Layers className="w-4 h-4" />
                    <span>
                      {selectedApprovedIds.size > 0
                        ? `Settle as Day Batch (${selectedApprovedIds.size})`
                        : `Settle Day Batch (All ${approvedItemsList.length})`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsExcelModalOpen(true)}
                    className="min-h-[40px] sm:min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>
                      Export Axis Excel
                      {selectedApprovedIds.size > 0 ? ` (${selectedApprovedIds.size})` : ''}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* DESKTOP 7-COLUMN TABLE VIEW (>= 768px) */}
            <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    {activeTab === 'APPROVED' && (
                      <th className="py-3 pl-3.5 pr-1 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all ready to pay items"
                          checked={
                            approvedItemsList.length > 0 &&
                            selectedApprovedIds.size === approvedItemsList.length
                          }
                          onChange={toggleSelectAllApproved}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer"
                        />
                      </th>
                    )}
                    <th className="py-3 px-3.5">Due Date / Sheet Date</th>
                    <th className="py-3 px-3.5">Party Name</th>
                    <th className="py-3 px-3.5">Invoice / Ref & Purpose</th>
                    <th className="py-3 px-3.5 text-right">Gross & TDS</th>
                    <th className="py-3 px-3.5 text-right">Net Payable</th>
                    <th className="py-3 px-3.5 text-center">Source Bank & Status</th>
                    <th className="py-3 px-3.5 text-right w-40">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((item) => {
                    const isSubmitting = submittingPaymentId === item.id;
                    const isDeleting = deletingPaymentId === item.id;
                    const isViewingFile = viewingFileId === item.id;
                    const overdue = isOverdue(item.due_date, item.status);
                    const vendorDisplayName =
                      item.vendor?.party_name || item.vendor?.name || 'Unknown Party';

                    return (
                      <tr
                        key={item.id}
                        data-payment-id={item.id}
                        onClick={() => setDetailPayment(item)}
                        className={`hover:bg-slate-50/60 transition-colors cursor-pointer group ${highlightedId === item.id
                          ? 'ring-2 ring-inset ring-brand bg-brand-tint/60 animate-pulse'
                          : activeTab === 'APPROVED' && selectedApprovedIds.has(item.id)
                            ? 'bg-brand/5'
                            : ''
                          }`}
                      >
                        {activeTab === 'APPROVED' && (
                          <td
                            className="py-3 pl-3.5 pr-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select payment for ${vendorDisplayName}`}
                              checked={selectedApprovedIds.has(item.id)}
                              onChange={() => toggleSelectApproved(item.id)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer"
                            />
                          </td>
                        )}
                        {/* 1. Due Date / Sheet Date */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="tabular-nums font-semibold text-slate-900">
                              {formatShortDate(item.due_date || item.sheet_date)}
                            </span>
                            {overdue && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 uppercase">
                                Overdue
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 tabular-nums">
                            Sheet: {formatShortDate(item.sheet_date)}
                          </div>
                        </td>

                        {/* 2. Party Name + Micro-tags */}
                        <td className="py-3 px-3.5 max-w-[200px]">
                          <div className="font-semibold text-slate-900 truncate">
                            {vendorDisplayName}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <PaymentModeBadge
                              mode={item.payment_mode}
                              chequeNumber={item.cheque_number}
                              compact
                            />
                            {item.vendor?.account_number && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                A/C: {item.vendor.account_number}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. Invoice / Ref & Purpose */}
                        <td className="py-3 px-3.5 max-w-[200px]">
                          <div className="flex items-center gap-1.5 font-mono text-slate-800 font-medium">
                            <span>{item.invoice_ref}</span>
                            {item.invoice_file_path && (
                              <button
                                type="button"
                                title="View attached bill"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewInvoiceFile(
                                    item.id,
                                    'supplier-invoices',
                                    item.invoice_file_path!
                                  );
                                }}
                                disabled={isViewingFile}
                                className="text-brand hover:underline p-0.5 rounded cursor-pointer"
                              >
                                {isViewingFile ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
                                ) : (
                                  <Paperclip className="w-3.5 h-3.5 text-brand" />
                                )}
                              </button>
                            )}
                          </div>
                          <div className="text-slate-500 truncate text-[11px] mt-0.5">
                            {item.purpose}
                          </div>
                        </td>

                        {/* 4. Gross & TDS */}
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

                        {/* 5. Net Payable */}
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="font-bold tabular-nums text-slate-900 text-sm">
                            {formatINR(item.net_payable)}
                          </div>
                        </td>

                        {/* 6. Source Bank & Status */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          <div className="flex flex-col items-center gap-1">
                            <BankBadge
                              shortName={item.source_bank?.short_code || item.source_bank?.short_name}
                              fullName={item.source_bank?.bank_name || item.source_bank?.full_name}
                            />
                            <PaymentStatusBadge status={item.status} />
                          </div>
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
                                  className="h-8 px-2.5 rounded-md bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                                  title="Submit for Senior Accountant verification"
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
                                className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Mark Paid</span>
                              </button>
                            )}

                            {/* REJECTED: Show tooltip / note */}
                            {item.status === 'REJECTED' && (
                              <div
                                className="flex items-center gap-1 text-xs text-rose-600 bg-rose-50 px-2 py-1 rounded border border-rose-200 max-w-[140px] truncate"
                                title={`Rejection reason: ${item.rejection_reason || 'No reason provided'}`}
                              >
                                <Info className="w-3 h-3 shrink-0" />
                                <span className="truncate">{item.rejection_reason || 'Rejected'}</span>
                              </div>
                            )}

                            {/* PAID Action: View UTR/Cheque info + Payment Advice / WhatsApp */}
                            {item.status === 'PAID' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setDetailPayment(item)}
                                  className="h-8 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-mono text-slate-700 inline-flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <span>
                                    {item.payment_mode === 'CHEQUE' && item.cheque_number
                                      ? `CHQ #${item.cheque_number}`
                                      : `UTR: ${item.utr_number || 'View'}`}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAdvicePayment(item)}
                                  className="h-8 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                                  title="Open Payment Advice & Share on WhatsApp"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  <span>Advice / WhatsApp</span>
                                </button>
                              </>
                            )}

                            {/* PENDING_VERIFICATION & PENDING_APPROVAL: View Details */}
                            {(item.status === 'PENDING_VERIFICATION' ||
                              item.status === 'PENDING_APPROVAL' ||
                              item.status === 'ON_HOLD') && (
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
                    <td
                      colSpan={activeTab === 'APPROVED' ? 5 : 4}
                      className="py-3 px-3.5 text-right uppercase tracking-wider text-[11px] text-slate-600"
                    >
                      Total ({tabs.find((t) => t.id === activeTab)?.label})
                    </td>
                    <td className="py-3 px-3.5 text-right tabular-nums text-slate-900 font-bold text-sm">
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
                const overdue = isOverdue(item.due_date, item.status);
                const vendorDisplayName =
                  item.vendor?.party_name || item.vendor?.name || 'Unknown Party';

                return (
                  <div
                    key={item.id}
                    data-payment-id={item.id}
                    onClick={() => setDetailPayment(item)}
                    className={`bg-white rounded-xl border p-4 shadow-sm space-y-3 cursor-pointer active:scale-[0.99] transition-all ${highlightedId === item.id
                      ? 'border-brand ring-2 ring-brand animate-pulse'
                      : 'border-slate-200'
                      }`}
                  >
                    {/* Header Row: Vendor Name + Net Amount */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex items-start gap-2.5">
                        {activeTab === 'APPROVED' && (
                          <input
                            type="checkbox"
                            aria-label={`Select payment for ${vendorDisplayName}`}
                            checked={selectedApprovedIds.has(item.id)}
                            onChange={() => toggleSelectApproved(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand shrink-0 cursor-pointer"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm text-slate-900 truncate">
                              {vendorDisplayName}
                            </span>
                            {overdue && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 uppercase">
                                Overdue
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-mono">
                            <span>Due: {formatShortDate(item.due_date || item.sheet_date)}</span>
                            <span>•</span>
                            <span className="truncate">{item.invoice_ref}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-sm text-slate-900 tabular-nums">
                          {formatINR(item.net_payable)}
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                          TDS: {item.tds > 0 ? formatINR(item.tds) : 'NA'}
                        </div>
                        <div className="mt-1">
                          <PaymentStatusBadge status={item.status} />
                        </div>
                      </div>
                    </div>

                    {/* Purpose and Bank */}
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                      <span className="truncate min-w-0 flex-1">{item.purpose}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <PaymentModeBadge mode={item.payment_mode} compact />
                        <BankBadge
                          shortName={item.source_bank?.short_code || item.source_bank?.short_name}
                          fullName={item.source_bank?.bank_name || item.source_bank?.full_name}
                        />
                      </div>
                    </div>

                    {/* Mobile Action Buttons */}
                    <div
                      className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100"
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
                            className="flex-1 min-h-[44px] px-4 rounded-lg bg-brand text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {isSubmitting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>Submit</span>
                          </button>
                        </>
                      )}

                      {item.status === 'APPROVED' && (
                        <button
                          type="button"
                          onClick={() => setUtrPayment(item)}
                          className="w-full min-h-[44px] px-4 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Mark Paid & Enter UTR</span>
                        </button>
                      )}

                      {item.status === 'PAID' && (
                        <div className="w-full flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-mono text-slate-600 truncate">
                            {item.payment_mode === 'CHEQUE' && item.cheque_number ? (
                              <>CHQ: <span className="font-semibold text-slate-900">#{item.cheque_number}</span></>
                            ) : (
                              <>UTR: <span className="font-semibold text-slate-900">{item.utr_number || 'Recorded'}</span></>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => setAdvicePayment(item)}
                            className="min-h-[40px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 shadow-sm cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>Advice / WhatsApp</span>
                          </button>
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

      {/* UPDATE LIVE BALANCES MODAL */}
      <UpdateBalancesModal
        open={isBalancesModalOpen}
        onOpenChange={setIsBalancesModalOpen}
        banks={activeBanks}
        onSuccess={(updated) => {
          const updatedMap = new Map(updated.map((b) => [b.id, b]));
          setBanks((prev) => prev.map((b) => updatedMap.get(b.id) || b));
          refreshServerState();
        }}
      />

      {/* MANAGE COMPANY BANKS MODAL (PREPARER + ADMIN) */}
      <ManageBanksModal
        open={isManageBanksModalOpen}
        onOpenChange={setIsManageBanksModalOpen}
        banks={banks}
        activeCompany={activeCompany}
        onBanksChange={setBanks}
      />

      {/* PAYMENT ENTRY SLIDE-OVER DRAWER */}
      <PaymentFormSheet
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        vendors={vendors}
        banks={activeBanks}
        reminders={reminders}
        purposes={purposes}
        onPurposesChange={setPurposes}
        editPayment={selectedEditPayment}
        initialFromReminder={initialFromReminder}
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
        activeCompany={activeCompany}
        fallbackUserName={currentUserName}
      />

      {/* MARK PAID / ENTER UTR MODAL */}
      <MarkPaidModal
        open={Boolean(utrPayment)}
        onOpenChange={(open) => {
          if (!open) setUtrPayment(null);
        }}
        payment={utrPayment}
        activeCompany={activeCompany}
        fallbackUserName={currentUserName}
        onSuccess={(paidItem) => {
          setPayments((prev) =>
            prev.map((p) => (p.id === paidItem.id ? paidItem : p))
          );
          setSelectedApprovedIds((prev) => {
            const next = new Set(prev);
            next.delete(paidItem.id);
            return next;
          });
          refreshServerState();
        }}
      />

      {/* BATCH SETTLEMENT MODAL */}
      <BatchSettlementModal
        open={isBatchModalOpen}
        onOpenChange={setIsBatchModalOpen}
        selectedItems={itemsForExcelModal}
        activeCompany={activeCompany}
        fallbackUserName={currentUserName}
        onSuccess={({ payments: settledItems }) => {
          const settledMap = new Map(settledItems.map((item) => [item.id, item]));
          setPayments((prev) =>
            prev.map((p) => settledMap.get(p.id) || p)
          );
          setSelectedApprovedIds((prev) => {
            const next = new Set(prev);
            for (const item of settledItems) {
              next.delete(item.id);
            }
            return next;
          });
          refreshServerState();
        }}
      />

      {/* STICKY MOBILE BATCH ACTION BAR */}
      {activeTab === 'APPROVED' && selectedApprovedIds.size > 0 && (
        <div className="md:hidden sticky bottom-3 z-20 mx-auto max-w-md rounded-xl border border-slate-200 bg-white/95 backdrop-blur px-3.5 py-2.5 shadow-lg flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900">
              {selectedApprovedIds.size} selected
            </p>
            <p className="text-[11px] font-semibold text-slate-500 tabular-nums">
              {formatINR(
                itemsForExcelModal.reduce(
                  (sum, p) => sum + Number(p.net_payable || 0),
                  0
                )
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsExcelModalOpen(true)}
              className="min-h-[40px] px-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBatchModalOpen(true)}
              className="min-h-[40px] px-3 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Settle Batch</span>
            </button>
          </div>
        </div>
      )}

      {/* PAYMENT ACKNOWLEDGEMENT / WHATSAPP MODAL */}
      <PaymentAcknowledgementModal
        open={Boolean(advicePayment)}
        onOpenChange={(open) => {
          if (!open) setAdvicePayment(null);
        }}
        payment={advicePayment}
        activeCompany={activeCompany}
        fallbackUserName={currentUserName}
      />

      {/* BANK BULK UPLOAD EXCEL EXPORT MODAL */}
      <BankExcelExportModal
        open={isExcelModalOpen}
        onOpenChange={setIsExcelModalOpen}
        readyToPayItems={itemsForExcelModal}
        banks={activeBanks}
        companyCode={companyCode}
        onProceedToBatch={(items) => {
          setIsExcelModalOpen(false);
          setSelectedApprovedIds(new Set(items.map((item) => item.id)));
          setIsBatchModalOpen(true);
        }}
      />
    </div>
  );
}
