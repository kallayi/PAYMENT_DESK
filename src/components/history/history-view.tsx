'use client';

import * as React from 'react';
import {
  Search,
  Download,
  Printer,
  Calendar,
  X,
  Eye,
  ChevronRight,
  FilterX,
  ShieldCheck,
  Clock,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PaymentStatusBadge } from '@/components/payments/payment-status-badge';
import { PaymentDetailDrawer } from '@/components/payments/payment-detail-drawer';
import { PaymentAcknowledgementModal } from '@/components/payments/payment-acknowledgement-modal';
import { formatHumanDate, formatINR, formatDDMMYYYY } from '@/lib/format';
import { generatePaymentsCSV, downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import type { Company, CompanyBank, PaymentItem } from '@/types/database';

interface HistoryViewProps {
  initialPayments: PaymentItem[];
  banks: CompanyBank[];
  companyCode?: string;
  companyName?: string;
  activeCompany?: Company | null;
  currentUserName?: string;
}

export function HistoryView({
  initialPayments,
  banks,
  companyCode = 'INDFURN',
  companyName = 'INDFURN',
  activeCompany,
  currentUserName = 'Accounts Team',
}: HistoryViewProps) {
  // Filters state
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');
  const [bankFilter, setBankFilter] = React.useState<string>('ALL');
  const [auditFilter, setAuditFilter] = React.useState<'ALL' | 'AUDITED' | 'UNAUDITED'>('ALL');
  const [dateFrom, setDateFrom] = React.useState<string>('');
  const [dateTo, setDateTo] = React.useState<string>('');

  // Payment detail drawer & advice modal state
  const [selectedPayment, setSelectedPayment] = React.useState<PaymentItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = React.useState<boolean>(false);
  const [advicePayment, setAdvicePayment] = React.useState<PaymentItem | null>(null);

  // Print dialog state
  const [isPrintDialogOpen, setIsPrintDialogOpen] = React.useState<boolean>(false);
  const [printMode, setPrintMode] = React.useState<'FILTERED' | 'DATE'>('FILTERED');
  const [selectedPrintDate, setSelectedPrintDate] = React.useState<string>('ALL');

  const availablePrintDates = React.useMemo(() => {
    return Array.from(
      new Set(
        initialPayments
          .filter((p) => p.status !== 'DRAFT' && p.status !== 'CANCELLED')
          .map((p) => p.sheet_date)
      )
    ).sort((a, b) => b.localeCompare(a));
  }, [initialPayments]);

  React.useEffect(() => {
    if (availablePrintDates.length > 0 && selectedPrintDate === 'ALL') {
      setSelectedPrintDate(availablePrintDates[0]);
    }
  }, [availablePrintDates, selectedPrintDate]);

  // Filtered payments calculation
  const filteredPayments = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return initialPayments.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) {
        return false;
      }

      if (bankFilter !== 'ALL' && p.source_bank_id !== bankFilter) {
        return false;
      }

      if (auditFilter === 'AUDITED') {
        if (p.status !== 'PAID' || !p.audited_at) return false;
      } else if (auditFilter === 'UNAUDITED') {
        if (p.status !== 'PAID' || Boolean(p.audited_at)) return false;
      }

      if (dateFrom && p.sheet_date < dateFrom) {
        return false;
      }
      if (dateTo && p.sheet_date > dateTo) {
        return false;
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
    initialPayments,
    searchQuery,
    statusFilter,
    bankFilter,
    auditFilter,
    dateFrom,
    dateTo,
  ]);

  const totalFilteredAmount = React.useMemo(() => {
    return filteredPayments.reduce((sum, p) => sum + Number(p.net_payable || 0), 0);
  }, [filteredPayments]);

  const hasActiveFilters = Boolean(
    searchQuery ||
    statusFilter !== 'ALL' ||
    bankFilter !== 'ALL' ||
    auditFilter !== 'ALL' ||
    dateFrom ||
    dateTo
  );

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setBankFilter('ALL');
    setAuditFilter('ALL');
    setDateFrom('');
    setDateTo('');
  };

  // Formula-safe CSV Export
  const handleExportCSV = () => {
    if (filteredPayments.length === 0) {
      toast.error('No payment records to export');
      return;
    }

    try {
      const csv = generatePaymentsCSV(filteredPayments);
      const dateTag = new Date().toISOString().split('T')[0];
      downloadCSV(`${companyCode}_Payments_Export_${dateTag}.csv`, csv);
      toast.success(`Exported ${filteredPayments.length} payment records to CSV`);
    } catch (err: unknown) {
      toast.error(
        'Failed to export CSV: ' + (err instanceof Error ? err.message : 'Unknown error')
      );
    }
  };

  // Open Printable A4 PDF Voucher with active filters or chosen sheet date
  const handleConfirmPrint = () => {
    setIsPrintDialogOpen(false);
    const params = new URLSearchParams();

    if (printMode === 'DATE') {
      params.set('date', selectedPrintDate);
    } else {
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (bankFilter !== 'ALL') params.set('bank', bankFilter);
      if (auditFilter !== 'ALL') params.set('audit', auditFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
    }

    const qs = params.toString();
    window.open(qs ? `/print?${qs}` : '/print', '_blank');
  };

  const handleOpenDetail = (payment: PaymentItem) => {
    setSelectedPayment(payment);
    setIsDetailOpen(true);
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Payment History & Archive — {companyName}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Search past approvals, UTR/Cheque references, audit status, and export CSV or A4 PDF vouchers.
          </p>
        </div>

        {/* Top Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCSV}
            disabled={filteredPayments.length === 0}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-[38px] px-3.5 border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 shadow-sm"
          >
            <Download className="w-4 h-4 mr-1.5 text-slate-500" />
            Export CSV
          </Button>

          <Button
            type="button"
            onClick={() => setIsPrintDialogOpen(true)}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-[38px] px-3.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-sm"
          >
            <Printer className="w-4 h-4 mr-1.5" />
            Print / Save PDF Voucher
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {/* Search Input */}
          <div className="sm:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search party, beneficiary, invoice #, UTR, cheque..."
              className="w-full min-h-[44px] sm:min-h-[38px] pl-9 pr-8 rounded-lg border border-slate-200 bg-slate-50/70 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Select */}
          <div className="sm:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-brand transition-colors cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_VERIFICATION">Pending Verification</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="APPROVED">Ready to Pay</option>
              <option value="PAID">Paid</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Bank Select */}
          <div className="sm:col-span-3">
            <select
              value={bankFilter}
              onChange={(e) => setBankFilter(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-brand transition-colors cursor-pointer"
            >
              <option value="ALL">All Banks</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.bank_name || bank.full_name} ({bank.short_code || bank.short_name})
                </option>
              ))}
            </select>
          </div>

          {/* Audit Status Select */}
          <div className="sm:col-span-2">
            <select
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value as 'ALL' | 'AUDITED' | 'UNAUDITED')}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-brand transition-colors cursor-pointer"
            >
              <option value="ALL">Audit: All</option>
              <option value="AUDITED">Audited Only</option>
              <option value="UNAUDITED">Unaudited Paid</option>
            </select>
          </div>
        </div>

        {/* Date Range & Reset Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <span className="text-slate-500 font-medium inline-flex items-center gap-1 shrink-0">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Sheet Date Range:
            </span>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 w-full sm:w-auto">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="flex-1 sm:flex-initial min-w-[130px] min-h-[38px] px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 outline-none focus:border-brand tabular-nums"
                title="From Date"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="flex-1 sm:flex-initial min-w-[130px] min-h-[38px] px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 outline-none focus:border-brand tabular-nums"
                title="To Date"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="h-8 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-2"
            >
              <FilterX className="w-3.5 h-3.5 mr-1" />
              Reset Filters
            </Button>
          )}
        </div>
      </div>

      {/* Summary Banner */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-3.5 py-2.5 bg-slate-100/70 border border-slate-200/80 rounded-xl text-xs sm:text-sm">
        <div className="font-medium text-slate-700">
          Showing{' '}
          <span className="tabular-nums font-semibold text-slate-900">
            {filteredPayments.length}
          </span>{' '}
          transaction{filteredPayments.length === 1 ? '' : 's'}
        </div>
        <div className="text-slate-600">
          Filtered Net Total:{' '}
          <span className="font-bold tabular-nums text-slate-900 ml-1">
            {formatINR(totalFilteredAmount)}
          </span>
        </div>
      </div>

      {/* Content Area: Table on Desktop, Cards on Mobile */}
      {filteredPayments.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-400">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">No transactions found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            No payment items matched your current search and filter criteria. Try resetting your filters.
          </p>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="text-xs min-h-[38px]"
            >
              Clear All Filters
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table View (md+) */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3.5">Date</th>
                    <th className="py-3 px-3.5">Party & Beneficiary</th>
                    <th className="py-3 px-3.5">Invoice / Ref</th>
                    <th className="py-3 px-3.5">Purpose</th>
                    <th className="py-3 px-3.5 text-right">Net Amount</th>
                    <th className="py-3 px-3.5 text-center">Bank</th>
                    <th className="py-3 px-3.5 text-center">Status & Audit</th>
                    <th className="py-3 px-3.5 text-center">UTR / Cheque</th>
                    <th className="py-3 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPayments.map((p) => {
                    const partyName = p.vendor?.party_name || p.vendor?.name || 'Unknown Party';
                    const beneficiary = p.vendor?.beneficiary_name || partyName;
                    const refLabel =
                      p.payment_mode === 'CHEQUE' && p.cheque_number
                        ? `CHQ #${p.cheque_number}`
                        : p.utr_number || '';

                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                        onClick={() => handleOpenDetail(p)}
                      >
                        <td className="py-3 px-3.5 tabular-nums text-slate-600 whitespace-nowrap">
                          {formatHumanDate(p.sheet_date)}
                        </td>
                        <td className="py-3 px-3.5 max-w-[200px]">
                          <div className="font-semibold text-slate-900 truncate">{partyName}</div>
                          {beneficiary !== partyName && (
                            <div className="text-[10px] text-slate-400 truncate">
                              A/C: {beneficiary}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {p.invoice_ref}
                        </td>
                        <td className="py-3 px-3.5 text-slate-600 max-w-[160px] truncate">
                          {p.purpose}
                        </td>
                        <td className="py-3 px-3.5 text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                          <div>{formatINR(p.net_payable)}</div>
                          <div className="text-[10px] text-slate-400 font-normal">
                            TDS: {p.tds > 0 ? formatINR(p.tds) : 'NA'}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            {p.source_bank?.short_code || p.source_bank?.short_name || 'Bank'}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <PaymentStatusBadge status={p.status} />
                            {p.status === 'PAID' && (
                              p.audited_at ? (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700">
                                  <ShieldCheck className="w-3 h-3" />
                                  <span>Audited</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700">
                                  <Clock className="w-3 h-3" />
                                  <span>Unaudited</span>
                                </span>
                              )
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          {refLabel ? (
                            <span className="font-mono text-[11px] font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {refLabel}
                            </span>
                          ) : (
                            <span className="text-slate-300 font-mono">—</span>
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
                                className="h-8 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                                title="Open Payment Acknowledgement & Share to WhatsApp"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span>Advice / WhatsApp</span>
                              </button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDetail(p);
                              }}
                              className="h-8 w-8 p-0 text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                              title="View Payment Details"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900 text-xs">
                    <td
                      colSpan={4}
                      className="py-3 px-3.5 text-right uppercase tracking-wider text-[11px] text-slate-600"
                    >
                      Filtered Total
                    </td>
                    <td className="py-3 px-3.5 text-right tabular-nums text-slate-900 font-bold">
                      {formatINR(totalFilteredAmount)}
                    </td>
                    <td colSpan={4} className="py-3 px-3.5 text-slate-400 font-normal">
                      {filteredPayments.length} entries
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Mobile Stacked Cards (< md) */}
          <div className="md:hidden space-y-2.5">
            {filteredPayments.map((p) => {
              const partyName = p.vendor?.party_name || p.vendor?.name || 'Unknown Party';
              const refLabel =
                p.payment_mode === 'CHEQUE' && p.cheque_number
                  ? `CHQ #${p.cheque_number}`
                  : p.utr_number
                    ? `UTR: ${p.utr_number}`
                    : null;

              return (
                <div
                  key={p.id}
                  onClick={() => handleOpenDetail(p)}
                  className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm active:scale-[0.99] transition-all cursor-pointer space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-slate-900 truncate">
                        {partyName}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-mono">
                        <span>{formatHumanDate(p.sheet_date)}</span>
                        <span>•</span>
                        <span className="truncate">{p.invoice_ref}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-sm text-slate-900 tabular-nums">
                        {formatINR(p.net_payable)}
                      </div>
                      <div className="mt-0.5 flex items-center justify-end gap-1">
                        <PaymentStatusBadge status={p.status} />
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 line-clamp-1 bg-slate-50/70 px-2.5 py-1 rounded border border-slate-100">
                    <span className="font-medium text-slate-500">Purpose: </span>
                    {p.purpose}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {p.source_bank?.short_code || p.source_bank?.short_name || 'Bank'}
                      </span>
                      {refLabel && (
                        <span className="font-mono text-[10px] text-slate-700 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded truncate max-w-[150px]">
                          {refLabel}
                        </span>
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
                    <div className="flex items-center gap-2 ml-auto">
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
                          <span>Advice / WhatsApp</span>
                        </button>
                      )}
                      <span className="text-[11px] font-medium text-slate-500 flex items-center">
                        Details
                        <ChevronRight className="w-3.5 h-3.5 ml-0.5 text-slate-400" />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail Drawer */}
      <PaymentDetailDrawer
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        payment={selectedPayment}
        activeCompany={activeCompany}
        fallbackUserName={currentUserName}
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
      />

      {/* Print Voucher Options Dialog */}
      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Printer className="w-5 h-5 text-brand" />
              Print A4 Payment Voucher ({companyName})
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Generate an archive-ready A4 Payment Approval & Disbursement Voucher.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setPrintMode('FILTERED')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${printMode === 'FILTERED'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600'
                  }`}
              >
                Current Filtered View ({filteredPayments.length})
              </button>
              <button
                type="button"
                onClick={() => setPrintMode('DATE')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${printMode === 'DATE'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600'
                  }`}
              >
                By Specific Sheet Date
              </button>
            </div>

            {printMode === 'DATE' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Select Sheet Date
                </label>
                <select
                  value={selectedPrintDate}
                  onChange={(e) => setSelectedPrintDate(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-brand"
                >
                  <option value="ALL">All Available Dates</option>
                  {availablePrintDates.map((date) => (
                    <option key={date} value={date}>
                      {formatDDMMYYYY(date)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              Includes {companyName} header, Party & Beneficiary details, Gross/TDS/Net Payable, Bank-wise breakup, UTR/Cheque references, and 4-stage timestamped digital sign-offs.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPrintDialogOpen(false)}
              className="text-xs min-h-[38px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmPrint}
              className="text-xs min-h-[38px] bg-brand hover:bg-brand-hover text-white font-semibold"
            >
              <Printer className="w-4 h-4 mr-1.5" />
              Open Printable Voucher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
