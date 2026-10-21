import { api } from './api';

export interface SearchResultTicket {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  createdAt: string;
}

export interface SearchResultPerson {
  id: string;
  name: string;
  email: string;
}

export interface SearchResults {
  tickets: SearchResultTicket[];
  people: SearchResultPerson[];
}

export const searchApi = {
  async search(q: string, limit = 8): Promise<SearchResults> {
    const res = await api.get<{ data: SearchResults }>('/search', { params: { q, limit } });
    return res.data.data;
  },
};
