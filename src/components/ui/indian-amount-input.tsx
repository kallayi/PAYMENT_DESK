'use client';

import * as React from 'react';
import {
  formatIndianAmountInput,
  sanitizeIndianAmountInput,
} from '@/lib/format';

export interface IndianAmountInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'inputMode'
  > {
  /** Clean numeric string (e.g. '', '0', '50000', '459973.50') */
  value: string;
  /** Emits sanitized numeric string (no commas) */
  onValueChange: (cleanValue: string) => void;
}

/**
 * Controlled decimal input that renders live Indian comma grouping (en-IN: 50,000 / 5,00,000.50)
 * while emitting clean numeric strings for form state and calculations.
 */
export const IndianAmountInput = React.forwardRef<
  HTMLInputElement,
  IndianAmountInputProps
>(function IndianAmountInput(
  { value, onValueChange, onKeyDown, placeholder = '0.00', ...rest },
  forwardedRef
) {
  const internalRef = React.useRef<HTMLInputElement | null>(null);
  const cursorNonCommaCountRef = React.useRef<number | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      internalRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef]
  );

  const displayValue = React.useMemo(
    () => formatIndianAmountInput(value),
    [value]
  );

  React.useLayoutEffect(() => {
    const targetNonComma = cursorNonCommaCountRef.current;
    const el = internalRef.current;
    if (targetNonComma === null || !el || document.activeElement !== el) {
      return;
    }
    cursorNonCommaCountRef.current = null;

    let seen = 0;
    let nextPos = displayValue.length;
    for (let i = 0; i < displayValue.length; i += 1) {
      if (seen >= targetNonComma) {
        nextPos = i;
        break;
      }
      if (displayValue[i] !== ',') {
        seen += 1;
      }
    }
    if (seen < targetNonComma) {
      nextPos = displayValue.length;
    }

    try {
      el.setSelectionRange(nextPos, nextPos);
    } catch {
      // Ignore selection range errors on unsupported inputs
    }
  }, [displayValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const caret = e.target.selectionStart ?? rawVal.length;
    const nonCommaBeforeCaret = rawVal
      .slice(0, caret)
      .replace(/[^0-9.]/g, '').length;

    const clean = sanitizeIndianAmountInput(rawVal);
    cursorNonCommaCountRef.current = nonCommaBeforeCaret;
    onValueChange(clean);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (e.key === 'Backspace') {
      const el = internalRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (
        start !== null &&
        end !== null &&
        start === end &&
        start > 1 &&
        el.value[start - 1] === ','
      ) {
        e.preventDefault();
        const beforeDigitDeleted =
          el.value.slice(0, start - 2) + el.value.slice(start);
        const nonCommaBeforeCaret = el.value
          .slice(0, start - 2)
          .replace(/[^0-9.]/g, '').length;
        cursorNonCommaCountRef.current = nonCommaBeforeCaret;
        onValueChange(sanitizeIndianAmountInput(beforeDigitDeleted));
      }
    }
  };

  return (
    <input
      {...rest}
      ref={setRefs}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
});
