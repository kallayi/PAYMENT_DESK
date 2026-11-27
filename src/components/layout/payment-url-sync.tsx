'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface PaymentUrlSyncInnerProps {
  onParams: (params: { tab: string | null; highlightId: string | null }) => void;
}

function PaymentUrlSyncInner({ onParams }: PaymentUrlSyncInnerProps) {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab');
  const highlightId = searchParams.get('highlight');

  React.useEffect(() => {
    onParams({ tab, highlightId });
  }, [tab, highlightId, onParams]);

  return null;
}

export function PaymentUrlSync({ onParams }: PaymentUrlSyncInnerProps) {
  return (
    <Suspense fallback={null}>
      <PaymentUrlSyncInner onParams={onParams} />
    </Suspense>
  );
}

/**
 * Tracks the currently highlighted payment ID, smoothly scrolls the visible
 * matching card/row (`data-payment-id`) into view, and clears the highlight after 3s.
 */
export function usePaymentHighlight() {
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null);
  const clearTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerHighlight = React.useCallback((targetId: string | null) => {
    if (!targetId) return;

    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
    }

    setHighlightedId(targetId);

    const scrollTimer = setTimeout(() => {
      try {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(`[data-payment-id="${targetId}"]`)
        );
        const visibleEl =
          candidates.find((el) => el.offsetParent !== null) || candidates[0];
        visibleEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        // Ignore DOM scroll errors
      }
    }, 120);

    clearTimerRef.current = setTimeout(() => {
      setHighlightedId(null);
      clearTimerRef.current = null;
    }, 3000);

    return () => clearTimeout(scrollTimer);
  }, []);

  React.useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  return { highlightedId, triggerHighlight };
}
