'use client';

import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertTriangle,
  FileCheck2,
  Paperclip,
  Loader2,
  X,
  Upload,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createPayment,
  updateDraftPayment,
  checkDuplicateInvoice,
  uploadInvoiceFile,
} from '@/actions/payments';
import { createVendor } from '@/actions/vendors';
import { getSignedFileUrl } from '@/actions/storage';
import { formatINR } from '@/lib/format';
import type { CompanyBank, IncomingBill, PaymentItem, Vendor } from '@/types/database';

interface PaymentFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: Vendor[];
  banks: CompanyBank[];
  editPayment?: PaymentItem | null;
  incomingBill?: IncomingBill | null;
  onSuccess: (payment: PaymentItem) => void;
  onVendorCreated?: (vendor: Vendor) => void;
}

const PURPOSE_PRESETS = [
  'Against Bill',
  'Against PI',
  'Transfer',
  'Electricity Charge',
  'Advance',
];

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getThreeDaysLaterString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PaymentFormSheet({
  open,
  onOpenChange,
  vendors: initialVendors,
  banks,
  editPayment,
  incomingBill,
  onSuccess,
  onVendorCreated,
}: PaymentFormSheetProps) {
  const [vendorsList, setVendorsList] = React.useState<Vendor[]>(initialVendors);

  // Synchronize when incoming vendors list changes
  React.useEffect(() => {
    setVendorsList(initialVendors);
  }, [initialVendors]);

  // Form Fields State
  const [sheetDate, setSheetDate] = React.useState<string>(getTodayString());
  const [dueDate, setDueDate] = React.useState<string>(getThreeDaysLaterString());
  const [vendorId, setVendorId] = React.useState<string>('');
  const [invoiceRef, setInvoiceRef] = React.useState<string>('');
  const [purpose, setPurpose] = React.useState<string>('Against Bill');
  const [amount, setAmount] = React.useState<string>('');
  const [tds, setTds] = React.useState<string>('0');
  const [sourceBankId, setSourceBankId] = React.useState<string>('');
  const [remarks, setRemarks] = React.useState<string>('');
  const [invoiceFilePath, setInvoiceFilePath] = React.useState<string | null>(null);

  // File Upload State
  const [isUploadingFile, setIsUploadingFile] = React.useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = React.useState<string | null>(null);

  // Inline Quick Add Vendor State
  const [showQuickAddVendor, setShowQuickAddVendor] = React.useState<boolean>(false);
  const [quickVendorName, setQuickVendorName] = React.useState<string>('');
  const [isAddingVendor, setIsAddingVendor] = React.useState<boolean>(false);

  // Duplicate Warning State
  const [duplicateWarning, setDuplicateWarning] = React.useState<{
    isDuplicate: boolean;
    existingPayment?: { id: string; invoice_ref: string; sheet_date: string; status: string };
  } | null>(null);

  // Action Loading States
  const [isSavingDraft, setIsSavingDraft] = React.useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [isViewingFile, setIsViewingFile] = React.useState<boolean>(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Initialize form whenever sheet opens or target payment/bill changes
  React.useEffect(() => {
    if (!open) return;

    setShowQuickAddVendor(false);
    setQuickVendorName('');
    setDuplicateWarning(null);

    if (editPayment) {
      setSheetDate(editPayment.sheet_date || getTodayString());
      setDueDate(editPayment.due_date || getThreeDaysLaterString());
      setVendorId(editPayment.vendor_id);
      setInvoiceRef(editPayment.invoice_ref);
      setPurpose(editPayment.purpose || 'Against Bill');
      setAmount(String(editPayment.amount));
      setTds(String(editPayment.tds || 0));
      setSourceBankId(editPayment.source_bank_id);
      setRemarks(editPayment.remarks || '');
      setInvoiceFilePath(editPayment.invoice_file_path);
      setUploadedFileName(
        editPayment.invoice_file_path
          ? editPayment.invoice_file_path.split('/').pop() || 'Attached Invoice'
          : null
      );
    } else if (incomingBill) {
      setSheetDate(getTodayString());
      setDueDate(getThreeDaysLaterString());

      // If incoming bill has vendor_id, use it; otherwise fallback to first vendor
      let selectedVendor = incomingBill.vendor_id || '';
      if (!selectedVendor && incomingBill.vendor_name_fallback) {
        const found = vendorsList.find(
          (v) => v.name.toLowerCase() === incomingBill.vendor_name_fallback?.toLowerCase()
        );
        if (found) selectedVendor = found.id;
      }
      if (!selectedVendor && vendorsList.length > 0) {
        selectedVendor = vendorsList[0].id;
      }

      setVendorId(selectedVendor);
      setInvoiceRef(incomingBill.invoice_ref || '');
      setPurpose('Against Bill');
      setAmount(
        incomingBill.estimated_amount ? String(incomingBill.estimated_amount) : ''
      );
      setTds('0');
      setSourceBankId(banks[0] ? banks[0].id : '');
      setRemarks(incomingBill.notes || '');
      setInvoiceFilePath(incomingBill.file_path);
      setUploadedFileName(
        incomingBill.file_path.split('/').pop() || 'Attached Supplier Invoice'
      );
    } else {
      setSheetDate(getTodayString());
      setDueDate(getThreeDaysLaterString());
      setVendorId(vendorsList.length > 0 ? vendorsList[0].id : '');
      setInvoiceRef('');
      setPurpose('Against Bill');
      setAmount('');
      setTds('0');
      setSourceBankId(banks[0] ? banks[0].id : '');
      setRemarks('');
      setInvoiceFilePath(null);
      setUploadedFileName(null);
    }
  }, [open, editPayment, incomingBill, vendorsList, banks]);

  // Live duplicate invoice detection with debounce
  React.useEffect(() => {
    if (!vendorId || !invoiceRef.trim()) {
      setDuplicateWarning(null);
      return;
    }

    const timer = setTimeout(async () => {
      const res = await checkDuplicateInvoice(
        vendorId,
        invoiceRef.trim(),
        editPayment?.id
      );
      if (res.success && res.data.isDuplicate) {
        setDuplicateWarning(res.data);
      } else {
        setDuplicateWarning(null);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [vendorId, invoiceRef, editPayment?.id]);

  // Live computed Net Payable
  const numAmount = parseFloat(amount) || 0;
  const numTds = parseFloat(tds) || 0;
  const netPayable = Math.max(0, numAmount - numTds);
  const isTdsInvalid = numTds > numAmount && numAmount > 0;

  // Inline Quick Add Vendor Handler
  const handleQuickAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickVendorName.trim()) return;

    setIsAddingVendor(true);
    try {
      const res = await createVendor({ name: quickVendorName.trim() });
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      const newVendor = res.data;
      setVendorsList((prev) => [newVendor, ...prev]);
      setVendorId(newVendor.id);
      setQuickVendorName('');
      setShowQuickAddVendor(false);
      onVendorCreated?.(newVendor);
      toast.success(`Vendor "${newVendor.name}" created and selected`);
    } catch {
      toast.error('Failed to create new vendor.');
    } finally {
      setIsAddingVendor(false);
    }
  };

  // File Upload Handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds the 5 MB limit.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await uploadInvoiceFile(formData);
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      setInvoiceFilePath(res.data.filePath);
      setUploadedFileName(res.data.fileName);
      toast.success('Invoice file attached');
    } catch {
      toast.error('Failed to upload file.');
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Preview attached invoice via temporary signed URL
  const handleViewAttachedFile = async () => {
    if (!invoiceFilePath) return;
    setIsViewingFile(true);
    try {
      const res = await getSignedFileUrl('supplier-invoices', invoiceFilePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not open file preview.');
    } finally {
      setIsViewingFile(false);
    }
  };

  // Save / Submit Form Handler
  const handleSave = async (targetStatus: 'DRAFT' | 'PENDING_APPROVAL') => {
    if (!vendorId) {
      toast.error('Please select a vendor.');
      return;
    }

    if (!invoiceRef.trim()) {
      toast.error('Please enter the Invoice / Ref No.');
      return;
    }

    if (!purpose.trim()) {
      toast.error('Please specify a payment purpose.');
      return;
    }

    if (!amount || numAmount <= 0) {
      toast.error('Please enter a valid amount greater than 0.');
      return;
    }

    if (isTdsInvalid) {
      toast.error('TDS cannot exceed Gross Amount.');
      return;
    }

    if (!sourceBankId) {
      toast.error('Please select a source bank.');
      return;
    }

    if (targetStatus === 'DRAFT') {
      setIsSavingDraft(true);
    } else {
      setIsSubmitting(true);
    }

    try {
      const payload = {
        sheet_date: sheetDate,
        due_date: dueDate,
        vendor_id: vendorId,
        invoice_ref: invoiceRef.trim(),
        purpose: purpose.trim(),
        amount: numAmount,
        tds: numTds,
        source_bank_id: sourceBankId,
        remarks: remarks.trim() || null,
        invoice_file_path: invoiceFilePath,
        incoming_bill_id: incomingBill?.id || editPayment?.incoming_bill_id || null,
      };

      let result;
      if (editPayment) {
        result = await updateDraftPayment(
          { ...payload, id: editPayment.id },
          targetStatus
        );
      } else {
        result = await createPayment(payload, targetStatus);
      }

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        targetStatus === 'DRAFT'
          ? 'Payment entry saved as Draft'
          : 'Payment entry submitted for Owner approval'
      );

      onSuccess(result.data);
      onOpenChange(false);
    } catch {
      toast.error('An unexpected error occurred while saving the payment.');
    } finally {
      setIsSavingDraft(false);
      setIsSubmitting(false);
    }
  };

  const sheetTitle = editPayment
    ? 'Edit Draft Entry'
    : incomingBill
      ? 'Convert Incoming Bill'
      : 'New Payment Entry';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col bg-white overflow-hidden shadow-2xl"
      >
        {/* DRAWER HEADER */}
        <SheetHeader className="px-5 py-4 border-b border-slate-200">
          <SheetTitle className="text-base font-semibold text-slate-900">
            {sheetTitle}
          </SheetTitle>
          <SheetDescription className="text-xs text-slate-500">
            Save as draft or submit directly for Owner approval.
          </SheetDescription>
        </SheetHeader>

        {/* SCROLLABLE FORM BODY */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* SHEET DATE & DUE DATE */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="sheet-date"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Sheet Date <span className="text-rose-600">*</span>
              </label>
              <input
                id="sheet-date"
                type="date"
                required
                value={sheetDate}
                onChange={(e) => setSheetDate(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm tabular-nums outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
              />
            </div>
            <div>
              <label
                htmlFor="due-date"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Due Date <span className="text-rose-600">*</span>
              </label>
              <input
                id="due-date"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm tabular-nums outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
              />
            </div>
          </div>

          {/* VENDOR SELECT + INLINE QUICK ADD */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="payment-vendor"
                className="text-xs font-medium text-slate-700"
              >
                Vendor / Supplier <span className="text-rose-600">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowQuickAddVendor(!showQuickAddVendor)}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                + Quick Add Vendor
              </button>
            </div>

            <select
              id="payment-vendor"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
            >
              {vendorsList.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>

            {/* INLINE QUICK ADD VENDOR BOX */}
            {showQuickAddVendor && (
              <form
                onSubmit={handleQuickAddVendor}
                className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2"
              >
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="New vendor name"
                  value={quickVendorName}
                  onChange={(e) => setQuickVendorName(e.target.value)}
                  className="flex-1 h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs outline-none focus:border-slate-900"
                />
                <button
                  type="submit"
                  disabled={isAddingVendor}
                  className="h-9 px-3 rounded-md bg-slate-900 text-white text-xs font-medium shrink-0 hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isAddingVendor ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  <span>Add</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickAddVendor(false)}
                  className="h-9 px-2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  Cancel
                </button>
              </form>
            )}
          </div>

          {/* INVOICE / REF NO + LIVE DUPLICATE WARNING */}
          <div>
            <label
              htmlFor="payment-ref"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Invoice / Ref No <span className="text-rose-600">*</span>
            </label>
            <input
              id="payment-ref"
              type="text"
              required
              placeholder="e.g., 0282, INV-8841, On Account, NA"
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm tabular-nums outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
            />

            {/* LIVE DUPLICATE BANNER */}
            {duplicateWarning?.isDuplicate && (
              <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2 animate-in fade-in-50">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Duplicate invoice warning:</strong> This vendor already has an
                  active entry with the same Invoice / Ref No (
                  {duplicateWarning.existingPayment?.sheet_date},{' '}
                  {duplicateWarning.existingPayment?.status}).
                </span>
              </div>
            )}
          </div>

          {/* PURPOSE PRESET CHIPS + INPUT */}
          <div>
            <label
              htmlFor="payment-purpose"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Purpose <span className="text-rose-600">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PURPOSE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPurpose(p)}
                  className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                    purpose === p
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              id="payment-purpose"
              type="text"
              required
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Specify payment purpose"
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
            />
          </div>

          {/* AMOUNT & TDS + LIVE NET PAYABLE */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="payment-amount"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Amount (₹) <span className="text-rose-600">*</span>
              </label>
              <input
                id="payment-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm font-medium tabular-nums outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
              />
            </div>
            <div>
              <label
                htmlFor="payment-tds"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                TDS (₹)
              </label>
              <input
                id="payment-tds"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={tds}
                onChange={(e) => setTds(e.target.value)}
                className={`w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border bg-white text-sm tabular-nums outline-none focus:ring-1 transition-colors ${
                  isTdsInvalid
                    ? 'border-rose-400 focus:border-rose-600 focus:ring-rose-500'
                    : 'border-slate-200 focus:border-slate-900 focus:ring-slate-900'
                }`}
              />
            </div>
          </div>

          {/* LIVE NET PAYABLE BOX */}
          <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Net Payable</span>
            <span
              className={`text-sm font-bold tabular-nums ${
                isTdsInvalid ? 'text-rose-600' : 'text-slate-900'
              }`}
            >
              {isTdsInvalid ? 'TDS exceeds Gross' : formatINR(netPayable)}
            </span>
          </div>

          {/* SOURCE BANK */}
          <div>
            <label
              htmlFor="payment-bank"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Source Bank <span className="text-rose-600">*</span>
            </label>
            <select
              id="payment-bank"
              value={sourceBankId}
              onChange={(e) => setSourceBankId(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.full_name} ({b.short_name})
                </option>
              ))}
            </select>
          </div>

          {/* INVOICE ATTACHMENT */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Invoice File (PDF / Image)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />

            {invoiceFilePath ? (
              <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-900 truncate">
                    {uploadedFileName || 'Attached Invoice File'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleViewAttachedFile}
                    disabled={isViewingFile}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {isViewingFile ? (
                      <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                    ) : (
                      <ExternalLink className="w-3 h-3" />
                    )}
                    <span>View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInvoiceFilePath(null);
                      setUploadedFileName(null);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                    title="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Paperclip className="w-4 h-4 text-slate-400" />
                  <span>
                    {isUploadingFile ? 'Uploading file...' : 'No file selected (optional)'}
                  </span>
                </div>
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
                  <span>Choose File</span>
                </button>
              </div>
            )}
          </div>

          {/* REMARKS */}
          <div>
            <label
              htmlFor="payment-remarks"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Remarks
            </label>
            <input
              id="payment-remarks"
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional notes for Owner or audit"
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
            />
          </div>
        </div>

        {/* DRAWER FOOTER BUTTONS */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center gap-2.5">
          <button
            type="button"
            disabled={isSavingDraft || isSubmitting}
            onClick={() => handleSave('DRAFT')}
            className="flex-1 min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors shadow-xs flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isSavingDraft ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
            ) : null}
            <span>Save as Draft</span>
          </button>
          <button
            type="button"
            disabled={isSavingDraft || isSubmitting}
            onClick={() => handleSave('PENDING_APPROVAL')}
            className="flex-1 min-h-[44px] sm:min-h-[40px] px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors shadow-xs flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
            ) : null}
            <span>Submit for Approval</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
