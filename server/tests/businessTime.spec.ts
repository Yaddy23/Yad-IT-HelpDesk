import { describe, expect, it } from 'vitest';

import { addBusinessMs, businessMsBetween, isWithinBusinessHours } from '../src/sla/businessTime.js';
import type { BusinessCalendarInput } from '../src/sla/businessTime.js';

/** 9:00–17:00 Monday–Friday, no holidays. */
const cal9to5: BusinessCalendarInput = {
  timezone: 'UTC',
  workWindows: [
    { day: 'mon', start: '09:00', end: '17:00' },
    { day: 'tue', start: '09:00', end: '17:00' },
    { day: 'wed', start: '09:00', end: '17:00' },
    { day: 'thu', start: '09:00', end: '17:00' },
    { day: 'fri', start: '09:00', end: '17:00' },
  ],
  holidays: [],
};

/** 24×7, used to verify naive passthrough. */
const cal247: BusinessCalendarInput = {
  timezone: 'UTC',
  workWindows: [
    { day: 'sun', start: '00:00', end: '24:00' },
    { day: 'mon', start: '00:00', end: '24:00' },
    { day: 'tue', start: '00:00', end: '24:00' },
    { day: 'wed', start: '00:00', end: '24:00' },
    { day: 'thu', start: '00:00', end: '24:00' },
    { day: 'fri', start: '00:00', end: '24:00' },
    { day: 'sat', start: '00:00', end: '24:00' },
  ],
  holidays: [],
};

const H = 3600000;

// Reference week: 2026-10-19 is a Monday.
const MON_0900 = new Date('2026-10-19T09:00:00Z');
const MON_1200 = new Date('2026-10-19T12:00:00Z');
const MON_1600 = new Date('2026-10-19T16:00:00Z');
const MON_1700 = new Date('2026-10-19T17:00:00Z');
const FRI_1600 = new Date('2026-10-23T16:00:00Z');
const NEXT_MON_1000 = new Date('2026-10-26T10:00:00Z');

describe('businessMsBetween', () => {
  it('counts fully contained spans', () => {
    expect(businessMsBetween(cal9to5, MON_0900, MON_1200)).toBe(3 * H);
  });

  it('clips to the work window', () => {
    expect(businessMsBetween(cal9to5, MON_1600, MON_1700)).toBe(H);
    expect(businessMsBetween(cal9to5, MON_1600, new Date('2026-10-19T20:00:00Z'))).toBe(H);
    expect(businessMsBetween(cal9to5, new Date('2026-10-19T07:00:00Z'), new Date('2026-10-19T08:00:00Z'))).toBe(0);
  });

  it('skips the weekend (Fri 16:00 → Mon 10:00 = 2 business hours)', () => {
    expect(businessMsBetween(cal9to5, FRI_1600, NEXT_MON_1000)).toBe(2 * H);
  });

  it('skips holidays', () => {
    const withHoliday: BusinessCalendarInput = {
      ...cal9to5,
      holidays: ['2026-10-19'], // Monday off
    };
    // Mon 09:00 → Tue 09:00 with Monday as a holiday = 0
    expect(businessMsBetween(withHoliday, MON_0900, new Date('2026-10-20T09:00:00Z'))).toBe(0);
  });

  it('matches real time on a 24×7 calendar', () => {
    const real = NEXT_MON_1000.getTime() - FRI_1600.getTime();
    expect(businessMsBetween(cal247, FRI_1600, NEXT_MON_1000)).toBe(real);
  });

  it('respects the calendar timezone (Tokyo 9–17 vs UTC instants)', () => {
    const tokyo: BusinessCalendarInput = {
      timezone: 'Asia/Tokyo', // UTC+9, no DST
      workWindows: [{ day: 'mon', start: '09:00', end: '17:00' }],
      holidays: [],
    };
    // Monday 09:00 Tokyo = Sunday 00:00 UTC.
    const mondayTokyo0900 = new Date('2026-10-19T00:00:00Z');
    const mondayTokyo1300 = new Date('2026-10-19T04:00:00Z');
    expect(businessMsBetween(tokyo, mondayTokyo0900, mondayTokyo1300)).toBe(4 * H);
    // Outside the Tokyo window (Sunday evening UTC = Monday 03:00 Tokyo is inside…)
    const sunday2100Utc = new Date('2026-10-18T21:00:00Z'); // Mon 06:00 Tokyo → before open
    expect(businessMsBetween(tokyo, sunday2100Utc, mondayTokyo0900)).toBe(0);
  });

  it('handles the US spring-forward DST transition (business time still adds up)', () => {
    const ny: BusinessCalendarInput = {
      timezone: 'America/New_York',
      workWindows: [
        { day: 'mon', start: '09:00', end: '17:00' },
        { day: 'tue', start: '09:00', end: '17:00' },
        { day: 'wed', start: '09:00', end: '17:00' },
        { day: 'thu', start: '09:00', end: '17:00' },
        { day: 'fri', start: '09:00', end: '17:00' },
        { day: 'sat', start: '09:00', end: '17:00' },
        { day: 'sun', start: '09:00', end: '17:00' },
      ],
      holidays: [],
    };
    // DST starts 2026-03-08 (Sunday). Sat 16:00 → Sun 16:00 local straddles the
    // transition: Sat contributes 16:00→17:00 (1h), Sun contributes 09:00→16:00
    // (7h) — 8h total, unaffected by the offset shift.
    const satBefore = new Date('2026-03-07T21:00:00Z'); // Sat 16:00 EST (UTC-5)
    const sunAfter = new Date('2026-03-08T20:00:00Z'); // Sun 16:00 EDT (UTC-4)
    expect(businessMsBetween(ny, satBefore, sunAfter)).toBe(8 * H);
  });
});

describe('addBusinessMs', () => {
  it('lands inside the same window when there is room', () => {
    expect(addBusinessMs(cal9to5, MON_0900, 3 * H).toISOString()).toBe(MON_1200.toISOString());
  });

  it('carries into the next working day', () => {
    // 1 h remain on Monday after 16:00; +3 h → Tuesday 11:00.
    const target = addBusinessMs(cal9to5, MON_1600, 3 * H);
    expect(target.toISOString()).toBe('2026-10-20T11:00:00.000Z');
  });

  it('starts at the next opening when initiated outside hours', () => {
    // Friday 20:00 → next window is Monday 09:00; +1 h → Monday 10:00.
    const target = addBusinessMs(cal9to5, new Date('2026-10-23T20:00:00Z'), H);
    expect(target.toISOString()).toBe('2026-10-26T10:00:00.000Z');
  });

  it('crosses weekends and holidays when adding', () => {
    const withHoliday: BusinessCalendarInput = { ...cal9to5, holidays: ['2026-10-26'] };
    // Friday 16:00 + 2 h: Mon is a holiday → Tuesday 10:00.
    const target = addBusinessMs(withHoliday, FRI_1600, 2 * H);
    expect(target.toISOString()).toBe('2026-10-27T10:00:00.000Z');
  });

  it('is the inverse of businessMsBetween for in-window spans', () => {
    const target = addBusinessMs(cal9to5, MON_0900, 12 * H);
    expect(businessMsBetween(cal9to5, MON_0900, target)).toBe(12 * H);
  });
});

describe('isWithinBusinessHours', () => {
  it('answers per the calendar timezone', () => {
    expect(isWithinBusinessHours(cal9to5, MON_1200)).toBe(true);
    expect(isWithinBusinessHours(cal9to5, new Date('2026-10-19T18:00:00Z'))).toBe(false);
    expect(isWithinBusinessHours(cal9to5, new Date('2026-10-24T12:00:00Z'))).toBe(false); // Saturday
  });
});
