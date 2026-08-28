// All clinic-local time reasoning lives here, so the app and its tests use
// the same code instead of two copies that can drift.
//
// Egypt reinstated DST in 2023. Every "same time next week" calculation
// therefore has to go through the zone database: adding 7*24h across a
// transition silently moves a 10:00 session to 09:00 or 11:00, and the
// patient turns up an hour out. There is no per-clinic timezone column yet;
// when there is, thread it in place of this constant.
export const DEFAULT_TZ = "Africa/Cairo";

/**
 * Kept as an alias so existing imports keep working. New code should pass the
 * clinic's own timezone — it is a column on `clinics`, and a clinic in Riyadh
 * booking "10:00" must get 10:00 Riyadh, not 10:00 Cairo.
 */
export const CLINIC_TZ = DEFAULT_TZ;

// Egyptian clinics work Saturday–Thursday with Friday off, so a schedule
// week that starts on Saturday shows the working week contiguously. This is
// the one place that decides it.
export const WEEK_STARTS_ON = 6; // 0=Sun … 6=Sat

// One formatter per zone, built on first use. Constructing an
// Intl.DateTimeFormat is expensive enough to matter inside recurringSlots,
// which calls this once per candidate day.
const PARTS_BY_TZ = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = PARTS_BY_TZ.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    PARTS_BY_TZ.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ClinicParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
};

export function partsInClinicTz(at: Date, timeZone = DEFAULT_TZ): ClinicParts {
  const raw = partsFormatter(timeZone).formatToParts(at);
  const num = (type: string) =>
    Number(raw.find((p) => p.type === type)!.value);
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
    second: num("second"),
    weekday: WEEKDAY_INDEX[raw.find((p) => p.type === "weekday")!.value],
  };
}

// How far the clinic's wall clock is ahead of UTC at a given instant.
export function zoneOffsetMs(at: Date, timeZone = DEFAULT_TZ) {
  const p = partsInClinicTz(at, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - at.getTime();
}

// A clinic-local wall clock ("2026-08-22 10:00") to the UTC instant it means.
//
// Two passes on purpose. The offset has to be sampled at the *resulting*
// instant, not at the naive one, or a booking within an hour of a DST
// transition lands on the wrong side of it. The second pass converges
// because a transition never moves the clock by more than an hour.
export function wallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone = DEFAULT_TZ
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const settled = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(settled);
}

// Midnight-to-midnight in clinic time, as UTC instants. Each boundary is
// resolved against its own offset so a DST night is 23 or 25 hours, not 24.
export function dayRange(
  year: number,
  month: number,
  day: number,
  timeZone = DEFAULT_TZ
) {
  const start = wallClockToUtc(year, month, day, 0, 0, timeZone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const n = {
    y: nextDay.getUTCFullYear(),
    m: nextDay.getUTCMonth() + 1,
    d: nextDay.getUTCDate(),
  };
  const end = wallClockToUtc(n.y, n.m, n.d, 0, 0, timeZone);
  return { start, end };
}

export function todayRange(now = new Date(), timeZone = DEFAULT_TZ) {
  const p = partsInClinicTz(now, timeZone);
  return dayRange(p.year, p.month, p.day, timeZone);
}

// The date the schedule week containing `at` begins on, as Y-M-D.
export function weekStart(at: Date, timeZone = DEFAULT_TZ) {
  const p = partsInClinicTz(at, timeZone);
  const back = (p.weekday - WEEK_STARTS_ON + 7) % 7;
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export type YMD = { year: number; month: number; day: number };

export function addDays(d: YMD, n: number): YMD {
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function ymdToISO(d: YMD) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

export function isoToYmd(iso: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Reject 2026-02-31 and friends: Date.UTC would roll them over silently.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function weekdayOf(d: YMD) {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export type Slot = { startsAt: Date; endsAt: Date };

// A plan of care: "12 sessions, Sundays and Wednesdays at 10:00, 45 minutes".
//
// Each occurrence converts its own wall clock independently, which is what
// makes it survive a DST transition mid-course — the patient keeps their
// 10:00 slot rather than drifting an hour when the clocks change.
export function recurringSlots({
  from,
  hour,
  minute,
  durationMinutes,
  weekdays,
  count,
  timeZone = DEFAULT_TZ,
}: {
  from: YMD;
  hour: number;
  minute: number;
  durationMinutes: number;
  weekdays: number[]; // 0=Sun … 6=Sat
  count: number;
  timeZone?: string;
}): Slot[] {
  if (count < 1 || durationMinutes < 1 || weekdays.length === 0) return [];

  const wanted = new Set(weekdays);
  const out: Slot[] = [];
  let cursor = from;

  // A whole year of candidate days is far more than any plan of care, and
  // bounds the loop even if `weekdays` somehow never matches.
  for (let i = 0; i < 366 && out.length < count; i++) {
    if (wanted.has(weekdayOf(cursor))) {
      const startsAt = wallClockToUtc(
        cursor.year,
        cursor.month,
        cursor.day,
        hour,
        minute,
        timeZone
      );
      out.push({
        startsAt,
        endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
      });
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

// Postgres tstzrange literal. Half-open on purpose: a 10:00–10:45 session
// and a 10:45–11:30 session do not overlap, so the exclusion constraint
// lets them both stand.
export function tstzrange(startsAt: Date, endsAt: Date) {
  return `[${startsAt.toISOString()},${endsAt.toISOString()})`;
}

// Reads the lower bound out of a tstzrange Postgres hands back.
export function rangeStart(during: string) {
  const inner = during.slice(1);
  return inner.slice(0, inner.indexOf(",")).replace(/^"|"$/g, "");
}

export function rangeEnd(during: string) {
  const inner = during.slice(1, -1);
  return inner.slice(inner.indexOf(",") + 1).replace(/^"|"$/g, "");
}

// How long a booked session actually is. Moving a session has to preserve
// this: assuming a default would silently turn a 30-minute slot into a
// 45-minute one and overlap whatever was booked after it.
export function rangeMinutes(during: string) {
  const from = new Date(rangeStart(during)).getTime();
  const to = new Date(rangeEnd(during)).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null;
  return Math.round((to - from) / 60_000);
}


// ---- display ----
//
// Eighteen module-level Intl.DateTimeFormat constants used to hardcode
// "Africa/Cairo" across fourteen files. One builder, cached per zone and
// locale, means a clinic's own timezone reaches the screen as well as the
// booking maths.
type FormatterKind = "time" | "date" | "dateTime" | "dayName" | "dayNum" | "monthDay" | "longDate";

const OPTIONS: Record<FormatterKind, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  date: { day: "numeric", month: "short", year: "numeric" },
  dateTime: {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  },
  dayName: { weekday: "short" },
  dayNum: { day: "numeric" },
  monthDay: { day: "numeric", month: "long" },
  longDate: { weekday: "long", day: "numeric", month: "long" },
};

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function clinicFormat(
  kind: FormatterKind,
  locale: string,
  timeZone = DEFAULT_TZ
) {
  const key = `${kind}|${locale}|${timeZone}`;
  let f = FORMATTERS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...OPTIONS[kind], timeZone });
    FORMATTERS.set(key, f);
  }
  return f;
}

// The clinic-local calendar date of an instant, as YYYY-MM-DD. Used as a grid
// key and as the value a <input type="date"> expects.
export function clinicDateISO(at: Date, timeZone = DEFAULT_TZ) {
  const p = partsInClinicTz(at, timeZone);
  return ymdToISO({ year: p.year, month: p.month, day: p.day });
}
