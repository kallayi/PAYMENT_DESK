'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  formatDDMMYYYY,
  formatINR,
  formatINRPlain,
  formatDateTime,
} from '@/lib/format';
import type { PaymentItem } from '@/types/database';

interface PrintSheetViewProps {
  payments: PaymentItem[];
  companyCode: string;
  companyName: string;
  filterSummary: string;
}

export function PrintSheetView({
  payments,
  companyCode,
  companyName,
  filterSummary,
}: PrintSheetViewProps) {
  const [generatedAt] = React.useState<string>(() =>
    formatDateTime(new Date().toISOString())
  );

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
        className="max-w-5xl mx-auto bg-white p-6 sm:p-10 border border-slate-300 shadow-sm print:border-none print:shadow-none print:p-0 print:max-w-none print:w-full text-slate-900"
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
              const modeLabel = p.payment_mode === 'CHEQUE' ? 'Cheque' : 'NEFT/RTGS';
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
                    <div className="text-[9px] text-slate-600">
                      {modeLabel}
                      {p.payment_type === 'ON_ACCOUNT' ? ' · On Account' : ''}
                    </div>
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
