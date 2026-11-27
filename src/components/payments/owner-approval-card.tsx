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
import { OwnerBankSwitcher } from '@/components/payments/owner-bank-switcher';
import { PaymentModeBadge } from '@/components/payments/payment-status-badge';
import type { CompanyBank, PaymentItem } from '@/types/database';

interface OwnerApprovalCardProps {
  item: PaymentItem;
  banks: CompanyBank[];
  isSelected?: boolean;
  isHighlighted?: boolean;
  onToggleSelect?: () => void;
  onApprove: (item: PaymentItem) => void;
  onHold: (item: PaymentItem) => void;
  onReject: (item: PaymentItem) => void;
  onBankSwitch: (item: PaymentItem, newBankId: string) => void;
  onViewBill: (item: PaymentItem) => void;
  isActionLoading?: boolean;
  isBankSwitching?: boolean;
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
  isHighlighted = false,
  onToggleSelect,
  onApprove,
  onHold,
  onReject,
  onBankSwitch,
  onViewBill,
  isActionLoading = false,
  isBankSwitching = false,
  isOverrideTab = false,
}: OwnerApprovalCardProps) {
  const isHold = item.status === 'ON_HOLD';
  const isAlreadyApproved = item.status === 'APPROVED' || item.status === 'PAID';
  const vendor = item.vendor;
  const partyName = vendor?.party_name || vendor?.name || 'Unknown Party';
  const beneficiaryName = vendor?.beneficiary_name || partyName;
  const overdue = isOverdue(item.due_date);

  return (
    <article
      data-payment-id={item.id}
      className={`bg-white rounded-xl border p-3 sm:p-5 flex flex-col gap-2.5 sm:gap-3.5 transition-all shadow-sm ${isHighlighted
        ? 'border-brand ring-2 ring-brand animate-pulse'
        : isSelected
          ? 'border-brand ring-1 ring-brand bg-brand/5'
          : 'border-slate-200 hover:border-slate-300'
        }`}
    >
      {/* ROW 1: CHECKBOX + VENDOR & BENEFICIARY + NET PAYABLE */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-3">
        <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
          {onToggleSelect && !isAlreadyApproved && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="mt-1 w-4 h-4 rounded text-brand focus:ring-brand border-slate-300 cursor-pointer shrink-0"
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 line-clamp-2 leading-snug">
                {partyName}
              </h3>
              {overdue && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 uppercase shrink-0">
                  Overdue
                </span>
              )}
              {isOverrideTab && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0">
                  Awaiting Verification (Override)
                </span>
              )}
              {isHold && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0">
                  On Hold
                </span>
              )}
            </div>

            {/* Beneficiary details line */}
            <div className="text-xs text-slate-600 mt-1 flex items-start sm:items-center gap-1.5 flex-wrap">
              <CreditCard className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 sm:mt-0" />
              <span className="font-medium text-slate-700 break-words">
                Beneficiary: {beneficiaryName}
              </span>
              {vendor?.account_number && (
                <span className="text-[11px] text-slate-400 font-mono break-all sm:break-normal">
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
              <span className="text-slate-300">·</span>
              <PaymentModeBadge mode={item.payment_mode} compact />
            </div>
          </div>
        </div>

        {/* Amount display (Full-width clean row on <640px, right-aligned on sm+) */}
        <div className="flex items-baseline justify-between gap-2 sm:block sm:text-right shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 pl-6 sm:pl-0">
          <div className="text-base sm:text-lg font-bold text-slate-900 tabular-nums leading-tight">
            {formatINR(item.net_payable)}
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums sm:mt-0.5">
            Gross: <span className="font-medium text-slate-700">{formatINR(item.amount)}</span>
            {' · '}
            TDS: <span className="font-medium text-slate-700">{item.tds > 0 ? formatINR(item.tds) : 'NA'}</span>
          </div>
        </div>
      </div>

      {/* ROW 2: REMARKS (if present) */}
      {item.remarks && (
        <div className="text-xs bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 text-slate-600 italic break-words">
          <span className="font-medium not-italic text-slate-500">Note: </span>
          {item.remarks}
        </div>
      )}

      {/* ROW 3: INTERACTIVE INLINE BANK SWITCHER + VIEW BILL */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1 max-w-full">
          <span className="text-xs text-slate-500 font-medium shrink-0">Disburse from:</span>
          <OwnerBankSwitcher
            banks={banks}
            selectedBankId={item.source_bank_id}
            fallbackBank={item.source_bank}
            billNetPayable={Number(item.net_payable) || 0}
            partyName={partyName}
            disabled={isActionLoading || isAlreadyApproved}
            isSwitching={isBankSwitching}
            onSelectBank={(newBankId) => onBankSwitch(item, newBankId)}
          />
        </div>

        {item.invoice_file_path ? (
          <button
            type="button"
            onClick={() => onViewBill(item)}
            className="min-h-[38px] px-2.5 rounded-lg text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>View Bill</span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-400 shrink-0">No bill file</span>
        )}
      </div>

      {/* ROW 4: ACTION BUTTONS (or Read-only Approved Badge) */}
      {isAlreadyApproved ? (
        <div className="pt-1 flex items-center">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <span>{item.status === 'PAID' ? 'Paid / Settled' : 'Approved — Awaiting UTR'}</span>
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-1">
          {/* APPROVE BUTTON (Solid, widest) */}
          <button
            type="button"
            disabled={isActionLoading}
            onClick={() => onApprove(item)}
            className="flex-[1.5] min-w-[120px] min-h-[44px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
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
              className="flex-1 min-w-[74px] min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span>{isHold ? 'Resume' : 'Hold'}</span>
            </button>
          )}

          {/* REJECT BUTTON */}
          <button
            type="button"
            disabled={isActionLoading}
            onClick={() => onReject(item)}
            className="flex-1 min-w-[74px] min-h-[44px] px-3 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <span>Reject</span>
          </button>
        </div>
      )}
    </article>
  );
}
