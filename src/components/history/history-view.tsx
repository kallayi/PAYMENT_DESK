'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Download,
  Printer,
  Calendar,
  X,
  Eye,
  FileSpreadsheet,
  ChevronRight,
  FilterX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { formatHumanDate, formatINR, formatDDMMYYYY } from '@/lib/format';
import { generatePaymentsCSV, downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import type { CompanyBank, PaymentItem, PaymentStatus } from '@/types/database';

interface HistoryViewProps {
  initialPayments: PaymentItem[];
  banks: CompanyBank[];
  currentRole: 'OWNER' | 'ACCOUNTANT';
}

export function HistoryView({
  initialPayments,
  banks,
  currentRole,
}: HistoryViewProps) {
  const router = useRouter();

  // Filters state
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');
  const [bankFilter, setBankFilter] = React.useState<string>('ALL');
  const [dateFrom, setDateFrom] = React.useState<string>('');
  const [dateTo, setDateTo] = React.useState<string>('');

  // Payment detail drawer state
  const [selectedPayment, setSelectedPayment] = React.useState<PaymentItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = React.useState<boolean>(false);

  // Print dialog state
  const [isPrintDialogOpen, setIsPrintDialogOpen] = React.useState<boolean>(false);
  const [selectedPrintDate, setSelectedPrintDate] = React.useState<string>('ALL');

  // Available unique dates for the print dialog (excluding drafts)
  const availablePrintDates = React.useMemo(() => {
    const dates = Array.from(
      new Set(
        initialPayments
          .filter((p) => p.status !== 'DRAFT' && p.status !== 'CANCELLED')
          .map((p) => p.sheet_date)
      )
    ).sort((a, b) => b.localeCompare(a));
    return dates;
  }, [initialPayments]);

  // Set default print date when dialog opens or dates change
  React.useEffect(() => {
    if (availablePrintDates.length > 0 && selectedPrintDate === 'ALL') {
      setSelectedPrintDate(availablePrintDates[0]);
    }
  }, [availablePrintDates, selectedPrintDate]);

  // Filtered payments calculation
  const filteredPayments = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return initialPayments.filter((p) => {
      // Status filter
      if (statusFilter !== 'ALL' && p.status !== statusFilter) {
        return false;
      }

      // Bank filter
      if (bankFilter !== 'ALL' && p.source_bank_id !== bankFilter) {
        return false;
      }

      // Date range filter
      if (dateFrom && p.sheet_date < dateFrom) {
        return false;
      }
      if (dateTo && p.sheet_date > dateTo) {
        return false;
      }

      // Text search: vendor name, invoice ref, purpose, UTR
      if (!q) return true;

      const vendorName = p.vendor?.name?.toLowerCase() || '';
      const invoiceRef = p.invoice_ref?.toLowerCase() || '';
      const purpose = p.purpose?.toLowerCase() || '';
      const utr = p.utr_number?.toLowerCase() || '';

      return (
        vendorName.includes(q) ||
        invoiceRef.includes(q) ||
        purpose.includes(q) ||
        utr.includes(q)
      );
    });
  }, [initialPayments, searchQuery, statusFilter, bankFilter, dateFrom, dateTo]);

  // Filtered totals
  const totalFilteredAmount = React.useMemo(() => {
    return filteredPayments.reduce((sum, p) => sum + Number(p.net_payable || 0), 0);
  }, [filteredPayments]);

  // Has active filters
  const hasActiveFilters = Boolean(
    searchQuery ||
      statusFilter !== 'ALL' ||
      bankFilter !== 'ALL' ||
      dateFrom ||
      dateTo
  );

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setBankFilter('ALL');
    setDateFrom('');
    setDateTo('');
  };

  // CSV Export
  const handleExportCSV = () => {
    if (filteredPayments.length === 0) {
      toast.error('No payment records to export');
      return;
    }

    try {
      const csv = generatePaymentsCSV(filteredPayments);
      const dateTag = new Date().toISOString().split('T')[0];
      downloadCSV(`INDFURN_Payments_Export_${dateTag}.csv`, csv);
      toast.success(`Exported ${filteredPayments.length} payment records to CSV`);
    } catch (err: unknown) {
      toast.error('Failed to export CSV: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  // Open print form in new tab or navigate
  const handleConfirmPrint = () => {
    setIsPrintDialogOpen(false);
    const url = `/print?date=${encodeURIComponent(selectedPrintDate)}`;
    window.open(url, '_blank');
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
            Payment History & Audit
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Search past approvals, verified UTR references, and export audit sheets.
          </p>
        </div>

        {/* Top Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCSV}
            disabled={filteredPayments.length === 0}
            className="min-h-[44px] sm:min-h-[38px] px-3.5 border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 shadow-sm"
          >
            <Download className="w-4 h-4 mr-1.5 text-slate-500" />
            Export CSV
          </Button>

          <Button
            type="button"
            onClick={() => setIsPrintDialogOpen(true)}
            className="min-h-[44px] sm:min-h-[38px] px-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-sm"
          >
            <Printer className="w-4 h-4 mr-1.5" />
            Print Form
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {/* Search Input */}
          <div className="sm:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vendor, invoice #, purpose, or UTR..."
              className="w-full min-h-[44px] sm:min-h-[38px] pl-9 pr-8 rounded-lg border border-slate-200 bg-slate-50/70 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-900 transition-colors"
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
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-slate-900 transition-colors cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="APPROVED">Ready to Pay</option>
              <option value="PAID">Paid</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Bank Select */}
          <div className="sm:col-span-4">
            <select
              value={bankFilter}
              onChange={(e) => setBankFilter(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 outline-none focus:border-slate-900 transition-colors cursor-pointer"
            >
              <option value="ALL">All Banks</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.full_name} ({bank.short_name})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date Range & Reset Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-medium inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Date Range:
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 outline-none focus:border-slate-900 tabular-nums"
                title="From Date"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 outline-none focus:border-slate-900 tabular-nums"
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
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-100/70 border border-slate-200/80 rounded-xl text-xs sm:text-sm">
        <div className="font-medium text-slate-700">
          Showing <span className="tabular-nums font-semibold text-slate-900">{filteredPayments.length}</span> transaction{filteredPayments.length === 1 ? '' : 's'}
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
                    <th className="py-3 px-3.5">Vendor</th>
                    <th className="py-3 px-3.5">Invoice / Ref</th>
                    <th className="py-3 px-3.5">Purpose</th>
                    <th className="py-3 px-3.5 text-right">Net Amount</th>
                    <th className="py-3 px-3.5 text-center">Bank</th>
                    <th className="py-3 px-3.5 text-center">Status</th>
                    <th className="py-3 px-3.5 text-center">UTR / Ref</th>
                    <th className="py-3 px-3.5 text-center w-16">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPayments.map((p) => {
                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                        onClick={() => handleOpenDetail(p)}
                      >
                        <td className="py-3 px-3.5 tabular-nums text-slate-600 whitespace-nowrap">
                          {formatHumanDate(p.sheet_date)}
                        </td>
                        <td className="py-3 px-3.5 font-medium text-slate-900 max-w-[180px] truncate">
                          {p.vendor?.name || 'Unknown Vendor'}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {p.invoice_ref}
                        </td>
                        <td className="py-3 px-3.5 text-slate-600 max-w-[160px] truncate">
                          {p.purpose}
                        </td>
                        <td className="py-3 px-3.5 text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                          {formatINR(p.net_payable)}
                        </td>
                        <td className="py-3 px-3.5 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            {p.source_bank?.short_name || 'Bank'}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 text-center">
                          <PaymentStatusBadge status={p.status} />
                        </td>
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          {p.utr_number ? (
                            <span className="font-mono text-[11px] font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {p.utr_number}
                            </span>
                          ) : (
                            <span className="text-slate-300 font-mono">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-center">
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900 text-xs">
                    <td colSpan={4} className="py-3 px-3.5 text-right uppercase tracking-wider text-[11px] text-slate-600">
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
              return (
                <div
                  key={p.id}
                  onClick={() => handleOpenDetail(p)}
                  className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm active:scale-[0.99] transition-all cursor-pointer space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-slate-900 truncate">
                        {p.vendor?.name || 'Unknown Vendor'}
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
                      <div className="mt-0.5">
                        <PaymentStatusBadge status={p.status} />
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 line-clamp-1 bg-slate-50/70 px-2.5 py-1 rounded border border-slate-100">
                    <span className="font-medium text-slate-500">Purpose: </span>
                    {p.purpose}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {p.source_bank?.short_name || 'Bank'}
                      </span>
                      {p.utr_number && (
                        <span className="font-mono text-[10px] text-slate-700 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded truncate max-w-[150px]">
                          UTR: {p.utr_number}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-slate-500 flex items-center">
                      Details
                      <ChevronRight className="w-3.5 h-3.5 ml-0.5 text-slate-400" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail Drawer (Shared Component) */}
      <PaymentDetailDrawer
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        payment={selectedPayment}
      />

      {/* Print Form Selection Dialog */}
      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Printer className="w-5 h-5 text-slate-700" />
              Print Payment Approval Form
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Select which sheet date you want to render in the physical A4 Payment Approval Form layout.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Sheet Date
              </label>
              <select
                value={selectedPrintDate}
                onChange={(e) => setSelectedPrintDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-slate-900 transition-colors"
              >
                <option value="ALL">All Available Dates (Combined Sheet)</option>
                {availablePrintDates.map((date) => (
                  <option key={date} value={date}>
                    {formatDDMMYYYY(date)}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              This will generate the exact printable INDFURN paper sheet with SL No, Party Name, Invoice Ref, Gross, TDS, Net Amount, and sign-off blocks ready for A4 printing or PDF export.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPrintDialogOpen(false)}
              className="text-xs min-h-[40px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmPrint}
              className="text-xs min-h-[40px] bg-slate-900 hover:bg-slate-800 text-white"
            >
              <Printer className="w-4 h-4 mr-1.5" />
              Open Printable Sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
