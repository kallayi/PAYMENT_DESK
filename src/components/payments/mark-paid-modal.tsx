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
  Loader2,
  X,
  AlertCircle,
  CheckCircle2,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { markPaymentPaid, uploadReceiptFile } from '@/actions/payments';
import { PaymentAcknowledgementModal } from '@/components/payments/payment-acknowledgement-modal';
import { DatePicker } from '@/components/ui/date-picker';
import { formatINR, formatPaymentMode } from '@/lib/format';
import type { Company, PaymentItem, PaymentMode } from '@/types/database';

interface MarkPaidModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentItem | null;
  activeCompany?: Company | null;
  fallbackUserName?: string;
  onSuccess: (updatedPayment: PaymentItem) => void;
}

export function MarkPaidModal({
  open,
  onOpenChange,
  payment,
  activeCompany,
  fallbackUserName,
  onSuccess,
}: MarkPaidModalProps) {
  const [utrNumber, setUtrNumber] = React.useState<string>('');
  const [chequeNumber, setChequeNumber] = React.useState<string>('');
  const [chequeDate, setChequeDate] = React.useState<string>('');
  const [remarks, setRemarks] = React.useState<string>('');
  const [receiptFilePath, setReceiptFilePath] = React.useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = React.useState<string | null>(null);

  const [isUploadingFile, setIsUploadingFile] = React.useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [paidPayment, setPaidPayment] = React.useState<PaymentItem | null>(null);
  const [isAdviceOpen, setIsAdviceOpen] = React.useState<boolean>(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open || !payment) {
      setUtrNumber('');
      setChequeNumber('');
      setChequeDate('');
      setRemarks('');
      setReceiptFilePath(null);
      setReceiptFileName(null);
      setErrorMessage(null);
      setPaidPayment(null);
      setIsAdviceOpen(false);
      return;
    }

    setPaidPayment(null);
    setIsAdviceOpen(false);
    setUtrNumber(payment.utr_number || '');
    setChequeNumber(payment.cheque_number || '');
    setChequeDate(payment.cheque_date || new Date().toISOString().split('T')[0]);
    setRemarks(payment.remarks || '');
    setReceiptFilePath(payment.receipt_file_path || null);
    setReceiptFileName(
      payment.receipt_file_path
        ? payment.receipt_file_path.split('/').pop() || 'Attached Receipt'
        : null
    );
    setErrorMessage(null);
  }, [open, payment]);

  if (!payment) return null;

  const isCheque = payment.payment_mode === 'CHEQUE';
  const partyName = payment.vendor?.party_name || payment.vendor?.name || 'Unknown Party';
  const beneficiaryName = payment.vendor?.beneficiary_name || partyName;
  const bankName = payment.source_bank?.bank_name || payment.source_bank?.full_name || 'Bank';
  const bankCode = payment.source_bank?.short_code || payment.source_bank?.short_name || 'BANK';

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      toast.error('Receipt file exceeds 4 MB limit.');
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
      formData.append('paymentId', payment.id);

      const res = await uploadReceiptFile(formData);
      if (!res.success) {
        toast.error(res.error);
        setErrorMessage(res.error);
        return;
      }

      setReceiptFilePath(res.data.filePath);
      setReceiptFileName(res.data.fileName);
      toast.success('Bank acknowledgement receipt uploaded.');
    } catch {
      toast.error('Failed to upload bank receipt.');
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isCheque) {
      if (!utrNumber.trim()) {
        setErrorMessage('Please enter the unique UTR / Payment Reference Number.');
        return;
      }
      if (!receiptFilePath) {
        setErrorMessage('Bank Acknowledgement PDF / Receipt upload is required.');
        return;
      }
    } else {
      if (!chequeNumber.trim()) {
        setErrorMessage('Please enter the Cheque Number.');
        return;
      }
      if (!chequeDate.trim()) {
        setErrorMessage('Please select the Cheque Date.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await markPaymentPaid({
        payment_id: payment.id,
        payment_mode: (payment.payment_mode || 'NEFT_RTGS') as PaymentMode,
        utr_number: isCheque ? null : utrNumber.trim().toUpperCase(),
        cheque_number: isCheque ? chequeNumber.trim() : null,
        cheque_date: isCheque ? chequeDate.trim() : null,
        receipt_file_path: receiptFilePath,
        remarks: remarks.trim() || null,
      });

      if (!res.success) {
        setErrorMessage(res.error);
        toast.error(res.error);
        return;
      }

      toast.success(
        isCheque
          ? `Payment marked Paid (Cheque #${res.data.cheque_number})`
          : `Payment marked Paid (UTR: ${res.data.utr_number})`
      );
      onSuccess(res.data);
      setPaidPayment(res.data);
    } catch {
      toast.error('An unexpected error occurred while marking payment paid.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          {paidPayment ? (
            <div className="space-y-4 py-1">
              <div className="flex flex-col items-center text-center pt-2 pb-1">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Payment Settled & Recorded
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  {partyName} · <strong className="text-slate-800">{formatINR(paidPayment.net_payable)}</strong>
                </p>
                <div className="mt-2 px-2.5 py-1 rounded-md bg-slate-100 text-xs font-mono font-semibold text-slate-700">
                  {paidPayment.payment_mode === 'CHEQUE'
                    ? `Cheque #${paidPayment.cheque_number || 'NA'}`
                    : `UTR: ${paidPayment.utr_number || 'NA'}`}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 text-center">
                Send the official Payment Acknowledgement slip to the supplier via WhatsApp or download it as PNG / PDF.
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAdviceOpen(true)}
                  className="w-full min-h-[42px] px-4 rounded-lg bg-[#25D366] hover:bg-[#1EB958] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors shadow-sm cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>View / Send Payment Advice on WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="w-full min-h-[38px] px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-semibold text-slate-900">
                  {isCheque
                    ? 'Record Cheque Settlement'
                    : 'Enter UTR & Bank Acknowledgement PDF'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Reconcile disbursement and seal this payment record for post-payment audit.
                </DialogDescription>
              </DialogHeader>

              {/* LOCKED SUMMARY HEADER */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 mb-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-600" />
                    <span>Locked after Approval</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800 uppercase">
                    {formatPaymentMode(payment.payment_mode)}
                  </span>
                </div>

                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 shrink-0">Party Name</span>
                  <span className="font-semibold text-slate-900 text-right truncate">{partyName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 shrink-0">Beneficiary Name</span>
                  <span className="font-medium text-slate-800 text-right truncate">{beneficiaryName}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 shrink-0">Approved Bank</span>
                  <span className="font-semibold text-slate-900 inline-flex items-center gap-1.5">
                    <span>{bankName}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">
                      {bankCode}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                  <span className="font-semibold text-slate-700">Net Payable</span>
                  <span className="text-base font-bold text-slate-900 tabular-nums">
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
                {!isCheque ? (
                  /* NEFT / RTGS: UTR NUMBER INPUT */
                  <div>
                    <label
                      htmlFor="utr-number"
                      className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                    >
                      UTR / Payment Reference No <span className="text-rose-600">*</span>
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
                      className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-mono font-medium uppercase placeholder:text-slate-500 shadow-sm tabular-nums hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
                    />
                  </div>
                ) : (
                  /* CHEQUE: CHEQUE NUMBER + CHEQUE DATE */
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="cheque-number"
                        className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                      >
                        Cheque Number <span className="text-rose-600">*</span>
                      </label>
                      <input
                        id="cheque-number"
                        type="text"
                        required
                        autoFocus
                        placeholder="e.g., 004821"
                        value={chequeNumber}
                        onChange={(e) => {
                          setChequeNumber(e.target.value);
                          setErrorMessage(null);
                        }}
                        className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-mono font-medium placeholder:text-slate-500 shadow-sm tabular-nums hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="cheque-date"
                        className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                      >
                        Cheque Date <span className="text-rose-600">*</span>
                      </label>
                      <DatePicker
                        id="cheque-date"
                        value={chequeDate}
                        onChange={(val) => {
                          setChequeDate(val);
                          setErrorMessage(null);
                        }}
                        placeholder="Select cheque date"
                        required
                      />
                    </div>
                  </div>
                )}

                {/* BANK ACKNOWLEDGEMENT PDF / RECEIPT UPLOAD */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {isCheque
                      ? 'Cheque Scan / Receipt Copy (Optional)'
                      : 'Bank Acknowledgement PDF / Receipt'}{' '}
                    {!isCheque && <span className="text-rose-600">*</span>}
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
                        title="Remove file"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 truncate">
                        {isUploadingFile
                          ? 'Uploading acknowledgement...'
                          : isCheque
                            ? 'No scan uploaded (optional)'
                            : 'No receipt file selected'}
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
                    Accepted: PDF, JPG, PNG, WEBP up to 4 MB. Stored privately for Auditor review.
                  </p>
                </div>

                {/* REMARKS */}
                <div>
                  <label
                    htmlFor="utr-remarks"
                    className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                  >
                    Remarks <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <input
                    id="utr-remarks"
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Optional settlement note"
                    className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-medium placeholder:text-slate-500 shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
                  />
                </div>

                {/* FOOTER */}
                <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onOpenChange(false)}
                    className="w-full sm:w-auto min-h-[42px] sm:min-h-[40px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || isUploadingFile}
                    className="w-full sm:w-auto min-h-[42px] sm:min-h-[40px] px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    <span>Confirm Paid & Close</span>
                  </button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PaymentAcknowledgementModal
        open={isAdviceOpen}
        onOpenChange={setIsAdviceOpen}
        payment={paidPayment}
        activeCompany={activeCompany}
        fallbackUserName={fallbackUserName}
      />
    </>
  );
}
