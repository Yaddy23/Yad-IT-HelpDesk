/**
 * Business-time engine.
 *
 * All SLA math flows through here — never naive timestamp subtraction when a
 * business calendar applies. A calendar is a timezone plus per-weekday work
 * windows ("09:00"–"17:00") plus holiday dates (calendar-local). Wall-clock
 * times in the calendar's timezone are converted to UTC instants DST-safely
 * (offset is resolved at the target instant, then re-checked once for
 * spring-forward boundaries).
 */

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface WorkWindow {
  day: Weekday;
  /** Local wall-clock "HH:MM" inclusive start. */
  start: string;
  /** Local wall-clock "HH:MM" exclusive end ("24:00" allowed for midnight). */
  end: string;
}

export interface BusinessCalendarInput {
  timezone: string;
  workWindows: WorkWindow[];
  /** Calendar-local ISO dates ("YYYY-MM-DD") on which no work happens. */
  holidays: string[];
}

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Safety valve for addBusinessMs walks (≈10 years of days). */
const MAX_DAYS = 4000;

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  weekday: Weekday;
  dateKey: string; // "YYYY-MM-DD"
}

function localParts(tz: string, at: Date): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const map = new Map<string, string>();
  for (const p of dtf.formatToParts(at)) map.set(p.type, p.value);
  const hour = Number(map.get('hour') === '24' ? '00' : map.get('hour'));
  const year = Number(map.get('year'));
  const month = Number(map.get('month'));
  const day = Number(map.get('day'));
  const weekdayShort = (map.get('weekday') ?? 'sun').slice(0, 3).toLowerCase();
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.get('minute')),
    weekday: (WEEKDAYS.includes(weekdayShort as Weekday) ? weekdayShort : 'sun') as Weekday,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/** Offset (ms) to add to a UTC instant to get wall-clock time in `tz`. */
function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = new Map<string, string>();
  for (const p of dtf.formatToParts(at)) map.set(p.type, p.value);
  const hour = Number(map.get('hour') === '24' ? '00' : map.get('hour'));
  const asUtc = Date.UTC(
    Number(map.get('year')),
    Number(map.get('month')) - 1,
    Number(map.get('day')),
    hour,
    Number(map.get('minute')),
    Number(map.get('second')),
  );
  return asUtc - at.getTime();
}

/** Converts a local wall-clock time in `tz` to its UTC instant (DST-safe). */
function wallToUtc(tz: string, year: number, month: number, day: number, minutes: number): number {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  // Resolve the offset at the naive instant, apply, then re-resolve once —
  // converges for DST transitions inside the day.
  const firstPass = naive - tzOffsetMs(tz, new Date(naive));
  const secondPass = naive - tzOffsetMs(tz, new Date(firstPass));
  return secondPass;
}

function parseHhMm(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

interface DayWindow {
  dateKey: string;
  startUtc: number;
  endUtc: number;
}

/** Work windows for the calendar-local day containing `at`, or null. */
function windowsForDay(cal: BusinessCalendarInput, at: Date): DayWindow[] {
  const parts = localParts(cal.timezone, at);
  if (cal.holidays.includes(parts.dateKey)) return [];
  const dayWindows = cal.workWindows.filter((w) => w.day === parts.weekday);
  return dayWindows.map((w) => ({
    dateKey: parts.dateKey,
    startUtc: wallToUtc(cal.timezone, parts.year, parts.month, parts.day, parseHhMm(w.start)),
    endUtc: wallToUtc(cal.timezone, parts.year, parts.month, parts.day, parseHhMm(w.end)),
  }));
}

/** Advances the anchor to the same wall-clock time on the next calendar day. */
function nextDayAnchor(cal: BusinessCalendarInput, at: Date): Date {
  const parts = localParts(cal.timezone, at);
  const nextLocalMidnightUtc = wallToUtc(cal.timezone, parts.year, parts.month, parts.day + 1, 0);
  return new Date(nextLocalMidnightUtc);
}

/** Business milliseconds elapsed between two instants under the calendar. */
export function businessMsBetween(cal: BusinessCalendarInput, from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = new Date(from);
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const windows = windowsForDay(cal, cursor);
    for (const w of windows) {
      const overlapStart = Math.max(cursor.getTime(), w.startUtc);
      const overlapEnd = Math.min(to.getTime(), w.endUtc);
      if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
    }
    const next = nextDayAnchor(cal, cursor);
    if (next.getTime() > to.getTime()) break;
    cursor = next;
  }
  return total;
}

/**
 * Adds `ms` of business time to `from`. If `from` sits outside all windows,
 * the clock starts at the next window's opening.
 */
export function addBusinessMs(cal: BusinessCalendarInput, from: Date, ms: number): Date {
  if (ms <= 0) return new Date(from);
  let remaining = ms;
  let cursor = new Date(from);
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const windows = windowsForDay(cal, cursor);
    for (const w of windows) {
      const segStart = Math.max(cursor.getTime(), w.startUtc);
      const segEnd = w.endUtc;
      if (segEnd <= segStart) continue;
      const available = segEnd - segStart;
      if (available >= remaining) return new Date(segStart + remaining);
      remaining -= available;
    }
    cursor = nextDayAnchor(cal, cursor);
  }
  // Calendar with no matching windows — fall back to real time so deadlines
  // still exist rather than looping forever.
  return new Date(from.getTime() + ms);
}

export function isWithinBusinessHours(cal: BusinessCalendarInput, at: Date): boolean {
  return windowsForDay(cal, at).some((w) => at.getTime() >= w.startUtc && at.getTime() < w.endUtc);
}

/** Rounds business milliseconds to whole minutes (deadlines are minute-granular). */
export function businessMinutesBetween(cal: BusinessCalendarInput, from: Date, to: Date): number {
  return Math.floor(businessMsBetween(cal, from, to) / 60000);
}
