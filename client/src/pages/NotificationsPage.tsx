import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { CheckAllIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { notificationsApi, type NotificationPreferences } from '@/lib/notificationsApi';
import { getNotificationsSocket } from '@/lib/notificationsSocket';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PREF_LABELS: Record<keyof NotificationPreferences, string> = {
  inApp: 'In-app notifications',
  email: 'Email notifications',
  slaWarnings: 'SLA warnings (approaching target)',
  slaBreaches: 'SLA breaches (target exceeded)',
  ticketUpdate: 'Ticket updates (assignments, status changes)',
};

function PreferencesSection() {
  const queryClient = useQueryClient();
  const prefsQuery = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => notificationsApi.getPreferences(),
    staleTime: 60_000,
  });

  const update = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => notificationsApi.updatePreferences(patch),
    onSuccess: (prefs) => queryClient.setQueryData(['notifications', 'preferences'], prefs),
  });

  if (prefsQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading preferences…</p>;
  if (prefsQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(prefsQuery.error, 'Failed to load preferences')}
      </p>
    );
  }
  const prefs = prefsQuery.data;
  if (!prefs) return null;

  return (
    <section aria-labelledby="notification-prefs-heading" className="mt-8">
      <h2 id="notification-prefs-heading" className="mb-3 text-sm font-semibold text-foreground">
        Delivery preferences
      </h2>
      <fieldset className="space-y-2.5">
        <legend className="sr-only">Notification delivery preferences</legend>
        {(Object.keys(PREF_LABELS) as (keyof NotificationPreferences)[]).map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
            <input
              type="checkbox"
              checked={prefs[key]}
              onChange={(e) => update.mutate({ [key]: e.target.checked })}
              className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
            />
            <span className="text-foreground">{PREF_LABELS[key]}</span>
          </label>
        ))}
      </fieldset>
      {update.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {apiErrorMessage(update.error, 'Failed to save preferences')}
        </p>
      )}
    </section>
  );
}

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const queryClient = useQueryClient();

  // Live refresh: invalidate lists when a socket notification arrives.
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

  const listQuery = useQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    queryFn: () => notificationsApi.list(unreadOnly, 50),
    staleTime: 10_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = listQuery.data?.items ?? [];
  const unread = listQuery.data?.unread ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unread > 0 ? `${unread} unread` : 'All caught up'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
            />
            Unread only
          </label>
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={unread === 0 || markAllRead.isPending}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckAllIcon size={16} />
            Mark all read
          </button>
        </div>
      </div>

      {listQuery.isLoading && <p className="text-sm text-muted-foreground">Loading notifications…</p>}
      {listQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {apiErrorMessage(listQuery.error, 'Failed to load notifications')}
        </p>
      )}
      {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Notifications">
          {items.map((item) => (
            <li key={item.id} className={`border-b border-border/60 last:border-b-0 ${item.readAt ? '' : 'bg-primary/5'}`}>
              <div className="flex items-start gap-3 px-4 py-3">
                {!item.readAt && <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`text-sm ${item.readAt ? 'text-foreground' : 'font-medium text-foreground'}`}>{item.title}</p>
                    <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={item.createdAt}>
                      {formatWhen(item.createdAt)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                  <div className="mt-1.5 flex items-center gap-3">
                    {item.ticketId && (
                      <Link to={`/tickets/${item.ticketId}`} className="text-xs font-medium text-primary hover:underline">
                        Open ticket
                      </Link>
                    )}
                    {!item.readAt && (
                      <button
                        type="button"
                        onClick={() => markRead.mutate(item.id)}
                        className="cursor-pointer text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PreferencesSection />
    </div>
  );
}
