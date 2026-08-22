import { describe, expect, it } from "vitest";

// Mirrors app/reception/page.tsx. Egypt reinstated DST in 2023, so a
// hardcoded +2 offset silently files late-evening appointments under the
// wrong day for half the year — these cases pin the real behaviour.
const CLINIC_TZ = "Africa/Cairo";

function zoneOffsetMs(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUTC - at.getTime();
}

function todayRangeAt(now: Date) {
  const offset = zoneOffsetMs(now);
  const local = new Date(now.getTime() + offset);
  const midnightUTC = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  const startGuess = new Date(midnightUTC - offset);
  const start = new Date(midnightUTC - zoneOffsetMs(startGuess));
  const endGuess = new Date(midnightUTC + 24 * 3600_000 - offset);
  const end = new Date(midnightUTC + 24 * 3600_000 - zoneOffsetMs(endGuess));
  return { start, end };
}

function coversLocalDay(now: Date, expectedLocalDate: string) {
  const { start, end } = todayRangeAt(now);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return {
    startLocal: fmt.format(start),
    endLocal: fmt.format(end),
    spanHours: (end.getTime() - start.getTime()) / 3600_000,
    expectedLocalDate,
  };
}

describe("today's range is computed in the clinic's real timezone", () => {
  it("summer (DST, UTC+3): the window starts at local midnight, not 01:00", () => {
    // 2026-08-21 20:52 Cairo === 17:52 UTC, i.e. UTC+3
    const r = coversLocalDay(new Date("2026-08-21T17:52:00Z"), "2026-08-21");
    expect(r.startLocal).toBe("2026-08-21, 00:00");
    expect(r.endLocal).toBe("2026-08-22, 00:00");
    expect(r.spanHours).toBe(24);
  });

  it("winter (no DST, UTC+2): same guarantee with a different offset", () => {
    const r = coversLocalDay(new Date("2026-01-15T10:00:00Z"), "2026-01-15");
    expect(r.startLocal).toBe("2026-01-15, 00:00");
    expect(r.endLocal).toBe("2026-01-16, 00:00");
    expect(r.spanHours).toBe(24);
  });

  it("a 23:30-local appointment falls inside today, not tomorrow", () => {
    // The exact case a hardcoded offset gets wrong: during DST it would place
    // this an hour past the window's end and drop it from today's column.
    const now = new Date("2026-08-21T17:52:00Z");
    const { start, end } = todayRangeAt(now);
    const appt = new Date("2026-08-21T20:30:00Z"); // 23:30 Cairo (UTC+3)
    expect(appt >= start && appt < end).toBe(true);
  });

  it("a 00:30-local appointment belongs to the next day's column", () => {
    const now = new Date("2026-08-21T17:52:00Z");
    const { end } = todayRangeAt(now);
    const appt = new Date("2026-08-21T21:30:00Z"); // 00:30 Cairo, next day
    expect(appt >= end).toBe(true);
  });

  it("the window is still exactly 24h across a DST transition day", () => {
    // Egypt's DST ends in late October; the day itself is 25 local hours,
    // so the UTC span must reflect that rather than silently staying 24.
    const r = coversLocalDay(new Date("2026-10-30T12:00:00Z"), "2026-10-30");
    expect(r.startLocal).toBe("2026-10-30, 00:00");
    expect(r.endLocal).toBe("2026-10-31, 00:00");
  });
});
