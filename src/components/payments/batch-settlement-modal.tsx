'use client';

import * as React from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileText,
  Landmark,
  Layers,
  Loader2,
  Receipt,
  Send,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';

import { settlePaymentBatch, uploadReceiptFile } from '@/actions/payments';
import { getSignedFileUrl } from '@/actions/storage';
import { PaymentAcknowledgementModal } from '@/components/payments/payment-acknowledgement-modal';
import { BankBadge, PaymentModeBadge } from '@/components/payments/payment-status-badge';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  formatHumanDate,
  formatINR,
  getTodayISTDateString,
  round2,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Company, PaymentBatch, PaymentItem } from '@/types/database';

interface BatchSettlementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: PaymentItem[];
  activeCompany?: Company | null;
  fallbackUserName?: string;
  onSuccess: (result: { batch: PaymentBatch; payments: PaymentItem[] }) => void;
}

interface RowRefState {
  utr_number: string;
  cheque_number: string;
  cheque_date: string;
}

export function BatchSettlementModal({
  open,
  onOpenChange,
  selectedItems,
  activeCompany,
  fallbackUserName,
  onSuccess,
}: BatchSettlementModalProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [batchDate, setBatchDate] = React.useState<string>(getTodayISTDateString());
  const [notes, setNotes] = React.useState<string>('');
  const [rowRefs, setRowRefs] = React.useState<Record<string, RowRefState>>({});

  // Single combined receipt upload state
  const [receiptFilePath, setReceiptFilePath] = React.useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = React.useState<string | null>(null);
  const [receiptMimeType, setReceiptMimeType] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [showInlinePreview, setShowInlinePreview] = React.useState<boolean>(false);
  const [isDragging, setIsDragging] = React.useState<boolean>(false);
  const [isUploading, setIsUploading] = React.useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Post-settlement success view state
  const [settledResult, setSettledResult] = React.useState<{
    batch: PaymentBatch;
    payments: PaymentItem[];
  } | null>(null);
  const [advicePayment, setAdvicePayment] = React.useState<PaymentItem | null>(null);

  // Initialize / reset state when modal opens with a fresh selection
  React.useEffect(() => {
    if (!open) return;

    const todayIst = getTodayISTDateString();
    setBatchDate(todayIst);
    setNotes('');
    setReceiptFilePath(null);
    setReceiptFileName(null);
    setReceiptMimeType(null);
    setPreviewUrl(null);
    setShowInlinePreview(false);
    setIsDragging(false);
    setIsUploading(false);
    setIsSubmitting(false);
    setFormError(null);
    setSettledResult(null);
    setAdvicePayment(null);

    const initialMap: Record<string, RowRefState> = {};
    for (const item of selectedItems) {
      initialMap[item.id] = {
        utr_number: item.utr_number ? item.utr_number.toUpperCase() : '',
        cheque_number: item.cheque_number ? item.cheque_number.toUpperCase() : '',
        cheque_date: item.cheque_date || todayIst,
      };
    }
    setRowRefs(initialMap);
  }, [open, selectedItems]);

  const totalAmount = React.useMemo(
    () =>
      round2(
        selectedItems.reduce((sum, item) => sum + Number(item.net_payable || 0), 0)
      ),
    [selectedItems]
  );

  // Check unique source banks across selected items
  const uniqueBankNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const item of selectedItems) {
      const bankLabel =
        item.source_bank?.short_code ||
        item.source_bank?.short_name ||
        item.source_bank?.bank_name ||
        item.source_bank?.full_name;
      if (bankLabel) {
        names.add(bankLabel);
      }
    }
    return Array.from(names);
  }, [selectedItems]);

  // Live in-batch duplicate UTR detection
  const duplicateUtrMap = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of selectedItems) {
      if (item.payment_mode === 'CHEQUE') continue;
      const utr = (rowRefs[item.id]?.utr_number || '').trim().toUpperCase();
      if (!utr) continue;
      counts.set(utr, (counts.get(utr) || 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [utr, count] of counts.entries()) {
      if (count > 1) dupes.add(utr);
    }
    return dupes;
  }, [selectedItems, rowRefs]);

  const missingRefCount = React.useMemo(() => {
    let missing = 0;
    for (const item of selectedItems) {
      const ref = rowRefs[item.id];
      if (item.payment_mode === 'CHEQUE') {
        if (!ref?.cheque_number.trim()) missing += 1;
      } else {
        if (!ref?.utr_number.trim()) missing += 1;
      }
    }
    return missing;
  }, [selectedItems, rowRefs]);

  const canSubmit =
    selectedItems.length > 0 &&
    Boolean(receiptFilePath) &&
    missingRefCount === 0 &&
    duplicateUtrMap.size === 0 &&
    !isUploading &&
    !isSubmitting;

  const updateRowField = (
    paymentId: string,
    field: keyof RowRefState,
    value: string
  ) => {
    setFormError(null);
    setRowRefs((prev) => ({
      ...prev,
      [paymentId]: {
        utr_number: prev[paymentId]?.utr_number || '',
        cheque_number: prev[paymentId]?.cheque_number || '',
        cheque_date: prev[paymentId]?.cheque_date || batchDate,
        [field]: value,
      },
    }));
  };

  const handleFileUpload = async (file: File) => {
    setFormError(null);

    if (file.size > 15 * 1024 * 1024) {
      const msg = 'Combined Bank Receipt PDF/Image must be 15 MB or smaller.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (file.type && !allowedTypes.includes(file.type)) {
      const msg = 'Allowed formats: PDF, JPG, PNG, or WebP.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('paymentId', 'batch');

      const uploadRes = await uploadReceiptFile(fd);
      if (!uploadRes.success) {
        setFormError(uploadRes.error);
        toast.error(uploadRes.error);
        return;
      }

      setReceiptFilePath(uploadRes.data.filePath);
      setReceiptFileName(uploadRes.data.fileName || file.name);
      setReceiptMimeType(
        file.type ||
          (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*')
      );

      const signedRes = await getSignedFileUrl(
        'bank-receipts',
        uploadRes.data.filePath
      );
      if (signedRes.success) {
        setPreviewUrl(signedRes.data.signedUrl);
      } else {
        setPreviewUrl(null);
      }

      toast.success('Combined Bank Receipt uploaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Receipt upload failed.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
  };

  const clearUploadedReceipt = () => {
    setReceiptFilePath(null);
    setReceiptFileName(null);
    setReceiptMimeType(null);
    setPreviewUrl(null);
    setShowInlinePreview(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (selectedItems.length === 0) {
      setFormError('Select at least one Ready-to-Pay item.');
      return;
    }

    if (!receiptFilePath) {
      setFormError('Upload the combined Bank Receipt PDF or image before settling.');
      return;
    }

    if (missingRefCount > 0) {
      setFormError(
        `${missingRefCount} payment${missingRefCount > 1 ? 's are' : ' is'} missing a UTR or Cheque Number.`
      );
      return;
    }

    if (duplicateUtrMap.size > 0) {
      setFormError(
        `Duplicate UTR detected in this batch: ${Array.from(duplicateUtrMap).join(', ')}. Each payment requires a unique UTR.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const payloadItems = selectedItems.map((item) => {
        const ref = rowRefs[item.id];
        if (item.payment_mode === 'CHEQUE') {
          return {
            payment_id: item.id,
            cheque_number: (ref?.cheque_number || '').trim().toUpperCase(),
            cheque_date: ref?.cheque_date || batchDate,
          };
        }
        return {
          payment_id: item.id,
          utr_number: (ref?.utr_number || '').trim().toUpperCase(),
        };
      });

      const res = await settlePaymentBatch({
        batch_date: batchDate,
        receipt_file_path: receiptFilePath,
        notes: notes.trim() || undefined,
        items: payloadItems,
      });

      if (!res.success) {
        setFormError(res.error);
        toast.error(res.error);
        return;
      }

      toast.success(
        `Batch ${res.data.batch.batch_code} settled (${res.data.batch.item_count} paid)`
      );
      onSuccess(res.data);
      setSettledResult(res.data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to settle payment batch.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    onOpenChange(false);
  };

  const isPdfReceipt =
    receiptMimeType === 'application/pdf' ||
    (receiptFileName?.toLowerCase().endsWith('.pdf') ?? false);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
        <DialogContent className="max-w-4xl w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] p-0 overflow-hidden gap-0">
          {settledResult ? (
            /* ============================================================
               POST-SETTLEMENT SUCCESS VIEW + WHATSAPP PAYMENT ADVICE LINKS
            ============================================================ */
            <div className="flex flex-col max-h-[88dvh]">
              <DialogHeader className="px-5 py-4 border-b border-slate-200 bg-emerald-50/70">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1 pr-6">
                    <DialogTitle className="text-base sm:text-lg font-bold text-slate-900">
                      Day Batch Settled Successfully
                    </DialogTitle>
                    <DialogDescription className="text-xs sm:text-sm text-slate-600 mt-0.5">
                      Batch{' '}
                      <span className="font-mono font-bold text-slate-900">
                        {settledResult.batch.batch_code}
                      </span>{' '}
                      · {settledResult.batch.item_count} payment
                      {settledResult.batch.item_count === 1 ? '' : 's'} totaling{' '}
                      <span className="font-bold text-slate-900 tabular-nums">
                        {formatINR(settledResult.batch.total_amount)}
                      </span>{' '}
                      marked Paid with 1 combined Bank Receipt.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Receipt className="w-4 h-4 text-brand shrink-0" />
                    <span>
                      Send individual Payment Advice slips to vendors via WhatsApp or download PNG/PDF:
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-slate-700">
                    {formatHumanDate(settledResult.batch.batch_date)}
                  </span>
                </div>

                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-white">
                  {settledResult.payments.map((payment) => {
                    const vendorName =
                      payment.vendor?.party_name ||
                      payment.vendor?.name ||
                      payment.vendor?.beneficiary_name ||
                      'Beneficiary';
                    const refText =
                      payment.payment_mode === 'CHEQUE'
                        ? payment.cheque_number
                          ? `CHQ ${payment.cheque_number}`
                          : 'Cheque'
                        : payment.utr_number || 'Paid';

                    return (
                      <div
                        key={payment.id}
                        className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-900 truncate">
                              {vendorName}
                            </span>
                            <PaymentModeBadge mode={payment.payment_mode} />
                            {payment.receipt_sent_at && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Advice Sent ✓
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 text-xs text-slate-500 flex-wrap">
                            <span className="font-bold text-slate-900 tabular-nums">
                              {formatINR(payment.net_payable)}
                            </span>
                            <span>·</span>
                            <span className="font-mono text-slate-700">{refText}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setAdvicePayment(payment)}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Payment Advice / WhatsApp</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="min-h-[44px] px-5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* ============================================================
               BATCH SETTLEMENT ENTRY FORM
            ============================================================ */
            <form onSubmit={handleSubmit} className="flex flex-col max-h-[88dvh]">
              <DialogHeader className="px-5 py-4 border-b border-slate-200 bg-slate-50/70">
                <div className="flex items-start justify-between gap-3 pr-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-tint text-brand text-[11px] font-bold uppercase tracking-wider">
                        <Layers className="w-3 h-3" />
                        Day Batch Settlement
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {formatHumanDate(batchDate)}
                      </span>
                    </div>
                    <DialogTitle className="text-base sm:text-lg font-bold text-slate-900">
                      Settle {selectedItems.length} Payment
                      {selectedItems.length === 1 ? '' : 's'} with Combined Bank PDF
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500">
                      Upload one combined bank confirmation PDF/image and enter individual UTR or Cheque numbers below.
                    </DialogDescription>
                  </div>

                  <div className="hidden sm:flex flex-col items-end shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Batch Total
                    </span>
                    <span className="text-lg font-bold text-slate-900 tabular-nums">
                      {formatINR(totalAmount)}
                    </span>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* Summary Bar (Mobile + Bank Pill) */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                  <div className="sm:col-span-4 space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                      <span>Batch Settlement Date</span>
                    </label>
                    <DatePicker
                      value={batchDate}
                      onChange={(val) => setBatchDate(val || getTodayISTDateString())}
                      disabled={isSubmitting}
                    />
                    <p className="text-[11px] text-slate-500">
                      Auto-label:{' '}
                      <span className="font-mono font-semibold text-slate-700">
                        Day Batch · {formatHumanDate(batchDate)}
                      </span>
                    </p>
                  </div>

                  <div className="sm:col-span-5 space-y-1.5">
                    <label
                      htmlFor="batch-notes"
                      className="text-xs font-semibold text-slate-700"
                    >
                      Batch Label / Notes (optional)
                    </label>
                    <input
                      id="batch-notes"
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      maxLength={500}
                      disabled={isSubmitting}
                      placeholder="e.g., Axis Afternoon Bulk Run / Supplier Day Batch"
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                    />
                  </div>

                  <div className="sm:col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex sm:flex-col items-center sm:items-end justify-between gap-1">
                    <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                      <Landmark className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {uniqueBankNames.length === 1
                          ? uniqueBankNames[0]
                          : uniqueBankNames.length > 1
                          ? `${uniqueBankNames.length} Banks`
                          : 'Selected'}
                      </span>
                    </span>
                    <span className="text-sm sm:text-base font-bold text-slate-900 tabular-nums">
                      {formatINR(totalAmount)}
                    </span>
                  </div>
                </div>

                {/* Single Combined Bank Receipt Upload */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-700">
                      1. Combined Bank Confirmation Receipt (PDF / Image) *
                    </label>
                    {receiptFilePath && (
                      <button
                        type="button"
                        onClick={clearUploadedReceipt}
                        disabled={isSubmitting}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Replace File</span>
                      </button>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />

                  {!receiptFilePath ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => !isUploading && fileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!isUploading) fileInputRef.current?.click();
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className={cn(
                        'rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors cursor-pointer',
                        isDragging
                          ? 'border-brand bg-brand-tint/40'
                          : 'border-slate-300 bg-slate-50/70 hover:border-brand/60 hover:bg-slate-50'
                      )}
                    >
                      {isUploading ? (
                        <div className="flex flex-col items-center gap-2 text-slate-600">
                          <Loader2 className="w-6 h-6 animate-spin text-brand" />
                          <p className="text-xs font-semibold">
                            Uploading combined bank receipt…
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1.5">
                          <UploadCloud className="w-6 h-6 text-brand" />
                          <p className="text-xs sm:text-sm font-semibold text-slate-800">
                            Drop combined Bank Advice PDF here or{' '}
                            <span className="text-brand underline">browse file</span>
                          </p>
                          <p className="text-[11px] text-slate-500">
                            One file attaches to all {selectedItems.length} payments in this batch (PDF, JPG, PNG, WebP · max 15 MB)
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {receiptFileName || 'Combined Bank Receipt'}
                            </p>
                            <p className="text-[11px] text-emerald-700 font-medium">
                              Uploaded · Attached to all {selectedItems.length} payments
                            </p>
                          </div>
                        </div>

                        {previewUrl && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setShowInlinePreview((prev) => !prev)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                            >
                              {showInlinePreview ? 'Hide Preview' : 'Inline Preview'}
                            </button>
                            <a
                              href={previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                            >
                              <span>Open</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>

                      {showInlinePreview && previewUrl && (
                        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                          {isPdfReceipt ? (
                            <iframe
                              src={previewUrl}
                              title="Combined Bank Receipt Preview"
                              className="w-full h-56 border-0"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewUrl}
                              alt="Combined Bank Receipt Preview"
                              className="max-h-56 w-full object-contain bg-slate-50"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Per-Item UTR / Cheque Entry */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-700">
                      2. Enter Individual UTR / Cheque Reference ({selectedItems.length}) *
                    </label>
                    <div className="flex items-center gap-2 text-[11px]">
                      {duplicateUtrMap.size > 0 && (
                        <span className="font-semibold text-rose-600">
                          Duplicate UTR found
                        </span>
                      )}
                      {missingRefCount > 0 && (
                        <span className="font-medium text-amber-700">
                          {missingRefCount} pending reference{missingRefCount === 1 ? '' : 's'}
                        </span>
                      )}
                      {missingRefCount === 0 && duplicateUtrMap.size === 0 && (
                        <span className="font-semibold text-emerald-700">
                          All references filled ✓
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Desktop Table */}
                  <div className="hidden md:block rounded-xl border border-slate-200 overflow-hidden bg-white">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          <th className="py-2.5 px-3">Payee & Bank</th>
                          <th className="py-2.5 px-3">Mode</th>
                          <th className="py-2.5 px-3 text-right">Net Amount</th>
                          <th className="py-2.5 px-3 w-[270px]">UTR / Cheque Reference *</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {selectedItems.map((item) => {
                          const vendorName =
                            item.vendor?.party_name ||
                            item.vendor?.name ||
                            item.vendor?.beneficiary_name ||
                            'Beneficiary';
                          const accountNo =
                            item.vendor?.account_number || item.vendor?.bank_account_no;
                          const ref = rowRefs[item.id] || {
                            utr_number: '',
                            cheque_number: '',
                            cheque_date: batchDate,
                          };
                          const isCheque = item.payment_mode === 'CHEQUE';
                          const normalizedUtr = ref.utr_number.trim().toUpperCase();
                          const isDupUtr =
                            !isCheque &&
                            Boolean(normalizedUtr) &&
                            duplicateUtrMap.has(normalizedUtr);

                          return (
                            <tr key={item.id} className="align-top hover:bg-slate-50/50">
                              <td className="py-2.5 px-3">
                                <div className="space-y-1">
                                  <p className="text-xs font-semibold text-slate-900">
                                    {vendorName}
                                  </p>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <BankBadge
                                      shortName={
                                        item.source_bank?.short_code ||
                                        item.source_bank?.short_name
                                      }
                                      fullName={
                                        item.source_bank?.bank_name ||
                                        item.source_bank?.full_name
                                      }
                                    />
                                    {accountNo && (
                                      <span className="text-[11px] font-mono text-slate-500">
                                        ···{accountNo.slice(-4)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <PaymentModeBadge mode={item.payment_mode} compact />
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <span className="text-xs font-bold text-slate-900 tabular-nums">
                                  {formatINR(item.net_payable)}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                {isCheque ? (
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <input
                                      type="text"
                                      value={ref.cheque_number}
                                      onChange={(e) =>
                                        updateRowField(
                                          item.id,
                                          'cheque_number',
                                          e.target.value.toUpperCase()
                                        )
                                      }
                                      placeholder="Cheque No *"
                                      disabled={isSubmitting}
                                      className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                                    />
                                    <DatePicker
                                      size="sm"
                                      value={ref.cheque_date || batchDate}
                                      onChange={(val) =>
                                        updateRowField(
                                          item.id,
                                          'cheque_date',
                                          val || batchDate
                                        )
                                      }
                                      disabled={isSubmitting}
                                    />
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      value={ref.utr_number}
                                      onChange={(e) =>
                                        updateRowField(
                                          item.id,
                                          'utr_number',
                                          e.target.value.toUpperCase()
                                        )
                                      }
                                      placeholder="Enter Bank UTR / Ref *"
                                      disabled={isSubmitting}
                                      className={cn(
                                        'w-full h-9 px-2.5 rounded-lg border bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2',
                                        isDupUtr
                                          ? 'border-rose-400 focus:ring-rose-200 focus:border-rose-500 bg-rose-50/40'
                                          : 'border-slate-200 focus:ring-brand/20 focus:border-brand'
                                      )}
                                    />
                                    {isDupUtr && (
                                      <p className="text-[10px] font-semibold text-rose-600">
                                        Duplicate UTR in batch
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden space-y-2.5">
                    {selectedItems.map((item) => {
                      const vendorName =
                        item.vendor?.party_name ||
                        item.vendor?.name ||
                        item.vendor?.beneficiary_name ||
                        'Beneficiary';
                      const ref = rowRefs[item.id] || {
                        utr_number: '',
                        cheque_number: '',
                        cheque_date: batchDate,
                      };
                      const isCheque = item.payment_mode === 'CHEQUE';
                      const normalizedUtr = ref.utr_number.trim().toUpperCase();
                      const isDupUtr =
                        !isCheque &&
                        Boolean(normalizedUtr) &&
                        duplicateUtrMap.has(normalizedUtr);

                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {vendorName}
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <PaymentModeBadge mode={item.payment_mode} compact />
                                <BankBadge
                                  shortName={
                                    item.source_bank?.short_code ||
                                    item.source_bank?.short_name
                                  }
                                  fullName={
                                    item.source_bank?.bank_name ||
                                    item.source_bank?.full_name
                                  }
                                />
                              </div>
                            </div>
                            <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                              {formatINR(item.net_payable)}
                            </span>
                          </div>

                          {isCheque ? (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                value={ref.cheque_number}
                                onChange={(e) =>
                                  updateRowField(
                                    item.id,
                                    'cheque_number',
                                    e.target.value.toUpperCase()
                                  )
                                }
                                placeholder="Cheque No *"
                                disabled={isSubmitting}
                                className="h-11 px-3 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                              />
                              <DatePicker
                                value={ref.cheque_date || batchDate}
                                onChange={(val) =>
                                  updateRowField(
                                    item.id,
                                    'cheque_date',
                                    val || batchDate
                                  )
                                }
                                disabled={isSubmitting}
                              />
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={ref.utr_number}
                                onChange={(e) =>
                                  updateRowField(
                                    item.id,
                                    'utr_number',
                                    e.target.value.toUpperCase()
                                  )
                                }
                                placeholder="Enter Bank UTR / Ref *"
                                disabled={isSubmitting}
                                className={cn(
                                  'w-full h-11 px-3 rounded-lg border bg-white font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2',
                                  isDupUtr
                                    ? 'border-rose-400 focus:ring-rose-200 focus:border-rose-500 bg-rose-50/40'
                                    : 'border-slate-200 focus:ring-brand/20 focus:border-brand'
                                )}
                              />
                              {isDupUtr && (
                                <p className="text-[11px] font-semibold text-rose-600">
                                  Duplicate UTR in batch
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {formError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-start gap-2 text-xs text-rose-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5">
                <p className="text-[11px] text-slate-500">
                  All {selectedItems.length} payment
                  {selectedItems.length === 1 ? '' : 's'} will be marked Paid together and grouped for Audit.
                </p>

                <div className="flex items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    disabled={isSubmitting}
                    className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="min-h-[44px] flex-1 sm:flex-initial px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Settling Batch…</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          Confirm Batch Settlement ({selectedItems.length} Paid)
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Post-settlement individual Payment Advice / WhatsApp modal */}
      <PaymentAcknowledgementModal
        open={Boolean(advicePayment)}
        onOpenChange={(next) => {
          if (!next) setAdvicePayment(null);
        }}
        payment={advicePayment}
        activeCompany={activeCompany}
        fallbackUserName={fallbackUserName}
        receiptSentAt={advicePayment?.receipt_sent_at || null}
        onReceiptSent={(paymentId, sentAt) => {
          setSettledResult((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              payments: prev.payments.map((item) =>
                item.id === paymentId
                  ? { ...item, receipt_sent_at: sentAt }
                  : item
              ),
            };
          });
        }}
      />
    </>
  );
}
