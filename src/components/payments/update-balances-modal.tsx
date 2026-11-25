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
import { Button } from '@/components/ui/button';
import { Loader2, Landmark, Clock, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { updateBankBalances } from '@/actions/banks';
import { formatINR, formatHumanDate } from '@/lib/format';
import type { CompanyBank } from '@/types/database';

interface UpdateBalancesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: CompanyBank[];
  onSuccess: (updatedBanks: CompanyBank[]) => void;
}

export function UpdateBalancesModal({
  open,
  onOpenChange,
  banks,
  onSuccess,
}: UpdateBalancesModalProps) {
  // Store form state: mapping bankId -> string balance
  const [balanceInputs, setBalanceInputs] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);

  // Initialize inputs from active banks whenever modal opens or banks change
  React.useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      banks.forEach((b) => {
        initial[b.id] = (b.available_balance ?? 0).toString();
      });
      setBalanceInputs(initial);
    }
  }, [open, banks]);

  const activeBanks = banks.filter((b) => b.is_active);

  const handleInputChange = (bankId: string, value: string) => {
    setBalanceInputs((prev) => ({
      ...prev,
      [bankId]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const updates = activeBanks.map((b) => ({
        bank_id: b.id,
        available_balance: parseFloat(balanceInputs[b.id] || '0') || 0,
      }));

      const res = await updateBankBalances(updates);

      if (!res.success) {
        toast.error(res.error || 'Failed to update bank balances.');
        return;
      }

      toast.success('Live bank balances updated successfully.');
      onSuccess(res.data);
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalCalculated = activeBanks.reduce((sum, b) => {
    const val = parseFloat(balanceInputs[b.id] || '0') || 0;
    return sum + val;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand/10 text-brand rounded-lg">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">
                Update Live Available Balances
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Enter current portal balances for today’s disbursement planning.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {activeBanks.map((b) => {
              const currentInputVal = parseFloat(balanceInputs[b.id] || '0') || 0;
              const shortCode = b.short_code || b.short_name || 'BANK';
              const bankName = b.bank_name || b.full_name || '';
              const accountMask = b.account_number_masked || b.account_mask || '';
              const updaterName = b.balance_updater?.full_name;

              return (
                <div
                  key={b.id}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold tracking-wide bg-slate-200 text-slate-800">
                        {shortCode}
                      </span>
                      <span className="text-xs font-semibold text-slate-800 truncate max-w-[180px]">
                        {bankName}
                      </span>
                      {accountMask && (
                        <span className="text-[11px] text-slate-400 font-mono">
                          ({accountMask})
                        </span>
                      )}
                    </div>
                    {b.is_primary && (
                      <span className="text-[10px] font-semibold text-brand bg-brand/10 px-1.5 py-0.5 rounded">
                        Primary
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                        ₹
                      </span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={balanceInputs[b.id] ?? ''}
                        onChange={(e) => handleInputChange(b.id, e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-1.5 text-sm font-semibold tabular-nums text-slate-900 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
                        required
                      />
                    </div>
                    <div className="text-right min-w-[100px]">
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        {formatINR(currentInputVal)}
                      </span>
                    </div>
                  </div>

                  {b.balance_updated_at && (
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 pt-0.5">
                      <Clock className="w-3 h-3" />
                      <span>Updated {formatHumanDate(b.balance_updated_at)}</span>
                      {updaterName && (
                        <>
                          <span>•</span>
                          <UserCheck className="w-3 h-3" />
                          <span>by {updaterName}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-lg bg-brand/5 border border-brand/15 flex items-center justify-between">
            <span className="text-xs font-semibold text-brand">Total Available Cash</span>
            <span className="text-sm font-bold text-brand tabular-nums">
              {formatINR(totalCalculated)}
            </span>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="bg-brand hover:bg-brand-hover text-white font-medium"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Live Balances'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
