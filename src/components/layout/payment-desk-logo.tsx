import * as React from 'react';

interface PaymentDeskLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  showSubtitle?: boolean;
  companyCode?: string | null;
}

export function PaymentDeskLogo({
  className = '',
  size = 'md',
  showWordmark = true,
  showSubtitle = false,
  companyCode,
}: PaymentDeskLogoProps) {
  const isVinmore = (companyCode || '').trim().toUpperCase() === 'VINMORE';
  const logoSrc = isVinmore
    ? '/app-logo-mark-vinmore.png'
    : '/app-logo-mark.png?v=3';

  const frameStyles = {
    sm: 'w-8 h-8',
    md: 'w-9 h-9',
    lg: 'w-14 h-14',
  };

  const titleSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* Self-Contained Payment Desk Squircle Mark (Maroon for INDFURN/Default, Teal for VINMORE) */}
      <div
        className={`${frameStyles[size]} shrink-0 select-none flex items-center justify-center`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          alt="Payment Desk"
          className="w-full h-full object-contain drop-shadow-sm"
        />
      </div>

      {/* Neutral Standalone Wordmark */}
      {showWordmark && (
        <div className="flex flex-col leading-tight select-none">
          <span
            className={`${titleSizes[size]} font-bold tracking-tight text-slate-900 dark:text-zinc-100`}
          >
            Payment Desk
          </span>
          {showSubtitle && (
            <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-medium">
              Internal Workflow
            </span>
          )}
        </div>
      )}
    </div>
  );
}
