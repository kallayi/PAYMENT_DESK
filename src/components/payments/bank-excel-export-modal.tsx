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
import type { CompanyBank, PaymentItem } from '@/types/database';

interface BankExcelExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readyToPayItems: PaymentItem[];
  banks: CompanyBank[];
  companyCode?: string;
}

export function BankExcelExportModal({
  open,
  onOpenChange,
  readyToPayItems,
  banks,
  companyCode = 'INDFURN',
}: BankExcelExportModalProps) {
  const activeBanks = React.useMemo(
    () => banks.filter((b) => b.is_active),
    [banks]
  );

  // Determine default bank based on items present
  const [selectedBankId, setSelectedBankId] = React.useState<string>('');
  const [downloadingType, setDownloadingType] = React.useState<BankBatchType | null>(null);

  React.useEffect(() => {
    if (!open) return;

    // Pick the first bank that has items in readyToPayItems, or fallback to first active bank
    const bankWithItems = activeBanks.find((b) =>
      readyToPayItems.some((item) => item.source_bank_id === b.id)
    );
    setSelectedBankId(bankWithItems?.id || activeBanks[0]?.id || '');
  }, [open, activeBanks, readyToPayItems]);

  const selectedBank = activeBanks.find((b) => b.id === selectedBankId) || null;
  const bankShortCode = (selectedBank?.short_code || selectedBank?.short_name || 'BANK').toUpperCase();
  const bankIfscPrefix = (selectedBank?.ifsc_prefix || '').toUpperCase();

  // Filter readyToPayItems to the selected source bank
  const bankItems = React.useMemo(() => {
    if (!selectedBankId) return [];
    return readyToPayItems.filter((item) => item.source_bank_id === selectedBankId);
  }, [readyToPayItems, selectedBankId]);

  // Convert to BulkExportRow and run IFSC auto-split
  const splitResult = React.useMemo(() => {
    const rows: BulkExportRow[] = bankItems.map((item) => {
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
        paymentMode: (item.payment_mode || 'NEFT_RTGS') as 'NEFT_RTGS' | 'CHEQUE',
      };
    });

    return splitRowsByIfsc(rows, bankIfscPrefix);
  }, [bankItems, bankShortCode, bankIfscPrefix, companyCode]);

  const handleDownload = async (batchType: BankBatchType) => {
    const targetRows =
      batchType === 'combined'
        ? [...splitResult.sameBankRows, ...splitResult.otherBankRows]
        : batchType === 'same_bank'
          ? splitResult.sameBankRows
          : splitResult.otherBankRows;

    if (targetRows.length === 0 || !selectedBankId) return;

    setDownloadingType(batchType);
    try {
      const res = await fetch('/api/export/bank-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIds: targetRows.map((r) => r.paymentId),
          bankId: selectedBankId,
          batchType,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Export failed' }));
        toast.error(errJson.error || 'Failed to generate Excel workbook.');
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
      const fallbackName = `${companyCode}_${bankShortCode}_${batchType.toUpperCase()}.xlsx`;
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
    } catch {
      toast.error('Network error while downloading Excel file.');
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
          {/* SOURCE BANK SELECTOR */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Landmark className="w-4 h-4 text-slate-500" />
              <span>Disbursing Source Bank:</span>
            </div>
            <select
              value={selectedBankId}
              onChange={(e) => setSelectedBankId(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900 outline-none focus:border-brand"
            >
              {activeBanks.map((b) => {
                const count = readyToPayItems.filter((p) => p.source_bank_id === b.id).length;
                return (
                  <option key={b.id} value={b.id}>
                    {b.bank_name || b.full_name} ({b.short_code || b.short_name} · Prefix: {b.ifsc_prefix || 'NA'}) — {count} item{count === 1 ? '' : 's'}
                  </option>
                );
              })}
            </select>
          </div>

          {/* CHEQUE EXCLUSION NOTICE */}
          {splitResult.skippedChequeCount > 0 && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>{splitResult.skippedChequeCount} Cheque payment{splitResult.skippedChequeCount === 1 ? '' : 's'}</strong> automatically excluded from bank bulk Excel export. Mark them paid manually with Cheque Number & Date.
              </span>
            </div>
          )}

          {/* COMBINED ALL-BANKS DOWNLOAD BANNER */}
          {(() => {
            const combinedCount =
              splitResult.sameBankRows.length + splitResult.otherBankRows.length;
            const combinedTotal =
              splitResult.sameBankTotal + splitResult.otherBankTotal;
            const hasDebitAccount = Boolean(selectedBank?.full_debit_account_number?.trim());

            return (
              <div className="p-4 rounded-xl border border-brand/25 bg-brand/5 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        Combined Bulk Upload (All Banks · {bankShortCode} Neo 31-Col Format)
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white border border-brand/20 text-brand tabular-nums">
                        {combinedCount} item{combinedCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Downloads IFT (Mode &lsquo;I&rsquo;) + NEFT + RTGS rows together in the official &ldquo;Default - Across All Banks&rdquo; template — {formatINR(combinedTotal)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={combinedCount === 0 || downloadingType !== null}
                    onClick={() => handleDownload('combined')}
                    className="bg-brand hover:bg-brand-hover text-white text-xs font-semibold shrink-0"
                  >
                    {downloadingType === 'combined' ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    <span>Download Combined (All Banks)</span>
                  </Button>
                </div>
                {!hasDebitAccount && (
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
                  Vendors matching {bankIfscPrefix || bankShortCode} IFSC prefix (Internal Transfer).
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
                <span>Download Same-Bank Excel</span>
              </Button>
            </div>

            {/* Other-Bank Card */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    Other-Bank (NEFT / RTGS)
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 tabular-nums">
                    {splitResult.otherBankRows.length} item{splitResult.otherBankRows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Non-{bankIfscPrefix || bankShortCode} vendors (auto-routed NEFT &lt; ₹2L / RTGS ≥ ₹2L).
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
                <span>Download Other-Bank Excel</span>
              </Button>
            </div>
          </div>

          {/* PREVIEW TABLE */}
          {splitResult.sameBankRows.length === 0 && splitResult.otherBankRows.length === 0 ? (
            <div className="p-8 rounded-xl border border-slate-200 bg-slate-50 text-center">
              <AlertCircle className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
              <p className="text-xs font-semibold text-slate-700">
                No eligible NEFT/RTGS rows for {bankShortCode}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Select another disbursing bank or select approved NEFT/RTGS payments.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { title: `Same-Bank Batch (${bankIfscPrefix || bankShortCode})`, rows: splitResult.sameBankRows },
                { title: 'Other-Bank Batch (NEFT / RTGS)', rows: splitResult.otherBankRows },
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
