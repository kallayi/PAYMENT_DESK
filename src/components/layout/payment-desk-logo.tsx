import * as React from 'react';

interface PaymentDeskLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  showSubtitle?: boolean;
}

export function PaymentDeskLogo({
  className = '',
  size = 'md',
  showWordmark = true,
  showSubtitle = false,
}: PaymentDeskLogoProps) {
  const frameStyles = {
    sm: 'w-8 h-8 rounded-lg p-1 bg-zinc-100 dark:bg-zinc-800/80 ring-1 ring-black/10 dark:ring-white/15',
    md: 'w-9 h-9 rounded-lg p-1 bg-zinc-100 dark:bg-zinc-800/80 ring-1 ring-black/10 dark:ring-white/15',
    lg: 'w-14 h-14 rounded-2xl p-2 bg-[#F4F4F6] dark:bg-zinc-800/80 ring-1 ring-black/10 dark:ring-white/15 shadow-md',
  };

  const titleSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* Tightly Cropped Transparent Payment Desk Folder Mark */}
      <div
        className={`${frameStyles[size]} shrink-0 select-none flex items-center justify-center`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/app-logo-mark.png"
          alt="Payment Desk"
          className="w-full h-full object-contain"
        />
      </div>

      {/* Neutral Standalone Wordmark */}
      {showWordmark && (
        <div className="flex flex-col leading-tight select-none">
          <span className={`${titleSizes[size]} font-bold tracking-tight text-slate-900`}>
            Payment Desk
          </span>
          {showSubtitle && (
            <span className="text-[10px] text-slate-500 font-medium">Internal Workflow</span>
          )}
        </div>
      )}
    </div>
  );
}
