'use client';

import * as React from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const MONTH_NAMES_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [yStr, mStr, dStr] = iso.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  if (isNaN(year) || isNaN(month) || isNaN(day) || month < 0 || month > 11 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTodayISTParts(): { year: number; month: number; day: number; iso: string } {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  const d = new Date(istMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  return { year, month, day, iso: toIsoDate(year, month, day) };
}

function addDaysToIso(baseIso: string, deltaDays: number): string {
  const parsed = parseIsoDate(baseIso);
  if (!parsed) return baseIso;
  const d = new Date(Date.UTC(parsed.year, parsed.month, parsed.day + deltaDays));
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatDisplayDate(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  return `${String(parsed.day).padStart(2, '0')} ${MONTH_NAMES_SHORT[parsed.month]} ${parsed.year}`;
}

interface CalendarCell {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
}

function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const firstDayOfWeek = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: CalendarCell[] = [];

  // Leading days from previous month
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const prevDate = new Date(Date.UTC(year, month - 1, day));
    cells.push({
      iso: toIsoDate(prevDate.getUTCFullYear(), prevDate.getUTCMonth(), prevDate.getUTCDate()),
      day,
      inCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      iso: toIsoDate(year, month, d),
      day: d,
      inCurrentMonth: true,
    });
  }

  // Trailing days to complete 6 rows (42 cells) for consistent calendar height
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nextDate = new Date(Date.UTC(year, month + 1, d));
    cells.push({
      iso: toIsoDate(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate()),
      day: d,
      inCurrentMonth: false,
    });
  }

  return cells;
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Select due date',
  disabled = false,
  required = false,
  allowClear,
  title,
  size = 'md',
  className,
}: DatePickerProps) {
  const todayInfo = React.useMemo(() => getTodayISTParts(), []);
  const parsedSelected = React.useMemo(() => parseIsoDate(value), [value]);

  const [isOpen, setIsOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState<number>(
    parsedSelected?.year ?? todayInfo.year
  );
  const [viewMonth, setViewMonth] = React.useState<number>(
    parsedSelected?.month ?? todayInfo.month
  );
  const [openUpward, setOpenUpward] = React.useState(false);
  const [alignRight, setAlignRight] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  const canClear = allowClear ?? !required;

  React.useEffect(() => {
    if (parsedSelected) {
      setViewYear(parsedSelected.year);
      setViewMonth(parsedSelected.month);
    }
  }, [parsedSelected]);

  React.useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  function toggleOpen() {
    if (disabled) return;
    if (!isOpen) {
      if (parsedSelected) {
        setViewYear(parsedSelected.year);
        setViewMonth(parsedSelected.month);
      } else {
        setViewYear(todayInfo.year);
        setViewMonth(todayInfo.month);
      }

      if (triggerRef.current && typeof window !== 'undefined') {
        const rect = triggerRef.current.getBoundingClientRect();
        const shouldOpenUp = rect.bottom + 345 > window.innerHeight && rect.top > 300;
        const shouldAlignRight = rect.left + 304 > window.innerWidth - 12 && rect.right > 304;
        setOpenUpward(shouldOpenUp);
        setAlignRight(shouldAlignRight);
      }
      setIsOpen(true);
      requestAnimationFrame(() => {
        popoverRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    } else {
      setIsOpen(false);
    }
  }

  function handlePrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function handleNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function handleSelectIso(iso: string) {
    onChange(iso);
    setIsOpen(false);
  }

  const cells = React.useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const yearOptions = React.useMemo(() => {
    const base = Math.min(todayInfo.year, viewYear);
    const max = Math.max(todayInfo.year + 6, viewYear + 2);
    const list: number[] = [];
    for (let y = base - 4; y <= max; y++) {
      list.push(y);
    }
    return list;
  }, [todayInfo.year, viewYear]);

  const formattedValue = value ? formatDisplayDate(value) : '';

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        title={title}
        disabled={disabled}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={cn(
          'w-full flex items-center justify-between gap-2 rounded-lg border px-3 text-left transition-colors outline-none shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
          'border-slate-300 bg-[#FFFFFF] text-slate-900 hover:border-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15',
          'dark:border-[#27272F] dark:bg-[#070709] dark:text-[#FAFAFA] dark:hover:border-[#3A3A46]',
          size === 'sm' ? 'min-h-[38px] text-xs' : 'min-h-[40px] text-xs sm:text-sm',
          isOpen && 'border-brand ring-2 ring-brand/15'
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-[#8E8E98] shrink-0" />
          <span
            className={cn(
              'truncate tabular-nums',
              formattedValue
                ? 'font-medium text-slate-900 dark:text-[#FAFAFA]'
                : 'text-slate-400 dark:text-[#63636E] font-normal'
            )}
          >
            {formattedValue || placeholder}
          </span>
        </span>

        {canClear && value && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }
            }}
            className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-[#1C1C22] dark:hover:text-[#FAFAFA] transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        ) : null}
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Choose date"
          className={cn(
            'absolute z-50 w-[292px] max-w-[calc(100vw-2rem)] rounded-2xl border p-3.5 shadow-xl',
            'border-slate-200 bg-[#FFFFFF] text-slate-900',
            'dark:border-[#27272F] dark:bg-[#141418] dark:text-[#FAFAFA]',
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            alignRight ? 'right-0' : 'left-0'
          )}
        >
          {/* Calendar Header */}
          <div className="flex items-center justify-between gap-1.5 mb-3">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous month"
              className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-[#27272F] text-slate-600 dark:text-[#D4D4D8] hover:bg-slate-100 dark:hover:bg-[#1E1E26] transition-colors cursor-pointer shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 min-w-0">
              <span className="text-xs font-bold tracking-tight text-slate-900 dark:text-[#FAFAFA] truncate">
                {MONTH_NAMES_FULL[viewMonth]}
              </span>
              <select
                aria-label="Select year"
                value={viewYear}
                onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                className="px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-[#27272F] bg-slate-50 dark:bg-[#0E0E11] text-xs font-bold text-slate-900 dark:text-[#FAFAFA] outline-none focus:border-brand cursor-pointer tabular-nums"
              >
                {yearOptions.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next month"
              className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-[#27272F] text-slate-600 dark:text-[#D4D4D8] hover:bg-slate-100 dark:hover:bg-[#1E1E26] transition-colors cursor-pointer shrink-0"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday Labels */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                className="h-7 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#71717A]"
              >
                {wd}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((cell) => {
              const isSelected = cell.iso === value;
              const isToday = cell.iso === todayInfo.iso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => handleSelectIso(cell.iso)}
                  className={cn(
                    'h-9 w-9 mx-auto rounded-lg text-xs tabular-nums flex items-center justify-center transition-all cursor-pointer',
                    isSelected
                      ? 'bg-brand text-white font-semibold shadow-sm'
                      : cell.inCurrentMonth
                        ? 'text-slate-800 dark:text-[#E4E4E7] hover:bg-slate-100 dark:hover:bg-[#1F1F27] font-medium'
                        : 'text-slate-300 dark:text-[#52525B] hover:bg-slate-50 dark:hover:bg-[#191920]',
                    !isSelected && isToday && 'ring-1 ring-brand/50 text-brand font-bold'
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Quick-Select Footer Pills */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-[#22222A] flex items-center justify-between gap-1.5 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => handleSelectIso(todayInfo.iso)}
                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-[#1E1E26] text-slate-700 dark:text-[#D4D4D8] hover:bg-brand-tint hover:text-brand transition-colors cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleSelectIso(addDaysToIso(todayInfo.iso, 1))}
                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-[#1E1E26] text-slate-700 dark:text-[#D4D4D8] hover:bg-brand-tint hover:text-brand transition-colors cursor-pointer"
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => handleSelectIso(addDaysToIso(todayInfo.iso, 7))}
                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-[#1E1E26] text-slate-700 dark:text-[#D4D4D8] hover:bg-brand-tint hover:text-brand transition-colors cursor-pointer"
              >
                +7 Days
              </button>
            </div>

            {canClear && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className="px-2 py-1 rounded-md text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
