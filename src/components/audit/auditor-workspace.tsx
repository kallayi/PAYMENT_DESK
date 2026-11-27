'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldCheck,
  Search,
  Calendar,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Clock,
  FileText,
  Receipt,
  CreditCard,
  AlertCircle,
  FilterX,
  Eye,
  Layers,
  Flag,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { BankBadge, PaymentModeBadge } from '@/components/payments/payment-status-badge';
import { markPaymentAudited } from '@/actions/payments';
import { auditPaymentBatch, auditSinglePayment } from '@/actions/audit';
import { getSignedFileUrl } from '@/actions/storage';
import {
  formatDateTime,
  formatHumanDate,
  formatINR,
  formatPaymentMode,
  formatShortDate,
} from '@/lib/format';
import type { CompanyBank, PaymentBatch, PaymentItem } from '@/types/database';

interface AuditorWorkspaceProps {
  initialPayments: PaymentItem[];
  initialBatches?: PaymentBatch[];
  banks: CompanyBank[];
  companyName: string;
  canAudit: boolean;
  currentAuditorName: string;
}

type AuditTab = 'UNAUDITED' | 'AUDITED' | 'ALL';
type DatePreset = 'ALL_TIME' | 'LAST_7_DAYS' | 'THIS_MONTH' | 'CUSTOM';

function isPdfUrl(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  return filePath.toLowerCase().split('?')[0].endsWith('.pdf');
}

export function AuditorWorkspace({
  initialPayments,
  initialBatches = [],
  banks,
  companyName,
  canAudit,
  currentAuditorName,
}: AuditorWorkspaceProps) {
  const router = useRouter();
  const [, startRefreshTransition] = React.useTransition();
  const refreshServerState = React.useCallback(() => {
    startRefreshTransition(() => {
      router.refresh();
    });
  }, [router]);

  const searchParams = useSearchParams();
  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const [batches, setBatches] = React.useState<PaymentBatch[]>(initialBatches);
  const [activeTab, setActiveTab] = React.useState<AuditTab>('UNAUDITED');

  // Filter states
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [bankFilter, setBankFilter] = React.useState<string>('ALL');
  const [datePreset, setDatePreset] = React.useState<DatePreset>('ALL_TIME');
  const [dateFrom, setDateFrom] = React.useState<string>('');
  const [dateTo, setDateTo] = React.useState<string>('');

  // Side-by-side Single Drawer states
  const [reviewPayment, setReviewPayment] = React.useState<PaymentItem | null>(null);
  const [mobileDrawerTab, setMobileDrawerTab] = React.useState<'VOUCHER' | 'PROOF'>('VOUCHER');
  const [proofSignedUrl, setProofSignedUrl] = React.useState<string | null>(null);
  const [isLoadingProof, setIsLoadingProof] = React.useState<boolean>(false);
  const [proofError, setProofError] = React.useState<string | null>(null);
  const [isOpeningInvoice, setIsOpeningInvoice] = React.useState<boolean>(false);
  const [isAuditing, setIsAuditing] = React.useState<boolean>(false);

  // Side-by-side Batch Compare Drawer states
  const [reviewBatch, setReviewBatch] = React.useState<PaymentBatch | null>(null);
  const [batchDrawerTab, setBatchDrawerTab] = React.useState<'LIST' | 'PROOF'>('LIST');
  const [batchProofUrl, setBatchProofUrl] = React.useState<string | null>(null);
  const [isLoadingBatchProof, setIsLoadingBatchProof] = React.useState<boolean>(false);
  const [batchProofError, setBatchProofError] = React.useState<string | null>(null);
  const [isAuditingBatchId, setIsAuditingBatchId] = React.useState<string | null>(null);
  const [flaggingBatchOpen, setFlaggingBatchOpen] = React.useState<boolean>(false);
  const [batchFlagNote, setBatchFlagNote] = React.useState<string>('');
  const [rowFlagTargetId, setRowFlagTargetId] = React.useState<string | null>(null);
  const [rowFlagNote, setRowFlagNote] = React.useState<string>('');
  const [auditingRowId, setAuditingRowId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  React.useEffect(() => {
    setBatches(initialBatches);
  }, [initialBatches]);

  // Deep-link ?batch=<uuid> opens Side-by-Side Batch Compare drawer automatically
  const deepLinkedBatchId = searchParams.get('batch');
  const handledDeepLinkRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!deepLinkedBatchId || handledDeepLinkRef.current === deepLinkedBatchId) {
      return;
    }
    const target = batches.find((b) => b.id === deepLinkedBatchId);
    if (target) {
      handledDeepLinkRef.current = deepLinkedBatchId;
      setActiveTab('ALL');
      setReviewBatch(target);
    }
  }, [deepLinkedBatchId, batches]);

  // Fetch 15-minute signed URL for Combined Batch Bank Proof
  React.useEffect(() => {
    if (!reviewBatch) {
      setBatchProofUrl(null);
      setBatchProofError(null);
      setFlaggingBatchOpen(false);
      setBatchFlagNote('');
      setRowFlagTargetId(null);
      setRowFlagNote('');
      return;
    }

    setBatchDrawerTab('LIST');
    if (!reviewBatch.receipt_file_path) {
      setBatchProofUrl(null);
      setBatchProofError('No combined receipt file attached to this batch.');
      return;
    }

    let isMounted = true;
    setIsLoadingBatchProof(true);
    setBatchProofError(null);

    getSignedFileUrl('bank-receipts', reviewBatch.receipt_file_path)
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setBatchProofUrl(res.data.signedUrl);
        } else {
          setBatchProofError(res.error || 'Failed to load combined bank proof.');
          setBatchProofUrl(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setBatchProofError('Network error generating signed URL.');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingBatchProof(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reviewBatch]);

  // Fetch 15-minute signed URL for Bank Proof automatically when review drawer opens
  React.useEffect(() => {
    if (!reviewPayment) {
      setProofSignedUrl(null);
      setProofError(null);
      return;
    }

    setMobileDrawerTab('VOUCHER');

    if (!reviewPayment.receipt_file_path) {
      setProofSignedUrl(null);
      setProofError(null);
      return;
    }

    let isMounted = true;
    setIsLoadingProof(true);
    setProofError(null);

    getSignedFileUrl('bank-receipts', reviewPayment.receipt_file_path)
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setProofSignedUrl(res.data.signedUrl);
        } else {
          setProofError(res.error || 'Failed to load Bank Acknowledgement proof.');
          setProofSignedUrl(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProofError('Network error generating signed URL.');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingProof(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reviewPayment]);

  // Tab counts & totals
  const unauditedItems = React.useMemo(
    () => payments.filter((p) => !p.audited_at),
    [payments]
  );
  const auditedItems = React.useMemo(
    () => payments.filter((p) => Boolean(p.audited_at)),
    [payments]
  );

  // Date preset resolver
  const getEffectiveDateRange = React.useCallback((): { from: string; to: string } => {
    const today = new Date();
    const todayIso = today.toISOString().split('T')[0];

    if (datePreset === 'LAST_7_DAYS') {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString().split('T')[0], to: todayIso };
    }
    if (datePreset === 'THIS_MONTH') {
      const startOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      return { from: startOfMonth, to: todayIso };
    }
    if (datePreset === 'CUSTOM') {
      return { from: dateFrom, to: dateTo };
    }
    return { from: '', to: '' };
  }, [datePreset, dateFrom, dateTo]);

  // Filtered rows
  const filteredRows = React.useMemo(() => {
    const { from, to } = getEffectiveDateRange();
    const q = searchQuery.trim().toLowerCase();

    return payments
      .filter((p) => {
        if (activeTab === 'UNAUDITED') return !p.audited_at;
        if (activeTab === 'AUDITED') return Boolean(p.audited_at);
        return true;
      })
      .filter((p) => {
        if (bankFilter !== 'ALL' && p.source_bank_id !== bankFilter) return false;

        const paidDateOnly = p.paid_at ? p.paid_at.split('T')[0] : p.sheet_date;
        if (from && paidDateOnly < from) return false;
        if (to && paidDateOnly > to) return false;

        if (!q) return true;
        const party = (p.vendor?.party_name || p.vendor?.name || '').toLowerCase();
        const beneficiary = (p.vendor?.beneficiary_name || '').toLowerCase();
        const ref = (p.invoice_ref || '').toLowerCase();
        const utr = (p.utr_number || '').toLowerCase();
        const chq = (p.cheque_number || '').toLowerCase();
        return (
          party.includes(q) ||
          beneficiary.includes(q) ||
          ref.includes(q) ||
          utr.includes(q) ||
          chq.includes(q)
        );
      });
  }, [payments, activeTab, bankFilter, searchQuery, getEffectiveDateRange]);

  const filteredTotal = filteredRows.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  const unauditedTotal = unauditedItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );
  const auditedTotal = auditedItems.reduce(
    (sum, p) => sum + (Number(p.net_payable) || 0),
    0
  );

  // Batch items lookup map & derived batch audit state
  const itemsByBatchId = React.useMemo(() => {
    const map = new Map<string, PaymentItem[]>();
    for (const p of payments) {
      if (!p.batch_id) continue;
      const arr = map.get(p.batch_id) || [];
      arr.push(p);
      map.set(p.batch_id, arr);
    }
    return map;
  }, [payments]);

  const getBatchDerivedState = React.useCallback(
    (batch: PaymentBatch) => {
      const children = itemsByBatchId.get(batch.id) || [];
      const auditedCount = children.filter(
        (c) => c.audit_status === 'AUDITED' || Boolean(c.audited_at)
      ).length;
      const flaggedCount = children.filter(
        (c) => c.audit_status === 'FLAGGED'
      ).length;

      let state: 'AUDITED' | 'FLAGGED' | 'PARTIAL' | 'PENDING' = 'PENDING';
      if (batch.audit_status === 'FLAGGED' || flaggedCount > 0) {
        state = 'FLAGGED';
      } else if (
        batch.audit_status === 'AUDITED' ||
        (children.length > 0 && auditedCount === children.length)
      ) {
        state = 'AUDITED';
      } else if (auditedCount > 0) {
        state = 'PARTIAL';
      }

      return { children, auditedCount, flaggedCount, state };
    },
    [itemsByBatchId]
  );

  const filteredBatches = React.useMemo(() => {
    const { from, to } = getEffectiveDateRange();
    const q = searchQuery.trim().toLowerCase();

    return batches.filter((batch) => {
      const { children, state } = getBatchDerivedState(batch);
      if (activeTab === 'UNAUDITED' && state === 'AUDITED') return false;
      if (activeTab === 'AUDITED' && state !== 'AUDITED') return false;

      if (bankFilter !== 'ALL') {
        const bankMatches =
          batch.source_bank_id === bankFilter ||
          children.some((c) => c.source_bank_id === bankFilter);
        if (!bankMatches) return false;
      }

      if (from && batch.batch_date < from) return false;
      if (to && batch.batch_date > to) return false;

      if (!q) return true;
      if ((batch.batch_code || '').toLowerCase().includes(q)) return true;
      if ((batch.notes || '').toLowerCase().includes(q)) return true;
      return children.some((c) => {
        const party = (c.vendor?.party_name || c.vendor?.name || '').toLowerCase();
        const utr = (c.utr_number || '').toLowerCase();
        const chq = (c.cheque_number || '').toLowerCase();
        const ref = (c.invoice_ref || '').toLowerCase();
        return (
          party.includes(q) ||
          utr.includes(q) ||
          chq.includes(q) ||
          ref.includes(q)
        );
      });
    });
  }, [batches, activeTab, bankFilter, searchQuery, getEffectiveDateRange, getBatchDerivedState]);

  const handleBatchAudit = async (
    batch: PaymentBatch,
    status: 'AUDITED' | 'FLAGGED',
    note?: string
  ) => {
    if (!canAudit) return;
    setIsAuditingBatchId(batch.id);
    try {
      const res = await auditPaymentBatch({
        batchId: batch.id,
        status,
        note: note?.trim() || undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      const updatedBatch = res.data.batch;
      const updatedMap = new Map(res.data.payments.map((item) => [item.id, item]));

      setBatches((prev) =>
        prev.map((b) => (b.id === updatedBatch.id ? updatedBatch : b))
      );
      setPayments((prev) =>
        prev.map((p) => updatedMap.get(p.id) || p)
      );
      setReviewBatch((prev) =>
        prev && prev.id === updatedBatch.id ? updatedBatch : prev
      );
      setFlaggingBatchOpen(false);
      setBatchFlagNote('');

      toast.success(
        status === 'AUDITED'
          ? `Batch ${updatedBatch.batch_code} marked Audited ✓`
          : `Batch ${updatedBatch.batch_code} flagged with note`
      );
      refreshServerState();
    } catch {
      toast.error('Network error while updating batch audit status.');
    } finally {
      setIsAuditingBatchId(null);
    }
  };

  const handleBatchItemAudit = async (
    paymentId: string,
    status: 'AUDITED' | 'FLAGGED',
    note?: string
  ) => {
    if (!canAudit) return;
    setAuditingRowId(paymentId);
    try {
      const res = await auditSinglePayment({
        paymentId,
        status,
        note: note?.trim() || undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      setPayments((prev) =>
        prev.map((p) => (p.id === res.data.payment.id ? res.data.payment : p))
      );
      if (res.data.batch) {
        const synced = res.data.batch;
        setBatches((prev) =>
          prev.map((b) => (b.id === synced.id ? synced : b))
        );
        setReviewBatch((prev) =>
          prev && prev.id === synced.id ? synced : prev
        );
      }

      setRowFlagTargetId(null);
      setRowFlagNote('');
      toast.success(
        status === 'AUDITED' ? 'Item stamped Audited ✓' : 'Item flagged with note'
      );
      refreshServerState();
    } catch {
      toast.error('Network error while updating item audit status.');
    } finally {
      setAuditingRowId(null);
    }
  };

  // Mark Audited handler (Optimistic UI + Rollback)
  const handleMarkAudited = async (payment: PaymentItem) => {
    if (!canAudit || payment.audited_at) return;

    const previousPayments = payments;
    const previousReview = reviewPayment;
    const nowIso = new Date().toISOString();

    const optimisticUpdated: PaymentItem = {
      ...payment,
      audited_at: nowIso,
      auditor: {
        id: 'optimistic',
        full_name: currentAuditorName,
        role: 'AUDITOR',
        is_admin: false,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      },
    };

    setPayments((prev) =>
      prev.map((p) => (p.id === payment.id ? optimisticUpdated : p))
    );
    setReviewPayment(optimisticUpdated);
    setIsAuditing(true);

    try {
      const res = await markPaymentAudited(payment.id);
      if (!res.success) {
        setPayments(previousPayments);
        setReviewPayment(previousReview);
        toast.error(res.error || 'Failed to stamp payment as audited.');
        return;
      }

      setPayments((prev) =>
        prev.map((p) => (p.id === payment.id ? res.data : p))
      );
      setReviewPayment(res.data);
      toast.success(
        `Stamped as Audited (${payment.vendor?.party_name || payment.vendor?.name})`
      );
      refreshServerState();
    } catch {
      setPayments(previousPayments);
      setReviewPayment(previousReview);
      toast.error('Network error while marking audited. Rolled back.');
    } finally {
      setIsAuditing(false);
    }
  };

  // Open optional Supplier Invoice signed URL
  const handleOpenInvoice = async (filePath: string) => {
    setIsOpeningInvoice(true);
    try {
      const res = await getSignedFileUrl('supplier-invoices', filePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not open supplier invoice.');
    } finally {
      setIsOpeningInvoice(false);
    }
  };

  const hasFilters =
    Boolean(searchQuery) || bankFilter !== 'ALL' || datePreset !== 'ALL_TIME';

  const resetFilters = () => {
    setSearchQuery('');
    setBankFilter('ALL');
    setDatePreset('ALL_TIME');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-12">
      {/* HEADER (Strictly Read-Only Financial Interface) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Audit Workspace — {companyName}
            </h1>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
              Read-Only Verification
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Inspect completed disbursements side-by-side with Bank Acknowledgement PDFs and stamp immutable audit sign-off.
          </p>
        </div>
      </div>

      {/* AUDIT SUMMARY STRIP */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          onClick={() => setActiveTab('UNAUDITED')}
          className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm flex items-center justify-between cursor-pointer hover:border-amber-300 transition-colors"
        >
          <div>
            <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
              Pending Audit (Unaudited)
            </p>
            <p className="text-lg font-bold text-amber-900 tabular-nums mt-0.5">
              {formatINR(unauditedTotal)}
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              {unauditedItems.length} paid transaction{unauditedItems.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-100 text-amber-700">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div
          onClick={() => setActiveTab('AUDITED')}
          className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-sm flex items-center justify-between cursor-pointer hover:border-emerald-300 transition-colors"
        >
          <div>
            <p className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">
              Audited & Sealed
            </p>
            <p className="text-lg font-bold text-emerald-900 tabular-nums mt-0.5">
              {formatINR(auditedTotal)}
            </p>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              {auditedItems.length} verified record{auditedItems.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-100 text-emerald-700">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Filtered View Total
            </p>
            <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {formatINR(filteredTotal)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {filteredRows.length} item{filteredRows.length === 1 ? '' : 's'} displayed
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-100 text-slate-600">
            <Eye className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* STATUS TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1.5 border-b border-slate-200/80 scrollbar-none">
        {(
          [
            { id: 'UNAUDITED', label: 'Unaudited', count: unauditedItems.length },
            { id: 'AUDITED', label: 'Audited', count: auditedItems.length },
            { id: 'ALL', label: 'All Paid', count: payments.length },
          ] as Array<{ id: AuditTab; label: string; count: number }>
        ).map((tab) => {
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
                className={`tabular-nums text-[11px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-600'
                  }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* FILTERS BAR */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {/* Vendor / UTR / Cheque Search */}
          <div className="sm:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search party, beneficiary, invoice #, or UTR / Cheque..."
              className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50/70 focus:bg-white text-xs text-slate-900 outline-none focus:border-brand"
            />
          </div>

          {/* Bank Filter */}
          <div className="sm:col-span-3">
            <select
              value={bankFilter}
              onChange={(e) => setBankFilter(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-brand"
            >
              <option value="ALL">All Source Banks</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bank_name || b.full_name} ({b.short_code || b.short_name})
                </option>
              ))}
            </select>
          </div>

          {/* Date Presets */}
          <div className="sm:col-span-4 flex items-center gap-1.5 flex-wrap">
            {(
              [
                { id: 'ALL_TIME', label: 'All Time' },
                { id: 'LAST_7_DAYS', label: 'Last 7 Days' },
                { id: 'THIS_MONTH', label: 'This Month' },
                { id: 'CUSTOM', label: 'Custom' },
              ] as Array<{ id: DatePreset; label: string }>
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setDatePreset(preset.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${datePreset === preset.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Range Inputs */}
        {datePreset === 'CUSTOM' && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-medium">Paid Date:</span>
            <div className="w-[155px]">
              <DatePicker
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="From date"
                size="sm"
                allowClear
              />
            </div>
            <span className="text-slate-400">to</span>
            <div className="w-[155px]">
              <DatePicker
                value={dateTo}
                onChange={setDateTo}
                placeholder="To date"
                size="sm"
                allowClear
              />
            </div>
          </div>
        )}

        {hasFilters && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
            >
              <FilterX className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>
        )}
      </div>

      {/* DAY BATCH AUDIT CARDS (COMBINED BANK PDF COMPARE) */}
      {filteredBatches.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-brand" />
              <h2 className="text-sm font-bold text-slate-900">
                Day Settlement Batches ({filteredBatches.length})
              </h2>
            </div>
            <span className="text-[11px] text-slate-500">
              Compare all batch payments side-by-side against the combined Bank PDF
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredBatches.map((batch) => {
              const { children, auditedCount, state } = getBatchDerivedState(batch);
              const isBusy = isAuditingBatchId === batch.id;

              return (
                <div
                  key={batch.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col justify-between gap-3 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
                          {batch.batch_code}
                        </span>
                        {state === 'AUDITED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                            <ShieldCheck className="w-3 h-3" />
                            <span>Audited ✓</span>
                          </span>
                        ) : state === 'FLAGGED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                            <Flag className="w-3 h-3" />
                            <span>Flagged</span>
                          </span>
                        ) : state === 'PARTIAL' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
                            <Clock className="w-3 h-3" />
                            <span>
                              Partially Audited ({auditedCount}/{children.length || batch.item_count})
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3" />
                            <span>Pending Audit</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                        <span className="font-medium tabular-nums">
                          {formatHumanDate(batch.batch_date)}
                        </span>
                        <span>·</span>
                        <span>
                          {children.length || batch.item_count} payment
                          {(children.length || batch.item_count) === 1 ? '' : 's'}
                        </span>
                        {batch.source_bank && (
                          <>
                            <span>·</span>
                            <BankBadge
                              shortName={
                                batch.source_bank.short_code ||
                                batch.source_bank.short_name
                              }
                              fullName={
                                batch.source_bank.bank_name ||
                                batch.source_bank.full_name
                              }
                            />
                          </>
                        )}
                      </div>

                      {batch.notes && (
                        <p className="text-[11px] text-slate-500 line-clamp-1">
                          {batch.notes}
                        </p>
                      )}
                      {state === 'FLAGGED' && batch.audit_note && (
                        <p className="text-[11px] text-rose-700 font-medium line-clamp-1">
                          Flag Note: {batch.audit_note}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                        Batch Total
                      </span>
                      <span className="text-base font-bold text-slate-900 tabular-nums">
                        {formatINR(batch.total_amount)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
                    <span className="text-[11px] text-slate-400 truncate">
                      Settled by {batch.creator?.full_name || 'Accounts'}
                    </span>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setReviewBatch(batch)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Compare Bank PDF</span>
                      </button>

                      {canAudit && state !== 'AUDITED' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleBatchAudit(batch, 'AUDITED')}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          )}
                          <span>Mark Entire Batch Audited ✓</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AUDIT TABLE / CARDS */}
      {filteredRows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-900">
            {activeTab === 'UNAUDITED' && payments.length > 0
              ? 'All paid transactions have been audited!'
              : 'No paid transactions match your filters'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Click any paid payment row to open the side-by-side digital voucher and bank proof viewer.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5">Paid Date</th>
                  <th className="py-3 px-3.5">Party & Beneficiary</th>
                  <th className="py-3 px-3.5">Invoice & Purpose</th>
                  <th className="py-3 px-3.5">UTR / Cheque Ref</th>
                  <th className="py-3 px-3.5 text-right">Net Payable</th>
                  <th className="py-3 px-3.5 text-center">Bank</th>
                  <th className="py-3 px-3.5 text-center">Audit Status</th>
                  <th className="py-3 px-3.5 text-right">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((item) => {
                  const partyName = item.vendor?.party_name || item.vendor?.name || 'Unknown Party';
                  const beneficiary = item.vendor?.beneficiary_name || partyName;
                  const paidDateStr = item.paid_at ? item.paid_at.split('T')[0] : item.sheet_date;
                  const isAudited = Boolean(item.audited_at);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setReviewPayment(item)}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-900 tabular-nums">
                          {formatShortDate(paidDateStr)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Sheet: {formatShortDate(item.sheet_date)}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 max-w-[210px]">
                        <div className="font-semibold text-slate-900 truncate">{partyName}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          A/C Holder: {beneficiary}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 max-w-[180px]">
                        <div className="font-mono text-slate-800 font-medium truncate">
                          {item.invoice_ref}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-slate-500 truncate">
                            {item.purpose}
                          </span>
                          {item.batch_id && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const targetBatch = batches.find(
                                  (b) => b.id === item.batch_id
                                );
                                if (targetBatch) setReviewBatch(targetBatch);
                              }}
                              className="px-1.5 py-0.5 rounded bg-brand-tint text-brand font-mono text-[10px] font-semibold shrink-0 hover:bg-brand/15 cursor-pointer"
                              title="Compare inside Batch PDF Drawer"
                            >
                              {item.batch?.batch_code || 'Batch'}
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
                        {item.payment_mode === 'CHEQUE' ? (
                          <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                            CHQ #{item.cheque_number || 'NA'}
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                            {item.utr_number || '—'}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <div className="font-bold text-slate-900 tabular-nums text-sm">
                          {formatINR(item.net_payable)}
                        </div>
                        <div className="text-[10px] text-slate-400 tabular-nums">
                          {item.tds > 0 ? `TDS: ${formatINR(item.tds)}` : 'TDS: NA'}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 text-center">
                        <BankBadge
                          shortName={item.source_bank?.short_code || item.source_bank?.short_name}
                          fullName={item.source_bank?.bank_name || item.source_bank?.full_name}
                        />
                      </td>

                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        {isAudited ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                            <ShieldCheck className="w-3 h-3" />
                            <span>Audited</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3" />
                            <span>Unaudited</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReviewPayment(item);
                          }}
                          className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5 text-brand" />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2.5">
            {filteredRows.map((item) => {
              const partyName = item.vendor?.party_name || item.vendor?.name || 'Unknown Party';
              const isAudited = Boolean(item.audited_at);
              return (
                <div
                  key={item.id}
                  onClick={() => setReviewPayment(item)}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-2 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-slate-900 truncate">{partyName}</div>
                      <div className="text-xs text-slate-500 font-mono">
                        {item.payment_mode === 'CHEQUE'
                          ? `CHQ #${item.cheque_number || 'NA'}`
                          : `UTR: ${item.utr_number || '—'}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-sm text-slate-900 tabular-nums">
                        {formatINR(item.net_payable)}
                      </div>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isAudited
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                          }`}
                      >
                        {isAudited ? 'Audited' : 'Unaudited'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WIDE SIDE-BY-SIDE AUDIT DRAWER */}
      <Sheet
        open={Boolean(reviewPayment)}
        onOpenChange={(open) => {
          if (!open) setReviewPayment(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-5xl p-0 flex flex-col bg-white overflow-hidden shadow-2xl"
        >
          {reviewPayment && (
            <>
              {/* DRAWER TOP HEADER */}
              <SheetHeader className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 shrink-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pr-8">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase tracking-wider text-brand">
                        Side-by-Side Audit Voucher
                      </span>
                      {reviewPayment.audited_at ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Audited & Immutable</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Pending Audit Sign-Off</span>
                        </span>
                      )}
                    </div>
                    <SheetTitle className="text-sm sm:text-lg font-bold text-slate-900 mt-1 break-words">
                      {reviewPayment.vendor?.party_name || reviewPayment.vendor?.name} —{' '}
                      <span className="tabular-nums">{formatINR(reviewPayment.net_payable)}</span>
                    </SheetTitle>
                  </div>

                  {/* Mobile Tab Switcher */}
                  <div className="flex md:hidden rounded-lg bg-slate-200/80 p-0.5 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setMobileDrawerTab('VOUCHER')}
                      className={`flex-1 min-h-[36px] py-1.5 px-3 rounded-md text-xs font-semibold transition-colors ${mobileDrawerTab === 'VOUCHER'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600'
                        }`}
                    >
                      Digital Voucher
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileDrawerTab('PROOF')}
                      className={`flex-1 min-h-[36px] py-1.5 px-3 rounded-md text-xs font-semibold transition-colors ${mobileDrawerTab === 'PROOF'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600'
                        }`}
                    >
                      Bank Proof PDF
                    </button>
                  </div>
                </div>
              </SheetHeader>

              {/* TWO-COLUMN SIDE-BY-SIDE BODY */}
              <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 md:grid-cols-12">
                {/* LEFT COLUMN: DIGITAL PAYMENT VOUCHER */}
                <div
                  className={`md:col-span-5 h-full overflow-y-auto p-4 sm:p-5 md:border-r border-slate-200 space-y-4 sm:space-y-5 ${mobileDrawerTab === 'VOUCHER' ? 'block' : 'hidden md:block'
                    }`}
                >
                  {/* Beneficiary & Financial Breakdown */}
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs overflow-hidden">
                    <div className="px-3.5 py-2.5 bg-slate-50 font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                      Beneficiary & Voucher Details
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Party Name</span>
                      <span className="font-semibold text-slate-900 text-right">
                        {reviewPayment.vendor?.party_name || reviewPayment.vendor?.name}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Bank Beneficiary</span>
                      <span className="font-semibold text-slate-900 text-right">
                        {reviewPayment.vendor?.beneficiary_name ||
                          reviewPayment.vendor?.party_name ||
                          reviewPayment.vendor?.name}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">A/C & IFSC</span>
                      <span className="font-mono text-slate-800 text-right">
                        {reviewPayment.vendor?.account_number || 'NA'} ·{' '}
                        {reviewPayment.vendor?.ifsc_code || 'NA'}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Invoice / Ref No</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {reviewPayment.invoice_ref}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Due Date / Sheet Date</span>
                      <span className="tabular-nums text-slate-800">
                        {formatHumanDate(reviewPayment.due_date)} (Sheet:{' '}
                        {formatShortDate(reviewPayment.sheet_date)})
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Purpose</span>
                      <span className="font-medium text-slate-900 text-right">
                        {reviewPayment.purpose}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Disbursement Mode</span>
                      <span className="font-medium text-slate-900 text-right">
                        {formatPaymentMode(reviewPayment.payment_mode)}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Gross / TDS</span>
                      <span className="tabular-nums text-slate-800">
                        {formatINR(reviewPayment.amount)} /{' '}
                        {reviewPayment.tds > 0 ? formatINR(reviewPayment.tds) : 'NA'}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex justify-between gap-2 bg-slate-50/70">
                      <span className="font-bold text-slate-700">Net Payable</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatINR(reviewPayment.net_payable)}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 flex justify-between gap-2">
                      <span className="text-slate-500">Source Bank & Mode</span>
                      <span className="font-semibold text-slate-900 text-right">
                        {reviewPayment.source_bank?.bank_name ||
                          reviewPayment.source_bank?.full_name}{' '}
                        ({formatPaymentMode(reviewPayment.payment_mode, true)})
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 flex justify-between gap-2 bg-emerald-50/40">
                      <span className="font-semibold text-emerald-900">
                        {reviewPayment.payment_mode === 'CHEQUE'
                          ? 'Cheque No & Date'
                          : 'UTR / Reference No'}
                      </span>
                      <span className="font-mono font-bold text-emerald-800">
                        {reviewPayment.payment_mode === 'CHEQUE'
                          ? `#${reviewPayment.cheque_number || 'NA'} (${formatHumanDate(
                            reviewPayment.cheque_date
                          )})`
                          : reviewPayment.utr_number || '—'}
                      </span>
                    </div>
                    {reviewPayment.remarks && (
                      <div className="px-3.5 py-2 flex justify-between gap-3">
                        <span className="text-slate-500 shrink-0">Remarks</span>
                        <span className="text-slate-700 text-right italic">
                          {reviewPayment.remarks}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Optional Supplier Invoice Button */}
                  {reviewPayment.invoice_file_path && (
                    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                        <FileText className="w-4 h-4 text-slate-500" />
                        <span>Supplier Invoice Attached</span>
                      </div>
                      <button
                        type="button"
                        disabled={isOpeningInvoice}
                        onClick={() => handleOpenInvoice(reviewPayment.invoice_file_path!)}
                        className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1"
                      >
                        {isOpeningInvoice ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        <span>Open Invoice</span>
                      </button>
                    </div>
                  )}

                  {/* Full 4/5-Stage Audit Timeline */}
                  <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Full Workflow Audit Trail
                    </div>
                    <ol className="relative border-l border-slate-200 ml-2 space-y-3.5 text-xs">
                      <li className="ml-4">
                        <span className="absolute -left-[5px] mt-1 w-2 h-2 rounded-full bg-slate-400 ring-2 ring-white" />
                        <div className="font-semibold text-slate-800">Prepared & Submitted</div>
                        <div className="text-[11px] text-slate-500">
                          {reviewPayment.creator?.full_name || 'Preparer'} ·{' '}
                          {formatDateTime(
                            reviewPayment.submitted_at || reviewPayment.created_at
                          )}
                        </div>
                      </li>

                      {reviewPayment.verified_at && (
                        <li className="ml-4">
                          <span className="absolute -left-[5px] mt-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white" />
                          <div className="font-semibold text-slate-800">
                            Verified by Senior Accountant
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {reviewPayment.verifier?.full_name || 'Verifier'} ·{' '}
                            {formatDateTime(reviewPayment.verified_at)}
                          </div>
                        </li>
                      )}

                      {reviewPayment.approved_at && (
                        <li className="ml-4">
                          <span className="absolute -left-[5px] mt-1 w-2 h-2 rounded-full bg-brand ring-2 ring-white" />
                          <div className="font-semibold text-slate-800">
                            Authorized by Approver
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {reviewPayment.approver?.full_name || 'Approver'} ·{' '}
                            {formatDateTime(reviewPayment.approved_at)}
                          </div>
                        </li>
                      )}

                      {reviewPayment.paid_at && (
                        <li className="ml-4">
                          <span className="absolute -left-[5px] mt-1 w-2 h-2 rounded-full bg-emerald-600 ring-2 ring-white" />
                          <div className="font-semibold text-slate-800">
                            Disbursed & Settled
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {reviewPayment.payer?.full_name || 'Preparer'} ·{' '}
                            {formatDateTime(reviewPayment.paid_at)}
                          </div>
                        </li>
                      )}

                      {reviewPayment.audited_at && (
                        <li className="ml-4">
                          <span className="absolute -left-[5px] mt-1 w-2 h-2 rounded-full bg-emerald-700 ring-2 ring-white" />
                          <div className="font-bold text-emerald-800">
                            Audited & Locked
                          </div>
                          <div className="text-[11px] text-emerald-700 font-medium">
                            {reviewPayment.auditor?.full_name || 'Auditor'} ·{' '}
                            {formatDateTime(reviewPayment.audited_at)}
                          </div>
                        </li>
                      )}
                    </ol>
                  </div>
                </div>

                {/* RIGHT COLUMN: INLINE BANK ACKNOWLEDGEMENT PROOF VIEWER */}
                <div
                  className={`md:col-span-7 h-full flex flex-col bg-slate-100/70 overflow-hidden ${mobileDrawerTab === 'PROOF' ? 'flex min-h-0' : 'hidden md:flex'
                    }`}
                >
                  <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <Receipt className="w-4 h-4 text-emerald-700" />
                      <span>Bank Acknowledgement Proof (15-min Signed Session)</span>
                    </div>
                    {proofSignedUrl && (
                      <a
                        href={proofSignedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open Proof in New Tab</span>
                      </a>
                    )}
                  </div>

                  <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                    {!reviewPayment.receipt_file_path ? (
                      <div className="text-center p-8 max-w-sm">
                        <Receipt className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <p className="text-xs font-semibold text-slate-700">
                          No Bank Proof Document Attached
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {reviewPayment.payment_mode === 'CHEQUE'
                            ? 'Cheque settlement was recorded without a scanned cheque image.'
                            : 'No acknowledgement file found on this payment.'}
                        </p>
                      </div>
                    ) : isLoadingProof ? (
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <Loader2 className="w-6 h-6 animate-spin text-brand" />
                        <span className="text-xs font-medium">
                          Generating secure private preview...
                        </span>
                      </div>
                    ) : proofError ? (
                      <div className="text-center p-6 max-w-sm">
                        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                        <p className="text-xs font-semibold text-rose-800">{proofError}</p>
                      </div>
                    ) : proofSignedUrl ? (
                      isPdfUrl(reviewPayment.receipt_file_path) ? (
                        <iframe
                          src={proofSignedUrl}
                          title="Bank Acknowledgement PDF"
                          className="w-full h-full min-h-[480px] rounded-lg border border-slate-200 bg-white shadow-sm"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={proofSignedUrl}
                          alt="Bank Acknowledgement Receipt"
                          className="max-w-full max-h-full object-contain rounded-lg border border-slate-200 bg-white shadow-sm"
                        />
                      )
                    ) : null}
                  </div>
                </div>
              </div>

              {/* BOTTOM AUDIT ACTION BAR */}
              <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 pb-safe">
                <div className="text-[11px] sm:text-xs text-slate-500">
                  Match UTR / Cheque reference and Net Payable ({formatINR(reviewPayment.net_payable)}) against the Bank Proof before stamping.
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReviewPayment(null)}
                    className="min-h-[40px] flex-1 sm:flex-initial"
                  >
                    Close
                  </Button>

                  {reviewPayment.audited_at ? (
                    <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold inline-flex items-center gap-1.5 flex-[2] sm:flex-initial justify-center">
                      <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="truncate">
                        Audited by {reviewPayment.auditor?.full_name || 'Auditor'} on{' '}
                        {formatDateTime(reviewPayment.audited_at)}
                      </span>
                    </div>
                  ) : canAudit ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={isAuditing}
                      onClick={() => handleMarkAudited(reviewPayment)}
                      className="min-h-[40px] flex-[2] sm:flex-initial bg-brand hover:bg-brand-hover text-white font-semibold px-4 shadow-sm"
                    >
                      {isAuditing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                          Stamping...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4 mr-1.5" />
                          Mark Audited
                        </>
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ====================================================================
          WIDE SIDE-BY-SIDE BATCH PDF COMPARISON SHEET
      ==================================================================== */}
      <Sheet
        open={Boolean(reviewBatch)}
        onOpenChange={(open) => !open && setReviewBatch(null)}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[96vw] lg:max-w-7xl p-0 flex flex-col bg-white overflow-hidden"
        >
          {reviewBatch && (() => {
            const batchChildren = itemsByBatchId.get(reviewBatch.id) || [];
            const { auditedCount, flaggedCount, state } =
              getBatchDerivedState(reviewBatch);
            const childrenSum = batchChildren.reduce(
              (acc, item) => acc + Number(item.net_payable || 0),
              0
            );
            const isBatchBusy = isAuditingBatchId === reviewBatch.id;

            return (
              <>
                <SheetHeader className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50/70 shrink-0">
                  <div className="flex flex-col gap-2.5 pr-8">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
                            {reviewBatch.batch_code}
                          </span>
                          <span className="text-xs font-medium text-slate-600">
                            {formatHumanDate(reviewBatch.batch_date)}
                          </span>
                          {reviewBatch.source_bank && (
                            <BankBadge
                              shortName={
                                reviewBatch.source_bank.short_code ||
                                reviewBatch.source_bank.short_name
                              }
                              fullName={
                                reviewBatch.source_bank.bank_name ||
                                reviewBatch.source_bank.full_name
                              }
                            />
                          )}
                          {state === 'AUDITED' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                              <ShieldCheck className="w-3 h-3" />
                              <span>Batch Audited ✓</span>
                            </span>
                          ) : state === 'FLAGGED' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                              <Flag className="w-3 h-3" />
                              <span>Flagged ({flaggedCount})</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                              <Clock className="w-3 h-3" />
                              <span>
                                {auditedCount}/{batchChildren.length} Audited
                              </span>
                            </span>
                          )}
                        </div>
                        <SheetTitle className="text-base sm:text-lg font-bold text-slate-900">
                          Batch Reconciliation · {batchChildren.length} Payment
                          {batchChildren.length === 1 ? '' : 's'}
                        </SheetTitle>
                      </div>

                      <div className="text-left sm:text-right">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                          Combined Batch Total
                        </span>
                        <span className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
                          {formatINR(reviewBatch.total_amount)}
                        </span>
                      </div>
                    </div>

                    {/* Mobile Toggle Tabs (< md) */}
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-200/70 md:hidden">
                      <button
                        type="button"
                        onClick={() => setBatchDrawerTab('LIST')}
                        className={`min-h-[38px] py-1.5 px-3 rounded-md text-xs font-semibold transition-colors ${
                          batchDrawerTab === 'LIST'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        Payments List ({batchChildren.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchDrawerTab('PROOF')}
                        className={`min-h-[38px] py-1.5 px-3 rounded-md text-xs font-semibold transition-colors ${
                          batchDrawerTab === 'PROOF'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        Bank Proof PDF
                      </button>
                    </div>
                  </div>
                </SheetHeader>

                {/* SIDE-BY-SIDE COMPARE BODY */}
                <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 md:grid-cols-12">
                  {/* LEFT PANE: BATCH PAYMENTS TABLE + PER-ROW AUDIT CONTROLS */}
                  <div
                    className={`md:col-span-6 h-full overflow-y-auto p-4 sm:p-5 md:border-r border-slate-200 space-y-3 ${
                      batchDrawerTab === 'LIST' ? 'block' : 'hidden md:block'
                    }`}
                  >
                    {(reviewBatch.notes || reviewBatch.audit_note) && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs space-y-1">
                        {reviewBatch.notes && (
                          <p className="text-slate-700">
                            <strong className="text-slate-900">Batch Note:</strong>{' '}
                            {reviewBatch.notes}
                          </p>
                        )}
                        {reviewBatch.audit_note && (
                          <p className="text-rose-700">
                            <strong>Audit Note:</strong> {reviewBatch.audit_note}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              <th className="py-2.5 px-3">Payee & Mode</th>
                              <th className="py-2.5 px-3">UTR / Cheque</th>
                              <th className="py-2.5 px-3 text-right">Net Payable</th>
                              <th className="py-2.5 px-3 text-right">Audit Check</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {batchChildren.map((item) => {
                              const partyName =
                                item.vendor?.party_name ||
                                item.vendor?.name ||
                                'Vendor';
                              const acct =
                                item.vendor?.account_number ||
                                item.vendor?.bank_account_no;
                              const isAuditedRow =
                                item.audit_status === 'AUDITED' ||
                                Boolean(item.audited_at);
                              const isFlaggedRow = item.audit_status === 'FLAGGED';
                              const isRowBusy = auditingRowId === item.id;
                              const isFlagInputOpen = rowFlagTargetId === item.id;

                              return (
                                <React.Fragment key={item.id}>
                                  <tr className="hover:bg-slate-50/50 align-top">
                                    <td className="py-2.5 px-3">
                                      <div className="space-y-1">
                                        <p className="font-semibold text-slate-900">
                                          {partyName}
                                        </p>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <PaymentModeBadge
                                            mode={item.payment_mode}
                                            compact
                                          />
                                          {acct && (
                                            <span className="font-mono text-[10px] text-slate-500">
                                              ···{acct.slice(-4)}
                                            </span>
                                          )}
                                        </div>
                                        {item.audit_note && (
                                          <p className="text-[10px] text-rose-700 font-medium">
                                            Note: {item.audit_note}
                                          </p>
                                        )}
                                      </div>
                                    </td>

                                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-800 whitespace-nowrap">
                                      {item.payment_mode === 'CHEQUE'
                                        ? `CHQ #${item.cheque_number || 'NA'}`
                                        : item.utr_number || '—'}
                                    </td>

                                    <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                                      {formatINR(item.net_payable)}
                                    </td>

                                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                      <div className="inline-flex items-center justify-end gap-1">
                                        {isAuditedRow ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                            <Check className="w-3 h-3" />
                                            Audited
                                          </span>
                                        ) : isFlaggedRow ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                                            <Flag className="w-3 h-3" />
                                            Flagged
                                          </span>
                                        ) : null}

                                        {canAudit && !isAuditedRow && (
                                          <button
                                            type="button"
                                            disabled={isRowBusy}
                                            onClick={() =>
                                              handleBatchItemAudit(
                                                item.id,
                                                'AUDITED'
                                              )
                                            }
                                            title="Mark item Audited"
                                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold cursor-pointer disabled:opacity-50"
                                          >
                                            {isRowBusy ? '...' : 'Audit ✓'}
                                          </button>
                                        )}

                                        {canAudit && (
                                          <button
                                            type="button"
                                            disabled={isRowBusy}
                                            onClick={() => {
                                              if (isFlagInputOpen) {
                                                setRowFlagTargetId(null);
                                                setRowFlagNote('');
                                              } else {
                                                setRowFlagTargetId(item.id);
                                                setRowFlagNote(
                                                  item.audit_note || ''
                                                );
                                              }
                                            }}
                                            title="Flag discrepancy"
                                            className="px-2 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-semibold cursor-pointer disabled:opacity-50"
                                          >
                                            Flag
                                          </button>
                                        )}

                                        <button
                                          type="button"
                                          onClick={() => setReviewPayment(item)}
                                          title="Open full payment voucher"
                                          className="p-1 rounded border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 cursor-pointer"
                                        >
                                          <Eye className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>

                                  {isFlagInputOpen && (
                                    <tr className="bg-rose-50/50">
                                      <td colSpan={4} className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="text"
                                            value={rowFlagNote}
                                            onChange={(e) =>
                                              setRowFlagNote(e.target.value)
                                            }
                                            placeholder="Enter discrepancy note (e.g., UTR mismatch on Bank PDF)..."
                                            className="flex-1 h-8 px-2.5 rounded border border-rose-200 bg-white text-xs text-slate-900 outline-none focus:border-rose-400"
                                          />
                                          <button
                                            type="button"
                                            disabled={
                                              isRowBusy || !rowFlagNote.trim()
                                            }
                                            onClick={() =>
                                              handleBatchItemAudit(
                                                item.id,
                                                'FLAGGED',
                                                rowFlagNote
                                              )
                                            }
                                            className="h-8 px-2.5 rounded bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer"
                                          >
                                            Save Flag
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                              <td colSpan={2} className="py-2.5 px-3 text-xs">
                                Batch Total ({batchChildren.length} items)
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-sm">
                                {formatINR(childrenSum)}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[11px] text-slate-500 font-normal">
                                {Math.abs(
                                  childrenSum - Number(reviewBatch.total_amount)
                                ) < 0.01
                                  ? 'Matches Batch ✓'
                                  : `Batch: ${formatINR(reviewBatch.total_amount)}`}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT PANE: EMBEDDED COMBINED BANK PROOF PDF/IMAGE */}
                  <div
                    className={`md:col-span-6 h-full flex flex-col bg-slate-100/80 ${
                      batchDrawerTab === 'PROOF' ? 'flex' : 'hidden md:flex'
                    }`}
                  >
                    <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between text-xs shrink-0">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <Receipt className="w-3.5 h-3.5 text-brand" />
                        <span>Combined Bank Acknowledgement Proof</span>
                      </span>
                      {batchProofUrl && (
                        <a
                          href={batchProofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand hover:underline font-medium inline-flex items-center gap-1"
                        >
                          <span>Open in New Tab</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <div className="flex-1 min-h-0 p-3 flex items-center justify-center overflow-auto">
                      {isLoadingBatchProof ? (
                        <div className="flex flex-col items-center text-slate-500 gap-2">
                          <Loader2 className="w-6 h-6 animate-spin text-brand" />
                          <span className="text-xs font-medium">
                            Loading combined bank PDF...
                          </span>
                        </div>
                      ) : batchProofError ? (
                        <div className="text-center p-6 max-w-sm">
                          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                          <p className="text-xs font-semibold text-rose-800">
                            {batchProofError}
                          </p>
                        </div>
                      ) : batchProofUrl ? (
                        isPdfUrl(reviewBatch.receipt_file_path) ? (
                          <iframe
                            src={batchProofUrl}
                            title="Combined Batch Bank Proof PDF"
                            className="w-full h-full min-h-[500px] rounded-lg border border-slate-200 bg-white shadow-sm"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={batchProofUrl}
                            alt="Combined Batch Bank Proof"
                            className="max-w-full max-h-full object-contain rounded-lg border border-slate-200 bg-white shadow-sm"
                          />
                        )
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* BATCH DRAWER FOOTER ACTION BAR */}
                <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-white space-y-2.5 shrink-0 pb-safe">
                  {flaggingBatchOpen && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-lg border border-rose-200 bg-rose-50/70">
                      <input
                        type="text"
                        value={batchFlagNote}
                        onChange={(e) => setBatchFlagNote(e.target.value)}
                        placeholder="Describe discrepancy in this batch (required to flag)..."
                        className="flex-1 h-9 px-3 rounded-lg border border-rose-200 bg-white text-xs text-slate-900 outline-none focus:border-rose-400"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setFlaggingBatchOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBatchBusy || !batchFlagNote.trim()}
                          onClick={() =>
                            handleBatchAudit(reviewBatch, 'FLAGGED', batchFlagNote)
                          }
                          className="bg-rose-600 hover:bg-rose-700 text-white"
                        >
                          Confirm Batch Flag
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="text-xs text-slate-500">
                      Verified progress:{' '}
                      <strong className="text-slate-900">
                        {auditedCount} of {batchChildren.length}
                      </strong>{' '}
                      payments matched · Total{' '}
                      <strong className="text-slate-900 tabular-nums">
                        {formatINR(reviewBatch.total_amount)}
                      </strong>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setReviewBatch(null)}
                        className="min-h-[40px]"
                      >
                        Close
                      </Button>

                      {canAudit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isBatchBusy}
                          onClick={() => setFlaggingBatchOpen((prev) => !prev)}
                          className="min-h-[40px] border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          <Flag className="w-3.5 h-3.5 mr-1.5" />
                          Flag Discrepancy
                        </Button>
                      )}

                      {canAudit && state !== 'AUDITED' && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBatchBusy}
                          onClick={() => handleBatchAudit(reviewBatch, 'AUDITED')}
                          className="min-h-[40px] bg-brand hover:bg-brand-hover text-white font-semibold px-4 shadow-sm"
                        >
                          {isBatchBusy ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                              Auditing Batch...
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-4 h-4 mr-1.5" />
                              Mark Entire Batch Audited ✓
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
