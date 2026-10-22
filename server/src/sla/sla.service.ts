import type { BusinessCalendar, SlaInstance, SlaPolicy } from '@prisma/client';

import { recordAudit } from '../core/audit.js';
import { logger } from '../core/logger.js';
import { prisma } from '../prisma/client.js';
import { addBusinessMs, businessMsBetween, type BusinessCalendarInput, type Weekday } from './businessTime.js';
import { getSystemSettings } from '../modules/settings/settings.routes.js';
import { createNotification, notifyRole } from '../modules/notifications/notifications.service.js';

/**
 * SLA instance engine.
 *
 * Targets are business MINUTES (real minutes when the policy has no calendar).
 * Elapsed time = clock(startAt → pausedAt ?? now) − pausedMs, where pause
 * intervals are converted to business milliseconds on resume so waiting on
 * the employee costs nothing. The materialized instance state is recomputed
 * on ticket events AND by the repeatable sweep — the sweep rechecks live
 * state before acting, so delayed jobs and retries stay idempotent
 * (escalations are additionally protected by a DB unique constraint).
 */

type CalendarDetail = BusinessCalendar & { workWindows: { day: string; start: string; end: string }[]; holidays: { date: Date }[] };

export function calendarToEngineInput(cal: CalendarDetail): BusinessCalendarInput {
  return {
    timezone: cal.timezone,
    workWindows: cal.workWindows.map((w) => ({ day: w.day as Weekday, start: w.start, end: w.end })),
    holidays: cal.holidays.map((h) => h.date.toISOString().slice(0, 10)),
  };
}

export async function loadMatchedPolicies(ticket: { priority: string; category: string }): Promise<SlaPolicy[]> {
  const policies = await prisma.slaPolicy.findMany({
    where: { active: true },
    include: { businessCalendar: { include: { workWindows: true, holidays: true } } },
  });
  return policies.filter((p) => {
    const applies = (p.appliesTo ?? {}) as { priorities?: string[]; categories?: string[] };
    if (applies.priorities?.length && !applies.priorities.includes(ticket.priority)) return false;
    if (applies.categories?.length && !applies.categories.includes(ticket.category)) return false;
    return true;
  });
}

/** Creates missing SLA instances for a ticket from currently-matching policies. */
export async function ensureSlaInstances(ticket: {
  id: string;
  priority: string;
  category: string;
  createdAt: Date;
}): Promise<void> {
  const matched = await loadMatchedPolicies(ticket);
  const existing = await prisma.slaInstance.findMany({
    where: { ticketId: ticket.id },
    select: { policyId: true, type: true },
  });
  const have = new Set(existing.map((e) => `${e.policyId}:${e.type}`));

  const toCreate = matched.flatMap((p) => {
    const rows: { policyId: string; type: 'response' | 'resolution'; targetMins: number }[] = [];
    if (p.responseTargetMins !== null && !have.has(`${p.id}:response`)) {
      rows.push({ policyId: p.id, type: 'response', targetMins: p.responseTargetMins });
    }
    if (p.resolveTargetMins !== null && !have.has(`${p.id}:resolution`)) {
      rows.push({ policyId: p.id, type: 'resolution', targetMins: p.resolveTargetMins });
    }
    return rows;
  });

  if (toCreate.length === 0) return;
  await prisma.slaInstance.createMany({
    data: toCreate.map((r) => ({
      ticketId: ticket.id,
      policyId: r.policyId,
      type: r.type,
      targetMins: r.targetMins,
      startAt: ticket.createdAt,
    })),
  });
}

/**
 * Re-evaluates matching after a priority/category change: refreshes targets on
 * instances whose policy still matches, removes non-terminal instances whose
 * policy no longer matches, and instantiates newly matching policies.
 */
export async function recomputeSlaForTicket(
  ticket: { id: string; priority: string; category: string; createdAt: Date },
  actorId: string | null,
): Promise<void> {
  const matched = await loadMatchedPolicies(ticket);
  const matchedIds = new Set(matched.map((p) => p.id));
  const targets = new Map<string, number | null>(
    matched.flatMap((p) => [
      [`${p.id}:response`, p.responseTargetMins] as const,
      [`${p.id}:resolution`, p.resolveTargetMins] as const,
    ]),
  );

  const instances = await prisma.slaInstance.findMany({ where: { ticketId: ticket.id } });
  for (const inst of instances) {
    const key = `${inst.policyId}:${inst.type}`;
    const target = targets.get(key) ?? null;
    if (!matchedIds.has(inst.policyId) || target === null) {
      if (inst.completedAt === null) {
        await prisma.slaInstance.delete({ where: { id: inst.id } });
        await prisma.slaEscalation.deleteMany({ where: { instanceId: inst.id } });
      }
      continue;
    }
    if (target !== inst.targetMins) {
      await prisma.slaInstance.update({ where: { id: inst.id }, data: { targetMins: target } });
      await recordAudit({
        actorId,
        action: 'sla.target_recomputed',
        targetType: 'ticket',
        targetId: ticket.id,
        before: { type: inst.type, targetMins: inst.targetMins },
        after: { type: inst.type, targetMins: target },
      });
    }
  }
  await ensureSlaInstances(ticket);
}

async function calendarFor(inst: SlaInstance & { policy: SlaPolicy }): Promise<BusinessCalendarInput | null> {
  if (!inst.policy.businessCalendarId) return null;
  const cal = inst.policy.businessCalendarId
    ? await prisma.businessCalendar.findUnique({
        where: { id: inst.policy.businessCalendarId },
        include: { workWindows: true, holidays: true },
      })
    : null;
  return cal ? calendarToEngineInput(cal as unknown as CalendarDetail) : null;
}

/** Elapsed clock (business or naive) minus accumulated pauses, in ms. */
export function elapsedMs(
  inst: Pick<SlaInstance, 'startAt' | 'pausedAt' | 'pausedMs'>,
  calendar: BusinessCalendarInput | null,
  now: Date,
): number {
  const end = inst.pausedAt ?? now;
  const raw = calendar ? businessMsBetween(calendar, inst.startAt, end) : end.getTime() - inst.startAt.getTime();
  return Math.max(0, raw - inst.pausedMs);
}

/** Derived deadline instant for display (target minutes of business time). */
export function deadlineFor(
  inst: Pick<SlaInstance, 'startAt' | 'targetMins'>,
  calendar: BusinessCalendarInput | null,
): Date {
  if (!calendar) return new Date(inst.startAt.getTime() + inst.targetMins * 60000);
  return addBusinessMs(calendar, inst.startAt, inst.targetMins * 60000);
}

/* ── Pause / resume ────────────────────────────────────────────────────────── */

/** Pauses every active instance (ticket entered a configured pause state). */
export async function pauseSlaForTicket(ticketId: string, at: Date): Promise<void> {
  await prisma.slaInstance.updateMany({
    where: { ticketId, pausedAt: null, completedAt: null },
    data: { pausedAt: at, state: 'paused' },
  });
}

/** Resumes (converting the pause interval to business ms) and re-arms targets. */
export async function resumeSlaForTicket(ticketId: string, at: Date): Promise<void> {
  const instances = await prisma.slaInstance.findMany({
    where: { ticketId, pausedAt: { not: null } },
    include: { policy: true },
  });
  for (const inst of instances) {
    const calendar = await calendarFor(inst);
    const pausedBusiness = calendar
      ? businessMsBetween(calendar, inst.pausedAt!, at)
      : at.getTime() - inst.pausedAt!.getTime();
    const next = await prisma.slaInstance.update({
      where: { id: inst.id },
      data: { pausedAt: null, pausedMs: inst.pausedMs + pausedBusiness },
    });
    await refreshInstanceState({ ...next, policy: inst.policy }, calendar, at);
  }
}

/* ── Completion ────────────────────────────────────────────────────────────── */

/** Marks the response instances answered (first agent activity). */
export async function recordFirstResponse(ticketId: string, at: Date): Promise<void> {
  const instances = await prisma.slaInstance.findMany({
    where: { ticketId, type: 'response', completedAt: null },
    include: {
      policy: true,
      ticket: { select: { id: true, number: true, title: true, assigneeId: true } },
    },
  });
  for (const inst of instances) {
    const calendar = await calendarFor(inst);
    const elapsed = elapsedMs(inst, calendar, at);
    const met = elapsed <= inst.targetMins * 60000;
    await prisma.slaInstance.update({
      where: { id: inst.id },
      data: { firstResponseAt: at, completedAt: at, state: met ? 'met' : 'missed' },
    });
    if (!met) await fireEscalations(inst, 'breached');
  }
}

/** Completes resolution instances when the ticket is resolved/closed. */
export async function completeResolutionSla(ticketId: string, at: Date): Promise<void> {
  const instances = await prisma.slaInstance.findMany({
    where: { ticketId, type: 'resolution', completedAt: null },
    include: {
      policy: true,
      ticket: { select: { id: true, number: true, title: true, assigneeId: true } },
    },
  });
  for (const inst of instances) {
    const calendar = await calendarFor(inst);
    const elapsed = elapsedMs(inst, calendar, at);
    const met = elapsed <= inst.targetMins * 60000;
    await prisma.slaInstance.update({
      where: { id: inst.id },
      data: { completedAt: at, state: met ? 'met' : 'missed' },
    });
    if (!met) await fireEscalations(inst, 'breached');
  }
}

/** Re-arms resolution instances after a reopen (clock restarts, chain resets). */
export async function rearmResolutionSla(ticketId: string, at: Date): Promise<void> {
  const instances = await prisma.slaInstance.findMany({ where: { ticketId, type: 'resolution' } });
  for (const inst of instances) {
    await prisma.slaEscalation.deleteMany({ where: { instanceId: inst.id } });
    await prisma.slaInstance.update({
      where: { id: inst.id },
      data: { startAt: at, pausedAt: null, pausedMs: 0, completedAt: null, state: 'within' },
    });
  }
}

/** Canceled tickets terminate their SLA clock without met/missed judgment. */
export async function cancelSlaForTicket(ticketId: string): Promise<void> {
  const active = await prisma.slaInstance.findMany({
    where: { ticketId, completedAt: null },
    select: { id: true },
  });
  if (active.length === 0) return;
  await prisma.slaEscalation.deleteMany({ where: { instanceId: { in: active.map((a) => a.id) } } });
  await prisma.slaInstance.deleteMany({ where: { id: { in: active.map((a) => a.id) } } });
}

/* ── State computation + sweep ─────────────────────────────────────────────── */

async function refreshInstanceState(
  inst: SlaInstance & { policy: SlaPolicy },
  calendar: BusinessCalendarInput | null,
  now: Date,
): Promise<SlaInstance> {
  if (inst.pausedAt || inst.completedAt) return inst;
  const elapsed = elapsedMs(inst, calendar, now);
  const targetMs = inst.targetMins * 60000;
  const warnMs = targetMs * ((inst.policy.warnPercent || 75) / 100);
  const next: 'within' | 'approaching' | 'breached' =
    elapsed >= targetMs ? 'breached' : elapsed >= warnMs ? 'approaching' : 'within';
  if (next === inst.state) return inst;
  return prisma.slaInstance.update({ where: { id: inst.id }, data: { state: next } });
}

/** Escalation thresholds: warning at warnPercent, breach at 100%. */
async function fireEscalations(
  inst: SlaInstance & { policy: SlaPolicy; ticket: { id: string; number: string; title: string; assigneeId: string | null } },
  state: 'approaching' | 'breached',
): Promise<void> {
  // The unique constraint makes a double fire impossible across races/retries.
  try {
    await prisma.slaEscalation.create({ data: { instanceId: inst.id, thresholdKey: state } });
  } catch {
    return; // already fired for this threshold
  }

  const title =
    state === 'approaching'
      ? `SLA warning: ${inst.ticket.number} is approaching its ${inst.type} target`
      : `SLA BREACH: ${inst.ticket.number} exceeded its ${inst.type} target`;
  const body =
    state === 'approaching'
      ? `“${inst.ticket.title}” is at ${inst.policy.warnPercent}% of the ${inst.type} target (${inst.targetMins} min).`
      : `“${inst.ticket.title}” breached the ${inst.type} target of ${inst.targetMins} min.`;

  const dedupeBase = `${inst.id}:${state}`;
  if (inst.ticket.assigneeId) {
    const assignee = await prisma.employee.findUnique({ where: { id: inst.ticket.assigneeId }, select: { userId: true } });
    if (assignee?.userId) {
      await createNotification({
        userId: assignee.userId,
        type: state === 'approaching' ? 'sla.warning' : 'sla.breach',
        title,
        body,
        ticketId: inst.ticket.id,
        dedupeKey: `${dedupeBase}:assignee`,
      });
    }
  }
  if (state === 'breached') {
    await notifyRole('it_manager', {
      type: 'sla.breach',
      title,
      body,
      ticketId: inst.ticket.id,
      dedupeKey: `${dedupeBase}:managers`,
    });
    await recordAudit({
      action: 'sla.breached',
      targetType: 'ticket',
      targetId: inst.ticket.id,
      meta: { number: inst.ticket.number, type: inst.type, targetMins: inst.targetMins },
    });
  }
  if (state === 'approaching') {
    await recordAudit({
      action: 'sla.warning',
      targetType: 'ticket',
      targetId: inst.ticket.id,
      meta: { number: inst.ticket.number, type: inst.type },
    });
  }
}

/**
 * The repeatable sweep: recomputes every non-terminal instance, fires
 * approaching/breach escalations once, and closes the loop on pauses the
 * event hooks might have missed. Idempotent — safe to run on a timer and on
 * demand (tests call it directly).
 */
export async function runSlaSweep(now = new Date()): Promise<{ checked: number; escalated: number; nextWakeUpMs: number | null }> {
  const settings = await getSystemSettings();
  const pauseStates = new Set(settings.slaPauseStates);
  const instances = await prisma.slaInstance.findMany({
    where: { OR: [{ completedAt: null }, { state: { in: ['within', 'approaching', 'breached', 'paused'] } }] },
    include: {
      policy: true,
      ticket: { select: { id: true, number: true, title: true, status: true, assigneeId: true } },
    },
    take: 500,
    orderBy: { createdAt: 'asc' },
  });

  let escalated = 0;
  let nextWakeUpMs: number | null = null;
  for (const inst of instances) {
    if (inst.completedAt) continue;

    // Terminal by ticket state: resolution instances complete on resolve/closed.
    if (inst.type === 'resolution' && ['resolved', 'closed'].includes(inst.ticket.status)) {
      await completeResolutionSla(inst.ticketId, now);
      continue;
    }

    const shouldPause = pauseStates.has(inst.ticket.status);
    if (shouldPause && !inst.pausedAt) {
      await pauseSlaForTicket(inst.ticketId, now);
      continue;
    }
    if (!shouldPause && inst.pausedAt) {
      await resumeSlaForTicket(inst.ticketId, now);
      continue;
    }

    const calendar = await calendarFor(inst);
    const before = inst.state;
    const updated = await refreshInstanceState(inst, calendar, now);
    if ((updated.state === 'approaching' || updated.state === 'breached') && before !== updated.state) {
      await fireEscalations(inst, updated.state === 'approaching' ? 'approaching' : 'breached');
      escalated += 1;
    }

    // Soonest warning threshold among still-healthy instances — lets the
    // scheduler wake up early instead of waiting for the next full sweep.
    if (updated.state === 'within') {
      const msToWarn =
        (inst.targetMins * 60000) * ((inst.policy.warnPercent || 75) / 100) -
        elapsedMs(inst, calendar, now);
      if (msToWarn > 0 && (nextWakeUpMs === null || msToWarn < nextWakeUpMs)) {
        nextWakeUpMs = Math.ceil(msToWarn);
      }
    }
  }
  return { checked: instances.length, escalated, nextWakeUpMs };
}

/** Live indicator for a ticket detail view (no DB writes). */
export function instanceIndicator(
  inst: SlaInstance & { policy: SlaPolicy },
  calendar: BusinessCalendarInput | null,
  now: Date,
): { state: SlaInstance['state']; elapsedMins: number; targetMins: number; deadlineAt: Date } {
  if (inst.completedAt) {
    return { state: inst.state, elapsedMins: Math.floor(elapsedMs(inst, calendar, inst.completedAt) / 60000), targetMins: inst.targetMins, deadlineAt: deadlineFor(inst, calendar) };
  }
  const elapsed = elapsedMs(inst, calendar, now);
  const targetMs = inst.targetMins * 60000;
  const state: SlaInstance['state'] = inst.pausedAt
    ? 'paused'
    : elapsed >= targetMs
      ? 'breached'
      : elapsed >= targetMs * ((inst.policy.warnPercent || 75) / 100)
        ? 'approaching'
        : 'within';
  return { state, elapsedMins: Math.floor(elapsed / 60000), targetMins: inst.targetMins, deadlineAt: deadlineFor(inst, calendar) };
}

export function logSweepError(err: unknown): void {
  logger.error('[sla] sweep failed', err);
}
