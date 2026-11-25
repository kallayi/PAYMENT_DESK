'use client';

import * as React from 'react';
import {
  Check,
  FileText,
  Loader2,
  AlertTriangle,
  Building2,
  CreditCard,
  ExternalLink,
} from 'lucide-react';
import { formatINR, formatShortDate } from '@/lib/format';
import type { CompanyBank, PaymentItem } from '@/types/database';

interface OwnerApprovalCardProps {
  item: PaymentItem;
  banks: CompanyBank[];
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onApprove: (item: PaymentItem) => void;
  onHold: (item: PaymentItem) => void;
  onReject: (item: PaymentItem) => void;
  onBankSwitch: (item: PaymentItem, newBankId: string) => void;
  onViewBill: (item: PaymentItem) => void;
  isActionLoading?: boolean;
  isOverrideTab?: boolean;
}

function isOverdue(dueDateStr: string): boolean {
  if (!dueDateStr) return false;
  const today = new Date().toISOString().split('T')[0];
  return dueDateStr < today;
}

export function OwnerApprovalCard({
  item,
  banks,
  isSelected = false,
  onToggleSelect,
  onApprove,
  onHold,
  onReject,
  onBankSwitch,
  onViewBill,
  isActionLoading = false,
  isOverrideTab = false,
}: OwnerApprovalCardProps) {
  const isHold = item.status === 'ON_HOLD';
  const vendor = item.vendor;
  const partyName = vendor?.party_name || vendor?.name || 'Unknown Party';
  const beneficiaryName = vendor?.beneficiary_name || partyName;
  const overdue = isOverdue(item.due_date);

  return (
    <article
      className={`bg-white rounded-xl border p-4 sm:p-5 flex flex-col gap-3.5 transition-all shadow-xs ${
        isSelected
          ? 'border-brand ring-1 ring-brand bg-brand/5'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* ROW 1: CHECKBOX + VENDOR & BENEFICIARY + NET PAYABLE */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="mt-1 w-4 h-4 rounded text-brand focus:ring-brand border-slate-300 cursor-pointer"
            />
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {partyName}
              </h3>
              {overdue && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 uppercase">
                  Overdue
                </span>
              )}
              {isOverrideTab && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                  Awaiting Verification (Override)
                </span>
              )}
              {isHold && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                  On Hold
                </span>
              )}
            </div>

            {/* Beneficiary details line */}
            <div className="text-xs text-slate-600 mt-1 flex items-center gap-1.5 truncate">
              <CreditCard className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700 truncate">
                Beneficiary: {beneficiaryName}
              </span>
              {vendor?.account_number && (
                <span className="text-[11px] text-slate-400 font-mono">
                  (A/C: {vendor.account_number} • {vendor.ifsc_code})
                </span>
              )}
            </div>

            <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-slate-700">{item.purpose}</span>
              <span className="text-slate-300">·</span>
              <span className="tabular-nums">
                Ref: <span className="font-mono font-medium text-slate-800">{item.invoice_ref}</span>
              </span>
              <span className="text-slate-300">·</span>
              <span className="tabular-nums">
                Due: <span className="font-medium text-slate-800">{formatShortDate(item.due_date)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Amount display */}
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-slate-900 tabular-nums leading-tight">
            {formatINR(item.net_payable)}
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
            Gross: <span className="font-medium text-slate-700">{formatINR(item.amount)}</span>
            {' · '}
            TDS: <span className="font-medium text-slate-700">{item.tds > 0 ? formatINR(item.tds) : 'NA'}</span>
          </div>
        </div>
      </div>

      {/* ROW 2: REMARKS (if present) */}
      {item.remarks && (
        <div className="text-xs bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 text-slate-600 italic">
          <span className="font-medium not-italic text-slate-500">Note: </span>
          {item.remarks}
        </div>
      )}

      {/* ROW 3: INTERACTIVE INLINE BANK SWITCHER + VIEW BILL */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 font-medium">Disburse from:</span>
          <select
            aria-label={`Select source bank for ${partyName}`}
            value={item.source_bank_id}
            disabled={isActionLoading}
            onChange={(e) => onBankSwitch(item, e.target.value)}
            className="min-h-[34px] pl-2.5 pr-7 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 outline-none focus:border-brand cursor-pointer transition-colors disabled:opacity-50"
          >
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bank_name || b.full_name} ({b.short_code || b.short_name}) — Bal: {formatINR(b.available_balance ?? 0)}
              </option>
            ))}
          </select>
        </div>

        {item.invoice_file_path ? (
          <button
            type="button"
            onClick={() => onViewBill(item)}
            className="min-h-[34px] px-2.5 rounded-lg text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>View Bill</span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">No bill file</span>
        )}
      </div>

      {/* ROW 4: ACTION BUTTONS */}
      <div className="flex items-center gap-2 pt-1">
        {/* APPROVE BUTTON (Maroon / Solid, widest) */}
        <button
          type="button"
          disabled={isActionLoading}
          onClick={() => onApprove(item)}
          className="flex-[1.5] min-h-[42px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
        >
          {isActionLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>{isOverrideTab ? 'Authorize Override' : 'Approve'}</span>
        </button>

        {/* HOLD / RESUME BUTTON */}
        {!isOverrideTab && (
          <button
            type="button"
            disabled={isActionLoading}
            onClick={() => onHold(item)}
            className="flex-1 min-h-[42px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <span>{isHold ? 'Resume' : 'Hold'}</span>
          </button>
        )}

        {/* REJECT BUTTON */}
        <button
          type="button"
          disabled={isActionLoading}
          onClick={() => onReject(item)}
          className="flex-1 min-h-[42px] px-3 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
        >
          <span>Reject</span>
        </button>
      </div>
    </article>
  );
}
