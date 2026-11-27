'use client';

import * as React from 'react';
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
  FileSpreadsheet,
  Download,
  Loader2,
  AlertCircle,
  Info,
  Landmark,
} from 'lucide-react';
import { toast } from 'sonner';
import { splitRowsByIfsc } from '@/lib/excel/ifsc';
import type { BankBatchType, BulkExportRow } from '@/lib/excel/types';
import { formatINR } from '@/lib/format';
import type { CompanyBank, PaymentItem, PaymentMode } from '@/types/database';

interface BankExcelExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readyToPayItems: PaymentItem[];
  banks: CompanyBank[];
  companyCode?: string;
}

function isAxisBank(bank: CompanyBank): boolean {
  return (
    (bank.ifsc_prefix || '').toUpperCase().startsWith('UTIB') ||
    (bank.short_code || bank.short_name || '').toUpperCase().includes('AXIS') ||
    (bank.bank_name || bank.full_name || '').toUpperCase().includes('AXIS')
  );
}

const isSalaryPayment = (p: { purpose?: string | null }) =>
  (p.purpose || '').toLowerCase().includes('salary');

export function BankExcelExportModal({
  open,
  onOpenChange,
  readyToPayItems,
  banks,
  companyCode = 'INDFURN',
}: BankExcelExportModalProps) {
  const axisBanks = React.useMemo(
    () => banks.filter((b) => b.is_active && isAxisBank(b)),
    [banks]
  );

  const axisBankIds = React.useMemo(
    () => new Set(axisBanks.map((b) => b.id)),
    [axisBanks]
  );

  // Determine default Axis bank & smart template category when modal opens
  const [selectedBankId, setSelectedBankId] = React.useState<string>('');
  const [templateCategory, setTemplateCategory] = React.useState<'vendor' | 'salary'>('vendor');
  const [autoDetectedSalary, setAutoDetectedSalary] = React.useState<boolean>(false);
  const [downloadingType, setDownloadingType] = React.useState<BankBatchType | 'both' | null>(null);

  React.useEffect(() => {
    if (!open) return;

    const bankWithItems = axisBanks.find((b) =>
      readyToPayItems.some(
        (item) => item.status === 'APPROVED' && item.source_bank_id === b.id
      )
    );
    const defaultBankId = bankWithItems?.id || axisBanks[0]?.id || '';
    setSelectedBankId(defaultBankId);

    const eligibleForBank = readyToPayItems.filter(
      (item) =>
        item.status === 'APPROVED' &&
        item.payment_mode !== 'CHEQUE' &&
        (defaultBankId ? item.source_bank_id === defaultBankId : axisBankIds.has(item.source_bank_id))
    );
    const defaultSalaryCount = eligibleForBank.filter(isSalaryPayment).length;
    const defaultVendorCount = eligibleForBank.length - defaultSalaryCount;

    const shouldDefaultSalary = defaultVendorCount === 0 && defaultSalaryCount > 0;
    setTemplateCategory(shouldDefaultSalary ? 'salary' : 'vendor');
    setAutoDetectedSalary(shouldDefaultSalary);
  }, [open, axisBanks, axisBankIds, readyToPayItems]);

  const selectedBank = axisBanks.find((b) => b.id === selectedBankId) || null;
  const bankShortCode = (selectedBank?.short_code || selectedBank?.short_name || 'AXIS').toUpperCase();
  const bankIfscPrefix = (selectedBank?.ifsc_prefix || 'UTIB').toUpperCase();

  // Count non-Axis items excluded from Axis bulk export
  const nonAxisSkippedCount = React.useMemo(
    () =>
      readyToPayItems.filter(
        (item) =>
          item.status === 'APPROVED' &&
          (!item.source_bank_id || !axisBankIds.has(item.source_bank_id))
      ).length,
    [readyToPayItems, axisBankIds]
  );

  // Filter readyToPayItems to APPROVED items matching the selected Axis Bank account
  const bankItems = React.useMemo(() => {
    if (!selectedBankId) return [];
    return readyToPayItems.filter(
      (item) =>
        item.status === 'APPROVED' &&
        item.source_bank_id === selectedBankId
    );
  }, [readyToPayItems, selectedBankId]);

  const skippedChequeCount = React.useMemo(
    () => bankItems.filter((item) => item.payment_mode === 'CHEQUE').length,
    [bankItems]
  );

  const axisEligiblePayments = React.useMemo(
    () => bankItems.filter((item) => item.payment_mode !== 'CHEQUE'),
    [bankItems]
  );

  // Strictly disjoint Vendor vs Salary buckets
  const salaryPayments = React.useMemo(
    () => axisEligiblePayments.filter(isSalaryPayment),
    [axisEligiblePayments]
  );

  const vendorPayments = React.useMemo(
    () => axisEligiblePayments.filter((p) => !isSalaryPayment(p)),
    [axisEligiblePayments]
  );

  // Active bucket drives all counts, totals, preview rows, and API paymentIds
  const activeExportPayments = React.useMemo(
    () => (templateCategory === 'salary' ? salaryPayments : vendorPayments),
    [templateCategory, salaryPayments, vendorPayments]
  );

  // Convert activeExportPayments to BulkExportRow and run IFSC auto-split
  const splitResult = React.useMemo(() => {
    const rows: BulkExportRow[] = activeExportPayments.map((item) => {
      const v = item.vendor;
      const partyName = v?.party_name || v?.name || 'Unknown Party';
      const beneficiaryName = v?.beneficiary_name || partyName;
      return {
        paymentId: item.id,
        partyName,
        beneficiaryName,
        accountNumber: v?.account_number || '',
        ifscCode: (v?.ifsc_code || '').toUpperCase(),
        netPayable: Number(item.net_payable || 0),
        invoiceRef: item.invoice_ref || '',
        purpose: item.purpose || '',
        sheetDate: item.sheet_date || '',
        sourceBankShortCode: bankShortCode,
        sourceBankIfscPrefix: bankIfscPrefix,
        companyCode,
        paymentMode: (item.payment_mode || 'NEFT_RTGS') as PaymentMode,
      };
    });

    return splitRowsByIfsc(rows, bankIfscPrefix);
  }, [activeExportPayments, bankShortCode, bankIfscPrefix, companyCode]);

  const triggerSingleDownload = async (batchType: BankBatchType): Promise<boolean> => {
    const targetRows =
      batchType === 'same_bank'
        ? splitResult.sameBankRows
        : splitResult.otherBankRows;

    if (targetRows.length === 0 || !selectedBankId) return false;

    const res = await fetch('/api/export/bank-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentIds: targetRows.map((r) => r.paymentId),
        bankId: selectedBankId,
        batchType,
        templateCategory,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({ error: 'Export failed' }));
      toast.error(errJson.error || 'Failed to generate Excel workbook.');
      return false;
    }

    const blob = await res.blob();
    const contentDisposition = res.headers.get('Content-Disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    const fallbackName =
      templateCategory === 'salary'
        ? `${companyCode}_Axis_Salary_${batchType === 'same_bank' ? 'WithinAxis' : 'AcrossAllBanks'}.xlsx`
        : `${companyCode}_${bankShortCode}_${batchType.toUpperCase()}.xlsx`;
    const filename = filenameMatch?.[1] || fallbackName;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Downloaded ${filename} (${targetRows.length} entries)`);
    return true;
  };

  const handleDownload = async (batchType: BankBatchType) => {
    setDownloadingType(batchType);
    try {
      await triggerSingleDownload(batchType);
    } catch {
      toast.error('Network error while downloading Excel file.');
    } finally {
      setDownloadingType(null);
    }
  };

  const handleDownloadBothSeparate = async () => {
    if (
      splitResult.sameBankRows.length === 0 ||
      splitResult.otherBankRows.length === 0 ||
      !selectedBankId
    ) {
      return;
    }

    setDownloadingType('both');
    try {
      const okFirst = await triggerSingleDownload('same_bank');
      if (okFirst) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await triggerSingleDownload('other_bank');
      }
    } catch {
      toast.error('Network error while downloading Excel files.');
    } finally {
      setDownloadingType(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-brand/10 text-brand">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">
                Export Bank Bulk Upload Excel (.xlsx)
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Auto-splits NEFT/RTGS payments by IFSC prefix into Same-Bank (IFT) and Other-Bank batches.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* TEMPLATE CATEGORY SWITCHER */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                Axis Neo Template Format:
              </span>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 border border-slate-200 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setTemplateCategory('vendor')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    templateCategory === 'vendor'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Vendor Payments ({vendorPayments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateCategory('salary')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    templateCategory === 'salary'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Salary Payments ({salaryPayments.length})
                </button>
              </div>
            </div>
            {autoDetectedSalary && templateCategory === 'salary' && (
              <p className="text-[11px] text-emerald-700 font-medium">
                Auto-selected Salary template (only Salary payments found in queue)
              </p>
            )}
            {templateCategory === 'salary' && vendorPayments.length > 0 && (
              <p className="text-[11px] text-slate-500">
                {vendorPayments.length} non-salary vendor payment(s) excluded from Salary export.
              </p>
            )}
            {templateCategory === 'vendor' && salaryPayments.length > 0 && (
              <p className="text-[11px] text-slate-500">
                {salaryPayments.length} Salary payment(s) excluded — switch to Salary Payments tab to export.
              </p>
            )}
          </div>

          {/* SOURCE BANK SELECTOR (Axis Bank Only) */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Landmark className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Disbursing Source Bank:</span>
            </div>

            {axisBanks.length === 0 ? (
              <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No active Axis Bank account configured for this company.
              </div>
            ) : axisBanks.length === 1 ? (
              <div className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs flex items-center gap-2.5 flex-wrap">
                <span className="font-bold text-slate-900">
                  {axisBanks[0].bank_name || axisBanks[0].full_name}
                </span>
                {(axisBanks[0].account_number_masked || axisBanks[0].account_mask) && (
                  <span className="font-mono text-[11px] text-slate-500">
                    {axisBanks[0].account_number_masked || axisBanks[0].account_mask}
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                  {axisBanks[0].short_code || axisBanks[0].short_name}
                </span>
              </div>
            ) : (
              <select
                value={selectedBankId}
                onChange={(e) => setSelectedBankId(e.target.value)}
                className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900 outline-none focus:border-brand"
              >
                {axisBanks.map((b) => {
                  const count = readyToPayItems.filter(
                    (p) => p.status === 'APPROVED' && p.source_bank_id === b.id
                  ).length;
                  return (
                    <option key={b.id} value={b.id}>
                      {b.bank_name || b.full_name} ({b.short_code || b.short_name} · Prefix: {b.ifsc_prefix || 'UTIB'}) — {count} item{count === 1 ? '' : 's'}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* CHEQUE & NON-AXIS EXCLUSION NOTICES */}
          {(skippedChequeCount > 0 || nonAxisSkippedCount > 0) && (
            <div className="space-y-2">
              {nonAxisSkippedCount > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>
                      {nonAxisSkippedCount} non-Axis bank payment{nonAxisSkippedCount === 1 ? '' : 's'} skipped
                    </strong>{' '}
                    — Bulk Excel export is configured for Axis Bank only.
                  </span>
                </div>
              )}
              {skippedChequeCount > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>{skippedChequeCount} Cheque payment{skippedChequeCount === 1 ? '' : 's'}</strong> automatically excluded from bank bulk Excel export. Mark them paid manually with Cheque Number & Date.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* SEPARATE TEMPLATE NOTICE & SEQUENTIAL DUAL DOWNLOAD */}
          {(() => {
            const hasBothBuckets =
              splitResult.sameBankRows.length > 0 &&
              splitResult.otherBankRows.length > 0;
            const hasDebitAccount = Boolean(
              selectedBank?.full_debit_account_number?.trim()
            );
            const isAxisBankSelected =
              bankShortCode === 'AXIS' || bankIfscPrefix === 'UTIB';
            const acrossColLabel =
              templateCategory === 'salary' ? '29-Col' : '31-Col';

            return (
              <div className="space-y-2.5">
                {hasBothBuckets && (
                  <div className="p-3.5 rounded-xl border border-brand/25 bg-brand/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        Separate Axis Neo Templates Required
                      </p>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        {isAxisBankSelected
                          ? `Same-Bank (${bankIfscPrefix} 8-Col) and Other-Bank (NEFT/RTGS/IMPS ${acrossColLabel}) are never merged into one broken file — download both cleanly as two separate .xlsx workbooks.`
                          : 'Same-Bank and Other-Bank transfers download cleanly as separate .xlsx workbooks.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={downloadingType !== null}
                      onClick={handleDownloadBothSeparate}
                      className="bg-brand hover:bg-brand-hover text-white text-xs font-semibold shrink-0"
                    >
                      {downloadingType === 'both' ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      <span>Download Both Separate Files</span>
                    </Button>
                  </div>
                )}

                {selectedBank && !hasDebitAccount && (
                  <p className="text-[11px] text-amber-700 bg-amber-50/90 border border-amber-200 rounded-md px-2.5 py-1.5">
                    Note: Full Corporate Debit A/C is not set for {bankShortCode} in Settings; column 1 will be left blank so you can fill it or set it once in Settings → Company Banks.
                  </p>
                )}
              </div>
            );
          })()}

          {/* SPLIT BATCH SUMMARY & DOWNLOAD CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Same-Bank Card */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Same-Bank ({bankIfscPrefix || bankShortCode} IFT)
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 tabular-nums">
                    {splitResult.sameBankRows.length} item{splitResult.sameBankRows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {bankShortCode === 'AXIS' || bankIfscPrefix === 'UTIB'
                    ? templateCategory === 'salary'
                      ? 'Axis Salary "Default - Within Axis Bank" 8-column template (UTIB only).'
                      : 'Axis "Default - Within Axis Bank" 8-column template (UTIB only).'
                    : `Vendors matching ${bankIfscPrefix || bankShortCode} IFSC prefix (Internal Transfer).`}
                </p>
                <div className="text-lg font-bold text-slate-900 tabular-nums mt-2">
                  {formatINR(splitResult.sameBankTotal)}
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                disabled={splitResult.sameBankRows.length === 0 || downloadingType !== null}
                onClick={() => handleDownload('same_bank')}
                className="w-full bg-brand hover:bg-brand-hover text-white text-xs font-semibold"
              >
                {downloadingType === 'same_bank' ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                )}
                <span>
                  {bankShortCode === 'AXIS' || bankIfscPrefix === 'UTIB'
                    ? templateCategory === 'salary'
                      ? 'Download Salary — Within Axis Bank (8-Col)'
                      : 'Download Axis Same-Bank (.xlsx)'
                    : 'Download Same-Bank Excel'}
                </span>
              </Button>
            </div>

            {/* Other-Bank Card */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Other-Bank (NEFT / RTGS / IMPS)
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 tabular-nums">
                    {splitResult.otherBankRows.length} item{splitResult.otherBankRows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {bankShortCode === 'AXIS' || bankIfscPrefix === 'UTIB'
                    ? templateCategory === 'salary'
                      ? 'Axis Salary "Default - Across All Banks" 29-column template (IMPS / NEFT < ₹2L / RTGS ≥ ₹2L).'
                      : 'Axis "Default - Across All Banks" 31-column template (IMPS / NEFT < ₹2L / RTGS ≥ ₹2L).'
                    : `Non-${bankIfscPrefix || bankShortCode} vendors (IMPS / NEFT < ₹2L / RTGS ≥ ₹2L).`}
                </p>
                <div className="text-lg font-bold text-slate-900 tabular-nums mt-2">
                  {formatINR(splitResult.otherBankTotal)}
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                disabled={splitResult.otherBankRows.length === 0 || downloadingType !== null}
                onClick={() => handleDownload('other_bank')}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                {downloadingType === 'other_bank' ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                )}
                <span>
                  {bankShortCode === 'AXIS' || bankIfscPrefix === 'UTIB'
                    ? templateCategory === 'salary'
                      ? 'Download Salary — Across All Banks (29-Col)'
                      : 'Download Other-Bank NEFT/RTGS/IMPS (.xlsx)'
                    : 'Download Other-Bank Excel'}
                </span>
              </Button>
            </div>
          </div>

          {/* PREVIEW TABLE */}
          {splitResult.sameBankRows.length === 0 && splitResult.otherBankRows.length === 0 ? (
            <div className="p-8 rounded-xl border border-slate-200 bg-slate-50 text-center">
              <AlertCircle className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
              <p className="text-xs font-semibold text-slate-700">
                {templateCategory === 'salary'
                  ? 'No approved Axis NEFT/RTGS/IMPS payments with a Salary purpose found.'
                  : 'No approved Axis NEFT/RTGS/IMPS vendor payments found.'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {templateCategory === 'salary'
                  ? 'Switch to Vendor Payments tab or approve payments with a Salary purpose.'
                  : 'Switch to Salary Payments tab or approve non-salary vendor payments.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { title: `Same-Bank Batch (${bankIfscPrefix || bankShortCode})`, rows: splitResult.sameBankRows },
                { title: 'Other-Bank Batch (NEFT / RTGS / IMPS)', rows: splitResult.otherBankRows },
              ].map(
                (group) =>
                  group.rows.length > 0 && (
                    <div
                      key={group.title}
                      className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                    >
                      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                        {group.title} — {group.rows.length} entries
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                              <th className="py-2 px-3">Beneficiary Name (Bank A/C)</th>
                              <th className="py-2 px-3">Account Number</th>
                              <th className="py-2 px-3">IFSC</th>
                              <th className="py-2 px-3 text-right">Net Payable</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {group.rows.map((r) => (
                              <tr key={r.paymentId} className="hover:bg-slate-50/50">
                                <td className="py-2 px-3">
                                  <div className="font-semibold text-slate-900">
                                    {r.beneficiaryName}
                                  </div>
                                  {r.beneficiaryName !== r.partyName && (
                                    <div className="text-[10px] text-slate-400">
                                      Party: {r.partyName}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-700">
                                  {r.accountNumber || 'MISSING'}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-700">
                                  {r.ifscCode || 'MISSING'}
                                </td>
                                <td className="py-2 px-3 text-right font-bold tabular-nums text-slate-900">
                                  {formatINR(r.netPayable)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
