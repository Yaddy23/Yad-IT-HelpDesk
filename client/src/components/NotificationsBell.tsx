import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { BellIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { notificationsApi } from '@/lib/notificationsApi';
import { getNotificationsSocket } from '@/lib/notificationsSocket';

const DROPDOWN_LIMIT = 8;

function formatWhen(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Top-bar notification bell: live unread badge (Socket.IO, with a polling
 * fallback), recent-items dropdown, link to the full inbox.
 */
export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 10_000,
    refetchInterval: 60_000, // fallback if the socket is not connected
  });

  const recentQuery = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => notificationsApi.list(false, DROPDOWN_LIMIT),
    staleTime: 10_000,
    enabled: open,
  });

  useEffect(() => {
    const socket = getNotificationsSocket();
    if (!socket) return;
    const onNotification = () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
    };
  }, [queryClient]);

  // Close when clicking anywhere outside the bell.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = unreadQuery.data ?? 0;

  const openItem = (item: { id: string; ticketId: string | null; readAt: string | null }) => {
    if (!item.readAt) markRead.mutate(item.id);
    setOpen(false);
    if (item.ticketId) navigate(`/tickets/${item.ticketId}`);
    else navigate('/notifications');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notifications-dropdown"
        className="relative cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <BellIcon size={20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
            <span role="status" aria-atomic="true" className="sr-only">
              {unread} unread {unread === 1 ? 'notification' : 'notifications'}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div
          id="notifications-dropdown"
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
              className="cursor-pointer text-xs font-medium text-primary hover:underline"
            >
              View all
            </button>
          </div>

          {recentQuery.isLoading && <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
          {recentQuery.isError && (
            <p role="alert" className="px-4 py-3 text-sm text-destructive">
              {apiErrorMessage(recentQuery.error, 'Failed to load notifications')}
            </p>
          )}
          {recentQuery.data && recentQuery.data.items.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">You're all caught up.</p>
          )}

          {recentQuery.data?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openItem(item)}
              className={`block w-full cursor-pointer border-b border-border/60 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted ${
                item.readAt ? '' : 'bg-primary/5'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`min-w-0 flex-1 truncate text-sm ${item.readAt ? 'text-foreground' : 'font-medium text-foreground'}`}>
                  {item.title}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatWhen(item.createdAt)}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{item.body}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
