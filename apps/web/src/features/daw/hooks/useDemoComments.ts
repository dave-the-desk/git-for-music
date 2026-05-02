'use client';

import { useEffect, useState } from 'react';
import type { DemoComment } from '@git-for-music/shared';

export function useDemoComments(demoId: string) {
  const [comments, setComments] = useState<DemoComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadComments() {
      setCommentsLoading(true);
      setCommentsError(null);

      try {
        const res = await fetch(`/api/demos/${demoId}/comments`, {
          headers: {
            Accept: 'application/json',
          },
        });
        const data = (await res.json()) as DemoComment[] | { error?: string };

        if (cancelled) return;

        if (!res.ok) {
          setCommentsError('error' in data ? data.error ?? 'Could not load comments' : 'Could not load comments');
          setComments([]);
          return;
        }

        setComments(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) {
          setCommentsError('Something went wrong while loading comments');
          setComments([]);
        }
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    }

    void loadComments();

    return () => {
      cancelled = true;
    };
  }, [demoId]);

  return {
    comments,
    setComments,
    commentsLoading,
    commentsError,
  };
}
