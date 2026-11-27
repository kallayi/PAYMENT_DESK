'use client';

import * as React from 'react';
import { Plus, Search, Edit2, Loader2, Building2, Download, Upload } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createVendor, updateVendor, toggleVendorActive } from '@/actions/vendors';
import { VendorImportModal } from '@/components/vendors/vendor-import-modal';
import { leanVendorSchema, type LeanVendorInput } from '@/lib/validators';
import type { Company, Vendor } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface VendorManagementProps {
  initialVendors: Vendor[];
  activeCompany?: Company | null;
  canManage?: boolean;
}

function getBankChip(ifsc: string | null | undefined) {
  if (!ifsc || ifsc.length < 4) return null;
  const prefix = ifsc.slice(0, 4).toUpperCase();
  if (prefix === 'UTIB') {
    return { label: 'AXIS', color: 'bg-rose-50 text-rose-800 border-rose-200' };
  }
  if (prefix === 'SIBL') {
    return { label: 'SIB', color: 'bg-blue-50 text-blue-800 border-blue-200' };
  }
  if (prefix === 'HDFC') {
    return { label: 'HDFC', color: 'bg-sky-50 text-sky-800 border-sky-200' };
  }
  if (prefix === 'KKBK') {
    return { label: 'KOTAK', color: 'bg-red-50 text-red-800 border-red-200' };
  }
  return { label: prefix, color: 'bg-slate-100 text-slate-700 border-slate-200' };
}

export function VendorManagement({
  initialVendors,
  activeCompany = null,
  canManage = true,
}: VendorManagementProps) {
  const [vendors, setVendors] = React.useState<Vendor[]>(initialVendors);
  const [search, setSearch] = React.useState('');
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = React.useState(false);
  const [isExportingExcel, setIsExportingExcel] = React.useState(false);
  const [editingVendor, setEditingVendor] = React.useState<Vendor | null>(null);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setVendors(initialVendors);
  }, [initialVendors]);

  // React Hook Form for Add Vendor
  const addForm = useForm<LeanVendorInput>({
    resolver: zodResolver(leanVendorSchema),
    defaultValues: {
      party_name: '',
      beneficiary_name: '',
      account_number: '',
      ifsc_code: '',
      remarks: '',
    },
  });

  // React Hook Form for Edit Vendor
  const editForm = useForm<LeanVendorInput>({
    resolver: zodResolver(leanVendorSchema),
    defaultValues: {
      party_name: '',
      beneficiary_name: '',
      account_number: '',
      ifsc_code: '',
      remarks: '',
    },
  });

  const filteredVendors = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        (v.party_name || v.name || '').toLowerCase().includes(q) ||
        (v.beneficiary_name || '').toLowerCase().includes(q) ||
        (v.account_number || v.bank_account_no || '').toLowerCase().includes(q) ||
        (v.ifsc_code || '').toLowerCase().includes(q)
    );
  }, [vendors, search]);

  function openCreateModal() {
    addForm.reset({
      party_name: '',
      beneficiary_name: '',
      account_number: '',
      ifsc_code: '',
      remarks: '',
    });
    setIsAddModalOpen(true);
  }

  function openEditModal(vendor: Vendor) {
    setEditingVendor(vendor);
    editForm.reset({
      party_name: vendor.party_name || vendor.name,
      beneficiary_name: vendor.beneficiary_name || vendor.name,
      account_number: vendor.account_number || vendor.bank_account_no || '',
      ifsc_code: vendor.ifsc_code || '',
      remarks: vendor.remarks || vendor.notes || '',
    });
  }

  function onAddSubmit(data: LeanVendorInput) {
    startTransition(async () => {
      const res = await createVendor({
        ...data,
        company_id: activeCompany?.id,
      });

      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Registered vendor "${res.data.party_name || res.data.name}"`);
        setVendors((prev) =>
          [...prev, res.data].sort((a, b) =>
            (a.party_name || a.name || '').localeCompare(b.party_name || b.name || '')
          )
        );
        setIsAddModalOpen(false);
      }
    });
  }

  function onEditSubmit(data: LeanVendorInput) {
    if (!editingVendor) return;
    startTransition(async () => {
      const res = await updateVendor(editingVendor.id, data);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Updated vendor "${res.data.party_name || res.data.name}"`);
        setVendors((prev) =>
          prev.map((v) => (v.id === editingVendor.id ? res.data : v))
        );
        setEditingVendor(null);
      }
    });
  }

  function handleToggleActive(vendorId: string) {
    const prevVendors = vendors;
    setVendors((prev) =>
      prev.map((v) => (v.id === vendorId ? { ...v, is_active: !v.is_active } : v))
    );

    startTransition(async () => {
      const res = await toggleVendorActive(vendorId);
      if (!res.success) {
        setVendors(prevVendors);
        toast.error(res.error);
      } else {
        toast.info(
          `Vendor "${res.data.party_name || res.data.name}" is now ${res.data.is_active ? 'Active' : 'Inactive'}`
        );
        setVendors((prev) =>
          prev.map((v) => (v.id === vendorId ? res.data : v))
        );
      }
    });
  }

  async function handleExportExcel() {
    setIsExportingExcel(true);
    try {
      const res = await fetch('/api/vendors/export');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        toast.error(err.error || 'Failed to export vendors Excel.');
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
      const companyCode = (activeCompany?.code || 'INDFURN').toUpperCase();
      const todayStr = new Date().toISOString().split('T')[0];
      const filename = filenameMatch?.[1] || `${companyCode}_Vendors_${todayStr}.xlsx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${filename}`);
    } catch {
      toast.error('Network error while exporting vendor Excel.');
    } finally {
      setIsExportingExcel(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-5">
        <div className="hidden sm:block">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">Vendor Master</h1>
            {activeCompany && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                {activeCompany.name}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Beneficiary master for payment vouchers and bank bulk upload exports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportExcel}
            disabled={isExportingExcel}
            className="flex-1 sm:flex-initial min-h-[40px] px-3.5 rounded-lg border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
          >
            {isExportingExcel ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
            ) : (
              <Upload className="w-4 h-4 text-slate-500" />
            )}
            <span>Export Excel</span>
          </Button>

          {canManage && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsImportModalOpen(true)}
                className="flex-1 sm:flex-initial min-h-[40px] px-3.5 rounded-lg border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#7F1D1D]" />
                <span>Import Excel</span>
              </Button>

              <Button
                type="button"
                onClick={openCreateModal}
                className="w-full sm:w-auto min-h-[42px] sm:min-h-[40px] px-4 rounded-lg bg-[#7F1D1D] hover:bg-[#991B1B] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Vendor</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4 max-w-full sm:max-w-sm relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by trade name, beneficiary, or IFSC..."
          className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#7F1D1D]"
        />
      </div>

      {/* Desktop Table (md+) */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-3 pl-5 pr-3">Party Name (Trade Name)</th>
              <th className="py-3 px-3">Beneficiary Name (Bank A/C)</th>
              <th className="py-3 px-3">Account Number</th>
              <th className="py-3 px-3">IFSC Code</th>
              <th className="py-3 px-3">Status</th>
              {canManage && <th className="py-3 pl-3 pr-5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {filteredVendors.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="py-12 text-center text-xs text-slate-500">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                    <Building2 className="w-4 h-4" />
                  </div>
                  No vendors found for {activeCompany?.name || 'this workspace'}.
                </td>
              </tr>
            ) : (
              filteredVendors.map((v) => {
                const partyName = v.party_name || v.name;
                const benName = v.beneficiary_name || v.name;
                const accNo = v.account_number || v.bank_account_no;
                const bankChip = getBankChip(v.ifsc_code);

                return (
                  <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 pl-5 pr-3">
                      <div className="font-bold text-slate-900">{partyName}</div>
                      {v.remarks && (
                        <div className="text-xs text-slate-400 line-clamp-1">{v.remarks}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-xs font-semibold text-slate-700">
                      {benName}
                    </td>
                    <td className="py-3.5 px-3 text-xs text-slate-700 font-mono tabular-nums">
                      {accNo || '—'}
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-bold text-slate-800">
                          {v.ifsc_code || '—'}
                        </span>
                        {bankChip && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${bankChip.color}`}
                          >
                            {bankChip.label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${v.is_active ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${v.is_active ? 'bg-emerald-600' : 'bg-slate-300'
                            }`}
                        />
                        {v.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="py-3.5 pl-3 pr-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(v)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(v.id)}
                            disabled={isPending}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${v.is_active
                              ? 'border-slate-200 text-slate-600 hover:bg-slate-100'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              }`}
                          >
                            {v.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Vendor Cards (< md) */}
      <div className="md:hidden space-y-3">
        {filteredVendors.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
            No vendors registered in {activeCompany?.name || 'this workspace'}.
          </div>
        ) : (
          filteredVendors.map((v) => {
            const partyName = v.party_name || v.name;
            const benName = v.beneficiary_name || v.name;
            const accNo = v.account_number || v.bank_account_no;
            const bankChip = getBankChip(v.ifsc_code);

            return (
              <div
                key={v.id}
                className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 break-words">{partyName}</div>
                    <div className="text-xs text-slate-600 mt-0.5 break-words">
                      Beneficiary: <span className="font-semibold text-slate-800">{benName}</span>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-semibold shrink-0 ${v.is_active ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${v.is_active ? 'bg-emerald-600' : 'bg-slate-300'
                        }`}
                    />
                    {v.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="text-xs text-slate-600 font-mono break-all">
                  A/C: <span className="font-bold text-slate-800">{accNo || '—'}</span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="text-slate-500">IFSC:</span>
                  <span className="font-mono font-bold text-slate-800">{v.ifsc_code || '—'}</span>
                  {bankChip && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${bankChip.color}`}
                    >
                      {bankChip.label}
                    </span>
                  )}
                </div>

                {v.remarks && (
                  <div className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-md break-words">
                    {v.remarks}
                  </div>
                )}

                {canManage && (
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => openEditModal(v)}
                      className="min-h-[40px] px-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(v.id)}
                      disabled={isPending}
                      className={`min-h-[40px] px-3.5 rounded-lg border text-xs font-semibold cursor-pointer ${v.is_active
                        ? 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }`}
                    >
                      {v.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* DIALOG: ADD VENDOR */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Vendor</DialogTitle>
            <DialogDescription>
              Register supplier beneficiary details for {activeCompany?.name || 'the active workspace'}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="av-party" className="block text-xs font-semibold text-slate-700 mb-1">
                Party Name (Trade Name) <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="av-party"
                {...addForm.register('party_name')}
                placeholder="e.g. Naas Hardware"
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {addForm.formState.errors.party_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {addForm.formState.errors.party_name.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="av-ben" className="block text-xs font-semibold text-slate-700 mb-1">
                Beneficiary Name (Bank Account Holder) <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="av-ben"
                {...addForm.register('beneficiary_name')}
                placeholder="e.g. Manoj (Exact name on bank statement)"
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {addForm.formState.errors.beneficiary_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {addForm.formState.errors.beneficiary_name.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="av-acc" className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Number <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="av-acc"
                  type="text"
                  {...addForm.register('account_number')}
                  placeholder="e.g. 918020012345678"
                  disabled={isPending}
                  className="w-full min-h-[42px] font-mono tabular-nums"
                />
                {addForm.formState.errors.account_number && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {addForm.formState.errors.account_number.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="av-ifsc" className="block text-xs font-semibold text-slate-700 mb-1">
                  IFSC Code (11-chars) <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="av-ifsc"
                  type="text"
                  maxLength={11}
                  {...addForm.register('ifsc_code')}
                  onChange={(e) => addForm.setValue('ifsc_code', e.target.value.toUpperCase())}
                  placeholder="e.g. UTIB0001462"
                  disabled={isPending}
                  className="w-full min-h-[42px] uppercase font-mono font-bold"
                />
                {addForm.formState.errors.ifsc_code && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {addForm.formState.errors.ifsc_code.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="av-remarks" className="block text-xs font-semibold text-slate-700 mb-1">
                Remarks (Optional)
              </Label>
              <Textarea
                id="av-remarks"
                {...addForm.register('remarks')}
                rows={2}
                placeholder="Optional supplier notes"
                disabled={isPending}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isPending}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="min-h-[40px] bg-[#7F1D1D] hover:bg-[#991B1B] text-white cursor-pointer font-semibold"
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </span>
                ) : (
                  'Save Vendor'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: EDIT VENDOR */}
      <Dialog
        open={Boolean(editingVendor)}
        onOpenChange={(open) => {
          if (!open) setEditingVendor(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Vendor</DialogTitle>
            <DialogDescription>
              Update supplier trade name or banking beneficiary credentials.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="ev-party" className="block text-xs font-semibold text-slate-700 mb-1">
                Party Name (Trade Name) <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="ev-party"
                {...editForm.register('party_name')}
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {editForm.formState.errors.party_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {editForm.formState.errors.party_name.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="ev-ben" className="block text-xs font-semibold text-slate-700 mb-1">
                Beneficiary Name (Bank Account Holder) <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="ev-ben"
                {...editForm.register('beneficiary_name')}
                disabled={isPending}
                className="w-full min-h-[42px]"
              />
              {editForm.formState.errors.beneficiary_name && (
                <p className="text-[11px] text-rose-600 mt-1">
                  {editForm.formState.errors.beneficiary_name.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ev-acc" className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Number <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="ev-acc"
                  type="text"
                  {...editForm.register('account_number')}
                  disabled={isPending}
                  className="w-full min-h-[42px] font-mono tabular-nums"
                />
                {editForm.formState.errors.account_number && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {editForm.formState.errors.account_number.message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="ev-ifsc" className="block text-xs font-semibold text-slate-700 mb-1">
                  IFSC Code (11-chars) <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="ev-ifsc"
                  type="text"
                  maxLength={11}
                  {...editForm.register('ifsc_code')}
                  onChange={(e) => editForm.setValue('ifsc_code', e.target.value.toUpperCase())}
                  disabled={isPending}
                  className="w-full min-h-[42px] uppercase font-mono font-bold"
                />
                {editForm.formState.errors.ifsc_code && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {editForm.formState.errors.ifsc_code.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="ev-remarks" className="block text-xs font-semibold text-slate-700 mb-1">
                Remarks (Optional)
              </Label>
              <Textarea
                id="ev-remarks"
                {...editForm.register('remarks')}
                rows={2}
                disabled={isPending}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingVendor(null)}
                disabled={isPending}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="min-h-[40px] bg-[#7F1D1D] hover:bg-[#991B1B] text-white cursor-pointer font-semibold"
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </span>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: BULK IMPORT VENDORS */}
      {canManage && (
        <VendorImportModal
          open={isImportModalOpen}
          onOpenChange={setIsImportModalOpen}
          activeCompany={activeCompany}
        />
      )}
    </div>
  );
}
