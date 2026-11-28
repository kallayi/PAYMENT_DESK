'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Edit2,
  Landmark,
  Loader2,
  Plus,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  createCompanyBank,
  toggleCompanyBankActive,
  updateCompanyBank,
} from '@/actions/banks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IndianAmountInput } from '@/components/ui/indian-amount-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Company, CompanyBank } from '@/types/database';

interface ManageBanksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: CompanyBank[];
  activeCompany?: Company | null;
  onBanksChange: (updatedBanks: CompanyBank[]) => void;
}

type ModalMode = 'list' | 'add' | 'edit';

export function ManageBanksModal({
  open,
  onOpenChange,
  banks,
  activeCompany,
  onBanksChange,
}: ManageBanksModalProps) {
  const router = useRouter();

  const [mode, setMode] = React.useState<ModalMode>('list');
  const [editingBankId, setEditingBankId] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState<boolean>(false);
  const [togglingBankId, setTogglingBankId] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Add / Edit form fields
  const [bankName, setBankName] = React.useState<string>('');
  const [shortCode, setShortCode] = React.useState<string>('');
  const [ifscPrefix, setIfscPrefix] = React.useState<string>('');
  const [maskedAccount, setMaskedAccount] = React.useState<string>('');
  const [fullDebitAccount, setFullDebitAccount] = React.useState<string>('');
  const [openingBalance, setOpeningBalance] = React.useState<string>('0');
  const [isPrimary, setIsPrimary] = React.useState<boolean>(false);

  // Reset to list view whenever modal opens
  React.useEffect(() => {
    if (!open) return;
    setMode('list');
    setEditingBankId(null);
    setFormError(null);
    setIsSaving(false);
    setTogglingBankId(null);
  }, [open]);

  const sortedBanks = React.useMemo(() => {
    return [...banks].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      if (Boolean(a.is_primary) !== Boolean(b.is_primary)) {
        return a.is_primary ? -1 : 1;
      }
      const codeA = (a.short_code || a.short_name || '').toUpperCase();
      const codeB = (b.short_code || b.short_name || '').toUpperCase();
      return codeA.localeCompare(codeB);
    });
  }, [banks]);

  const companyCode = (activeCompany?.code || 'INDFURN').toUpperCase();
  const isVinmore = companyCode === 'VINMORE';

  const openAddForm = () => {
    setFormError(null);
    setEditingBankId(null);
    setBankName('');
    setShortCode('');
    setIfscPrefix('');
    setMaskedAccount('');
    setFullDebitAccount('');
    setOpeningBalance('0');
    setIsPrimary(banks.length === 0);
    setMode('add');
  };

  const openEditForm = (bank: CompanyBank) => {
    setFormError(null);
    setEditingBankId(bank.id);
    setBankName(bank.bank_name || bank.full_name || '');
    setShortCode((bank.short_code || bank.short_name || '').toUpperCase());
    setIfscPrefix((bank.ifsc_prefix || '').toUpperCase());
    setMaskedAccount(bank.account_number_masked || bank.account_mask || '');
    setFullDebitAccount(bank.full_debit_account_number || '');
    setOpeningBalance('0');
    setIsPrimary(Boolean(bank.is_primary));
    setMode('edit');
  };

  const returnToList = () => {
    if (isSaving) return;
    setFormError(null);
    setEditingBankId(null);
    setMode('list');
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = bankName.trim();
    const cleanShort = shortCode.trim().toUpperCase();
    const cleanPrefix = ifscPrefix.trim().toUpperCase();
    const cleanMasked = maskedAccount.trim();
    const cleanFullDebit = fullDebitAccount.replace(/\s+/g, '').trim().toUpperCase();

    if (!cleanName) {
      setFormError('Bank Name is required.');
      return;
    }
    if (!cleanShort) {
      setFormError('Short Code is required (e.g. AXIS).');
      return;
    }
    if (!/^[A-Z0-9]{4}$/.test(cleanPrefix)) {
      setFormError('IFSC Prefix must be exactly 4 uppercase characters (e.g. UTIB).');
      return;
    }
    if (cleanFullDebit && !/^[A-Z0-9]{6,34}$/.test(cleanFullDebit)) {
      setFormError(
        'Full Corporate Debit Account Number must be at least 6 alphanumeric characters.'
      );
      return;
    }

    setIsSaving(true);
    try {
      if (mode === 'add') {
        const numericBalance = Number.parseFloat(openingBalance || '0');
        const res = await createCompanyBank({
          bank_name: cleanName,
          short_code: cleanShort,
          ifsc_prefix: cleanPrefix,
          account_number_masked: cleanMasked || null,
          full_debit_account_number: cleanFullDebit || null,
          available_balance:
            Number.isFinite(numericBalance) && numericBalance >= 0
              ? numericBalance
              : 0,
          is_primary: isPrimary,
          is_active: true,
        });

        if (!res.success) {
          setFormError(res.error);
          toast.error(res.error);
          return;
        }

        const createdBank = res.data;
        const nextBanks = [
          ...(createdBank.is_primary
            ? banks.map((b) => ({ ...b, is_primary: false }))
            : banks),
          createdBank,
        ];
        onBanksChange(nextBanks);
        toast.success(`Added ${createdBank.bank_name || createdBank.short_code}`);
        router.refresh();
        setMode('list');
      } else if (mode === 'edit' && editingBankId) {
        const targetBank = banks.find((b) => b.id === editingBankId);
        const res = await updateCompanyBank(editingBankId, {
          bank_name: cleanName,
          short_code: cleanShort,
          ifsc_prefix: cleanPrefix,
          account_number_masked: cleanMasked || null,
          full_debit_account_number: cleanFullDebit || null,
          available_balance: 0,
          is_primary: isPrimary,
          is_active: Boolean(targetBank?.is_active ?? true),
        });

        if (!res.success) {
          setFormError(res.error);
          toast.error(res.error);
          return;
        }

        const updatedBank = res.data;
        const nextBanks = banks.map((b) => {
          if (b.id === updatedBank.id) return updatedBank;
          return updatedBank.is_primary ? { ...b, is_primary: false } : b;
        });
        onBanksChange(nextBanks);
        toast.success(`Updated ${updatedBank.bank_name || updatedBank.short_code}`);
        router.refresh();
        setEditingBankId(null);
        setMode('list');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save company bank.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleBank = async (bank: CompanyBank) => {
    if (togglingBankId || isSaving) return;
    setTogglingBankId(bank.id);
    try {
      const res = await toggleCompanyBankActive(bank.id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const updated = res.data;
      onBanksChange(banks.map((b) => (b.id === updated.id ? updated : b)));
      toast.success(
        `${updated.bank_name || updated.short_code} ${
          updated.is_active ? 'enabled' : 'disabled'
        }.`
      );
      router.refresh();
    } catch {
      toast.error('Failed to update bank status.');
    } finally {
      setTogglingBankId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSaving && !togglingBankId) {
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="max-w-2xl w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] p-0 overflow-hidden gap-0">
        {/* MODAL HEADER */}
        <DialogHeader className="px-5 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-7">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-base font-bold text-slate-900">
                  <Landmark className="w-4 h-4 text-brand shrink-0" />
                  <DialogTitle className="text-base font-bold text-slate-900">
                    Company Bank Accounts
                  </DialogTitle>
                </span>
                <span
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border',
                    isVinmore
                      ? 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/60'
                      : 'bg-rose-50 text-[#7F1D1D] border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60'
                  )}
                >
                  {activeCompany?.name || companyCode}
                </span>
              </div>
              <DialogDescription className="text-xs text-slate-500">
                {mode === 'list'
                  ? 'Configure disbursement banks, masked slip numbers, and Corporate Debit A/C numbers for Axis Excel.'
                  : mode === 'add'
                  ? 'Add a new disbursement bank account for this company.'
                  : 'Update bank details, masked slip number, or Corporate Debit A/C.'}
              </DialogDescription>
            </div>

            {mode === 'list' ? (
              <Button
                type="button"
                size="sm"
                onClick={openAddForm}
                className="min-h-[36px] px-3 bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 shadow-sm cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Bank</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={returnToList}
                disabled={isSaving}
                className="min-h-[36px] px-3 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to List</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* BODY */}
        {mode === 'list' ? (
          <div className="max-h-[70dvh] overflow-y-auto p-4 sm:p-5 space-y-3">
            {sortedBanks.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
                <Building2 className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-800">
                  No bank accounts configured
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Click &quot;Add Bank&quot; above to add the first disbursement bank for{' '}
                  {activeCompany?.name || companyCode}.
                </p>
              </div>
            ) : (
              sortedBanks.map((bank) => {
                const short = bank.short_code || bank.short_name || 'BANK';
                const fullName = bank.bank_name || bank.full_name || 'Bank';
                const masked = bank.account_number_masked || bank.account_mask;
                const cleanFullDebit = (bank.full_debit_account_number || '')
                  .replace(/\s+/g, '')
                  .trim();
                const isToggling = togglingBankId === bank.id;

                return (
                  <div
                    key={bank.id}
                    className={cn(
                      'rounded-xl border p-4 bg-white transition-colors shadow-xs space-y-3',
                      bank.is_active
                        ? 'border-slate-200'
                        : 'border-slate-200/70 bg-slate-50/70 opacity-80'
                    )}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-bold uppercase">
                            {short}
                          </span>
                          <span className="text-sm font-bold text-slate-900">
                            {fullName}
                          </span>
                          {bank.is_primary && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                              <span>Primary</span>
                            </span>
                          )}
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full text-[10px] font-bold border',
                              bank.is_active
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            )}
                          >
                            {bank.is_active ? 'Active' : 'Disabled'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                          <span>
                            IFSC Prefix:{' '}
                            <strong className="font-mono text-slate-900">
                              {bank.ifsc_prefix || '—'}
                            </strong>
                          </span>

                          <span>
                            Masked A/C:{' '}
                            {masked ? (
                              <strong className="font-mono text-slate-900 tabular-nums">
                                {masked}
                              </strong>
                            ) : (
                              <span className="font-semibold text-amber-700">
                                Not set
                              </span>
                            )}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap text-[11px]">
                          <span className="text-slate-500">
                            Corporate Debit A/C (Excel):
                          </span>
                          {cleanFullDebit ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold tabular-nums">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Configured (••••{cleanFullDebit.slice(-4)})</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                              Not set — click Edit to add
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditForm(bank)}
                          disabled={Boolean(togglingBankId)}
                          className="h-9 px-3 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleBank(bank)}
                          disabled={Boolean(togglingBankId)}
                          className={cn(
                            'h-9 px-3 text-xs font-semibold cursor-pointer',
                            bank.is_active
                              ? 'border-slate-200 text-slate-600 hover:bg-slate-100'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          )}
                        >
                          {isToggling ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : bank.is_active ? (
                            'Disable'
                          ) : (
                            'Enable'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* ADD / EDIT FORM VIEW */
          <form onSubmit={handleSaveBank} className="max-h-[75dvh] overflow-y-auto">
            <div className="p-4 sm:p-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-start gap-2 text-xs text-rose-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <Label
                  htmlFor="mb-name"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Bank Name <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="mb-name"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. Axis Bank Neo for Corporates"
                  disabled={isSaving}
                  required
                  className="w-full min-h-[42px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label
                    htmlFor="mb-short"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Short Code <span className="text-rose-600">*</span>
                  </Label>
                  <Input
                    id="mb-short"
                    value={shortCode}
                    onChange={(e) => setShortCode(e.target.value.toUpperCase())}
                    placeholder="e.g. AXIS, SIB, HDFC, KOTAK"
                    disabled={isSaving}
                    required
                    className="w-full min-h-[42px] uppercase font-bold"
                  />
                </div>

                <div>
                  <Label
                    htmlFor="mb-prefix"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    IFSC Prefix <span className="text-rose-600">*</span>
                  </Label>
                  <Input
                    id="mb-prefix"
                    value={ifscPrefix}
                    onChange={(e) =>
                      setIfscPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    maxLength={4}
                    placeholder="e.g. UTIB, SIBL, HDFC, KKBK"
                    disabled={isSaving}
                    required
                    className="w-full min-h-[42px] uppercase font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <Label
                  htmlFor="mb-masked"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Masked Account Number (for Slips &amp; UI)
                </Label>
                <Input
                  id="mb-masked"
                  value={maskedAccount}
                  onChange={(e) => setMaskedAccount(e.target.value)}
                  placeholder="e.g. XXXX XXXX XXX 5074"
                  disabled={isSaving}
                  className="w-full min-h-[42px] tabular-nums"
                />
              </div>

              <div>
                <Label
                  htmlFor="mb-full-debit"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Full Corporate Debit Account Number (for Axis Bulk Excel)
                </Label>
                <Input
                  id="mb-full-debit"
                  value={fullDebitAccount}
                  onChange={(e) =>
                    setFullDebitAccount(e.target.value.replace(/\s+/g, '').toUpperCase())
                  }
                  placeholder="e.g. 921020012345074 (optional for non-Axis banks)"
                  disabled={isSaving}
                  className="w-full min-h-[42px] font-mono tabular-nums"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Used in Column 1 of Axis Neo Bulk Upload Excel
                </p>
              </div>

              {mode === 'add' && (
                <div>
                  <Label
                    htmlFor="mb-balance"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Opening Available Balance (₹)
                  </Label>
                  <IndianAmountInput
                    id="mb-balance"
                    value={openingBalance}
                    onValueChange={setOpeningBalance}
                    disabled={isSaving}
                    className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:border-brand disabled:opacity-50 font-semibold tabular-nums"
                  />
                </div>
              )}

              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                <input
                  id="mb-primary"
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  disabled={isSaving}
                  className="w-4 h-4 text-brand rounded border-slate-300 focus:ring-brand cursor-pointer"
                />
                <Label
                  htmlFor="mb-primary"
                  className="text-xs font-medium text-slate-800 cursor-pointer"
                >
                  Set as default disbursement bank for this company
                </Label>
              </div>
            </div>

            <DialogFooter className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={returnToList}
                disabled={isSaving}
                className="min-h-[40px] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="min-h-[40px] px-5 bg-brand hover:bg-brand-hover text-white font-semibold cursor-pointer"
              >
                {isSaving ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </span>
                ) : mode === 'add' ? (
                  'Add Bank'
                ) : (
                  'Save Bank Changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {mode === 'list' && (
          <DialogFooter className="px-5 py-3 border-t border-slate-200 bg-slate-50">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="min-h-[38px] cursor-pointer"
            >
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
