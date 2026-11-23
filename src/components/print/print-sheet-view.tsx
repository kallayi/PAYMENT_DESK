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
  selectedDate: string;
  userRole: 'OWNER' | 'ACCOUNTANT';
  userName: string;
}

export function PrintSheetView({
  payments,
  selectedDate,
  userRole,
  userName,
}: PrintSheetViewProps) {
  const handlePrint = () => {
    window.print();
  };

  const totalGross = React.useMemo(() => {
    return payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [payments]);

  const totalTds = React.useMemo(() => {
    return payments.reduce((sum, p) => sum + Number(p.tds || 0), 0);
  }, [payments]);

  const netPayableTotal = totalGross - totalTds;

  // Sign-off metadata extraction
  const firstPrepared = payments.find((p) => p.creator?.full_name);
  const preparedName =
    firstPrepared?.creator?.full_name ||
    (userRole === 'ACCOUNTANT' ? userName : 'Accountant');
  const preparedTimestamp = firstPrepared?.submitted_at || firstPrepared?.created_at;

  const firstApproved = payments.find((p) => p.approver?.full_name && p.status !== 'PENDING_APPROVAL');
  const approvedName = firstApproved?.approver?.full_name;
  const approvedTimestamp = firstApproved?.approved_at;

  // Minimum 6 rows for authentic physical sheet height
  const emptyRowsCount = Math.max(0, 6 - payments.length);

  return (
    <div className="min-h-screen bg-slate-100/70 p-4 sm:p-8 print:p-0 print:bg-white">
      {/* Top Floating / Screen Toolbar (Hidden on Print) */}
      <div className="max-w-5xl mx-auto mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
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
            Sheet Date:{' '}
            <span className="font-semibold text-slate-900 tabular-nums">
              {selectedDate === 'ALL' ? 'All Dates' : formatDDMMYYYY(selectedDate)}
            </span>{' '}
            ({payments.length} items)
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={handlePrint}
            className="min-h-[38px] px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-sm"
          >
            <Printer className="w-4 h-4 mr-1.5" />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* Replicated INDFURN Physical Form (A4 Sheet Container) */}
      <div
        id="printable-sheet"
        className="max-w-5xl mx-auto bg-white p-8 sm:p-12 border border-slate-300 shadow-sm print:border-none print:shadow-none print:p-0 print:max-w-none print:w-full"
      >
        {/* Header Block */}
        <div className="mb-6">
          <h1 className="text-center text-xl font-bold tracking-tight text-slate-900 uppercase">
            Payment Approval Form
          </h1>
          <div className="mt-4 flex items-center justify-between text-xs font-bold text-slate-900 border-b-2 border-slate-900 pb-2">
            <span className="tracking-widest">INDFURN</span>
            <span className="tabular-nums">
              Date: {selectedDate === 'ALL' ? 'All Dates' : formatDDMMYYYY(selectedDate)}
            </span>
          </div>
        </div>

        {/* Exact Replicated Table */}
        <table className="w-full border-collapse border border-slate-900 text-[11px] sm:text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-900 font-bold border-b border-slate-900">
              <th className="border border-slate-900 py-2 px-1 text-center w-10">
                SL No.
              </th>
              <th className="border border-slate-900 py-2 px-2.5 text-left">
                Vendor/Supplier
              </th>
              <th className="border border-slate-900 py-2 px-2 text-center">
                Invoice / Ref No
              </th>
              <th className="border border-slate-900 py-2 px-2 text-center">
                Due Date
              </th>
              <th className="border border-slate-900 py-2 px-2 text-center">
                Purpose
              </th>
              <th className="border border-slate-900 py-2 px-2 text-right">
                Amount (₹)
              </th>
              <th className="border border-slate-900 py-2 px-2 text-center">
                TDS (₹)
              </th>
              <th className="border border-slate-900 py-2 px-2 text-center">
                Payment Ref NO
              </th>
              <th className="border border-slate-900 py-2 px-2 text-center">
                Remarks
              </th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, index) => {
              const bankShort = p.source_bank?.short_name || 'Bank';
              const remarksText = p.remarks
                ? `${bankShort} · ${p.remarks}`
                : bankShort;

              return (
                <tr key={p.id} className="border-b border-slate-900">
                  <td className="border border-slate-900 py-2 px-1 text-center tabular-nums font-medium text-slate-800">
                    {index + 1}
                  </td>
                  <td className="border border-slate-900 py-2 px-2.5 font-semibold text-slate-900">
                    {p.vendor?.name || 'Unknown Vendor'}
                  </td>
                  <td className="border border-slate-900 py-2 px-2 text-center font-mono tabular-nums text-slate-800">
                    {p.invoice_ref}
                  </td>
                  <td className="border border-slate-900 py-2 px-2 text-center tabular-nums whitespace-nowrap text-slate-800">
                    {formatDDMMYYYY(p.due_date)}
                  </td>
                  <td className="border border-slate-900 py-2 px-2 text-center text-slate-800">
                    {p.purpose}
                  </td>
                  <td className="border border-slate-900 py-2 px-2 text-right font-medium tabular-nums text-slate-900">
                    {formatINRPlain(p.amount)}
                  </td>
                  <td className="border border-slate-900 py-2 px-2 text-center tabular-nums text-slate-800">
                    {Number(p.tds || 0) > 0 ? formatINRPlain(p.tds) : 'NA'}
                  </td>
                  <td className="border border-slate-900 py-2 px-2 text-center font-mono text-[11px] tabular-nums text-slate-800">
                    {p.utr_number || '—'}
                  </td>
                  <td className="border border-slate-900 py-2 px-2 text-center text-[11px] text-slate-800">
                    {remarksText}
                  </td>
                </tr>
              );
            })}

            {/* Empty padding rows for physical sheet layout consistency */}
            {Array.from({ length: emptyRowsCount }).map((_, i) => (
              <tr key={`empty-${i}`} className="h-8 border-b border-slate-900">
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
                <td className="border border-slate-900"></td>
              </tr>
            ))}

            {/* Total Row */}
            <tr className="font-bold bg-slate-50 border-t-2 border-slate-900">
              <td
                colSpan={5}
                className="border border-slate-900 py-2 px-3 text-right uppercase tracking-wider text-xs"
              >
                Total
              </td>
              <td className="border border-slate-900 py-2 px-2 text-right tabular-nums text-slate-900">
                {formatINRPlain(totalGross)}
              </td>
              <td className="border border-slate-900 py-2 px-2 text-center tabular-nums text-slate-900">
                {totalTds > 0 ? formatINRPlain(totalTds) : 'NA'}
              </td>
              <td
                colSpan={2}
                className="border border-slate-900 py-2 px-2 text-center text-[11px] font-semibold text-slate-800"
              >
                Net: {formatINR(netPayableTotal)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Footer Sign-Off Row */}
        <div className="mt-14 grid grid-cols-3 gap-8 text-xs">
          {/* Prepared By */}
          <div className="text-center">
            <div className="h-12 flex flex-col justify-end pb-1 text-[11px] text-slate-800">
              <span className="font-semibold text-slate-900">{preparedName}</span>
              {preparedTimestamp && (
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {formatDateTime(preparedTimestamp)}
                </span>
              )}
            </div>
            <div className="border-t border-slate-900 pt-1.5 font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Prepared By
            </div>
          </div>

          {/* Checked By */}
          <div className="text-center">
            <div className="h-12"></div>
            <div className="border-t border-slate-900 pt-1.5 font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Checked By
            </div>
          </div>

          {/* Approved By */}
          <div className="text-center">
            <div className="h-12 flex flex-col justify-end pb-1 text-[11px] text-slate-800">
              {approvedName ? (
                <>
                  <span className="font-bold text-slate-900">{approvedName}</span>
                  {approvedTimestamp && (
                    <span className="text-[10px] text-slate-500 tabular-nums">
                      {formatDateTime(approvedTimestamp)}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[10px] text-slate-400 italic">
                  Awaiting Approval
                </span>
              )}
            </div>
            <div className="border-t border-slate-900 pt-1.5 font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Approved By
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
