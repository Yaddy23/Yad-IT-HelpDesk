import { api } from './api';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  ticketId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListData {
  items: NotificationItem[];
  unread: number;
}

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  slaWarnings: boolean;
  slaBreaches: boolean;
  ticketUpdate: boolean;
}

export const notificationsApi = {
  async list(unreadOnly = false, limit = 25): Promise<NotificationListData> {
    const res = await api.get<{ data: NotificationListData }>('/notifications', {
      params: { ...(unreadOnly ? { unread: 'true' } : {}), limit },
    });
    return res.data.data;
  },

  async unreadCount(): Promise<number> {
    const res = await api.get<{ data: { count: number } }>('/notifications/unread-count');
    return res.data.data.count;
  },

  async markRead(id: string): Promise<void> {
    await api.post(`/notifications/${id}/read`);
  },

  async markAllRead(): Promise<void> {
    await api.post('/notifications/read-all');
  },

  async getPreferences(): Promise<NotificationPreferences> {
    const res = await api.get<{ data: NotificationPreferences }>('/notifications/preferences');
    return res.data.data;
  },

  async updatePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const res = await api.put<{ data: NotificationPreferences }>('/notifications/preferences', patch);
    return res.data.data;
  },
};
