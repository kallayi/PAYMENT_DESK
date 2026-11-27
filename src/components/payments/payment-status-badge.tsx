import * as React from 'react';
import type { PaymentMode, PaymentStatus } from '@/types/database';

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
}

export function PaymentStatusBadge({ status }: PaymentStatusBadgeProps) {
  switch (status) {
    case 'DRAFT':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
          Draft
        </span>
      );
    case 'PENDING_APPROVAL':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200/80 whitespace-nowrap">
          Pending
        </span>
      );
    case 'ON_HOLD':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200/80 whitespace-nowrap">
          On Hold
        </span>
      );
    case 'APPROVED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-900 text-white border border-slate-900 whitespace-nowrap">
          Ready to Pay
        </span>
      );
    case 'PAID':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80 whitespace-nowrap">
          Paid
        </span>
      );
    case 'REJECTED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200/80 whitespace-nowrap">
          Rejected
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
          {status}
        </span>
      );
  }
}

interface BankBadgeProps {
  shortName?: string | null;
  fullName?: string | null;
}

export function BankBadge({ shortName = 'Bank', fullName }: BankBadgeProps) {
  const name = shortName || 'Bank';
  const lower = name.toLowerCase();
  const isAxis = lower === 'axis';
  const isSib = lower === 'sib';
  const dotColor = isAxis ? 'bg-[#97144D]' : isSib ? 'bg-[#B91C1C]' : 'bg-slate-600';

  return (
    <span
      title={fullName || undefined}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-50 text-slate-700 border border-slate-200 whitespace-nowrap"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{name}</span>
    </span>
  );
}

interface PaymentModeBadgeProps {
  mode?: PaymentMode | string | null;
  chequeNumber?: string | null;
  compact?: boolean;
}

export function PaymentModeBadge({
  mode,
  chequeNumber,
  compact = false,
}: PaymentModeBadgeProps) {
  if (mode === 'CHEQUE') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
        Cheque{chequeNumber ? ` #${chequeNumber}` : ''}
      </span>
    );
  }
  if (mode === 'IMPS') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 whitespace-nowrap">
        IMPS
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
      {compact ? 'NEFT/RTGS' : 'NEFT / RTGS'}
    </span>
  );
}
