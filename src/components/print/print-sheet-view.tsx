'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  formatDDMMYYYY,
  formatINR,
  formatINRPlain,
  formatDateTime,
  formatHumanDate,
  formatPaymentMode,
} from '@/lib/format';
import type { PaymentItem } from '@/types/database';

interface PrintSheetViewProps {
  payments: PaymentItem[];
  printMode?: 'voucher' | 'history';
  companyCode: string;
  companyName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  filterSummary: string;
  extraFilterLabel?: string | null;
  printedByName?: string;
  excludedPendingReceiptCount?: number;
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function toISTDateIso(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = new Date(value).getTime();
  if (isNaN(ms)) return value.slice(0, 10);
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function PrintSheetView({
  payments,
  printMode = 'voucher',
  companyCode,
  companyName,
  contactEmail,
  contactPhone,
  filterSummary,
  extraFilterLabel = null,
  printedByName = 'Accounts Team',
  excludedPendingReceiptCount = 0,
}: PrintSheetViewProps) {
  const [generatedAt] = React.useState<string>(() =>
    formatDateTime(new Date().toISOString())
  );

  const isHistoryReport = printMode === 'history';
  const isVinmore = companyCode.toUpperCase().includes('VINMORE');
  const brandHex = isVinmore ? '#0F766E' : '#7F1D1D';

  const handlePrint = () => {
    window.print();
  };

  const totalGross = React.useMemo(() => {
    return payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [payments]);

  const totalTds = React.useMemo(() => {
    return payments.reduce((sum, p) => sum + Number(p.tds || 0), 0);
  }, [payments]);

  const netPayableTotal = payments.reduce(
    (sum, p) => sum + Number(p.net_payable || 0),
    0
  );

  // Bank-wise breakup summary
  const bankBreakup = React.useMemo(() => {
    const map = new Map<string, { label: string; count: number; total: number }>();
    for (const p of payments) {
      const code = p.source_bank?.short_code || p.source_bank?.short_name || 'BANK';
      const existing = map.get(code) || { label: code, count: 0, total: 0 };
      existing.count += 1;
      existing.total += Number(p.net_payable || 0);
      map.set(code, existing);
    }
    return Array.from(map.values());
  }, [payments]);

  // 4-Stage Digital Sign-off extraction (latest/first non-null actor per stage)
  const preparedSample = payments.find((p) => p.creator?.full_name);
  const verifiedSample = payments.find((p) => p.verified_at && p.verifier?.full_name);
  const approvedSample = payments.find((p) => p.approved_at && p.approver?.full_name);
  const auditedSample = payments.find((p) => p.audited_at && p.auditor?.full_name);

  // =========================================================================
  // STRICT SETTLED HISTORY REPORT VIEW (view=history)
  // =========================================================================
  if (isHistoryReport) {
    return (
      <div className="min-h-screen bg-slate-100/70 p-3 sm:p-8 print:p-0 print:bg-white">
        {/* Top On-Screen Control Bar (Strictly Hidden in Print) */}
        <div className="max-w-6xl mx-auto mb-4 space-y-3 no-print print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <Link href="/history">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[38px] text-xs font-medium text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4 mr-1.5" />
                  Back to /history
                </Button>
              </Link>
              <div className="text-xs text-slate-600">
                <strong className="text-slate-900">{companyName}</strong> · {filterSummary}
                {extraFilterLabel ? ` · ${extraFilterLabel}` : ''} ·{' '}
                <strong className="text-emerald-700 tabular-nums">
                  {payments.length} eligible settled record{payments.length === 1 ? '' : 's'}
                </strong>
              </div>
            </div>

            {payments.length > 0 && (
              <Button
                type="button"
                onClick={handlePrint}
                className="min-h-[38px] px-4 bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-sm cursor-pointer"
              >
                <Printer className="w-4 h-4 mr-1.5" />
                Print / Save PDF
              </Button>
            )}
          </div>

          {excludedPendingReceiptCount > 0 && (
            <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5 shadow-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>{excludedPendingReceiptCount}</strong> paid payment(s) in this period were excluded because UTR or Payment Receipt Sent confirmation is pending.
              </span>
            </div>
          )}
        </div>

        {/* Empty State (Zero Eligible Settled + UTR + Receipt-Sent Records) */}
        {payments.length === 0 ? (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-sm space-y-3 no-print">
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto text-amber-600">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <h1 className="text-base font-bold text-slate-900">
              No Eligible Settled Records to Print
            </h1>
            <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
              Only payments that are <strong>Approved &amp; Paid</strong>, have a recorded{' '}
              <strong>UTR / Cheque reference</strong>, and are marked as{' '}
              <strong>Receipt Sent ✓</strong> are eligible for the Settled Payment History printout.
            </p>
            <div className="pt-2">
              <Link href="/history">
                <Button
                  type="button"
                  className="min-h-[40px] px-4 bg-brand hover:bg-brand-hover text-white text-xs font-semibold cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4 mr-1.5" />
                  Return to Payment History
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          /* Company-Isolated Pure White-Paper A4 Print Sheet */
          <div
            id="printable-sheet"
            className="keep-light print-history-ledger max-w-6xl mx-auto bg-white p-6 sm:p-9 border border-slate-300 shadow-sm print:border-none print:shadow-none print:max-w-none print:w-full text-[#111111]"
            style={{
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            }}
          >
            {/* Clean Report Header (Strictly Company-Isolated) */}
            <div
              className="mb-4 pb-3 border-b-2 flex flex-col sm:flex-row sm:items-end justify-between gap-3"
              style={{ borderColor: brandHex }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-lg p-1.5 flex items-center justify-center shrink-0"
                  style={{ backgroundColor: brandHex }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={isVinmore ? '/brand-vinmore-icon.png' : '/brand-indfurn-icon.png'}
                    alt={companyName}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <div
                    className="text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: brandHex }}
                  >
                    {companyName} ({companyCode}) · Official Ledger
                  </div>
                  <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-[#111111] uppercase mt-0.5">
                    SETTLED PAYMENT HISTORY REPORT
                  </h1>
                  <div className="text-xs font-semibold text-slate-800 mt-0.5">
                    {filterSummary}
                    {extraFilterLabel ? ` · ${extraFilterLabel}` : ''}
                  </div>
                  <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-800">
                    <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                    <span>Verified: Approved · UTR Recorded · Receipt Sent</span>
                  </div>
                  {(contactEmail || contactPhone) && (
                    <p className="text-[10px] text-slate-600 mt-1 tabular-nums">
                      {contactEmail}
                      {contactEmail && contactPhone ? ' · ' : ''}
                      {contactPhone}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-left sm:text-right text-[10.5px] text-slate-700 space-y-0.5 shrink-0 tabular-nums">
                <div>
                  <span className="font-bold text-[#111111]">Printed On:</span> {generatedAt}
                </div>
                <div>
                  <span className="font-bold text-[#111111]">Printed By:</span> {printedByName}
                </div>
                <div>
                  <span className="font-bold text-[#111111]">Total Records:</span> {payments.length}
                </div>
              </div>
            </div>

            {/* Crisp 8-Column Ledger Table */}
            <table className="w-full border-collapse border border-slate-800 text-[10px] leading-snug">
              <thead>
                <tr className="bg-slate-100 text-[#111111] font-bold border-b border-slate-800">
                  <th className="border border-slate-800 py-2 px-1.5 text-center w-8">#</th>
                  <th className="border border-slate-800 py-2 px-2 text-left whitespace-nowrap">
                    Paid Date
                  </th>
                  <th className="border border-slate-800 py-2 px-2 text-left">
                    Payee / Vendor
                  </th>
                  <th className="border border-slate-800 py-2 px-2 text-left">
                    Invoice &amp; Purpose
                  </th>
                  <th className="border border-slate-800 py-2 px-2 text-left whitespace-nowrap">
                    Bank &amp; Mode
                  </th>
                  <th className="border border-slate-800 py-2 px-2 text-left whitespace-nowrap">
                    UTR / Cheque Ref
                  </th>
                  <th className="border border-slate-800 py-2 px-2 text-center whitespace-nowrap">
                    Receipt Sent
                  </th>
                  <th className="border border-slate-800 py-2 px-2 text-right whitespace-nowrap">
                    Net Paid (₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, idx) => {
                  const partyName = p.vendor?.party_name || p.vendor?.name || 'Unknown Party';
                  const beneficiary = p.vendor?.beneficiary_name || '';
                  const bankShort = p.source_bank?.short_code || p.source_bank?.short_name || 'Bank';
                  const modeLabel = formatPaymentMode(p.payment_mode, true);
                  const paidIso = toISTDateIso(p.paid_at || p.updated_at || p.sheet_date);
                  const sentIso = toISTDateIso(p.receipt_sent_at);
                  const refText =
                    p.payment_mode === 'CHEQUE' && p.cheque_number
                      ? `CHQ #${p.cheque_number}`
                      : p.utr_number || '—';

                  return (
                    <tr key={p.id} className="border-b border-slate-800 break-inside-avoid">
                      <td className="border border-slate-800 py-1.5 px-1.5 text-center tabular-nums font-medium">
                        {idx + 1}
                      </td>
                      <td className="border border-slate-800 py-1.5 px-2 tabular-nums whitespace-nowrap">
                        {formatHumanDate(paidIso)}
                      </td>
                      <td className="border border-slate-800 py-1.5 px-2">
                        <div className="font-bold text-[#111111]">{partyName}</div>
                        {beneficiary && beneficiary !== partyName && (
                          <div className="text-[9px] text-slate-600">Ben: {beneficiary}</div>
                        )}
                      </td>
                      <td className="border border-slate-800 py-1.5 px-2">
                        <div className="font-mono text-[9.5px] font-semibold text-slate-800">
                          {p.invoice_ref || 'NA'}
                        </div>
                        <div className="text-[9.5px] text-slate-700">{p.purpose}</div>
                      </td>
                      <td className="border border-slate-800 py-1.5 px-2 whitespace-nowrap">
                        <div className="font-bold text-[#111111]">{bankShort}</div>
                        <div className="text-[9px] text-slate-600">{modeLabel}</div>
                      </td>
                      <td className="border border-slate-800 py-1.5 px-2 font-mono text-[9.5px] font-semibold text-[#111111] whitespace-nowrap">
                        {refText}
                      </td>
                      <td className="border border-slate-800 py-1.5 px-2 text-center tabular-nums whitespace-nowrap">
                        <span className="font-bold text-emerald-800">Sent ✓</span>
                        {sentIso && (
                          <div className="text-[8.5px] text-slate-600">
                            {formatHumanDate(sentIso)}
                          </div>
                        )}
                      </td>
                      <td className="border border-slate-800 py-1.5 px-2 text-right font-bold tabular-nums whitespace-nowrap">
                        <div>{formatINRPlain(p.net_payable)}</div>
                        {Number(p.tds || 0) > 0 && (
                          <div className="text-[8.5px] font-normal text-slate-600">
                            TDS: {formatINRPlain(p.tds)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-100 border-t-2 border-slate-900 break-inside-avoid">
                  <td
                    colSpan={6}
                    className="border border-slate-800 py-2 px-2 text-right uppercase tracking-wider text-[10px]"
                  >
                    Grand Total Settled ({payments.length} Record{payments.length === 1 ? '' : 's'})
                    {totalTds > 0 ? ` · Total TDS: ${formatINR(totalTds)}` : ''}
                  </td>
                  <td className="border border-slate-800 py-2 px-2 text-center text-[9.5px] text-emerald-800">
                    All Sent ✓
                  </td>
                  <td
                    className="border border-slate-800 py-2 px-2 text-right tabular-nums text-[11px] font-extrabold whitespace-nowrap"
                    style={{ color: brandHex }}
                  >
                    {formatINR(netPayableTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Compact Bank-Wise Summary */}
            {bankBreakup.length > 0 && (
              <div className="mt-4 p-3 border border-slate-300 rounded bg-slate-50/70 break-inside-avoid">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Bank-Wise Settled Summary
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
                  {bankBreakup.map((b) => (
                    <div key={b.label} className="flex items-center gap-1.5 tabular-nums">
                      <span className="font-bold text-[#111111]">{b.label}:</span>
                      <span className="font-bold text-[#111111]">{formatINR(b.total)}</span>
                      <span className="text-slate-600">({b.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Verification Signature Footer */}
            <div className="mt-8 grid grid-cols-3 gap-8 text-[10px] break-inside-avoid">
              <div className="text-center">
                <div className="h-9 flex flex-col justify-end pb-1">
                  <span className="font-bold text-[#111111]">
                    {preparedSample?.creator?.full_name || 'Accounts Preparer'}
                  </span>
                </div>
                <div className="border-t border-slate-800 pt-1.5 font-bold uppercase tracking-wider text-[#111111]">
                  Prepared By
                </div>
              </div>

              <div className="text-center">
                <div className="h-9 flex flex-col justify-end pb-1">
                  <span className="font-bold text-[#111111]">
                    {verifiedSample?.verifier?.full_name || 'Senior Accountant'}
                  </span>
                </div>
                <div className="border-t border-slate-800 pt-1.5 font-bold uppercase tracking-wider text-[#111111]">
                  Verified By
                </div>
              </div>

              <div className="text-center">
                <div className="h-9 flex flex-col justify-end pb-1">
                  <span className="font-bold text-[#111111]">
                    {approvedSample?.approver?.full_name || 'Authorized Approver'}
                  </span>
                </div>
                <div className="border-t border-slate-800 pt-1.5 font-bold uppercase tracking-wider text-[#111111]">
                  Approved By
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // STANDARD VOUCHER PRINT VIEW (Existing Non-History Print Modes Preserved)
  // =========================================================================
  // Minimum 5 rows for clean formal A4 sheet proportions
  const emptyRowsCount = Math.max(0, 5 - payments.length);

  return (
    <div className="min-h-screen bg-slate-100/70 p-4 sm:p-8 print:p-0 print:bg-white">
      {/* Top Floating Toolbar (Hidden on Print) */}
      <div className="max-w-5xl mx-auto mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print print:hidden bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/history">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[38px] text-xs font-medium text-slate-700 border-slate-200 hover:bg-slate-50"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back to History
            </Button>
          </Link>
          <div className="text-xs text-slate-500">
            <strong className="text-slate-900">{companyName}</strong> · {filterSummary} ({payments.length} entries)
          </div>
        </div>

        <Button
          type="button"
          onClick={handlePrint}
          className="min-h-[38px] px-4 bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-sm"
        >
          <Printer className="w-4 h-4 mr-1.5" />
          Print / Save as PDF
        </Button>
      </div>

      {/* Formal A4 Printable Voucher Sheet */}
      <div
        id="printable-sheet"
        className="keep-light max-w-5xl mx-auto bg-white p-6 sm:p-10 border border-slate-300 shadow-sm print:border-none print:shadow-none print:p-0 print:max-w-none print:w-full text-slate-900"
      >
        {/* Header Block */}
        <div className="mb-5 pb-3 border-b-2 border-[#7F1D1D] flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#7F1D1D]">
              Payment Desk · Official Record
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 uppercase mt-0.5">
              {companyName} ({companyCode})
            </h1>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
              Payment Approval &amp; Disbursement Voucher
            </p>
            {(contactEmail || contactPhone) && (
              <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                {contactEmail}
                {contactEmail && contactPhone ? ' · ' : ''}
                {contactPhone}
              </p>
            )}
          </div>

          <div className="text-left sm:text-right text-[11px] text-slate-600 space-y-0.5">
            <div>
              <span className="font-semibold text-slate-800">Scope:</span> {filterSummary}
            </div>
            <div className="tabular-nums">
              <span className="font-semibold text-slate-800">Generated:</span> {generatedAt}
            </div>
            <div>
              <span className="font-semibold text-slate-800">Entries:</span> {payments.length}
            </div>
          </div>
        </div>

        {/* Formal 10-Column Line-Item Table */}
        <table className="w-full border-collapse border border-slate-800 text-[10px] leading-tight">
          <thead>
            <tr className="bg-slate-100 text-slate-900 font-bold border-b border-slate-800">
              <th className="border border-slate-800 py-2 px-1 text-center w-8">SL</th>
              <th className="border border-slate-800 py-2 px-1.5 text-left">Party / Beneficiary</th>
              <th className="border border-slate-800 py-2 px-1.5 text-center">Invoice / Ref</th>
              <th className="border border-slate-800 py-2 px-1.5 text-center">Due Date</th>
              <th className="border border-slate-800 py-2 px-1.5 text-left">Purpose &amp; Mode</th>
              <th className="border border-slate-800 py-2 px-1.5 text-right">Gross (₹)</th>
              <th className="border border-slate-800 py-2 px-1.5 text-right">TDS (₹)</th>
              <th className="border border-slate-800 py-2 px-1.5 text-right">Net Payable (₹)</th>
              <th className="border border-slate-800 py-2 px-1.5 text-left">Bank &amp; UTR / Cheque</th>
              <th className="border border-slate-800 py-2 px-1.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, index) => {
              const partyName = p.vendor?.party_name || p.vendor?.name || 'Unknown Party';
              const beneficiary = p.vendor?.beneficiary_name || '';
              const bankShort = p.source_bank?.short_code || p.source_bank?.short_name || 'Bank';
              const modeLabel = formatPaymentMode(p.payment_mode, true);
              const refText =
                p.payment_mode === 'CHEQUE' && p.cheque_number
                  ? `CHQ #${p.cheque_number}`
                  : p.utr_number || 'Pending';

              return (
                <tr key={p.id} className="border-b border-slate-800 break-inside-avoid">
                  <td className="border border-slate-800 py-1.5 px-1 text-center tabular-nums font-medium">
                    {index + 1}
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5">
                    <div className="font-bold text-slate-900">{partyName}</div>
                    {beneficiary && beneficiary !== partyName && (
                      <div className="text-[9px] text-slate-600">Ben: {beneficiary}</div>
                    )}
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5 text-center font-mono tabular-nums">
                    {p.invoice_ref}
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5 text-center tabular-nums whitespace-nowrap">
                    {formatDDMMYYYY(p.due_date)}
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5">
                    <div>{p.purpose}</div>
                    <div className="text-[9px] text-slate-600">{modeLabel}</div>
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5 text-right tabular-nums">
                    {formatINRPlain(p.amount)}
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5 text-right tabular-nums">
                    {Number(p.tds || 0) > 0 ? formatINRPlain(p.tds) : 'NA'}
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5 text-right font-bold tabular-nums">
                    {formatINRPlain(p.net_payable)}
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5">
                    <div className="font-semibold">{bankShort}</div>
                    <div className="font-mono text-[9px] text-slate-700">{refText}</div>
                  </td>
                  <td className="border border-slate-800 py-1.5 px-1.5 text-center font-semibold uppercase text-[9px]">
                    <div>{p.status.replace('_', ' ')}</div>
                    {p.audited_at && (
                      <div className="text-[8px] text-emerald-800 font-bold">AUDITED</div>
                    )}
                  </td>
                </tr>
              );
            })}

            {Array.from({ length: emptyRowsCount }).map((_, i) => (
              <tr key={`empty-${i}`} className="h-7 border-b border-slate-800">
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
                <td className="border border-slate-800"></td>
              </tr>
            ))}

            {/* Grand Total Row */}
            <tr className="font-bold bg-slate-100 border-t-2 border-slate-900 break-inside-avoid">
              <td
                colSpan={5}
                className="border border-slate-800 py-2 px-2 text-right uppercase tracking-wider text-[10px]"
              >
                Grand Total ({payments.length} items)
              </td>
              <td className="border border-slate-800 py-2 px-1.5 text-right tabular-nums">
                {formatINRPlain(totalGross)}
              </td>
              <td className="border border-slate-800 py-2 px-1.5 text-right tabular-nums">
                {totalTds > 0 ? formatINRPlain(totalTds) : 'NA'}
              </td>
              <td className="border border-slate-800 py-2 px-1.5 text-right tabular-nums text-[11px] text-[#7F1D1D]">
                {formatINR(netPayableTotal)}
              </td>
              <td colSpan={2} className="border border-slate-800 py-2 px-1.5"></td>
            </tr>
          </tbody>
        </table>

        {/* Bank-Wise Breakup Summary */}
        {bankBreakup.length > 0 && (
          <div className="mt-4 p-3 border border-slate-300 rounded bg-slate-50/70 break-inside-avoid">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Bank-Wise Disbursement Summary
            </div>
            <div className="flex flex-wrap gap-4 text-[11px]">
              {bankBreakup.map((b) => (
                <div key={b.label} className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-900">{b.label}:</span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {formatINR(b.total)}
                  </span>
                  <span className="text-slate-500">({b.count})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4-Stage Digital Timestamped Sign-Off Footer */}
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-6 text-[10px] break-inside-avoid">
          {/* 1. Prepared By */}
          <div className="text-center">
            <div className="h-11 flex flex-col justify-end pb-1">
              {preparedSample?.creator?.full_name ? (
                <>
                  <span className="font-bold text-slate-900">
                    {preparedSample.creator.full_name}
                  </span>
                  <span className="text-[9px] text-slate-500 tabular-nums">
                    {formatDateTime(preparedSample.submitted_at || preparedSample.created_at)}
                  </span>
                </>
              ) : (
                <span className="text-[9px] text-slate-400 italic">—</span>
              )}
            </div>
            <div className="border-t border-slate-800 pt-1.5 font-bold uppercase tracking-wider text-slate-900">
              Prepared By
            </div>
          </div>

          {/* 2. Verified By */}
          <div className="text-center">
            <div className="h-11 flex flex-col justify-end pb-1">
              {verifiedSample?.verifier?.full_name ? (
                <>
                  <span className="font-bold text-slate-900">
                    {verifiedSample.verifier.full_name}
                  </span>
                  <span className="text-[9px] text-slate-500 tabular-nums">
                    {formatDateTime(verifiedSample.verified_at)}
                  </span>
                </>
              ) : (
                <span className="text-[9px] text-slate-400 italic">Pending / Override</span>
              )}
            </div>
            <div className="border-t border-slate-800 pt-1.5 font-bold uppercase tracking-wider text-slate-900">
              Verified By
            </div>
          </div>

          {/* 3. Approved By */}
          <div className="text-center">
            <div className="h-11 flex flex-col justify-end pb-1">
              {approvedSample?.approver?.full_name ? (
                <>
                  <span className="font-bold text-slate-900">
                    {approvedSample.approver.full_name}
                  </span>
                  <span className="text-[9px] text-slate-500 tabular-nums">
                    {formatDateTime(approvedSample.approved_at)}
                  </span>
                </>
              ) : (
                <span className="text-[9px] text-slate-400 italic">Awaiting Approval</span>
              )}
            </div>
            <div className="border-t border-slate-800 pt-1.5 font-bold uppercase tracking-wider text-slate-900">
              Approved By
            </div>
          </div>

          {/* 4. Audited By */}
          <div className="text-center">
            <div className="h-11 flex flex-col justify-end pb-1">
              {auditedSample?.auditor?.full_name ? (
                <>
                  <span className="font-bold text-emerald-800">
                    {auditedSample.auditor.full_name}
                  </span>
                  <span className="text-[9px] text-slate-500 tabular-nums">
                    {formatDateTime(auditedSample.audited_at)}
                  </span>
                </>
              ) : (
                <span className="text-[9px] text-slate-400 italic">Pending Audit</span>
              )}
            </div>
            <div className="border-t border-slate-800 pt-1.5 font-bold uppercase tracking-wider text-slate-900">
              Audited By
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
