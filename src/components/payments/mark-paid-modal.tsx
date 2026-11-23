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
import {
  Lock,
  Upload,
  FileCheck2,
  Paperclip,
  Loader2,
  X,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { markPaidWithUtr, uploadReceiptFile } from '@/actions/payments';
import { formatINR } from '@/lib/format';
import type { PaymentItem } from '@/types/database';

interface MarkPaidModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentItem | null;
  onSuccess: (updatedPayment: PaymentItem) => void;
}

export function MarkPaidModal({
  open,
  onOpenChange,
  payment,
  onSuccess,
}: MarkPaidModalProps) {
  const [utrNumber, setUtrNumber] = React.useState<string>('');
  const [remarks, setRemarks] = React.useState<string>('');
  const [receiptFilePath, setReceiptFilePath] = React.useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = React.useState<string | null>(null);

  const [isUploadingFile, setIsUploadingFile] = React.useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open || !payment) {
      setUtrNumber('');
      setRemarks('');
      setReceiptFilePath(null);
      setReceiptFileName(null);
      setErrorMessage(null);
      return;
    }
    setRemarks(payment.remarks || '');
    setErrorMessage(null);
  }, [open, payment]);

  if (!payment) return null;

  const vendorName = payment.vendor?.name || 'Unknown Vendor';
  const bankName = payment.source_bank?.full_name || 'Bank';

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Receipt file exceeds 5 MB limit.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Invalid format. Allowed: PDF, JPG, PNG, WEBP.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploadingFile(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await uploadReceiptFile(formData);
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      setReceiptFilePath(res.data.filePath);
      setReceiptFileName(res.data.fileName);
      toast.success('Bank receipt attached');
    } catch {
      toast.error('Failed to upload bank receipt.');
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!utrNumber.trim()) {
      setErrorMessage('Please enter the UTR / Payment Ref No.');
      return;
    }

    if (!receiptFilePath) {
      setErrorMessage('Bank transaction receipt file is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await markPaidWithUtr({
        payment_id: payment.id,
        utr_number: utrNumber.trim().toUpperCase(),
        receipt_file_path: receiptFilePath,
        remarks: remarks.trim() || null,
      });

      if (!res.success) {
        setErrorMessage(res.error);
        toast.error(res.error);
        return;
      }

      toast.success(`Payment marked Paid (UTR: ${res.data.utr_number})`);
      onSuccess(res.data);
      onOpenChange(false);
    } catch {
      toast.error('An unexpected error occurred while marking paid.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-900">
            Enter UTR & Bank Receipt
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Reconcile disbursement and close the payment cycle.
          </DialogDescription>
        </DialogHeader>

        {/* READ-ONLY LOCKED SUMMARY HEADER (Screen C & ui-reference.html) */}
        <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 mb-1">
            <Lock className="w-3.5 h-3.5 text-slate-600" />
            <span>Locked after Owner approval</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Vendor</span>
            <span className="font-semibold text-slate-900">{vendorName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Approved Bank</span>
            <span className="font-medium text-slate-800">{bankName}</span>
          </div>
          <div className="flex justify-between pt-1.5 border-t border-slate-200">
            <span className="font-medium text-slate-700">Net Payable</span>
            <span className="font-bold text-slate-900 tabular-nums">
              {formatINR(payment.net_payable)}
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* UTR NUMBER INPUT */}
          <div>
            <label
              htmlFor="utr-number"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              UTR / Payment Ref No <span className="text-rose-600">*</span>
            </label>
            <input
              id="utr-number"
              type="text"
              required
              autoFocus
              placeholder="e.g., AXCOH32315623899"
              value={utrNumber}
              onChange={(e) => {
                setUtrNumber(e.target.value.toUpperCase());
                setErrorMessage(null);
              }}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm font-mono uppercase tabular-nums outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
            />
          </div>

          {/* BANK RECEIPT UPLOAD */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Bank Transaction Receipt <span className="text-rose-600">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />

            {receiptFilePath ? (
              <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-900 truncate">
                    {receiptFileName || 'Bank Receipt Attached'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptFilePath(null);
                    setReceiptFileName(null);
                  }}
                  className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 truncate">
                  {isUploadingFile ? 'Uploading receipt...' : 'No receipt file selected'}
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingFile}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isUploadingFile ? (
                    <Loader2 className="w-3 h-3 animate-spin text-slate-500" />
                  ) : (
                    <Upload className="w-3 h-3 text-slate-500" />
                  )}
                  <span>Upload File</span>
                </button>
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Accepted: PDF, JPG, PNG, WEBP up to 5MB.
            </p>
          </div>

          {/* REMARKS */}
          <div>
            <label
              htmlFor="utr-remarks"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Remarks <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              id="utr-remarks"
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional transfer note"
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
            />
          </div>

          {/* FOOTER */}
          <DialogFooter className="flex-row gap-2 sm:justify-end pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
              className="flex-1 sm:flex-initial min-h-[40px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isUploadingFile}
              className="flex-1 sm:flex-initial min-h-[40px] px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              <span>Confirm Paid & Close</span>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
