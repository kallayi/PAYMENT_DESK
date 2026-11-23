'use client';

import * as React from 'react';
import { Plus, Search, Edit2, Loader2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { createVendor, updateVendor } from '@/actions/vendors';
import type { Vendor } from '@/types/database';
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
}

export function VendorManagement({ initialVendors }: VendorManagementProps) {
  const [vendors, setVendors] = React.useState<Vendor[]>(initialVendors);
  const [search, setSearch] = React.useState('');
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingVendor, setEditingVendor] = React.useState<Vendor | null>(null);

  // Form states
  const [name, setName] = React.useState('');
  const [gstin, setGstin] = React.useState('');
  const [bankAccountNo, setBankAccountNo] = React.useState('');
  const [ifscCode, setIfscCode] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  // Keep state synced when initialVendors changes
  React.useEffect(() => {
    setVendors(initialVendors);
  }, [initialVendors]);

  const filteredVendors = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.gstin && v.gstin.toLowerCase().includes(q)) ||
        (v.bank_account_no && v.bank_account_no.toLowerCase().includes(q)) ||
        (v.ifsc_code && v.ifsc_code.toLowerCase().includes(q))
    );
  }, [vendors, search]);

  function openCreateModal() {
    setEditingVendor(null);
    setName('');
    setGstin('');
    setBankAccountNo('');
    setIfscCode('');
    setNotes('');
    setFormError(null);
    setIsModalOpen(true);
  }

  function openEditModal(vendor: Vendor) {
    setEditingVendor(vendor);
    setName(vendor.name);
    setGstin(vendor.gstin || '');
    setBankAccountNo(vendor.bank_account_no || '');
    setIfscCode(vendor.ifsc_code || '');
    setNotes(vendor.notes || '');
    setFormError(null);
    setIsModalOpen(true);
  }

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const payload = {
      name: name.trim(),
      gstin: gstin.trim().toUpperCase() || undefined,
      bank_account_no: bankAccountNo.trim() || undefined,
      ifsc_code: ifscCode.trim().toUpperCase() || undefined,
      notes: notes.trim() || undefined,
    };

    startTransition(async () => {
      if (editingVendor) {
        const res = await updateVendor(editingVendor.id, payload);
        if (!res.success) {
          setFormError(res.error);
          toast.error(res.error);
        } else {
          toast.success(`Updated vendor "${res.data.name}"`);
          setVendors((prev) =>
            prev.map((v) => (v.id === editingVendor.id ? res.data : v))
          );
          setIsModalOpen(false);
        }
      } else {
        const res = await createVendor(payload);
        if (!res.success) {
          setFormError(res.error);
          toast.error(res.error);
        } else {
          toast.success(`Added vendor "${res.data.name}"`);
          setVendors((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
          setIsModalOpen(false);
        }
      }
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Vendors</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Supplier directory and beneficiary bank details.
          </p>
        </div>
        <Button
          type="button"
          onClick={openCreateModal}
          className="min-h-[44px] sm:min-h-[38px] px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add Vendor</span>
        </Button>
      </div>

      {/* Search Input */}
      <div className="mb-4 max-w-sm relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vendor name or GSTIN..."
          className="w-full min-h-[44px] sm:min-h-[38px] pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-500"
        />
      </div>

      {/* Desktop Vendors Table (md+) */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-3 pl-5 pr-3">Vendor Name</th>
              <th className="py-3 px-3">GSTIN</th>
              <th className="py-3 px-3">Bank Account No</th>
              <th className="py-3 px-3">IFSC Code</th>
              <th className="py-3 pl-3 pr-5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {filteredVendors.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-xs text-slate-500">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                    <Building2 className="w-4 h-4" />
                  </div>
                  No vendors found.
                </td>
              </tr>
            ) : (
              filteredVendors.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 pl-5 pr-3 font-medium text-slate-900">{v.name}</td>
                  <td className="py-3.5 px-3 text-xs text-slate-600 tabular-nums">
                    {v.gstin || '—'}
                  </td>
                  <td className="py-3.5 px-3 text-xs text-slate-600 tabular-nums">
                    {v.bank_account_no || '—'}
                  </td>
                  <td className="py-3.5 px-3 text-xs text-slate-600 tabular-nums font-mono">
                    {v.ifsc_code || '—'}
                  </td>
                  <td className="py-3.5 pl-3 pr-5 text-right">
                    <button
                      type="button"
                      onClick={() => openEditModal(v)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900 text-xs font-medium inline-flex items-center gap-1 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Vendors Cards (< md) */}
      <div className="md:hidden space-y-3">
        {filteredVendors.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
            No vendors found.
          </div>
        ) : (
          filteredVendors.map((v) => (
            <div
              key={v.id}
              className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">{v.name}</div>
                <button
                  type="button"
                  onClick={() => openEditModal(v)}
                  className="min-h-[36px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-medium inline-flex items-center gap-1 shrink-0"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              </div>
              <div className="text-xs text-slate-500 tabular-nums">
                GSTIN: <span className="text-slate-700 font-medium">{v.gstin || '—'}</span>
              </div>
              <div className="text-xs text-slate-500 tabular-nums">
                A/C: <span className="text-slate-700 font-medium">{v.bank_account_no || '—'}</span> · IFSC:{' '}
                <span className="text-slate-700 font-medium">{v.ifsc_code || '—'}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Vendor Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVendor ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
            <DialogDescription>
              {editingVendor
                ? 'Update supplier information and bank transfer details.'
                : 'Register a new supplier for payment authorization.'}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {formError}
            </div>
          )}

          <form id="vendor-form" onSubmit={handleFormSubmit} className="space-y-3.5">
            <div>
              <Label htmlFor="v-name" className="block text-xs font-medium text-slate-700 mb-1">
                Vendor Name <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="v-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Malabar Timber Depot"
                disabled={isPending}
                className="w-full min-h-[44px]"
              />
            </div>

            <div>
              <Label htmlFor="v-gstin" className="block text-xs font-medium text-slate-700 mb-1">
                GSTIN
              </Label>
              <Input
                id="v-gstin"
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="32XXXXX0000X1Z5"
                disabled={isPending}
                className="w-full min-h-[44px] uppercase tabular-nums"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="v-acc" className="block text-xs font-medium text-slate-700 mb-1">
                  Bank Account No
                </Label>
                <Input
                  id="v-acc"
                  type="text"
                  value={bankAccountNo}
                  onChange={(e) => setBankAccountNo(e.target.value)}
                  placeholder="Account number"
                  disabled={isPending}
                  className="w-full min-h-[44px] tabular-nums"
                />
              </div>
              <div>
                <Label htmlFor="v-ifsc" className="block text-xs font-medium text-slate-700 mb-1">
                  IFSC Code
                </Label>
                <Input
                  id="v-ifsc"
                  type="text"
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                  placeholder="UTIB0001462"
                  disabled={isPending}
                  className="w-full min-h-[44px] uppercase tabular-nums"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="v-notes" className="block text-xs font-medium text-slate-700 mb-1">
                Notes
              </Label>
              <Textarea
                id="v-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional supplier notes"
                disabled={isPending}
              />
            </div>
          </form>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
              disabled={isPending}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="vendor-form"
              disabled={isPending}
              className="min-h-[44px] bg-slate-900 hover:bg-slate-800 text-white"
            >
              {isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </span>
              ) : editingVendor ? (
                'Save Changes'
              ) : (
                'Save Vendor'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
