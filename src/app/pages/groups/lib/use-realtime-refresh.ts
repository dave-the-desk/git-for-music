'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function useRealtimeRefresh(endpoint: string | null) {
  const router = useRouter();
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!endpoint) return;

    const source = new EventSource(endpoint);

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 75);
    };

    source.onmessage = scheduleRefresh;

    return () => {
      source.close();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [endpoint, router]);
}
