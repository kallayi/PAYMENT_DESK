'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Landmark, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatINR } from '@/lib/format';
import type { CompanyBank } from '@/types/database';

interface OwnerBankSwitcherProps {
  banks: CompanyBank[];
  selectedBankId: string;
  fallbackBank?: CompanyBank | null;
  billNetPayable: number;
  partyName: string;
  disabled?: boolean;
  isSwitching?: boolean;
  onSelectBank: (newBankId: string) => void;
}

function getMaskedAccountLabel(bank: CompanyBank | null | undefined): string {
  if (!bank) return '';
  const raw = (bank.account_number_masked || bank.account_mask || bank.full_debit_account_number || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (digits.length >= 4) {
    return `•••• ${digits.slice(-4)}`;
  }
  return raw;
}

export function OwnerBankSwitcher({
  banks,
  selectedBankId,
  fallbackBank = null,
  billNetPayable,
  partyName,
  disabled = false,
  isSwitching = false,
  onSelectBank,
}: OwnerBankSwitcherProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isMobileSheet, setIsMobileSheet] = React.useState(false);
  const [openUpward, setOpenUpward] = React.useState(false);
  const [alignRight, setAlignRight] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const activeBank = React.useMemo(
    () => banks.find((b) => b.id === selectedBankId) || fallbackBank || null,
    [banks, selectedBankId, fallbackBank]
  );

  const activeShortCode = activeBank?.short_code || activeBank?.short_name || 'BANK';
  const activeMask = getMaskedAccountLabel(activeBank);
  const activeBalance = Number(activeBank?.available_balance ?? 0);
  const isCurrentSufficient = activeBalance >= billNetPayable;

  React.useEffect(() => {
    if (!isOpen || isMobileSheet) return;

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isMobileSheet]);

  function handleToggleOpen() {
    if (disabled || isSwitching) return;
    if (!isOpen && typeof window !== 'undefined') {
      const mobile = window.innerWidth < 640;
      setIsMobileSheet(mobile);
      if (!mobile && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setOpenUpward(rect.bottom + 320 > window.innerHeight && rect.top > 280);
        setAlignRight(rect.left + 360 > window.innerWidth - 16 && rect.right > 360);
      }
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }

  function handleChooseBank(bankId: string) {
    setIsOpen(false);
    if (bankId !== selectedBankId) {
      onSelectBank(bankId);
    }
  }

  function renderBankList() {
    return (
      <div className="space-y-2">
        {banks.map((bank) => {
          const isSelected = bank.id === selectedBankId;
          const shortCode = bank.short_code || bank.short_name || 'BANK';
          const bankTitle = bank.bank_name || bank.full_name || shortCode;
          const acMask = getMaskedAccountLabel(bank);
          const available = Number(bank.available_balance ?? 0);
          const remaining = available - billNetPayable;
          const isShortfall = remaining < 0;

          return (
            <button
              key={bank.id}
              type="button"
              onClick={() => handleChooseBank(bank.id)}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition-all cursor-pointer',
                isSelected
                  ? 'border-brand bg-brand-tint ring-1 ring-brand/25'
                  : 'border-slate-200 bg-[#FFFFFF] hover:border-slate-300 hover:bg-[#F8FAFC] dark:border-[#27272F] dark:bg-[#0E0E11] dark:hover:border-[#3A3A46] dark:hover:bg-[#17171E]'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
                      {bankTitle}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#1E1E26] text-slate-700 dark:text-[#D4D4D8] text-[10px] font-bold uppercase tracking-wide shrink-0">
                      {shortCode}
                    </span>
                  </div>
                  {acMask && (
                    <div className="text-[11px] font-mono text-slate-500 dark:text-[#8E8E98] mt-0.5">
                      {acMask}
                    </div>
                  )}
                </div>

                {isSelected && (
                  <span className="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </div>

              <div className="mt-2 pt-2 border-t border-slate-100 dark:border-[#202028] flex items-center justify-between gap-2 text-[11px] tabular-nums">
                <span className="text-slate-600 dark:text-[#9CA3AF]">
                  Bal:{' '}
                  <strong className="font-bold text-slate-900 dark:text-[#FAFAFA]">
                    {formatINR(available)}
                  </strong>
                </span>
                <span
                  className={cn(
                    'font-semibold shrink-0',
                    isShortfall
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  )}
                >
                  {isShortfall
                    ? `Short by ${formatINR(Math.abs(remaining))}`
                    : `Leaves ${formatINR(remaining)}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative min-w-0 max-w-full">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || isSwitching}
        onClick={handleToggleOpen}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Disbursement bank for ${partyName}: ${activeShortCode}`}
        className={cn(
          'group max-w-full min-h-[38px] px-2.5 py-1.5 rounded-xl border text-left transition-all inline-flex items-center gap-2 flex-wrap sm:flex-nowrap cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
          'border-slate-200 bg-[#F8FAFC] hover:border-slate-300 hover:bg-[#F1F5F9]',
          'dark:border-[#27272F] dark:bg-[#0A0A0D] dark:hover:border-[#3A3A46] dark:hover:bg-[#14141A]',
          isOpen && 'border-brand ring-2 ring-brand/15'
        )}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {isSwitching ? (
            <Loader2 className="w-3.5 h-3.5 text-brand animate-spin shrink-0" />
          ) : (
            <Landmark className="w-3.5 h-3.5 text-brand shrink-0" />
          )}
          <span className="text-xs font-bold text-slate-900 dark:text-[#FAFAFA] truncate">
            {activeShortCode}
          </span>
          {activeMask && (
            <span className="text-[11px] font-mono text-slate-500 dark:text-[#8E8E98] shrink-0">
              {activeMask}
            </span>
          )}
        </span>

        <span
          className={cn(
            'px-2 py-0.5 rounded-md border text-[11px] font-bold tabular-nums shrink-0',
            isCurrentSufficient
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          )}
        >
          Bal: {formatINR(activeBalance)}
        </span>

        {!disabled && (
          <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 dark:text-[#71717A] dark:group-hover:text-[#D4D4D8] shrink-0 transition-colors" />
        )}
      </button>

      {/* Desktop Popover Picker */}
      {isOpen && !isMobileSheet && (
        <div
          className={cn(
            'absolute z-50 w-[356px] max-w-[calc(100vw-2rem)] rounded-2xl border p-3 shadow-xl',
            'border-slate-200 bg-[#FFFFFF] dark:border-[#27272F] dark:bg-[#141418]',
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            alignRight ? 'right-0' : 'left-0'
          )}
        >
          <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100 dark:border-[#22222A]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#8E8E98]">
              Switch Source Bank
            </span>
            <span className="text-[11px] font-semibold text-slate-700 dark:text-[#D4D4D8] tabular-nums">
              Bill: {formatINR(billNetPayable)}
            </span>
          </div>
          <div className="max-h-72 overflow-y-auto pr-0.5">{renderBankList()}</div>
        </div>
      )}

      {/* Mobile Bottom Sheet / Modal Picker */}
      {isOpen && isMobileSheet && (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-2xl p-4 bg-[#FFFFFF] dark:bg-[#141418] border-slate-200 dark:border-[#27272F]">
            <DialogHeader className="text-left pb-1">
              <DialogTitle className="text-sm font-bold text-slate-900 dark:text-[#FAFAFA]">
                Switch Disbursement Bank
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-[#8E8E98] tabular-nums">
                {partyName} · Bill Net: {formatINR(billNetPayable)}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60dvh] overflow-y-auto pt-1">{renderBankList()}</div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
