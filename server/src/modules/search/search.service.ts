import type { Prisma } from '@prisma/client';

import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { can } from '../tickets/tickets.service.js';
import { ticketScopeWhere } from '../tickets/tickets.service.js';

/**
 * Global search. Record-level authorization is inherited from the tickets
 * module: the same `ticketScopeWhere` used by the list queues clips ticket
 * results, so an employee can never surface someone else's ticket by searching.
 * People results are only included for users holding `users:manage`.
 */

export interface SearchResults {
  tickets: {
    id: string;
    number: string;
    title: string;
    status: string;
    priority: string;
    category: string;
    createdAt: Date;
  }[];
  people: { id: string; name: string; email: string }[];
}

export async function globalSearch(user: AuthedUser, q: string, limit: number): Promise<SearchResults> {
  const term = q.trim();

  // Tickets: title, human number, or description text — always within scope.
  const ticketWhere: Prisma.TicketWhereInput = {
    AND: [
      await ticketScopeWhere(user),
      {
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { number: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      },
    ],
  };

  const [tickets, people] = await Promise.all([
    prisma.ticket.findMany({
      where: ticketWhere,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, number: true, title: true, status: true, priority: true, category: true, createdAt: true },
    }),
    can(user, 'users:manage')
      ? prisma.user.findMany({
          where: {
            active: true,
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
            ],
          },
          orderBy: { name: 'asc' },
          take: limit,
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);

  return { tickets, people };
}
