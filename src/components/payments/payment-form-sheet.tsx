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
  Landmark,
  CreditCard,
  CalendarClock,
  UserPlus,
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
import { getBankNameFromIfsc } from '@/lib/bank-names';
import { leanVendorSchema } from '@/lib/validators';
import { formatINR, formatINRInWords, getCurrentISTInfo, getTodayISTDateString } from '@/lib/format';
import { PurposeCombobox } from '@/components/payments/purpose-combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { IndianAmountInput } from '@/components/ui/indian-amount-input';
import type {
  CompanyBank,
  PaymentItem,
  PaymentMode,
  PaymentPurpose,
  RecurringReminder,
  Vendor,
} from '@/types/database';

interface PaymentFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: Vendor[];
  banks: CompanyBank[];
  reminders?: RecurringReminder[];
  purposes?: PaymentPurpose[];
  onPurposesChange?: (nextPurposes: PaymentPurpose[]) => void;
  editPayment?: PaymentItem | null;
  initialFromReminder?: {
    id: string;
    title: string;
    estimated_amount: number | null;
    vendor_id: string | null;
  } | null;
  onSuccess: (payment: PaymentItem) => void;
  onVendorCreated?: (vendor: Vendor) => void;
}

export function PaymentFormSheet({
  open,
  onOpenChange,
  vendors: initialVendors,
  banks,
  reminders = [],
  purposes = [],
  onPurposesChange,
  editPayment,
  initialFromReminder,
  onSuccess,
  onVendorCreated,
}: PaymentFormSheetProps) {
  const [vendorsList, setVendorsList] = React.useState<Vendor[]>(initialVendors);
  const vendorsRef = React.useRef<Vendor[]>(initialVendors);
  const banksRef = React.useRef<CompanyBank[]>(banks);
  vendorsRef.current = vendorsList;
  banksRef.current = banks;

  // Synchronize when incoming vendors list changes (preserving newly added vendor if not yet in props)
  React.useEffect(() => {
    setVendorsList((prev) => {
      const incomingIds = new Set(initialVendors.map((v) => v.id));
      const localExtras = prev.filter((v) => !incomingIds.has(v.id));
      return [...localExtras, ...initialVendors];
    });
  }, [initialVendors]);

  // Form Fields State
  const [sheetDate, setSheetDate] = React.useState<string>(() => getTodayISTDateString());
  const [dueDate, setDueDate] = React.useState<string>(() => getTodayISTDateString());
  const [vendorId, setVendorId] = React.useState<string>('');

  const [paymentMode, setPaymentMode] = React.useState<PaymentMode>('NEFT_RTGS');
  const [chequeNumber, setChequeNumber] = React.useState<string>('');
  const [chequeDate, setChequeDate] = React.useState<string>('');

  const [invoiceRef, setInvoiceRef] = React.useState<string>('');
  const [purpose, setPurpose] = React.useState<string>('');
  const [amount, setAmount] = React.useState<string>('');
  const [tds, setTds] = React.useState<string>('0');
  const [sourceBankId, setSourceBankId] = React.useState<string>('');
  const [remarks, setRemarks] = React.useState<string>('');
  const [invoiceFilePath, setInvoiceFilePath] = React.useState<string | null>(null);
  const [recurringReminderId, setRecurringReminderId] = React.useState<string>('');
  const [showReminderPicker, setShowReminderPicker] = React.useState<boolean>(false);

  const { yearMonth: currentIstMonth } = React.useMemo(() => getCurrentISTInfo(), []);
  const availableReminders = React.useMemo(() => {
    return reminders.filter(
      (r) =>
        (r.is_active && r.last_completed_month !== currentIstMonth) ||
        r.id === recurringReminderId
    );
  }, [reminders, currentIstMonth, recurringReminderId]);

  const linkedReminder = React.useMemo(() => {
    if (!recurringReminderId) return null;
    return (
      reminders.find((r) => r.id === recurringReminderId) ||
      (initialFromReminder && initialFromReminder.id === recurringReminderId
        ? {
          id: initialFromReminder.id,
          title: initialFromReminder.title,
          estimated_amount: initialFromReminder.estimated_amount,
          vendor_id: initialFromReminder.vendor_id,
        }
        : null)
    );
  }, [recurringReminderId, reminders, initialFromReminder]);

  const matchingVendorReminder = React.useMemo(() => {
    if (!vendorId || recurringReminderId) return null;
    return (
      availableReminders.find(
        (r) => r.vendor_id === vendorId && r.last_completed_month !== currentIstMonth
      ) || null
    );
  }, [vendorId, recurringReminderId, availableReminders, currentIstMonth]);

  const handleSelectReminder = (nextId: string) => {
    setRecurringReminderId(nextId);
    setShowReminderPicker(false);
    if (!nextId) return;
    const rem = reminders.find((r) => r.id === nextId);
    if (!rem) return;
    if (rem.vendor_id) {
      setVendorId(rem.vendor_id);
    }
    if (!amount && rem.estimated_amount) {
      setAmount(String(rem.estimated_amount));
    }
    if (!purpose.trim()) {
      setPurpose(rem.title);
    }
  };

  // File Upload State
  const [isUploadingFile, setIsUploadingFile] = React.useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = React.useState<string | null>(null);

  // Inline Quick Add Vendor State (full mandatory bank details)
  const [showQuickAddVendor, setShowQuickAddVendor] = React.useState<boolean>(false);
  const [quickPartyName, setQuickPartyName] = React.useState<string>('');
  const [quickBeneficiaryName, setQuickBeneficiaryName] = React.useState<string>('');
  const [quickAccountNumber, setQuickAccountNumber] = React.useState<string>('');
  const [quickIfscCode, setQuickIfscCode] = React.useState<string>('');
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

  // Selected vendor details for read-only verification strip
  const selectedVendor = React.useMemo(() => {
    return vendorsList.find((v) => v.id === vendorId) || null;
  }, [vendorsList, vendorId]);

  const quickIfscBankName = React.useMemo(() => {
    const cleaned = quickIfscCode.trim().toUpperCase();
    return cleaned.length >= 4 ? getBankNameFromIfsc(cleaned) : '';
  }, [quickIfscCode]);

  const resetQuickAddFields = React.useCallback(() => {
    setQuickPartyName('');
    setQuickBeneficiaryName('');
    setQuickAccountNumber('');
    setQuickIfscCode('');
  }, []);

  // Initialize form whenever sheet opens (never reset mid-edit when vendorsList updates)
  React.useEffect(() => {
    if (!open) return;

    const currentVendors = vendorsRef.current;
    const currentBanks = banksRef.current;
    const todayIst = getTodayISTDateString();

    setShowQuickAddVendor(false);
    resetQuickAddFields();
    setDuplicateWarning(null);

    if (editPayment) {
      setSheetDate(editPayment.sheet_date || todayIst);
      setDueDate(editPayment.due_date || editPayment.sheet_date || todayIst);
      setVendorId(editPayment.vendor_id);
      setPaymentMode(editPayment.payment_mode || 'NEFT_RTGS');
      setChequeNumber(editPayment.cheque_number || '');
      setChequeDate(editPayment.cheque_date || '');
      setInvoiceRef(editPayment.invoice_ref);
      setPurpose(editPayment.purpose || '');
      setAmount(String(editPayment.amount));
      setTds(String(editPayment.tds || 0));
      setSourceBankId(editPayment.source_bank_id);
      setRemarks(editPayment.remarks || '');
      setInvoiceFilePath(editPayment.invoice_file_path);
      setRecurringReminderId(editPayment.recurring_reminder_id || '');
      setShowReminderPicker(false);
      setUploadedFileName(
        editPayment.invoice_file_path
          ? editPayment.invoice_file_path.split('/').pop() || 'Attached Invoice'
          : null
      );
    } else if (initialFromReminder) {
      // Pre-fill from Recurring Reminder
      setSheetDate(todayIst);
      setDueDate(todayIst);
      setVendorId(initialFromReminder.vendor_id || (currentVendors[0]?.id ?? ''));
      setPaymentMode('NEFT_RTGS');
      setChequeNumber('');
      setChequeDate('');
      setInvoiceRef('');
      setPurpose(initialFromReminder.title || '');
      setAmount(initialFromReminder.estimated_amount ? String(initialFromReminder.estimated_amount) : '');
      setTds('0');
      setSourceBankId(currentBanks[0] ? currentBanks[0].id : '');
      setRemarks('');
      setInvoiceFilePath(null);
      setRecurringReminderId(initialFromReminder.id);
      setShowReminderPicker(false);
      setUploadedFileName(null);
    } else {
      setSheetDate(todayIst);
      setDueDate(todayIst);
      setVendorId(currentVendors.length > 0 ? currentVendors[0].id : '');
      setPaymentMode('NEFT_RTGS');
      setChequeNumber('');
      setChequeDate('');
      setInvoiceRef('');
      setPurpose('');
      setAmount('');
      setTds('0');
      setSourceBankId(currentBanks[0] ? currentBanks[0].id : '');
      setRemarks('');
      setInvoiceFilePath(null);
      setRecurringReminderId('');
      setShowReminderPicker(false);
      setUploadedFileName(null);
    }
  }, [open, editPayment, initialFromReminder, resetQuickAddFields]);

  // If vendors/banks load after open and selection is empty, pick first available without resetting other fields
  React.useEffect(() => {
    if (open && !vendorId && vendorsList.length > 0) {
      setVendorId(vendorsList[0].id);
    }
  }, [open, vendorId, vendorsList]);

  React.useEffect(() => {
    if (open && !sourceBankId && banks.length > 0) {
      setSourceBankId(banks[0].id);
    }
  }, [open, sourceBankId, banks]);

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

  // Inline Quick Add Vendor Handler (validates all 4 mandatory bank fields)
  const handleQuickAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const cleanAccount = quickAccountNumber.replace(/\s+/g, '').trim();
    const validation = leanVendorSchema.safeParse({
      party_name: quickPartyName,
      beneficiary_name: quickBeneficiaryName,
      account_number: cleanAccount,
      ifsc_code: quickIfscCode,
    });

    if (!validation.success) {
      toast.error(
        validation.error.issues[0]?.message ||
          'Please complete all 4 mandatory vendor bank fields.'
      );
      return;
    }

    if (cleanAccount.toUpperCase() === 'PENDING' || /^0+$/.test(cleanAccount)) {
      toast.error('Please enter a valid bank account number.');
      return;
    }

    setIsAddingVendor(true);
    try {
      const res = await createVendor({
        party_name: validation.data.party_name,
        beneficiary_name: validation.data.beneficiary_name,
        account_number: validation.data.account_number,
        ifsc_code: validation.data.ifsc_code,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }

      const newVendor = res.data;
      setVendorsList((prev) =>
        [newVendor, ...prev.filter((v) => v.id !== newVendor.id)].sort((a, b) =>
          (a.party_name || a.name || '').localeCompare(b.party_name || b.name || '')
        )
      );
      setVendorId(newVendor.id);
      resetQuickAddFields();
      setShowQuickAddVendor(false);
      onVendorCreated?.(newVendor);
      const bankLabel = getBankNameFromIfsc(newVendor.ifsc_code);
      toast.success(
        `Vendor "${newVendor.party_name || newVendor.name}" (${bankLabel}) created and selected`
      );
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

    if (file.size > 4 * 1024 * 1024) {
      toast.error('File size exceeds the 4 MB limit.');
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
      toast.success('Invoice file attached.');
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
  const handleSave = async (targetStatus: 'DRAFT' | 'PENDING_VERIFICATION') => {
    if (!vendorId) {
      toast.error('Please select a vendor.');
      return;
    }

    if (!sheetDate || !dueDate) {
      toast.error('Sheet Date and Due Date are required.');
      return;
    }

    const cleanRef = invoiceRef.trim() || 'NA';

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
        invoice_ref: cleanRef,
        purpose: purpose.trim(),
        payment_type: 'AGAINST_BILL' as const,
        payment_mode: paymentMode,
        amount: numAmount,
        tds: numTds,
        source_bank_id: sourceBankId,
        remarks: remarks.trim() || null,
        invoice_file_path: invoiceFilePath,
        recurring_reminder_id: recurringReminderId || null,
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
          ? 'Payment entry saved as Draft.'
          : 'Payment submitted for Senior Accountant verification.'
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
    : initialFromReminder
      ? `New Payment Entry (from Reminder)`
      : 'New Payment Entry';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col bg-white overflow-hidden shadow-2xl"
      >
        {/* DRAWER HEADER */}
        <SheetHeader className="px-4 sm:px-5 py-3.5 sm:py-4 pr-10 bg-white border-b border-slate-200 shrink-0">
          <SheetTitle className="text-base font-bold text-slate-950">
            {sheetTitle}
          </SheetTitle>
          <SheetDescription className="text-xs text-slate-600">
            Save as draft or submit to Senior Accountant for verification.
          </SheetDescription>
        </SheetHeader>

        {/* SCROLLABLE FORM BODY */}
        <div className="flex-1 overflow-y-auto bg-slate-100/80 p-3.5 sm:p-5 space-y-3.5">
          {/* CARD 1: DISBURSEMENT MODE & DATES */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 sm:p-4 shadow-sm space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-800 tracking-tight mb-1.5">
                Disbursement Mode
              </label>
              <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-1 border border-slate-300/80 gap-1">
                <button
                  type="button"
                  onClick={() => setPaymentMode('NEFT_RTGS')}
                  className={`min-h-[36px] py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${paymentMode === 'NEFT_RTGS'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-950'
                    }`}
                >
                  NEFT / RTGS
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMode('IMPS')}
                  className={`min-h-[36px] py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${paymentMode === 'IMPS'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-950'
                    }`}
                >
                  IMPS
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMode('CHEQUE')}
                  className={`min-h-[36px] py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${paymentMode === 'CHEQUE'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-950'
                    }`}
                >
                  Cheque
                </button>
              </div>
              {paymentMode === 'IMPS' && (
                <p className="mt-1.5 text-[11px] font-medium text-emerald-700">
                  Instant 24×7 transfer
                </p>
              )}
            </div>

            {paymentMode === 'CHEQUE' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-amber-50/70 border border-amber-300/80 animate-in fade-in-50">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 tracking-tight mb-1">
                    Cheque Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 004821"
                    value={chequeNumber}
                    onChange={(e) => setChequeNumber(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-950 font-mono font-medium placeholder:text-slate-500 shadow-sm tabular-nums hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-800 tracking-tight mb-1">
                    Cheque Date
                  </label>
                  <DatePicker
                    value={chequeDate}
                    onChange={setChequeDate}
                    placeholder="Select cheque date"
                    allowClear
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="sheet-date"
                  className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                >
                  Sheet Date <span className="text-rose-600">*</span>
                </label>
                <DatePicker
                  id="sheet-date"
                  value={sheetDate}
                  onChange={setSheetDate}
                  placeholder="Select sheet date"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="due-date"
                  className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                >
                  Due Date <span className="text-rose-600">*</span>
                </label>
                <DatePicker
                  id="due-date"
                  value={dueDate}
                  onChange={setDueDate}
                  placeholder="Select due date"
                  required
                />
              </div>
            </div>
          </div>

          {/* CARD 2: VENDOR, INVOICE REF & PURPOSE */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 sm:p-4 shadow-sm space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="payment-vendor"
                  className="text-xs font-semibold text-slate-800 tracking-tight"
                >
                  Vendor / Party Name <span className="text-rose-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (showQuickAddVendor) {
                      setShowQuickAddVendor(false);
                      resetQuickAddFields();
                    } else {
                      setShowQuickAddVendor(true);
                    }
                  }}
                  className="text-[11px] font-semibold text-[#7F1D1D] hover:underline cursor-pointer"
                >
                  {showQuickAddVendor ? 'Close Quick Add' : '+ Quick Add Vendor'}
                </button>
              </div>

              <div className="relative">
                <select
                  id="payment-vendor"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-medium shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
                >
                  {vendorsList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.party_name || v.name} {v.ifsc_code ? `(${v.ifsc_code})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* READ-ONLY BENEFICIARY VERIFICATION STRIP */}
              {selectedVendor && (
                <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-300/80 text-[11px] text-slate-800 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                    <CreditCard className="w-3.5 h-3.5 text-slate-600" />
                    <span>Beneficiary: {selectedVendor.beneficiary_name || selectedVendor.party_name || selectedVendor.name}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-slate-700 font-medium text-[10px]">
                    <span>A/C: {selectedVendor.account_number || 'NA'}</span>
                    <span>•</span>
                    <span>IFSC: {selectedVendor.ifsc_code || 'NA'}</span>
                  </div>
                </div>
              )}

              {/* INLINE QUICK ADD VENDOR BOX (ALL 4 MANDATORY BANK FIELDS) */}
              {showQuickAddVendor && (
                <form
                  onSubmit={handleQuickAddVendor}
                  className="mt-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-300 space-y-3 animate-in fade-in-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-[#7F1D1D]" />
                      <span>Quick Add Vendor &amp; Bank Details</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowQuickAddVendor(false);
                        resetQuickAddFields();
                      }}
                      className="text-[11px] font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>

                  <div>
                    <label
                      htmlFor="qa-party-name"
                      className="block text-[11px] font-semibold text-slate-800 mb-1"
                    >
                      Party Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="qa-party-name"
                      type="text"
                      autoFocus
                      required
                      disabled={isAddingVendor}
                      placeholder="e.g. Shree Laxmi Timber Traders"
                      value={quickPartyName}
                      onChange={(e) => setQuickPartyName(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-950 font-medium placeholder:text-slate-500 shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label
                        htmlFor="qa-beneficiary-name"
                        className="text-[11px] font-semibold text-slate-800"
                      >
                        Beneficiary Name (as per Bank) <span className="text-rose-600">*</span>
                      </label>
                      <button
                        type="button"
                        disabled={!quickPartyName.trim() || isAddingVendor}
                        onClick={() => setQuickBeneficiaryName(quickPartyName.trim())}
                        className="text-[11px] font-semibold text-[#7F1D1D] hover:underline cursor-pointer disabled:opacity-40"
                      >
                        Same as Party Name
                      </button>
                    </div>
                    <input
                      id="qa-beneficiary-name"
                      type="text"
                      required
                      disabled={isAddingVendor}
                      placeholder="Exact bank account holder name"
                      value={quickBeneficiaryName}
                      onChange={(e) => setQuickBeneficiaryName(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-950 font-medium placeholder:text-slate-500 shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="qa-account-number"
                        className="block text-[11px] font-semibold text-slate-800 mb-1"
                      >
                        Account Number <span className="text-rose-600">*</span>
                      </label>
                      <input
                        id="qa-account-number"
                        type="text"
                        required
                        disabled={isAddingVendor}
                        placeholder="e.g. 918020012345678"
                        value={quickAccountNumber}
                        onChange={(e) =>
                          setQuickAccountNumber(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))
                        }
                        className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-950 font-mono font-medium tabular-nums placeholder:text-slate-500 shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="qa-ifsc-code"
                        className="block text-[11px] font-semibold text-slate-800 mb-1"
                      >
                        IFSC Code <span className="text-rose-600">*</span>
                      </label>
                      <input
                        id="qa-ifsc-code"
                        type="text"
                        required
                        maxLength={11}
                        disabled={isAddingVendor}
                        placeholder="e.g. UTIB0001462"
                        value={quickIfscCode}
                        onChange={(e) =>
                          setQuickIfscCode(
                            e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                          )
                        }
                        className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-950 font-mono font-bold uppercase placeholder:text-slate-500 shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15"
                      />
                      {quickIfscBankName && (
                        <p className="text-[11px] font-medium text-emerald-700 mt-1 flex items-center gap-1">
                          <Landmark className="w-3 h-3 shrink-0" />
                          <span>{quickIfscBankName}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isAddingVendor}
                      onClick={() => {
                        setShowQuickAddVendor(false);
                        resetQuickAddFields();
                      }}
                      className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isAddingVendor}
                      className="h-9 px-3.5 rounded-lg bg-[#7F1D1D] text-white text-xs font-semibold shrink-0 hover:bg-[#691717] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      {isAddingVendor ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5" />
                      )}
                      <span>Save Vendor &amp; Select</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* INVOICE / REF NO + LIVE DUPLICATE WARNING */}
            <div>
              <label
                htmlFor="payment-ref"
                className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
              >
                Invoice / Ref No <span className="text-slate-500 font-normal">(Optional)</span>
              </label>
              <input
                id="payment-ref"
                type="text"
                placeholder="e.g., 0282, INV-8841 (leave blank for NA)"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-medium placeholder:text-slate-500 shadow-sm tabular-nums hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
              />

              {duplicateWarning?.isDuplicate && (
                <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900 flex items-start gap-2 animate-in fade-in-50">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Duplicate invoice detected:</strong> {selectedVendor?.party_name || 'This vendor'} already has an active entry with Invoice / Ref No &ldquo;{duplicateWarning.existingPayment?.invoice_ref}&rdquo; dated {duplicateWarning.existingPayment?.sheet_date} ({duplicateWarning.existingPayment?.status}).
                  </span>
                </div>
              )}
            </div>

            {/* DATABASE-BACKED PURPOSE COMBOBOX */}
            <div>
              <label
                htmlFor="payment-purpose"
                className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
              >
                Purpose <span className="text-rose-600">*</span>
              </label>
              <PurposeCombobox
                id="payment-purpose"
                value={purpose}
                onChange={setPurpose}
                purposes={purposes}
                onPurposesChange={onPurposesChange}
                placeholder="Select or type purpose (e.g., Against Bill, Advance, Freight)"
              />
            </div>
          </div>

          {/* CARD 3: FINANCIALS & SOURCE BANK */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 sm:p-4 shadow-sm space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="payment-amount"
                  className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                >
                  Gross Amount (₹) <span className="text-rose-600">*</span>
                </label>
                <IndianAmountInput
                  id="payment-amount"
                  required
                  placeholder="0.00"
                  value={amount}
                  onValueChange={setAmount}
                  className="w-full min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-semibold placeholder:text-slate-500 shadow-sm tabular-nums hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
                />
              </div>
              <div>
                <label
                  htmlFor="payment-tds"
                  className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
                >
                  TDS Deduction (₹)
                </label>
                <IndianAmountInput
                  id="payment-tds"
                  placeholder="0.00"
                  value={tds}
                  onValueChange={setTds}
                  className={`w-full min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border bg-white text-sm text-slate-950 font-medium placeholder:text-slate-500 shadow-sm tabular-nums outline-none transition-colors ${isTdsInvalid
                    ? 'border-rose-500 focus:border-rose-600 focus:ring-2 focus:ring-rose-500/20'
                    : 'border-slate-300 hover:border-slate-400 focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15'
                    }`}
                />
              </div>
            </div>

            {/* PROMINENT NET PAYABLE SUMMARY BAR */}
            <div
              className={`px-3.5 py-2.5 rounded-lg border text-xs ${isTdsInvalid
                ? 'bg-rose-50 border-rose-300'
                : 'bg-[#FEF2F2] border-[#7F1D1D]/30'
                }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-semibold ${isTdsInvalid ? 'text-rose-800' : 'text-[#7F1D1D]'
                    }`}
                >
                  Net Payable to Beneficiary
                </span>
                <span
                  className={`text-base font-bold tabular-nums ${isTdsInvalid ? 'text-rose-700' : 'text-[#7F1D1D]'
                    }`}
                >
                  {isTdsInvalid ? 'TDS exceeds Gross' : formatINR(netPayable)}
                </span>
              </div>
              {!isTdsInvalid && netPayable > 0 && (
                <p className="text-[11px] leading-snug text-[#7F1D1D]/80 font-medium mt-1.5 pt-1.5 border-t border-[#7F1D1D]/15">
                  {formatINRInWords(netPayable)}
                </p>
              )}
            </div>

            {/* SOURCE BANK */}
            <div>
              <label
                htmlFor="payment-bank"
                className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
              >
                Source Bank <span className="text-rose-600">*</span>
              </label>
              <select
                id="payment-bank"
                value={sourceBankId}
                onChange={(e) => setSourceBankId(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-medium shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
              >
                {banks.map((b) => {
                  const shortCode = b.short_code || b.short_name;
                  const bankName = b.bank_name || b.full_name;
                  return (
                    <option key={b.id} value={b.id}>
                      {bankName} ({shortCode}) — Bal: {formatINR(b.available_balance ?? 0)}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* CARD 4: OPTIONAL ATTACHMENT, REMARKS & MONTHLY REMINDER */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 sm:p-4 shadow-sm space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-800 tracking-tight mb-1">
                Invoice Attachment (PDF or Image, max 4 MB)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />

              {invoiceFilePath ? (
                <div className="p-3 rounded-lg border border-emerald-300 bg-emerald-50/70 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCheck2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="text-xs font-semibold text-emerald-950 truncate">
                      {uploadedFileName || 'Attached Invoice File'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleViewAttachedFile}
                      disabled={isViewingFile}
                      className="text-xs font-semibold text-[#7F1D1D] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {isViewingFile ? (
                        <Loader2 className="w-3 h-3 animate-spin text-[#7F1D1D]" />
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
                      className="p-1 text-slate-500 hover:text-rose-600 rounded transition-colors"
                      title="Remove attachment"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                    <Paperclip className="w-4 h-4 text-slate-500" />
                    <span>
                      {isUploadingFile ? 'Uploading file...' : 'No bill file attached (optional)'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingFile}
                    className="px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 shrink-0 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {isUploadingFile ? (
                      <Loader2 className="w-3 h-3 animate-spin text-slate-600" />
                    ) : (
                      <Upload className="w-3 h-3 text-slate-600" />
                    )}
                    <span>Choose Bill</span>
                  </button>
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="payment-remarks"
                className="block text-xs font-semibold text-slate-800 tracking-tight mb-1"
              >
                Remarks
              </label>
              <input
                id="payment-remarks"
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes for verification or audit"
                className="w-full min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-medium placeholder:text-slate-500 shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
              />
            </div>

            {/* OPTIONAL MONTHLY REMINDER LINK (ONLY SHOWN WHEN PENDING REMINDERS OR LINKED REMINDER EXIST) */}
            {(availableReminders.length > 0 || Boolean(linkedReminder)) && (
              <div className="pt-1 border-t border-slate-100">
                {linkedReminder && !showReminderPicker ? (
                  <div className="px-2.5 py-2 rounded-lg bg-emerald-50/80 border border-emerald-300 text-[11px] text-emerald-950 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CalendarClock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span className="truncate">
                        Linked Reminder: <strong>{linkedReminder.title}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {availableReminders.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setShowReminderPicker(true)}
                          className="font-semibold text-emerald-800 hover:underline cursor-pointer"
                        >
                          Change
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRecurringReminderId('');
                          setShowReminderPicker(false);
                        }}
                        className="font-semibold text-slate-600 hover:text-rose-700 cursor-pointer"
                      >
                        Unlink
                      </button>
                    </div>
                  </div>
                ) : showReminderPicker ? (
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-300 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="payment-reminder-link"
                        className="text-[11px] font-semibold text-slate-800 inline-flex items-center gap-1"
                      >
                        <CalendarClock className="w-3.5 h-3.5 text-slate-600" />
                        <span>Link to Monthly Reminder</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowReminderPicker(false)}
                        className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                    <select
                      id="payment-reminder-link"
                      value={recurringReminderId}
                      onChange={(e) => handleSelectReminder(e.target.value)}
                      className="w-full min-h-[38px] sm:min-h-[36px] px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-950 font-medium shadow-sm hover:border-slate-400 outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 transition-colors"
                    >
                      <option value="">None — Regular one-off payment</option>
                      {availableReminders.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title} (Due {r.due_day_of_month}th
                          {r.estimated_amount ? ` · Est. ${formatINR(r.estimated_amount)}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : matchingVendorReminder ? (
                  <button
                    type="button"
                    onClick={() => handleSelectReminder(matchingVendorReminder.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-950 hover:bg-amber-100/70 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                      <CalendarClock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span className="truncate">
                        Matches monthly reminder: <strong>{matchingVendorReminder.title}</strong>
                      </span>
                    </span>
                    <span className="font-semibold text-[#7F1D1D] shrink-0">Link &amp; Auto-tick</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowReminderPicker(true)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-[#7F1D1D] transition-colors cursor-pointer"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    <span>Link to a pending monthly reminder ({availableReminders.length})</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* DRAWER FOOTER BUTTONS */}
        <div className="px-4 sm:px-5 py-3.5 bg-white border-t border-slate-200 shadow-[0_-2px_10px_rgba(15,23,42,0.05)] flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 pb-safe">
          <button
            type="button"
            disabled={isSavingDraft || isSubmitting}
            onClick={() => handleSave('DRAFT')}
            className="sm:flex-1 min-h-[44px] sm:min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isSavingDraft ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
            ) : null}
            <span>Save as Draft</span>
          </button>
          <button
            type="button"
            disabled={isSavingDraft || isSubmitting}
            onClick={() => handleSave('PENDING_VERIFICATION')}
            className="sm:flex-1 min-h-[44px] sm:min-h-[40px] px-3 rounded-lg bg-[#7F1D1D] hover:bg-[#691717] text-white text-xs font-semibold transition-colors shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
            ) : null}
            <span>Save & Submit for Verification</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
