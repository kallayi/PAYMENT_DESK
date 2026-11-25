'use client';

import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Lock,
  Copy,
  Check,
  FileText,
  Receipt,
  ExternalLink,
  ShieldCheck,
  ChevronDown,
  Loader2,
  AlertCircle,
  Clock,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { PaymentStatusBadge } from '@/components/payments/payment-status-badge';
import { PaymentAcknowledgementModal } from '@/components/payments/payment-acknowledgement-modal';
import { getSignedFileUrl } from '@/actions/storage';
import { getPaymentAuditLogs } from '@/actions/payments';
import { formatHumanDate, formatINR, formatDateTime } from '@/lib/format';
import type { AuditLog, Company, PaymentItem } from '@/types/database';

interface PaymentDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentItem | null;
  activeCompany?: Company | null;
  fallbackUserName?: string;
}

export function PaymentDetailDrawer({
  open,
  onOpenChange,
  payment,
  activeCompany,
  fallbackUserName,
}: PaymentDetailDrawerProps) {
  const [copiedUtr, setCopiedUtr] = React.useState<boolean>(false);
  const [isViewingInvoice, setIsViewingInvoice] = React.useState<boolean>(false);
  const [isViewingReceipt, setIsViewingReceipt] = React.useState<boolean>(false);
  const [isAdviceOpen, setIsAdviceOpen] = React.useState<boolean>(false);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = React.useState<AuditLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!open || !payment) {
      setAuditLogs([]);
      setIsAdviceOpen(false);
      return;
    }

    let isMounted = true;
    setIsLoadingLogs(true);

    getPaymentAuditLogs(payment.id)
      .then((res) => {
        if (isMounted) {
          setAuditLogs(res.success ? res.data : []);
        }
      })
      .catch(() => {
        if (isMounted) setAuditLogs([]);
      })
      .finally(() => {
        if (isMounted) setIsLoadingLogs(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, payment]);

  if (!payment) return null;

  const isLocked = payment.status === 'APPROVED' || payment.status === 'PAID';
  const partyName = payment.vendor?.party_name || payment.vendor?.name || 'Unknown Party';
  const beneficiaryName = payment.vendor?.beneficiary_name || partyName;
  const bankName = payment.source_bank?.bank_name || payment.source_bank?.full_name || 'Bank';
  const bankShort = payment.source_bank?.short_code || payment.source_bank?.short_name || 'Bank';
  const invoiceFileName = payment.invoice_file_path
    ? payment.invoice_file_path.split('/').pop() || 'Supplier Invoice'
    : null;
  const receiptFileName = payment.receipt_file_path
    ? payment.receipt_file_path.split('/').pop() || 'Bank Acknowledgement Receipt'
    : null;

  const handleCopyUtr = (utr: string) => {
    navigator.clipboard.writeText(utr);
    setCopiedUtr(true);
    toast.success('Reference copied to clipboard');
    setTimeout(() => setCopiedUtr(false), 2000);
  };

  const handleOpenDocument = async (
    bucket: 'supplier-invoices' | 'bank-receipts',
    filePath: string | null
  ) => {
    if (!filePath) return;

    if (bucket === 'supplier-invoices') {
      setIsViewingInvoice(true);
    } else {
      setIsViewingReceipt(true);
    }

    try {
      const res = await getSignedFileUrl(bucket, filePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not generate document preview URL.');
    } finally {
      setIsViewingInvoice(false);
      setIsViewingReceipt(false);
    }
  };

  function getAuditActionDescription(log: AuditLog): string {
    const act = log.action;
    const newData = (log.new_data || {}) as Record<string, unknown>;
    const oldData = (log.old_data || {}) as Record<string, unknown>;

    if (act === 'INSERT') {
      return newData.status === 'PENDING_VERIFICATION'
        ? 'Payment created & submitted for verification'
        : 'Payment entry created as Draft';
    }

    if (act === 'UPDATE') {
      if (newData.audited_at && !oldData.audited_at) {
        return 'Stamped as Audited by Auditor';
      }

      if (newData.status && newData.status !== oldData.status) {
        switch (newData.status) {
          case 'PENDING_VERIFICATION':
            return 'Submitted for Senior Accountant verification';
          case 'PENDING_APPROVAL':
            return 'Verified & forwarded for Owner approval';
          case 'APPROVED':
            return 'Authorized & Approved by Owner';
          case 'ON_HOLD':
            return 'Placed on hold by Owner';
          case 'REJECTED':
            return `Rejected / Returned: "${newData.rejection_reason || ''}"`;
          case 'PAID':
            return newData.payment_mode === 'CHEQUE'
              ? `Settled via Cheque (#${newData.cheque_number || 'NA'})`
              : `Payment disbursed & marked Paid (UTR: ${newData.utr_number || 'NA'})`;
          case 'CANCELLED':
            return 'Payment cancelled';
          default:
            return `Status changed to ${newData.status}`;
        }
      }

      if (
        newData.source_bank_id &&
        oldData.source_bank_id &&
        newData.source_bank_id !== oldData.source_bank_id
      ) {
        return 'Source disbursement bank switched';
      }

      return 'Payment details updated';
    }

    return `${act} record`;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col bg-white overflow-hidden shadow-2xl"
      >
        {/* HEADER */}
        <SheetHeader className="px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <PaymentStatusBadge status={payment.status} />
            {isLocked && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                <Lock className="w-3 h-3 text-slate-500" />
                <span>Locked Post-Approval</span>
              </span>
            )}
            {payment.status === 'PAID' && (
              payment.audited_at ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Audited</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                  <Clock className="w-3 h-3" />
                  <span>Unaudited</span>
                </span>
              )
            )}
          </div>
          <SheetTitle className="text-base font-semibold text-slate-900 truncate mt-1">
            {partyName}
          </SheetTitle>
          <div className="text-xl font-bold text-slate-900 tabular-nums">
            {formatINR(payment.net_payable)}
          </div>
        </SheetHeader>

        {/* SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* REJECTION REASON ALERT BANNER */}
          {payment.status === 'REJECTED' && payment.rejection_reason && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
              <div className="font-semibold flex items-center gap-1.5 mb-1 text-rose-900">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Rejection / Return Reason</span>
              </div>
              <p className="leading-relaxed pl-5">{payment.rejection_reason}</p>
            </div>
          )}

          {/* KEY-VALUE DETAILS GRID */}
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs shadow-sm overflow-hidden">
            <div className="px-3.5 py-2.5 flex justify-between gap-3">
              <span className="text-slate-500">Beneficiary (Bank A/C)</span>
              <span className="font-semibold text-slate-900 text-right">{beneficiaryName}</span>
            </div>
            {(payment.vendor?.account_number || payment.vendor?.ifsc_code) && (
              <div className="px-3.5 py-2.5 flex justify-between gap-3">
                <span className="text-slate-500">A/C & IFSC</span>
                <span className="font-mono text-slate-800 text-right">
                  {payment.vendor?.account_number || 'NA'} · {payment.vendor?.ifsc_code || 'NA'}
                </span>
              </div>
            )}
            <div className="px-3.5 py-2.5 flex justify-between gap-3">
              <span className="text-slate-500">Sheet Date / Due Date</span>
              <span className="font-medium text-slate-900 tabular-nums">
                {formatHumanDate(payment.sheet_date)} / Due {formatHumanDate(payment.due_date)}
              </span>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between gap-3">
              <span className="text-slate-500">Invoice / Ref No</span>
              <span className="font-mono font-medium text-slate-900 tabular-nums">
                {payment.invoice_ref}
              </span>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between gap-3">
              <span className="text-slate-500">Purpose & Type</span>
              <span className="font-medium text-slate-900">
                {payment.purpose} ({payment.payment_type === 'ON_ACCOUNT' ? 'On Account' : 'Against Bill'})
              </span>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between gap-3">
              <span className="text-slate-500">Gross Amount</span>
              <span className="font-medium text-slate-900 tabular-nums">
                {formatINR(payment.amount)}
              </span>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between gap-3">
              <span className="text-slate-500">TDS Deduction</span>
              <span className="font-medium text-slate-900 tabular-nums">
                {payment.tds > 0 ? formatINR(payment.tds) : 'NA'}
              </span>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between gap-3 items-center">
              <span className="text-slate-500">Source Bank & Mode</span>
              <span className="font-medium text-slate-900">
                {bankName} ({bankShort}) · {payment.payment_mode === 'CHEQUE' ? 'Cheque' : 'NEFT/RTGS'}
              </span>
            </div>

            {payment.utr_number && (
              <div className="px-3.5 py-2.5 flex justify-between gap-3 items-center bg-emerald-50/40">
                <span className="text-slate-600 font-medium">UTR / Ref No</span>
                <span className="inline-flex items-center gap-1.5 font-mono font-bold text-emerald-800 tabular-nums text-xs">
                  <span>{payment.utr_number}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyUtr(payment.utr_number!)}
                    className="p-1 rounded hover:bg-emerald-100/60 text-emerald-700 transition-colors"
                    title="Copy UTR"
                  >
                    {copiedUtr ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </span>
              </div>
            )}

            {payment.payment_mode === 'CHEQUE' && payment.cheque_number && (
              <div className="px-3.5 py-2.5 flex justify-between gap-3 items-center bg-blue-50/40">
                <span className="text-slate-600 font-medium">Cheque Details</span>
                <span className="font-mono font-bold text-blue-900 text-xs">
                  #{payment.cheque_number} ({formatHumanDate(payment.cheque_date)})
                </span>
              </div>
            )}

            {payment.remarks && (
              <div className="px-3.5 py-2.5 flex justify-between gap-4">
                <span className="text-slate-500 shrink-0">Remarks</span>
                <span className="text-slate-800 text-right">{payment.remarks}</span>
              </div>
            )}
          </div>

          {/* 4-STAGE SIGN-OFF TIMESTAMPS */}
          <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/50 space-y-2 text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Stage Timestamps
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="p-2 rounded-lg bg-white border border-slate-100">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Prepared</div>
                <div className="font-medium text-slate-900">{payment.creator?.full_name || '—'}</div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {formatDateTime(payment.submitted_at || payment.created_at)}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-100">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Verified</div>
                <div className="font-medium text-slate-900">{payment.verifier?.full_name || '—'}</div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {payment.verified_at ? formatDateTime(payment.verified_at) : '—'}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-100">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Approved</div>
                <div className="font-medium text-slate-900">{payment.approver?.full_name || '—'}</div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {payment.approved_at ? formatDateTime(payment.approved_at) : '—'}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-100">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Paid & Audited</div>
                <div className="font-medium text-slate-900">
                  {payment.payer?.full_name || '—'}
                  {payment.auditor?.full_name ? ` / ${payment.auditor.full_name}` : ''}
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {payment.paid_at ? formatDateTime(payment.paid_at) : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* DOCUMENTS SECTION (15-MINUTE SIGNED URLS) */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Documents (Private Signed URLs)
            </div>

            {/* SUPPLIER INVOICE CARD */}
            <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-xs font-medium text-slate-800 truncate">
                    {invoiceFileName || 'No invoice attached'}
                  </span>
                </div>
                <span className="text-[10px] font-medium text-slate-500 shrink-0">
                  Supplier Invoice
                </span>
              </div>

              {payment.invoice_file_path ? (
                <div className="p-3.5 bg-white text-xs space-y-2">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span className="truncate max-w-[200px]">
                      <strong className="text-slate-800">{partyName}</strong>
                    </span>
                    <span className="tabular-nums">Ref: {payment.invoice_ref}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
                    <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      Signed preview · 15m expiry
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenDocument(
                          'supplier-invoices',
                          payment.invoice_file_path
                        )
                      }
                      disabled={isViewingInvoice}
                      className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      {isViewingInvoice ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="w-3.5 h-3.5" />
                      )}
                      <span>Open Document</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-white text-xs text-slate-400 text-center">
                  No invoice document uploaded for this entry.
                </div>
              )}
            </div>

            {/* BANK RECEIPT CARD (WHEN PAID) */}
            {payment.receipt_file_path && (
              <div className="rounded-xl border border-emerald-200 overflow-hidden shadow-sm">
                <div className="px-3.5 py-2.5 bg-emerald-50/70 border-b border-emerald-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Receipt className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="text-xs font-semibold text-emerald-900 truncate">
                      {receiptFileName || 'Bank Acknowledgement PDF'}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-700 shrink-0">
                    Bank Receipt
                  </span>
                </div>
                <div className="p-3.5 bg-white text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Disbursed From</span>
                    <span className="font-medium text-slate-800">{bankName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Settlement Ref</span>
                    <span className="font-semibold text-slate-900 tabular-nums font-mono">
                      {payment.payment_mode === 'CHEQUE'
                        ? `CHQ #${payment.cheque_number || 'NA'}`
                        : payment.utr_number || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
                    <span className="font-semibold text-emerald-700 tabular-nums">
                      Settled: {formatINR(payment.net_payable)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenDocument('bank-receipts', payment.receipt_file_path)
                      }
                      disabled={isViewingReceipt}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      {isViewingReceipt ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="w-3.5 h-3.5" />
                      )}
                      <span>View Bank Proof</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* OFFICIAL PAYMENT ADVICE / WHATSAPP SHARE (WHEN PAID) */}
            {payment.status === 'PAID' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">
                    Official Payment Advice
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Share branded Payment Acknowledgement image on WhatsApp or download PDF/PNG.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAdviceOpen(true)}
                  className="min-h-[36px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors shadow-sm cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>View / Share Payment Advice</span>
                </button>
              </div>
            )}
          </div>

          {/* COLLAPSIBLE ACTIVITY & AUDIT LOG TIMELINE */}
          <details
            open
            className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm"
          >
            <summary className="px-3.5 py-2.5 cursor-pointer text-xs font-semibold text-slate-700 flex items-center justify-between select-none hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-1.5">
                <span>Activity & Audit Log</span>
                {auditLogs.length > 0 && (
                  <span className="tabular-nums text-[11px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600">
                    {auditLogs.length}
                  </span>
                )}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </summary>
            <div className="px-4 pb-4 pt-3 border-t border-slate-100">
              {isLoadingLogs ? (
                <div className="py-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading audit trail...</span>
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="py-3 text-center text-xs text-slate-400">
                  No audit log entries recorded yet.
                </div>
              ) : (
                <ol className="relative border-l border-slate-200 ml-2 space-y-4">
                  {auditLogs.map((log) => {
                    const desc = getAuditActionDescription(log);
                    const actorName = log.performer?.full_name || 'System';
                    const role = log.performer?.role ? ` (${log.performer.role})` : '';

                    return (
                      <li key={log.id} className="ml-4">
                        <span className="absolute -left-[5px] mt-1.5 w-2 h-2 rounded-full bg-slate-400 ring-2 ring-white" />
                        <div className="text-xs font-medium text-slate-800 leading-snug">
                          {desc}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                          {actorName}
                          {role} · {formatDateTime(log.created_at)}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </details>
        </div>

        {/* FOOTER */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 shrink-0 pb-safe">
          {payment.status === 'PAID' ? (
            <button
              type="button"
              onClick={() => setIsAdviceOpen(true)}
              className="min-h-[40px] px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>View / Share Payment Advice</span>
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="min-h-[40px] px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </SheetContent>

      <PaymentAcknowledgementModal
        open={isAdviceOpen}
        onOpenChange={setIsAdviceOpen}
        payment={payment}
        activeCompany={activeCompany}
        fallbackUserName={fallbackUserName}
      />
    </Sheet>
  );
}
