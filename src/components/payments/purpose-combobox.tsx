'use client';

import * as React from 'react';
import { Check, ChevronDown, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { addPaymentPurpose, deletePaymentPurpose } from '@/actions/purposes';
import type { PaymentPurpose } from '@/types/database';

const BUILTIN_DEFAULT_PURPOSES = [
  'Own Account',
  'Against Bill',
  'On Account',
  'Advance',
  'Electricity Charge',
  'Rent',
  'Staff Salary',
  'Freight / Transport',
] as const;

type SelectablePurposeItem = PaymentPurpose & { isBuiltIn?: boolean };

interface PurposeComboboxProps {
  id?: string;
  value: string;
  onChange: (nextVal: string) => void;
  purposes: PaymentPurpose[];
  onPurposesChange?: (nextPurposes: PaymentPurpose[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function PurposeCombobox({
  id = 'payment-purpose',
  value,
  onChange,
  purposes,
  onPurposesChange,
  placeholder = 'Select or type a purpose (e.g., Against Bill, Advance, Freight)',
  disabled = false,
}: PurposeComboboxProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const [isAdding, setIsAdding] = React.useState<boolean>(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);

  const cleanTyped = value.trim();
  const normalizedTyped = cleanTyped.toLowerCase();

  const sortedPurposes = React.useMemo<SelectablePurposeItem[]>(() => {
    const merged: SelectablePurposeItem[] = [...purposes];
    const seen = new Set(
      purposes.map((p) => p.label.trim().toLowerCase())
    );

    const fallbacksToEnsure =
      purposes.length === 0 ? BUILTIN_DEFAULT_PURPOSES : (['Own Account'] as const);

    for (const label of fallbacksToEnsure) {
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({
          id: `builtin-${key.replace(/[^a-z0-9]+/g, '-')}`,
          company_id: '',
          label,
          created_by: null,
          created_at: '',
          isBuiltIn: true,
        });
      }
    }

    return merged.sort((a, b) => a.label.localeCompare(b.label));
  }, [purposes]);

  const filteredPurposes = React.useMemo(() => {
    if (!normalizedTyped) return sortedPurposes;
    return sortedPurposes.filter((p) =>
      p.label.toLowerCase().includes(normalizedTyped)
    );
  }, [sortedPurposes, normalizedTyped]);

  const exactMatchExists = React.useMemo(() => {
    if (!normalizedTyped) return true;
    return sortedPurposes.some(
      (p) => p.label.trim().toLowerCase() === normalizedTyped
    );
  }, [sortedPurposes, normalizedTyped]);

  const handleSelectOption = (label: string) => {
    onChange(label);
    setIsOpen(false);
  };

  const handleAddNew = async () => {
    if (!cleanTyped || isAdding) return;
    setIsAdding(true);
    try {
      const res = await addPaymentPurpose(cleanTyped);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const saved = res.data;
      if (onPurposesChange) {
        const existsInList = purposes.some(
          (p) =>
            p.id === saved.id ||
            p.label.trim().toLowerCase() === saved.label.trim().toLowerCase()
        );
        if (!existsInList) {
          onPurposesChange([...purposes, saved]);
        }
      }
      onChange(saved.label);
      setIsOpen(false);
      toast.success(`Saved "${saved.label}" for quick selection.`);
    } catch {
      toast.error('Failed to save purpose.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteOption = async (
    e: React.MouseEvent,
    purposeItem: PaymentPurpose
  ) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(purposeItem.id);
    try {
      const res = await deletePaymentPurpose(purposeItem.id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      if (onPurposesChange) {
        onPurposesChange(purposes.filter((p) => p.id !== purposeItem.id));
      }
      toast.success(`Removed "${purposeItem.label}" from saved list.`);
    } catch {
      toast.error('Could not remove saved purpose.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          required
          disabled={disabled}
          autoComplete="off"
          value={value}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsOpen(false);
            }
          }}
          placeholder={placeholder}
          className="w-full min-h-[44px] sm:min-h-[40px] pl-3 pr-10 rounded-lg border border-slate-300 bg-white text-sm text-slate-950 font-medium shadow-sm placeholder:text-slate-500 hover:border-slate-400 focus:outline-none focus:border-[#7F1D1D] focus:ring-2 focus:ring-[#7F1D1D]/15 disabled:opacity-50 transition-colors"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            setIsOpen((prev) => !prev);
            if (!isOpen) inputRef.current?.focus();
          }}
          aria-label="Toggle saved purposes"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-150 ${isOpen ? 'rotate-180 text-[#7F1D1D]' : ''
              }`}
          />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-300 shadow-lg rounded-lg max-h-56 overflow-y-auto z-50 divide-y divide-slate-100">
          {filteredPurposes.length === 0 && !cleanTyped ? (
            <div className="px-3 py-3 text-xs text-slate-500 text-center">
              No saved purposes yet — type any purpose to save it automatically.
            </div>
          ) : (
            filteredPurposes.map((item) => {
              const isSelected =
                item.label.trim().toLowerCase() === normalizedTyped;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectOption(item.label)}
                  className={`px-3 py-2.5 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${isSelected
                      ? 'bg-rose-50/70 text-[#7F1D1D] font-semibold'
                      : 'text-slate-900 font-medium hover:bg-slate-50'
                    }`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    <Check
                      className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-[#7F1D1D] opacity-100' : 'opacity-0'
                        }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {!item.isBuiltIn && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteOption(e, item)}
                      disabled={deletingId === item.id}
                      title={`Remove "${item.label}" from saved list`}
                      aria-label={`Remove ${item.label}`}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 disabled:opacity-50"
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}

          {cleanTyped.length > 0 && !exactMatchExists && (
            <button
              type="button"
              onClick={handleAddNew}
              disabled={isAdding}
              className="w-full px-3 py-2.5 text-left text-xs font-semibold text-[#7F1D1D] bg-rose-50/50 hover:bg-rose-50 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isAdding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Plus className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="truncate">
                Add &ldquo;{cleanTyped}&rdquo; to saved list
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
