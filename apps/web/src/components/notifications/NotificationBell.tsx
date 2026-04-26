'use client';

import { useEffect, useRef, useState } from 'react';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

type NotificationsResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
  error?: string;
};

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatNotificationTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absDiffSeconds = Math.abs(diffSeconds);

  if (absDiffSeconds < 60) {
    return 'just now';
  }

  if (absDiffSeconds < 3600) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / 60), 'minute');
  }

  if (absDiffSeconds < 86400) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / 3600), 'hour');
  }

  if (absDiffSeconds < 604800) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / 86400), 'day');
  }

  return dateTimeFormatter.format(date);
}

export function NotificationBell() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeActionById, setActiveActionById] = useState<Record<string, 'accept' | 'decline' | null>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadNotifications(showLoading = false) {
    if (showLoading) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const response = await fetch('/api/notifications', { method: 'GET' });
      const data = (await response.json()) as NotificationsResponse;

      if (!response.ok) {
        setError(data.error ?? 'Could not load notifications');
        return null;
      }

      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);

      return data;
    } catch {
      setError('Something went wrong. Please try again.');
      return null;
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }

  async function markAllAsRead() {
    try {
      const response = await fetch('/api/notifications/read-all', {
        method: 'PATCH',
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? 'Could not mark notifications as read');
        return;
      }

      const readAt = new Date().toISOString();
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.readAt
            ? notification
            : {
                ...notification,
                readAt,
              },
        ),
      );
    } catch {
      setError('Something went wrong. Please try again.');
    }
  }

  async function handleGroupInviteAction(notificationId: string, action: 'accept' | 'decline') {
    setError(null);
    setActiveActionById((prev) => ({ ...prev, [notificationId]: action }));

    try {
      const response = await fetch(`/api/notifications/${notificationId}/group-invite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? `Could not ${action} invite`);
        return;
      }

      setNotifications((prev) => prev.filter((notification) => notification.id !== notificationId));
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setActiveActionById((prev) => ({ ...prev, [notificationId]: null }));
    }
  }

  async function handleToggle() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    setIsOpen(true);
    const data = await loadNotifications(true);

    if ((data?.unreadCount ?? unreadCount) > 0) {
      await markAllAsRead();
    }
  }

  useEffect(() => {
    void loadNotifications();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="Open notifications"
        onClick={handleToggle}
        className="relative rounded-md border border-gray-700 p-2 text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
          <path d="M9.7 17a2.3 2.3 0 0 0 4.6 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500" />
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-gray-800 bg-gray-900 shadow-2xl">
          <div className="border-b border-gray-800 px-4 py-3">
            <p className="text-sm font-medium text-white">Notifications</p>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? <p className="px-4 py-5 text-sm text-gray-400">Loading notifications...</p> : null}
            {!isLoading && error ? <p className="px-4 py-5 text-sm text-red-400">{error}</p> : null}
            {!isLoading && !error && notifications.length === 0 ? (
              <p className="px-4 py-5 text-sm text-gray-400">No new notifications</p>
            ) : null}
            {!isLoading && !error && notifications.length > 0
              ? notifications.map((notification) => (
                  <div key={notification.id} className="border-b border-gray-800/80 px-4 py-3 last:border-b-0">
                    <p className="text-sm font-medium text-white">{notification.title}</p>
                    <p className="mt-1 text-sm text-gray-300">{notification.message}</p>
                    {notification.type === 'GROUP_INVITE' ? (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleGroupInviteAction(notification.id, 'accept')}
                          disabled={Boolean(activeActionById[notification.id])}
                          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                        >
                          {activeActionById[notification.id] === 'accept' ? 'Accepting...' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleGroupInviteAction(notification.id, 'decline')}
                          disabled={Boolean(activeActionById[notification.id])}
                          className="rounded-md border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-60"
                        >
                          {activeActionById[notification.id] === 'decline' ? 'Declining...' : 'Decline'}
                        </button>
                      </div>
                    ) : null}
                    <p className="mt-1 text-xs text-gray-500">
                      {formatNotificationTime(notification.createdAt)}
                    </p>
                  </div>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
