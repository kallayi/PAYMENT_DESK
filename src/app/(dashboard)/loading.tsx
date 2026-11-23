import * as React from 'react';

export default function DashboardLoading() {
  return (
    <div className="w-full space-y-4 animate-pulse">
      {/* Top Header / Filter skeleton strip */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-5 w-40 bg-slate-200 rounded" />
            <div className="h-3 w-64 bg-slate-100 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 bg-slate-200 rounded-lg" />
            <div className="h-9 w-28 bg-slate-200 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Tab bar skeleton */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <div className="h-8 w-24 bg-slate-200 rounded-lg" />
        <div className="h-8 w-24 bg-slate-100 rounded-lg" />
        <div className="h-8 w-24 bg-slate-100 rounded-lg" />
      </div>

      {/* Card rows skeleton */}
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-slate-200 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-4 w-32 bg-slate-200 rounded" />
                <div className="h-5 w-16 bg-slate-100 rounded-full" />
              </div>
              <div className="h-5 w-24 bg-slate-200 rounded" />
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="h-3.5 w-48 bg-slate-100 rounded" />
              <div className="h-7 w-20 bg-slate-100 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
