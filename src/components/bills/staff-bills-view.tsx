'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Upload,
  FileText,
  Camera,
  FileCheck2,
  Paperclip,
  Loader2,
  Clock,
  CheckCircle2,
  ExternalLink,
  Plus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { uploadIncomingBill } from '@/actions/bills';
import { getSignedFileUrl } from '@/actions/storage';
import { formatHumanDate, formatINR } from '@/lib/format';
import type { IncomingBill, Vendor } from '@/types/database';

interface StaffBillsViewProps {
  vendors: Vendor[];
  initialBills: IncomingBill[];
}

export function StaffBillsView({ vendors, initialBills }: StaffBillsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tab state synced with URL query parameter (?tab=upload | ?tab=uploads)
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = React.useState<'upload' | 'uploads'>(
    tabParam === 'uploads' ? 'uploads' : 'upload'
  );

  React.useEffect(() => {
    if (tabParam === 'uploads') {
      setActiveTab('uploads');
    } else if (tabParam === 'upload' || !tabParam) {
      setActiveTab('upload');
    }
  }, [tabParam]);

  const handleTabChange = (tab: 'upload' | 'uploads') => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'uploads') {
      params.set('tab', 'uploads');
    } else {
      params.delete('tab');
    }
    const query = params.toString();
    router.replace(`/bills${query ? `?${query}` : ''}`);
  };

  // Bills list state
  const [bills, setBills] = React.useState<IncomingBill[]>(initialBills);

  // Form state
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = React.useState<string | null>(null);
  const [vendorSelect, setVendorSelect] = React.useState<string>(
    vendors.length > 0 ? vendors[0].id : '__new__'
  );
  const [customVendorName, setCustomVendorName] = React.useState<string>('');
  const [invoiceRef, setInvoiceRef] = React.useState<string>('');
  const [estimatedAmount, setEstimatedAmount] = React.useState<string>('');
  const [notes, setNotes] = React.useState<string>('');

  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [viewingFileId, setViewingFileId] = React.useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Clean up object URLs
  React.useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds the 5 MB limit');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Invalid format. Please select a PDF, JPG, PNG, or WEBP file');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const handleClearFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!selectedFile) {
      toast.error('Please select an invoice photo or PDF first');
      return;
    }

    if (vendorSelect === '__new__' && !customVendorName.trim()) {
      toast.error('Please enter the vendor / supplier name');
      return;
    }

    if (!invoiceRef.trim()) {
      toast.error('Please enter the Invoice / PI Number');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (vendorSelect === '__new__') {
        formData.append('vendor_name_fallback', customVendorName.trim());
      } else {
        formData.append('vendor_id', vendorSelect);
      }
      formData.append('invoice_ref', invoiceRef.trim());
      if (estimatedAmount.trim()) {
        formData.append('estimated_amount', estimatedAmount.trim());
      }
      if (notes.trim()) {
        formData.append('notes', notes.trim());
      }

      const result = await uploadIncomingBill(formData);

      if (!result.success) {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      toast.success('Invoice sent to Accountant');

      // Update local bills list
      setBills((prev) => [result.data, ...prev]);

      // Reset form
      setSelectedFile(null);
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
        setFilePreviewUrl(null);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setInvoiceRef('');
      setEstimatedAmount('');
      setNotes('');
      setCustomVendorName('');
      if (vendors.length > 0) {
        setVendorSelect(vendors[0].id);
      }

      // Switch to My Uploads tab to see the uploaded bill
      handleTabChange('uploads');
    } catch {
      toast.error('An unexpected error occurred while uploading. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenFile = async (billId: string, filePath: string) => {
    try {
      setViewingFileId(billId);
      const res = await getSignedFileUrl('supplier-invoices', filePath);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not generate document preview URL.');
    } finally {
      setViewingFileId(null);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* 2-TAB SEGMENTED CONTROLLER */}
      <div className="flex items-center justify-center sm:justify-start">
        <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => handleTabChange('upload')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'upload'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Bill</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('uploads')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'uploads'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>My Uploads</span>
            {bills.length > 0 && (
              <span
                className={`tabular-nums text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  activeTab === 'uploads'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {bills.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* TAB 1: UPLOAD BILL VIEW */}
      {activeTab === 'upload' && (
        <div className="max-w-lg mx-auto">
          {/* Desktop Heading */}
          <div className="hidden lg:block mb-5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Upload Supplier Invoice
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Send vendor bills directly to the Accounts team.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-xs">
            <h2 className="text-base font-semibold text-slate-900 mb-4 lg:hidden">
              Upload Supplier Invoice
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* LARGE TAP-TO-UPLOAD DROPZONE */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Invoice Photo or PDF <span className="text-rose-600">*</span>
                </label>
                <input
                  ref={fileInputRef}
                  id="staff-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors min-h-[140px] flex flex-col items-center justify-center ${
                    selectedFile
                      ? 'border-emerald-300 bg-emerald-50/40'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50/70'
                  }`}
                >
                  {selectedFile ? (
                    <div className="w-full flex flex-col items-center">
                      <div className="flex items-center justify-center gap-2 text-emerald-700">
                        <FileCheck2 className="w-5 h-5 shrink-0" />
                        <span className="text-xs font-semibold truncate max-w-[260px]">
                          {selectedFile.name}
                        </span>
                        <button
                          type="button"
                          onClick={handleClearFile}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-md hover:bg-white transition-colors"
                          title="Remove file"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                        {(selectedFile.size / 1024).toFixed(0)} KB · Tap to replace file
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center mx-auto mb-2 text-slate-500 shadow-xs">
                        <Camera className="w-5 h-5" />
                      </div>
                      <div className="text-xs font-medium text-slate-700">
                        Tap to take photo or select Invoice PDF/Image
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        PDF, JPG, PNG up to 5MB
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* VENDOR SELECT + NEW VENDOR FALLBACK */}
              <div>
                <label
                  htmlFor="staff-vendor-select"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Vendor / Supplier <span className="text-rose-600">*</span>
                </label>
                <select
                  id="staff-vendor-select"
                  value={vendorSelect}
                  onChange={(e) => setVendorSelect(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                  <option value="__new__">+ Type a new vendor name...</option>
                </select>

                {vendorSelect === '__new__' && (
                  <div className="mt-2">
                    <input
                      id="staff-vendor-custom"
                      type="text"
                      autoFocus
                      required
                      placeholder="Enter new vendor name"
                      value={customVendorName}
                      onChange={(e) => setCustomVendorName(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      New vendor will be automatically added to the system directory.
                    </p>
                  </div>
                )}
              </div>

              {/* INVOICE / PI NUMBER */}
              <div>
                <label
                  htmlFor="staff-invoice-ref"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Invoice / PI Number <span className="text-rose-600">*</span>
                </label>
                <input
                  id="staff-invoice-ref"
                  type="text"
                  required
                  placeholder="e.g., INV-9145 or PI-204"
                  value={invoiceRef}
                  onChange={(e) => setInvoiceRef(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 tabular-nums outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
                />
              </div>

              {/* BILL AMOUNT (OPTIONAL) */}
              <div>
                <label
                  htmlFor="staff-amount"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Bill Amount ₹ <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  id="staff-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 tabular-nums outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition-colors"
                />
              </div>

              {/* NOTE FOR ACCOUNTANT */}
              <div>
                <label
                  htmlFor="staff-note"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Note for Accountant{' '}
                  <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  id="staff-note"
                  rows={2}
                  placeholder="e.g., Urgent plywood restock order"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 resize-none transition-colors"
                ></textarea>
              </div>

              {/* SUBMIT BUTTON */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[44px] rounded-lg bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-sm font-medium transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Sending to Accountant...</span>
                  </>
                ) : (
                  <span>Send to Accountant</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: MY UPLOADS LIST VIEW */}
      {activeTab === 'uploads' && (
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                My Uploads
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Bills you have submitted to the Accounts team.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleTabChange('upload')}
              className="min-h-[40px] px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload New</span>
            </button>
          </div>

          {bills.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <FileText className="w-5 h-5" />
              </div>
              <div className="text-sm font-semibold text-slate-900">No bills uploaded yet</div>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Uploaded supplier invoices will appear here so you can track handoff to the
                accountant.
              </p>
              <button
                type="button"
                onClick={() => handleTabChange('upload')}
                className="mt-4 min-h-[38px] px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Upload First Invoice</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {bills.map((b) => {
                const vendorName =
                  b.vendor?.name || b.vendor_name_fallback || 'Unknown Supplier';

                const isViewingThis = viewingFileId === b.id;

                const fileExt = b.file_path.split('.').pop()?.toUpperCase() || 'FILE';

                return (
                  <div
                    key={b.id}
                    className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-xs hover:border-slate-300 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">
                          {vendorName}
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          Ref: {b.invoice_ref}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="tabular-nums flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {formatHumanDate(b.created_at)}
                        </span>

                        {b.estimated_amount && b.estimated_amount > 0 && (
                          <>
                            <span>·</span>
                            <span className="tabular-nums font-medium text-slate-700">
                              {formatINR(b.estimated_amount)}
                            </span>
                          </>
                        )}

                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => handleOpenFile(b.id, b.file_path)}
                          disabled={isViewingThis}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium cursor-pointer"
                          title="Open attached invoice document"
                        >
                          {isViewingThis ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                          ) : (
                            <Paperclip className="w-3 h-3" />
                          )}
                          <span>Invoice {fileExt}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                        </button>
                      </div>

                      {b.notes && (
                        <div className="mt-2 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-md border border-slate-100 max-w-xl">
                          <span className="font-medium text-slate-500">Note: </span>
                          <span>{b.notes}</span>
                        </div>
                      )}
                    </div>

                    {/* STATUS PILL */}
                    <div className="shrink-0 self-start sm:self-center">
                      {b.status === 'CONVERTED' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Added to Payment Queue</span>
                        </span>
                      ) : b.status === 'DISMISSED' ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          Dismissed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock className="w-3 h-3" />
                          <span>Waiting for Accountant</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
