import * as React from 'react';

interface PaymentDeskLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
}

export function PaymentDeskLogo({
  className = '',
  size = 'md',
  showWordmark = true,
}: PaymentDeskLogoProps) {
  const iconSizes = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
  };

  const titleSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* Standalone Maroon Emblem */}
      <div
        className={`${iconSizes[size]} rounded-lg bg-[#7F1D1D] text-white flex items-center justify-center font-bold tracking-tight shadow-sm shrink-0 select-none`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-4/5 h-4/5 stroke-current"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Desk / Ledger Geometric Monogram */}
          <rect x="3" y="4" width="18" height="15" rx="2" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <path d="M7 15h3" />
          <path d="M14 15h3" />
          <path d="M7 7h.01" />
          <path d="M10 7h.01" />
        </svg>
      </div>

      {/* Neutral Standalone Wordmark */}
      {showWordmark && (
        <div className="flex flex-col leading-tight select-none">
          <span className={`${titleSizes[size]} font-bold tracking-tight text-slate-900`}>
            Payment Desk
          </span>
          <span className="text-[10px] text-slate-500 font-medium">Internal Workflow</span>
        </div>
      )}
    </div>
  );
}
