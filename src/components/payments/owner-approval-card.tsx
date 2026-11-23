'use client';

import * as React from 'react';
import { Check, FileText, Loader2 } from 'lucide-react';
import { formatINR, formatShortDate } from '@/lib/format';
import type { CompanyBank, PaymentItem } from '@/types/database';

interface OwnerApprovalCardProps {
  item: PaymentItem;
  banks: CompanyBank[];
  onApprove: (item: PaymentItem) => void;
  onHold: (item: PaymentItem) => void;
  onReject: (item: PaymentItem) => void;
  onBankSwitch: (item: PaymentItem, newBankId: string) => void;
  onViewBill: (item: PaymentItem) => void;
  isActionLoading?: boolean;
}

export function OwnerApprovalCard({
  item,
  banks,
  onApprove,
  onHold,
  onReject,
  onBankSwitch,
  onViewBill,
  isActionLoading = false,
}: OwnerApprovalCardProps) {
  const isHold = item.status === 'ON_HOLD';
  const vendorName = item.vendor?.name || 'Unknown Vendor';

  return (
    <article className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col gap-3.5 hover:border-slate-300 transition-colors shadow-xs">
      {/* ROW 1: VENDOR NAME | NET PAYABLE AMOUNT */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 truncate">
            {vendorName}
          </h3>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-slate-900 tabular-nums leading-tight">
            {formatINR(item.net_payable)}
          </div>
          {item.tds > 0 && (
            <div className="text-[11px] font-medium text-amber-700 tabular-nums mt-0.5">
              TDS: {formatINR(item.tds)}
            </div>
          )}
        </div>
      </div>

      {/* ROW 2: PURPOSE · REF · DUE */}
      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-slate-700">{item.purpose}</span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">
          Ref: <span className="text-slate-700">{item.invoice_ref}</span>
        </span>
        <span className="text-slate-300">·</span>
        <span className="tabular-nums">Due: {formatShortDate(item.due_date)}</span>
      </div>

      {/* ROW 3: INTERACTIVE INLINE BANK SWITCHER + VIEW BILL */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Pay via:</span>
          <select
            aria-label={`Select source bank for ${vendorName}`}
            value={item.source_bank_id}
            disabled={isActionLoading}
            onChange={(e) => onBankSwitch(item, e.target.value)}
            className="min-h-[36px] pl-2.5 pr-7 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 outline-none focus:border-slate-400 cursor-pointer transition-colors disabled:opacity-50"
          >
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.full_name} ({b.short_name})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => onViewBill(item)}
          className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 inline-flex items-center gap-1 transition-colors cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>View Bill</span>
        </button>
      </div>

      {/* ROW 4: CLEAN 3-BUTTON ACTION BAR (min-h-[44px] touch targets) */}
      <div className="flex items-center gap-2 pt-1">
        {/* APPROVE BUTTON (Solid Green, widest) */}
        <button
          type="button"
          disabled={isActionLoading}
          onClick={() => onApprove(item)}
          className="flex-[1.5] min-h-[44px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
        >
          {isActionLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>Approve</span>
        </button>

        {/* HOLD / RESUME BUTTON */}
        <button
          type="button"
          disabled={isActionLoading}
          onClick={() => onHold(item)}
          className="flex-1 min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
        >
          <span>{isHold ? 'Resume' : 'Hold'}</span>
        </button>

        {/* REJECT BUTTON (Subtle Red outline) */}
        <button
          type="button"
          disabled={isActionLoading}
          onClick={() => onReject(item)}
          className="flex-1 min-h-[44px] px-3 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
        >
          <span>Reject</span>
        </button>
      </div>
    </article>
  );
}
