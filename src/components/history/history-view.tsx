'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  Download,
  Printer,
  Calendar,
  X,
  Eye,
  ChevronDown,
  ChevronRight,
  FilterX,
  ShieldCheck,
  Clock,
  MessageCircle,
  Paperclip,
  Loader2,
  Building2,
  Check,
  ChevronsUpDown,
  Landmark,
  XCircle,
  CheckCircle2,
  Send,
  RotateCcw,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { PaymentStatusBadge } from '@/components/payments/payment-status-badge';
import { PaymentDetailDrawer } from '@/components/payments/payment-detail-drawer';
import { PaymentAcknowledgementModal } from '@/components/payments/payment-acknowledgement-modal';
import { PaymentUrlSync, usePaymentHighlight } from '@/components/layout/payment-url-sync';
import { markReceiptSent } from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import {
  formatHumanDate,
  formatINR,
  formatPaymentMode,
  getCurrentISTInfo,
} from '@/lib/format';
import { generatePaymentsCSV, downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import type { Company, CompanyBank, PaymentItem, Vendor } from '@/types/database';

interface HistoryViewProps {
  initialPayments: PaymentItem[];
  vendors: Vendor[];
  banks: CompanyBank[];
  companyCode?: string;
  companyName?: string;
  activeCompany?: Company | null;
  currentUserName?: string;
  canMarkReceiptSent?: boolean;
  canUndoReceiptSent?: boolean;
}

type PrimaryViewTab = 'PAID' | 'REJECTED';
type ModeFilter = 'ALL' | 'NEFT_RTGS' | 'IMPS' | 'CHEQUE';
type ReceiptFilter = 'ALL' | 'SENT' | 'PENDING';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * Convert an ISO timestamp or YYYY-MM-DD date string to YYYY-MM-DD in Asia/Kolkata (IST).
 */
function toISTDateIso(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = new Date(value).getTime();
  if (isNaN(ms)) return value.slice(0, 10);
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Resolve the effective ledger date (YYYY-MM-DD in IST) for a history record.
 */
function getEffectiveLedgerDateIST(p: PaymentItem): string {
  if (p.status === 'PAID') {
    return toISTDateIso(p.paid_at || p.updated_at || p.sheet_date);
  }
  return toISTDateIso(p.updated_at || p.sheet_date);
}

function formatMonthLabel(monthKey: string, full = false): string {
  const [yStr, mStr] = monthKey.split('-');
  const mIdx = parseInt(mStr, 10) - 1;
  const list = full ? MONTHS_FULL : MONTHS_SHORT;
  const mName = list[mIdx] || mStr;
  return `${mName} ${yStr}`;
}

interface SearchableVendorFilterProps {
  vendors: Vendor[];
  selectedVendorId: string;
  onChange: (vendorId: string) => void;
}

function SearchableVendorFilter({
  vendors,
  selectedVendorId,
  onChange,
}: SearchableVendorFilterProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const selectedVendor = React.useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) || null,
    [vendors, selectedVendorId]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        (v.party_name || v.name || '').toLowerCase().includes(q) ||
        (v.beneficiary_name || '').toLowerCase().includes(q)
    );
  }, [vendors, query]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 text-xs font-medium text-slate-700 flex items-center justify-between gap-2 transition-colors outline-none focus:border-brand cursor-pointer"
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">
            {selectedVendor
              ? selectedVendor.party_name || selectedVendor.name
              : 'All Vendors'}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          {selectedVendorId !== 'ALL' && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear vendor filter"
              onClick={(e) => {
                e.stopPropagation();
                onChange('ALL');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange('ALL');
                }
              }}
              className="p-0.5 rounded text-slate-400 hover:text-slate-700"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
        </span>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 rounded-xl border border-slate-200 dark:border-[#27272F] bg-[#FFFFFF] dark:bg-[#141418] shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-[#22222A]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search vendor..."
                className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-900 outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1F1F26]">
            <button
              type="button"
              onClick={() => {
                onChange('ALL');
                setQuery('');
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${selectedVendorId === 'ALL'
                ? 'bg-brand-tint text-brand font-semibold'
                : 'text-slate-700 hover:bg-slate-50'
                }`}
            >
              <span>All Vendors</span>
              {selectedVendorId === 'ALL' && <Check className="w-3.5 h-3.5 text-brand" />}
            </button>

            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500 text-center">
                No matching vendors.
              </div>
            ) : (
              filtered.map((v) => {
                const name = v.party_name || v.name || 'Vendor';
                const isSelected = v.id === selectedVendorId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onChange(v.id);
                      setQuery('');
                      setIsOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${isSelected
                      ? 'bg-brand-tint text-brand font-semibold'
                      : 'text-slate-800 hover:bg-slate-50'
                      }`}
                  >
                    <span className="truncate">{name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-brand shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryView({
  initialPayments,
  vendors,
  banks,
  companyCode = 'INDFURN',
  companyName = 'INDFURN',
  activeCompany,
  currentUserName = 'Accounts Team',
  canMarkReceiptSent = false,
  canUndoReceiptSent = false,
}: HistoryViewProps) {
  const router = useRouter();
  const [, startRefreshTransition] = React.useTransition();
  const refreshServerState = React.useCallback(() => {
    startRefreshTransition(() => {
      router.refresh();
    });
  }, [router]);

  const [payments, setPayments] = React.useState<PaymentItem[]>(initialPayments);
  const currentIST = React.useMemo(() => getCurrentISTInfo(), []);

  // Sync live updates from RealtimeSync router.refresh()
  React.useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  // Primary View Switch (Paid Settled Ledger vs Rejected)
  const [viewTab, setViewTab] = React.useState<PrimaryViewTab>('PAID');

  // Strictly bucket archived records
  const paidPayments = React.useMemo(
    () => payments.filter((p) => p.status === 'PAID'),
    [payments]
  );
  const rejectedPayments = React.useMemo(
    () => payments.filter((p) => p.status === 'REJECTED'),
    [payments]
  );

  // Derive available IST months from PAID ledger
  const availablePaidMonths = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const p of paidPayments) {
      const dateIso = getEffectiveLedgerDateIST(p);
      const monthKey = dateIso.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(monthKey)) {
        map.set(monthKey, (map.get(monthKey) || 0) + 1);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, count]) => ({
        key,
        label: formatMonthLabel(key, false),
        fullLabel: formatMonthLabel(key, true),
        count,
      }));
  }, [paidPayments]);

  const defaultMonthKey = React.useMemo(() => {
    if (availablePaidMonths.some((m) => m.key === currentIST.yearMonth)) {
      return currentIST.yearMonth;
    }
    return availablePaidMonths[0]?.key || 'ALL';
  }, [availablePaidMonths, currentIST.yearMonth]);

  // Filters state
  const [selectedMonth, setSelectedMonth] = React.useState<string>(() => defaultMonthKey);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [vendorFilter, setVendorFilter] = React.useState<string>('ALL');
  const [bankFilter, setBankFilter] = React.useState<string>('ALL');
  const [modeFilter, setModeFilter] = React.useState<ModeFilter>('ALL');
  const [receiptFilter, setReceiptFilter] = React.useState<ReceiptFilter>('ALL');
  const [dateFrom, setDateFrom] = React.useState<string>('');
  const [dateTo, setDateTo] = React.useState<string>('');
  const [collapsedMonths, setCollapsedMonths] = React.useState<Set<string>>(new Set());

  // Reset month default cleanly if user switches companies
  const companyIdKey = activeCompany?.id || companyCode;
  const lastCompanyRef = React.useRef<string>(companyIdKey);
  React.useEffect(() => {
    if (lastCompanyRef.current !== companyIdKey) {
      lastCompanyRef.current = companyIdKey;
      setSelectedMonth(defaultMonthKey);
      setVendorFilter('ALL');
      setBankFilter('ALL');
      setModeFilter('ALL');
      setReceiptFilter('ALL');
      setDateFrom('');
      setDateTo('');
      setSearchQuery('');
      setCollapsedMonths(new Set());
    }
  }, [companyIdKey, defaultMonthKey]);

  // Payment detail drawer, advice modal & action loading states
  const [selectedPayment, setSelectedPayment] = React.useState<PaymentItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = React.useState<boolean>(false);
  const [advicePayment, setAdvicePayment] = React.useState<PaymentItem | null>(null);
  const [openingBillId, setOpeningBillId] = React.useState<string | null>(null);
  const [markingReceiptId, setMarkingReceiptId] = React.useState<string | null>(null);

  const isDateRangeActive = Boolean(dateFrom || dateTo);

  // Deep-link ?highlight=<id> support
  const { highlightedId, triggerHighlight } = usePaymentHighlight();
  const paymentsRef = React.useRef(payments);
  paymentsRef.current = payments;

  const handleUrlParams = React.useCallback(
    ({ highlightId }: { tab: string | null; highlightId: string | null }) => {
      if (!highlightId) return;
      const target = paymentsRef.current.find((p) => p.id === highlightId);
      if (target) {
        if (target.status === 'REJECTED') {
          setViewTab('REJECTED');
        } else {
          setViewTab('PAID');
          const mKey = getEffectiveLedgerDateIST(target).slice(0, 7);
          if (mKey) {
            setSelectedMonth((curr) => (curr === 'ALL' || curr === mKey ? curr : mKey));
            setCollapsedMonths((prev) => {
              if (!prev.has(mKey)) return prev;
              const next = new Set(prev);
              next.delete(mKey);
              return next;
            });
          }
        }
      }
      triggerHighlight(highlightId);
    },
    [triggerHighlight]
  );

  // Combine registered company vendors with any inactive vendor present in history rows
  const filterVendorsList = React.useMemo(() => {
    const map = new Map<string, Vendor>();
    for (const v of vendors) map.set(v.id, v);
    for (const p of payments) {
      if (p.vendor && !map.has(p.vendor.id)) {
        map.set(p.vendor.id, p.vendor);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.party_name || a.name || '').localeCompare(b.party_name || b.name || '')
    );
  }, [vendors, payments]);

  // Base list filtered by everything EXCEPT bankFilter & receiptFilter
  const tabFilteredWithoutBankAndReceipt = React.useMemo(() => {
    const source = viewTab === 'PAID' ? paidPayments : rejectedPayments;
    const q = searchQuery.trim().toLowerCase();

    return source.filter((p) => {
      const effectiveDate = getEffectiveLedgerDateIST(p);

      // Specific Date Range overrides month pill filter
      if (isDateRangeActive) {
        if (dateFrom && effectiveDate < dateFrom) return false;
        if (dateTo && effectiveDate > dateTo) return false;
      } else if (viewTab === 'PAID' && selectedMonth !== 'ALL') {
        if (!effectiveDate.startsWith(selectedMonth)) return false;
      }

      if (vendorFilter !== 'ALL' && p.vendor_id !== vendorFilter) {
        return false;
      }

      if (modeFilter !== 'ALL') {
        const pMode = p.payment_mode || 'NEFT_RTGS';
        if (pMode !== modeFilter) return false;
      }

      if (!q) return true;

      const partyName = (p.vendor?.party_name || p.vendor?.name || '').toLowerCase();
      const beneficiaryName = (p.vendor?.beneficiary_name || '').toLowerCase();
      const invoiceRef = (p.invoice_ref || '').toLowerCase();
      const purpose = (p.purpose || '').toLowerCase();
      const utr = (p.utr_number || '').toLowerCase();
      const cheque = (p.cheque_number || '').toLowerCase();

      return (
        partyName.includes(q) ||
        beneficiaryName.includes(q) ||
        invoiceRef.includes(q) ||
        purpose.includes(q) ||
        utr.includes(q) ||
        cheque.includes(q)
      );
    });
  }, [
    viewTab,
    paidPayments,
    rejectedPayments,
    isDateRangeActive,
    dateFrom,
    dateTo,
    selectedMonth,
    vendorFilter,
    modeFilter,
    searchQuery,
  ]);

  // Apply Bank Filter (used to compute receipt status tab counts & printable settled count)
  const scopedWithBank = React.useMemo(() => {
    if (bankFilter === 'ALL') return tabFilteredWithoutBankAndReceipt;
    return tabFilteredWithoutBankAndReceipt.filter((p) => p.source_bank_id === bankFilter);
  }, [tabFilteredWithoutBankAndReceipt, bankFilter]);

  const receiptCounts = React.useMemo(() => {
    if (viewTab !== 'PAID') {
      return { sent: 0, pending: 0, printableSettled: 0 };
    }
    let sent = 0;
    let pending = 0;
    let printableSettled = 0;
    for (const p of scopedWithBank) {
      const hasRef = Boolean((p.utr_number || p.cheque_number || '').trim());
      if (p.receipt_sent_at) {
        sent += 1;
        if (hasRef) printableSettled += 1;
      } else {
        pending += 1;
      }
    }
    return { sent, pending, printableSettled };
  }, [scopedWithBank, viewTab]);

  // Used for Bank-Wise summary chips (applies receiptFilter when PAID, keeps sibling banks visible)
  const tabFilteredWithoutBank = React.useMemo(() => {
    if (viewTab !== 'PAID' || receiptFilter === 'ALL') {
      return tabFilteredWithoutBankAndReceipt;
    }
    return tabFilteredWithoutBankAndReceipt.filter((p) =>
      receiptFilter === 'SENT' ? Boolean(p.receipt_sent_at) : !p.receipt_sent_at
    );
  }, [tabFilteredWithoutBankAndReceipt, viewTab, receiptFilter]);

  // Final filtered rows including receiptFilter + bankFilter
  const filteredPayments = React.useMemo(() => {
    if (viewTab !== 'PAID' || receiptFilter === 'ALL') return scopedWithBank;
    return scopedWithBank.filter((p) =>
      receiptFilter === 'SENT' ? Boolean(p.receipt_sent_at) : !p.receipt_sent_at
    );
  }, [scopedWithBank, viewTab, receiptFilter]);

  // Group filtered payments into IST months (newest first)
  const groupedMonths = React.useMemo(() => {
    const groupMap = new Map<
      string,
      {
        monthKey: string;
        monthLabel: string;
        items: PaymentItem[];
        totalAmount: number;
      }
    >();

    for (const p of filteredPayments) {
      const dateIso = getEffectiveLedgerDateIST(p);
      const monthKey = /^\d{4}-\d{2}/.test(dateIso) ? dateIso.slice(0, 7) : 'UNKNOWN';
      const existing = groupMap.get(monthKey);
      const amt = Number(p.net_payable || 0);
      if (existing) {
        existing.items.push(p);
        existing.totalAmount += amt;
      } else {
        groupMap.set(monthKey, {
          monthKey,
          monthLabel: monthKey === 'UNKNOWN' ? 'Other Dates' : formatMonthLabel(monthKey, true),
          items: [p],
          totalAmount: amt,
        });
      }
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey)
    );
  }, [filteredPayments]);

  // Live Monthly Summary Metrics (Settled Ledger)
  const summaryMetrics = React.useMemo(() => {
    let totalAmount = 0;
    let neftTotal = 0;
    let neftCount = 0;
    let impsTotal = 0;
    let impsCount = 0;
    let chequeTotal = 0;
    let chequeCount = 0;

    for (const p of filteredPayments) {
      const amt = Number(p.net_payable || 0);
      totalAmount += amt;
      if (p.payment_mode === 'CHEQUE') {
        chequeTotal += amt;
        chequeCount += 1;
      } else if (p.payment_mode === 'IMPS') {
        impsTotal += amt;
        impsCount += 1;
      } else {
        neftTotal += amt;
        neftCount += 1;
      }
    }

    // Bank-wise chips built from tabFilteredWithoutBank so clicking a bank chip doesn't hide sibling banks!
    const bankMap = new Map<
      string,
      { bankId: string; shortLabel: string; total: number; count: number }
    >();
    for (const b of banks) {
      bankMap.set(b.id, {
        bankId: b.id,
        shortLabel: b.short_code || b.short_name || 'Bank',
        total: 0,
        count: 0,
      });
    }
    for (const p of tabFilteredWithoutBank) {
      const entry = bankMap.get(p.source_bank_id) || {
        bankId: p.source_bank_id,
        shortLabel: p.source_bank?.short_code || p.source_bank?.short_name || 'Bank',
        total: 0,
        count: 0,
      };
      entry.total += Number(p.net_payable || 0);
      entry.count += 1;
      bankMap.set(p.source_bank_id, entry);
    }

    const bankChips = Array.from(bankMap.values()).filter((c) => c.count > 0);

    return {
      totalAmount,
      neftTotal,
      neftCount,
      impsTotal,
      impsCount,
      chequeTotal,
      chequeCount,
      bankChips,
    };
  }, [filteredPayments, tabFilteredWithoutBank, banks]);

  const hasActiveFilters = Boolean(
    searchQuery ||
    vendorFilter !== 'ALL' ||
    bankFilter !== 'ALL' ||
    modeFilter !== 'ALL' ||
    receiptFilter !== 'ALL' ||
    dateFrom ||
    dateTo
  );

  const handleClearFilters = () => {
    setSearchQuery('');
    setVendorFilter('ALL');
    setBankFilter('ALL');
    setModeFilter('ALL');
    setReceiptFilter('ALL');
    setDateFrom('');
    setDateTo('');
  };

  const handleReceiptSentLocal = React.useCallback(
    (paymentId: string, sentAt: string | null) => {
      setPayments((prev) =>
        prev.map((item) =>
          item.id === paymentId ? { ...item, receipt_sent_at: sentAt } : item
        )
      );
      setSelectedPayment((prev) =>
        prev && prev.id === paymentId ? { ...prev, receipt_sent_at: sentAt } : prev
      );
      setAdvicePayment((prev) =>
        prev && prev.id === paymentId ? { ...prev, receipt_sent_at: sentAt } : prev
      );
    },
    []
  );

  const handleToggleReceiptSent = async (
    e: React.MouseEvent,
    p: PaymentItem,
    sent: boolean
  ) => {
    e.stopPropagation();
    if (markingReceiptId === p.id) return;
    setMarkingReceiptId(p.id);
    try {
      const res = await markReceiptSent({ paymentId: p.id, sent });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      handleReceiptSentLocal(p.id, res.data.receipt_sent_at);
      toast.success(
        sent ? 'Marked as Receipt Sent ✓' : 'Receipt Sent confirmation cleared.'
      );
      refreshServerState();
    } catch {
      toast.error('Failed to update receipt status.');
    } finally {
      setMarkingReceiptId(null);
    }
  };

  const handleSelectMonthPill = (monthKey: string) => {
    setSelectedMonth(monthKey);
    if (dateFrom || dateTo) {
      setDateFrom('');
      setDateTo('');
    }
  };

  const toggleMonthCollapse = (monthKey: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const handleQuickFilterVendor = (vendorId: string | null | undefined, partyName: string) => {
    if (!vendorId) return;
    if (vendorFilter === vendorId) {
      setVendorFilter('ALL');
      toast.info('Cleared vendor filter');
    } else {
      setVendorFilter(vendorId);
      toast.info(`Showing payments for ${partyName}`);
    }
  };

  const handleOpenBill = async (e: React.MouseEvent, p: PaymentItem) => {
    e.stopPropagation();
    if (!p.invoice_file_path) return;
    setOpeningBillId(p.id);
    try {
      const res = await getSignedFileUrl('supplier-invoices', p.invoice_file_path);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Failed to open supplier bill.');
    } finally {
      setOpeningBillId(null);
    }
  };

  const handleExportCSV = () => {
    if (filteredPayments.length === 0) {
      toast.error('No payment records to export');
      return;
    }

    try {
      const csv = generatePaymentsCSV(filteredPayments);
      const dateTag = currentIST.yearMonth;
      downloadCSV(`${companyCode}_Ledger_${dateTag}.csv`, csv);
      toast.success(`Exported ${filteredPayments.length} payment records to CSV`);
    } catch (err: unknown) {
      toast.error(
        'Failed to export CSV: ' + (err instanceof Error ? err.message : 'Unknown error')
      );
    }
  };

  // Open strict Settled Payment History Printout (/print?view=history&...) with active filters preserved
  const handlePrintSettledHistory = () => {
    const params = new URLSearchParams();
    params.set('view', 'history');

    if (isDateRangeActive) {
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
    } else if (selectedMonth !== 'ALL') {
      params.set('month', selectedMonth);
    } else {
      params.set('month', 'all');
    }

    if (vendorFilter !== 'ALL') params.set('vendorId', vendorFilter);
    if (bankFilter !== 'ALL') params.set('bankId', bankFilter);
    if (modeFilter !== 'ALL') params.set('mode', modeFilter);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());

    window.open(`/print?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const handleOpenDetail = (payment: PaymentItem) => {
    setSelectedPayment(payment);
    setIsDetailOpen(true);
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 sm:space-y-5 pb-12">
      <PaymentUrlSync onParams={handleUrlParams} />

      {/* Header & Primary Exports */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="hidden sm:block min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Payment History &amp; Ledger — {companyName}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monthly settled disbursements, verified UTR/Cheque archive, Payment Advice slips, and A4 PDF vouchers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCSV}
            disabled={filteredPayments.length === 0}
            className="flex-1 sm:flex-initial min-h-[40px] px-3.5 border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 shadow-sm cursor-pointer"
          >
            <Download className="w-4 h-4 mr-1.5 text-slate-500" />
            Export CSV
          </Button>

          <Button
            type="button"
            onClick={handlePrintSettledHistory}
            title="Prints ONLY approved + settled (UTR/Cheque recorded) + Receipt-Sent payments matching current period & filters"
            className="flex-1 sm:flex-initial min-h-[40px] px-3.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-sm cursor-pointer inline-flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            <span>
              Print Settled ({receiptCounts.printableSettled})
            </span>
          </Button>
        </div>
      </div>

      {/* 1. Primary View Switch: Paid / Settled vs Rejected */}
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-200/80 pb-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewTab('PAID')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${viewTab === 'PAID'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Paid / Settled</span>
            <span
              className={`tabular-nums text-[11px] px-1.5 py-0.5 rounded-full ${viewTab === 'PAID'
                ? 'bg-white/20 text-white'
                : 'bg-emerald-100 text-emerald-800'
                }`}
            >
              {paidPayments.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setViewTab('REJECTED')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${viewTab === 'REJECTED'
              ? 'bg-rose-700 text-white shadow-sm'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`}
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Rejected</span>
            <span
              className={`tabular-nums text-[11px] px-1.5 py-0.5 rounded-full ${viewTab === 'REJECTED'
                ? 'bg-white/20 text-white'
                : 'bg-slate-200 text-slate-700'
                }`}
            >
              {rejectedPayments.length}
            </span>
          </button>
        </div>

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 cursor-pointer"
          >
            <FilterX className="w-3.5 h-3.5 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* 2. Interactive Month Selector Bar (Paid Ledger) */}
      {viewTab === 'PAID' && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0">
          <button
            type="button"
            onClick={() => handleSelectMonthPill('ALL')}
            className={`min-h-[36px] px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 border transition-colors cursor-pointer shrink-0 ${!isDateRangeActive && selectedMonth === 'ALL'
              ? 'bg-brand border-brand text-white shadow-sm'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
          >
            <span>All Months</span>
            <span
              className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${!isDateRangeActive && selectedMonth === 'ALL'
                ? 'bg-white/20 text-white'
                : 'bg-slate-100 text-slate-600'
                }`}
            >
              {paidPayments.length}
            </span>
          </button>

          {availablePaidMonths.map((m) => {
            const isActive = !isDateRangeActive && selectedMonth === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => handleSelectMonthPill(m.key)}
                className={`min-h-[36px] px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 border transition-colors cursor-pointer shrink-0 ${isActive
                  ? 'bg-brand border-brand text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <span>{m.label}</span>
                <span
                  className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                >
                  {m.count}
                </span>
              </button>
            );
          })}

          {isDateRangeActive && (
            <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold whitespace-nowrap shrink-0">
              Custom Date Range Active
            </span>
          )}
        </div>
      )}

      {/* 3. Compact Monthly Summary Strip (Updates Live with Active Month & Filters) */}
      {viewTab === 'PAID' && (
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4 shadow-sm space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {isDateRangeActive
                    ? 'Filtered Date Range Settled'
                    : selectedMonth === 'ALL'
                      ? 'All-Time Settled Total'
                      : `${formatMonthLabel(selectedMonth, true)} Settled`}
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                  {formatINR(summaryMetrics.totalAmount)}
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold tabular-nums">
                {filteredPayments.length} Payment{filteredPayments.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* Mode Split */}
            <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
              <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
                <span className="text-slate-500 font-medium">NEFT / RTGS:</span>
                <span className="font-bold text-slate-900">
                  {formatINR(summaryMetrics.neftTotal)}
                </span>
                <span className="text-[11px] text-slate-500">({summaryMetrics.neftCount})</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
                <span className="text-slate-500 font-medium">IMPS:</span>
                <span className="font-bold text-slate-900">
                  {formatINR(summaryMetrics.impsTotal)}
                </span>
                <span className="text-[11px] text-slate-500">({summaryMetrics.impsCount})</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
                <span className="text-slate-500 font-medium">Cheque:</span>
                <span className="font-bold text-slate-900">
                  {formatINR(summaryMetrics.chequeTotal)}
                </span>
                <span className="text-[11px] text-slate-500">({summaryMetrics.chequeCount})</span>
              </div>
            </div>
          </div>

          {/* Bank-Wise Breakdown Chips (Clickable to Filter Bank!) */}
          {summaryMetrics.bankChips.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-2.5 border-t border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 inline-flex items-center gap-1 mr-1 shrink-0">
                <Landmark className="w-3.5 h-3.5 text-slate-400" />
                <span>By Bank:</span>
              </span>
              {summaryMetrics.bankChips.map((chip) => {
                const isPicked = bankFilter === chip.bankId;
                return (
                  <button
                    key={chip.bankId}
                    type="button"
                    onClick={() =>
                      setBankFilter((prev) => (prev === chip.bankId ? 'ALL' : chip.bankId))
                    }
                    className={`px-2.5 py-1 rounded-lg border text-xs font-semibold tabular-nums inline-flex items-center gap-1.5 transition-all cursor-pointer ${isPicked
                      ? 'border-brand bg-brand text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                      }`}
                  >
                    <span>{chip.shortLabel}</span>
                    <span className="opacity-60">·</span>
                    <span>{formatINR(chip.total)}</span>
                    <span
                      className={`text-[10px] px-1 rounded ${isPicked ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-600'
                        }`}
                    >
                      {chip.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. Clean Filter Bar (Search + Vendor Dropdown + DatePicker + Mode Filter) */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {/* Instant Search */}
          <div className="sm:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search party, UTR / Cheque ref, invoice #, or purpose..."
              className="w-full min-h-[38px] pl-9 pr-8 rounded-lg border border-slate-200 bg-slate-50/70 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Searchable Vendor Filter */}
          <div className="sm:col-span-4">
            <SearchableVendorFilter
              vendors={filterVendorsList}
              selectedVendorId={vendorFilter}
              onChange={setVendorFilter}
            />
          </div>

          {/* Payment Mode Segmented Filter */}
          <div className="sm:col-span-3">
            <div className="grid grid-cols-4 p-0.5 rounded-lg bg-slate-100 border border-slate-200 min-h-[38px]">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'NEFT_RTGS', label: 'NEFT' },
                  { id: 'IMPS', label: 'IMPS' },
                  { id: 'CHEQUE', label: 'Cheque' },
                ] as Array<{ id: ModeFilter; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModeFilter(m.id)}
                  className={`rounded-md text-[11px] font-semibold transition-all cursor-pointer ${modeFilter === m.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Specific Date / Date Range (<DatePicker />) + Receipt Status Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <span className="text-slate-500 font-medium inline-flex items-center gap-1 shrink-0">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Date Range:</span>
            </span>
            <div className="grid grid-cols-1 xs:grid-cols-[1fr_auto_1fr] items-center gap-1.5 w-full sm:w-auto">
              <div className="sm:w-[160px]">
                <DatePicker
                  value={dateFrom}
                  onChange={setDateFrom}
                  placeholder="From date"
                  title="From Date"
                  size="sm"
                  allowClear
                />
              </div>
              <span className="text-slate-400 text-center">to</span>
              <div className="sm:w-[160px]">
                <DatePicker
                  value={dateTo}
                  onChange={setDateTo}
                  placeholder="To date"
                  title="To Date"
                  size="sm"
                  allowClear
                />
              </div>
            </div>
          </div>

          {viewTab === 'PAID' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  {
                    id: 'ALL',
                    label: `All Paid (${receiptCounts.sent + receiptCounts.pending})`,
                    activeClass: 'bg-slate-900 text-white border-slate-900',
                  },
                  {
                    id: 'SENT',
                    label: `Receipt Sent (${receiptCounts.sent})`,
                    activeClass: 'bg-emerald-700 text-white border-emerald-700',
                  },
                  {
                    id: 'PENDING',
                    label: `Receipt Pending (${receiptCounts.pending})`,
                    activeClass: 'bg-amber-600 text-white border-amber-600',
                  },
                ] as Array<{ id: ReceiptFilter; label: string; activeClass: string }>
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setReceiptFilter(pill.id)}
                  className={`min-h-[34px] px-2.5 py-1 rounded-full border text-[11px] font-semibold tabular-nums transition-colors cursor-pointer ${receiptFilter === pill.id
                      ? pill.activeClass
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          )}

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="h-8 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-2 cursor-pointer"
            >
              <FilterX className="w-3.5 h-3.5 mr-1" />
              Reset Filters
            </Button>
          )}
        </div>
      </div>

      {/* 5. Month-Grouped Ledger Sections */}
      {groupedMonths.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-400">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            {viewTab === 'REJECTED'
              ? 'No rejected payments found'
              : 'No settled transactions found'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            {hasActiveFilters
              ? 'No history entries matched your current search or filter criteria.'
              : viewTab === 'PAID'
                ? 'Settled payments with UTR or Cheque details appear here grouped by month.'
                : 'Rejected payment requests will be archived here.'}
          </p>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="text-xs min-h-[38px] cursor-pointer"
            >
              Clear All Filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedMonths.map((group) => {
            const isCollapsed = collapsedMonths.has(group.monthKey);

            return (
              <section
                key={group.monthKey}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
              >
                {/* Sticky / Collapsible Month Group Header */}
                <button
                  type="button"
                  onClick={() => toggleMonthCollapse(group.monthKey)}
                  className="w-full px-4 py-3 bg-slate-50/90 hover:bg-slate-100/80 border-b border-slate-200 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                    <h2 className="text-sm font-bold text-slate-900 truncate">
                      {group.monthLabel}
                    </h2>
                    <span className="px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 text-[11px] font-bold tabular-nums shrink-0">
                      {group.items.length} Payment{group.items.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="text-sm font-extrabold text-slate-900 tabular-nums shrink-0">
                    {formatINR(group.totalAmount)}
                  </div>
                </button>

                {!isCollapsed && (
                  <>
                    {/* Desktop Dense Ledger Table (md+) */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                            <th className="py-2.5 px-3.5">
                              {viewTab === 'PAID' ? 'Date Paid' : 'Date'}
                            </th>
                            <th className="py-2.5 px-3.5">Party / Vendor</th>
                            <th className="py-2.5 px-3.5">Invoice &amp; Purpose</th>
                            <th className="py-2.5 px-3.5">Bank &amp; Mode</th>
                            <th className="py-2.5 px-3.5">UTR / Cheque No</th>
                            <th className="py-2.5 px-3.5 text-right">Net Amount</th>
                            <th className="py-2.5 px-3.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.items.map((p) => {
                            const partyName =
                              p.vendor?.party_name || p.vendor?.name || 'Unknown Party';
                            const beneficiary = p.vendor?.beneficiary_name || partyName;
                            const effectiveDate = getEffectiveLedgerDateIST(p);
                            const refLabel =
                              p.payment_mode === 'CHEQUE' && p.cheque_number
                                ? `CHQ #${p.cheque_number}`
                                : p.utr_number || '';
                            const bankCode =
                              p.source_bank?.short_code || p.source_bank?.short_name || 'Bank';

                            return (
                              <tr
                                key={p.id}
                                data-payment-id={p.id}
                                onClick={() => handleOpenDetail(p)}
                                className={`hover:bg-slate-50/60 transition-colors cursor-pointer ${highlightedId === p.id
                                  ? 'ring-2 ring-inset ring-brand bg-brand-tint/60 animate-pulse'
                                  : ''
                                  }`}
                              >
                                <td className="py-3 px-3.5 tabular-nums text-slate-600 whitespace-nowrap">
                                  {formatHumanDate(effectiveDate)}
                                </td>

                                <td className="py-3 px-3.5 max-w-[210px]">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuickFilterVendor(p.vendor_id, partyName);
                                    }}
                                    title={`Filter ledger by ${partyName}`}
                                    className="font-semibold text-slate-900 hover:text-brand hover:underline truncate block max-w-full text-left cursor-pointer"
                                  >
                                    {partyName}
                                  </button>
                                  {beneficiary !== partyName && (
                                    <div className="text-[10px] text-slate-400 truncate">
                                      A/C: {beneficiary}
                                    </div>
                                  )}
                                </td>

                                <td className="py-3 px-3.5 max-w-[210px]">
                                  <div className="font-mono text-[11px] font-medium text-slate-700 truncate">
                                    {p.invoice_ref || 'NA'}
                                  </div>
                                  <div className="text-[11px] text-slate-500 truncate">
                                    {p.purpose}
                                  </div>
                                </td>

                                <td className="py-3 px-3.5 whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                      {bankCode}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-500">
                                      {formatPaymentMode(p.payment_mode, true)}
                                    </span>
                                  </div>
                                </td>

                                <td className="py-3 px-3.5 whitespace-nowrap">
                                  {refLabel ? (
                                    <div className="flex flex-col items-start gap-1">
                                      <span className="font-mono text-[11px] font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                        {refLabel}
                                      </span>
                                      {p.batch_id && (
                                        <Link
                                          href={`/audit?batch=${encodeURIComponent(p.batch_id)}`}
                                          onClick={(e) => e.stopPropagation()}
                                          title="Open Day Batch in Audit Compare"
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-tint hover:bg-brand/15 border border-brand/25 text-brand font-mono text-[10px] font-semibold transition-colors"
                                        >
                                          <Layers className="w-2.5 h-2.5 shrink-0" />
                                          <span>{p.batch?.batch_code || 'Batch'}</span>
                                        </Link>
                                      )}
                                      {p.status === 'PAID' && (
                                        p.receipt_sent_at ? (
                                          <div className="inline-flex items-center gap-1">
                                            <span
                                              title={`Receipt Sent: ${formatHumanDate(toISTDateIso(p.receipt_sent_at))}`}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold"
                                            >
                                              Receipt Sent ✓
                                            </span>
                                            {canUndoReceiptSent && (
                                              <button
                                                type="button"
                                                disabled={markingReceiptId === p.id}
                                                onClick={(e) => handleToggleReceiptSent(e, p, false)}
                                                title="Undo Receipt Sent mark"
                                                className="p-0.5 rounded text-slate-400 hover:text-rose-600 cursor-pointer disabled:opacity-50"
                                              >
                                                {markingReceiptId === p.id ? (
                                                  <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                  <RotateCcw className="w-3 h-3" />
                                                )}
                                              </button>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="inline-flex items-center gap-1">
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold">
                                              Receipt Pending
                                            </span>
                                            {canMarkReceiptSent && (
                                              <button
                                                type="button"
                                                disabled={markingReceiptId === p.id}
                                                onClick={(e) => handleToggleReceiptSent(e, p, true)}
                                                className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-semibold inline-flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                                              >
                                                {markingReceiptId === p.id ? (
                                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                ) : (
                                                  <Send className="w-2.5 h-2.5" />
                                                )}
                                                <span>Mark Sent</span>
                                              </button>
                                            )}
                                          </div>
                                        )
                                      )}
                                    </div>
                                  ) : viewTab === 'REJECTED' ? (
                                    <PaymentStatusBadge status={p.status} />
                                  ) : (
                                    <span className="text-slate-300 font-mono">—</span>
                                  )}
                                </td>

                                <td className="py-3 px-3.5 text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                                  <div>{formatINR(p.net_payable)}</div>
                                  {p.tds > 0 && (
                                    <div className="text-[10px] text-slate-400 font-normal">
                                      TDS: {formatINR(p.tds)}
                                    </div>
                                  )}
                                </td>

                                <td className="py-3 px-3.5 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center justify-end gap-1.5">
                                    {p.status === 'PAID' && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAdvicePayment(p);
                                        }}
                                        className="h-8 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                                        title="Open Payment Acknowledgement Slip & WhatsApp"
                                      >
                                        <MessageCircle className="w-3.5 h-3.5" />
                                        <span>Advice</span>
                                      </button>
                                    )}

                                    {p.invoice_file_path && (
                                      <button
                                        type="button"
                                        onClick={(e) => handleOpenBill(e, p)}
                                        disabled={openingBillId === p.id}
                                        className="h-8 px-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                                        title="Open Supplier Bill"
                                      >
                                        {openingBillId === p.id ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                                        )}
                                        <span>Bill</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenDetail(p);
                                      }}
                                      className={`h-8 px-2 rounded-md border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${p.status === 'PAID'
                                        ? p.audited_at
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                          : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                        }`}
                                      title="Open Audit Trail & Payment Details"
                                    >
                                      {p.status === 'PAID' ? (
                                        p.audited_at ? (
                                          <>
                                            <ShieldCheck className="w-3.5 h-3.5" />
                                            <span>Audited</span>
                                          </>
                                        ) : (
                                          <>
                                            <Clock className="w-3.5 h-3.5" />
                                            <span>Audit</span>
                                          </>
                                        )
                                      ) : (
                                        <>
                                          <Eye className="w-3.5 h-3.5" />
                                          <span>Details</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Crisp Cards (< md) */}
                    <div className="md:hidden divide-y divide-slate-100">
                      {group.items.map((p) => {
                        const partyName =
                          p.vendor?.party_name || p.vendor?.name || 'Unknown Party';
                        const effectiveDate = getEffectiveLedgerDateIST(p);
                        const refLabel =
                          p.payment_mode === 'CHEQUE' && p.cheque_number
                            ? `CHQ #${p.cheque_number}`
                            : p.utr_number
                              ? `UTR: ${p.utr_number}`
                              : null;

                        return (
                          <div
                            key={p.id}
                            data-payment-id={p.id}
                            onClick={() => handleOpenDetail(p)}
                            className={`p-3.5 active:scale-[0.99] transition-all cursor-pointer space-y-2 ${highlightedId === p.id
                              ? 'ring-2 ring-inset ring-brand bg-brand-tint/60 animate-pulse'
                              : ''
                              }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuickFilterVendor(p.vendor_id, partyName);
                                  }}
                                  className="font-semibold text-sm text-slate-900 hover:text-brand truncate block max-w-full text-left cursor-pointer"
                                >
                                  {partyName}
                                </button>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                                  <span className="tabular-nums">
                                    {formatHumanDate(effectiveDate)}
                                  </span>
                                  <span>·</span>
                                  <span className="font-mono truncate">
                                    {p.invoice_ref || 'NA'}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-bold text-sm text-slate-900 tabular-nums">
                                  {formatINR(p.net_payable)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {formatPaymentMode(p.payment_mode, true)}
                                </div>
                              </div>
                            </div>

                            <div className="text-xs text-slate-600 line-clamp-1 bg-slate-50/70 px-2.5 py-1 rounded border border-slate-100">
                              <span className="font-medium text-slate-500">Purpose: </span>
                              {p.purpose}
                            </div>

                            {p.status === 'REJECTED' && p.rejection_reason && (
                              <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1 break-words">
                                <strong>Reason:</strong> {p.rejection_reason}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 text-xs">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                  {p.source_bank?.short_code || p.source_bank?.short_name || 'Bank'}
                                </span>
                                {refLabel && (
                                  <span className="font-mono text-[10px] text-slate-700 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded truncate max-w-[145px]">
                                    {refLabel}
                                  </span>
                                )}
                                {p.batch_id && (
                                  <Link
                                    href={`/audit?batch=${encodeURIComponent(p.batch_id)}`}
                                    onClick={(e) => e.stopPropagation()}
                                    title="Open Day Batch in Audit Compare"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-tint border border-brand/25 text-brand font-mono text-[10px] font-semibold"
                                  >
                                    <Layers className="w-2.5 h-2.5 shrink-0" />
                                    <span>{p.batch?.batch_code || 'Batch'}</span>
                                  </Link>
                                )}
                                {p.status === 'PAID' && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.audited_at
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                      }`}
                                  >
                                    {p.audited_at ? 'Audited' : 'Unaudited'}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 ml-auto">
                                {p.status === 'PAID' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAdvicePayment(p);
                                    }}
                                    className="min-h-[34px] px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 shadow-sm cursor-pointer"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    <span>Payment Advice</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenDetail(p);
                                  }}
                                  className="min-h-[34px] px-2 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-600 inline-flex items-center gap-0.5 cursor-pointer"
                                >
                                  <span>Audit</span>
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Detail / Audit Drawer */}
      <PaymentDetailDrawer
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        payment={selectedPayment}
        activeCompany={activeCompany}
        fallbackUserName={currentUserName}
        onReceiptSent={handleReceiptSentLocal}
      />

      {/* Payment Acknowledgement / WhatsApp Modal */}
      <PaymentAcknowledgementModal
        open={Boolean(advicePayment)}
        onOpenChange={(open) => {
          if (!open) setAdvicePayment(null);
        }}
        payment={advicePayment}
        activeCompany={activeCompany}
        fallbackUserName={currentUserName}
        receiptSentAt={advicePayment?.receipt_sent_at}
        onReceiptSent={handleReceiptSentLocal}
      />
    </div>
  );
}
