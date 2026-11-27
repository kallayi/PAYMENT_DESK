'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { switchActiveCompany } from '@/actions/company';
import type { Company } from '@/types/database';
import { toast } from 'sonner';

interface CompanySwitcherProps {
  allowedCompanies: Company[];
  activeCompany: Company | null;
  compact?: boolean;
}

function CompanyMiniLogo({ companyCode }: { companyCode?: string | null }) {
  const isVinmore = (companyCode || '').toUpperCase() === 'VINMORE';
  return (
    <span
      style={{ backgroundColor: isVinmore ? '#0F766E' : '#7F1D1D' }}
      className="w-6 h-6 rounded-md p-1 flex items-center justify-center shrink-0 shadow-xs"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={isVinmore ? '/brand-vinmore-icon.png' : '/brand-indfurn-icon.png'}
        alt={isVinmore ? 'VINMORE' : 'INDFURN'}
        className="w-full h-full object-contain"
      />
    </span>
  );
}

export function CompanySwitcher({
  allowedCompanies,
  activeCompany,
  compact = false,
}: CompanySwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const hasMultipleCompanies = allowedCompanies.length > 1;

  function handleSwitch(companyCode: string) {
    if (!activeCompany || activeCompany.code === companyCode) {
      setIsOpen(false);
      return;
    }

    setIsOpen(false);
    startTransition(async () => {
      const res = await switchActiveCompany(companyCode);
      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Switched workspace to ${res.data.name}`);
        router.refresh();
      }
    });
  }

  // Single-company user: Locked subtle read-only badge
  if (!hasMultipleCompanies) {
    const singleCompany = activeCompany || allowedCompanies[0];
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-slate-800 border border-slate-200/80 font-bold text-xs select-none ${compact ? 'text-[11px] px-1.5 py-0.5' : ''
          }`}
        title={`Assigned company: ${singleCompany?.name || 'INDFURN'}`}
      >
        <CompanyMiniLogo companyCode={singleCompany?.code} />
        <span>{singleCompany?.code || 'INDFURN'}</span>
      </div>
    );
  }

  // Multi-company user: Crisp interactive dropdown
  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isPending}
        className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 font-bold text-xs shadow-sm transition-colors cursor-pointer disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand/25 ${compact ? 'text-[11px] px-1.5 py-0.5' : 'min-h-[38px]'
          }`}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {isPending ? (
          <Loader2 className="w-3.5 h-3.5 text-brand animate-spin shrink-0" />
        ) : (
          <CompanyMiniLogo companyCode={activeCompany?.code} />
        )}
        <span className="truncate max-w-[92px] sm:max-w-none">
          {activeCompany?.code || 'Select Company'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-52 max-w-[calc(100vw-1.5rem)] rounded-lg bg-white border border-slate-200 shadow-lg py-1 z-50 text-xs animate-in fade-in-0 zoom-in-95">
          <div className="px-3 py-1.5 text-[10px] uppercase font-semibold text-slate-400 tracking-wider border-b border-slate-100">
            Switch Workspace
          </div>
          {allowedCompanies.map((company) => {
            const isSelected = activeCompany?.id === company.id || activeCompany?.code === company.code;
            return (
              <button
                key={company.id}
                type="button"
                onClick={() => handleSwitch(company.code)}
                className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 font-medium transition-colors cursor-pointer ${isSelected
                  ? 'bg-brand-tint text-brand font-bold'
                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CompanyMiniLogo companyCode={company.code} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs truncate">{company.name}</span>
                    <span className="text-[10px] text-slate-400 font-normal truncate">
                      {company.code === 'INDFURN' ? 'Axis, SIB, HDFC, Kotak' : 'Axis, HDFC, Kotak'}
                    </span>
                  </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-brand shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
