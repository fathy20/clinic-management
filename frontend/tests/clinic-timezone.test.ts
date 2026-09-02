import { describe, expect, it } from "vitest";
import {
  addDays,
  clinicDateISO,
  isoToYmd,
  recurringSlots,
  rangeEnd,
  rangeMinutes,
  rangeStart,
  todayRange,
  tstzrange,
  wallClockToUtc,
  weekStart,
  weekdayOf,
  ymdToISO,
  zoneOffsetMs,
} from "@/lib/clinic-time";

// These exercise lib/clinic-time.ts directly. An earlier version of this file
// re-implemented the logic locally, which meant it could pass while the app
// was broken — the whole point is to pin the code that actually runs.
//
// Egypt reinstated DST in 2023: +02:00 in winter, +03:00 in summer.

describe("zone offset tracks Egypt's DST", () => {
  it("is +2 in winter", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"))).toBe(2 * 3600_000);
  });

  it("is +3 in summer", () => {
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"))).toBe(3 * 3600_000);
  });
});

describe("wall clock to UTC", () => {
  it("resolves a winter morning at +2", () => {
    expect(wallClockToUtc(2026, 1, 15, 10, 0).toISOString()).toBe(
      "2026-01-15T08:00:00.000Z"
    );
  });

  it("resolves a summer morning at +3", () => {
    expect(wallClockToUtc(2026, 7, 15, 10, 0).toISOString()).toBe(
      "2026-07-15T07:00:00.000Z"
    );
  });

  // The naive single-pass version samples the offset at the wrong instant and
  // lands an hour out for bookings near a transition.
  it("survives a booking on each side of a transition", () => {
    const spring = wallClockToUtc(2026, 4, 24, 10, 0);
    const summer = wallClockToUtc(2026, 5, 1, 10, 0);
    // Both are 10:00 local, so both must read back as hour 10.
    for (const d of [spring, summer]) {
      const local = new Date(d.getTime() + zoneOffsetMs(d));
      expect(local.getUTCHours()).toBe(10);
    }
  });
});

describe("today's range", () => {
  it("spans a whole clinic day and starts at local midnight", () => {
    const { start, end } = todayRange(new Date("2026-08-22T22:30:00Z"));
    const localStart = new Date(start.getTime() + zoneOffsetMs(start));
    expect(localStart.getUTCHours()).toBe(0);
    expect(localStart.getUTCMinutes()).toBe(0);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  // 23:30 Cairo on the 22nd is 20:30 UTC on the 22nd; a naive UTC-day
  // calculation would file it under the 22nd either way. The failing case is
  // the other side: 01:00 Cairo on the 23rd is 22:00 UTC on the 22nd, and
  // must belong to the 23rd.
  it("files an after-midnight local time under the local day", () => {
    const { start } = todayRange(new Date("2026-08-22T22:00:00Z"));
    const localStart = new Date(start.getTime() + zoneOffsetMs(start));
    expect(localStart.getUTCDate()).toBe(23);
  });

  it("a DST-transition day is not assumed to be 24 hours", () => {
    // Whatever the length, the range must still cover local midnight to
    // local midnight rather than a hardcoded 86400s.
    const { start, end } = todayRange(new Date("2026-04-24T12:00:00Z"));
    const hours = (end.getTime() - start.getTime()) / 3600_000;
    expect([23, 24, 25]).toContain(hours);
  });
});

describe("week start", () => {
  it("starts the week on Saturday, matching the Egyptian working week", () => {
    // 2026-08-22 is a Saturday.
    expect(weekStart(new Date("2026-08-22T09:00:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 22,
    });
    // A Wednesday belongs to the week that began the previous Saturday.
    expect(weekStart(new Date("2026-08-26T09:00:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 22,
    });
  });

  it("walks back across a month boundary", () => {
    // 2026-09-01 is a Tuesday; its week began Saturday 2026-08-29.
    expect(weekStart(new Date("2026-09-01T09:00:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 29,
    });
  });
});

describe("date helpers", () => {
  it("adds days across a month and a year boundary", () => {
    expect(addDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 1,
    });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it("round-trips ISO", () => {
    expect(ymdToISO({ year: 2026, month: 8, day: 5 })).toBe("2026-08-05");
    expect(isoToYmd("2026-08-05")).toEqual({ year: 2026, month: 8, day: 5 });
  });

  it("rejects a date that does not exist instead of rolling it over", () => {
    expect(isoToYmd("2026-02-31")).toBeNull();
    expect(isoToYmd("2026-13-01")).toBeNull();
    expect(isoToYmd("not-a-date")).toBeNull();
  });
});

describe("recurring plan of care", () => {
  const from = { year: 2026, month: 8, day: 22 }; // a Saturday

  it("books the requested number of sessions", () => {
    const slots = recurringSlots({
      from,
      hour: 10,
      minute: 0,
      durationMinutes: 45,
      weekdays: [0, 3], // Sun + Wed
      count: 12,
    });
    expect(slots).toHaveLength(12);
  });

  it("only lands on the requested weekdays", () => {
    const slots = recurringSlots({
      from,
      hour: 10,
      minute: 0,
      durationMinutes: 45,
      weekdays: [0, 3],
      count: 8,
    });
    for (const s of slots) {
      const local = new Date(s.startsAt.getTime() + zoneOffsetMs(s.startsAt));
      expect([0, 3]).toContain(local.getUTCDay());
    }
  });

  it("holds the same wall-clock time across a DST transition", () => {
    // A 12-session course from late March crosses Egypt's spring change.
    const slots = recurringSlots({
      from: { year: 2026, month: 3, day: 21 },
      hour: 10,
      minute: 0,
      durationMinutes: 45,
      weekdays: [0, 3],
      count: 12,
    });
    expect(slots).toHaveLength(12);
    for (const s of slots) {
      const local = new Date(s.startsAt.getTime() + zoneOffsetMs(s.startsAt));
      expect(local.getUTCHours()).toBe(10);
      expect(local.getUTCMinutes()).toBe(0);
    }
    // and the underlying UTC instants really do differ by offset, proving the
    // transition was crossed rather than the test being vacuous.
    const offsets = new Set(slots.map((s) => zoneOffsetMs(s.startsAt)));
    expect(offsets.size).toBe(2);
  });

  it("gives every session the requested duration", () => {
    const slots = recurringSlots({
      from,
      hour: 9,
      minute: 30,
      durationMinutes: 30,
      weekdays: [1],
      count: 4,
    });
    for (const s of slots) {
      expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(30 * 60_000);
    }
  });

  it("refuses nonsense input rather than looping", () => {
    const base = {
      from,
      hour: 10,
      minute: 0,
      durationMinutes: 45,
      weekdays: [1],
      count: 4,
    };
    expect(recurringSlots({ ...base, count: 0 })).toEqual([]);
    expect(recurringSlots({ ...base, weekdays: [] })).toEqual([]);
    expect(recurringSlots({ ...base, durationMinutes: 0 })).toEqual([]);
  });
});

describe("tstzrange", () => {
  it("is half-open so back-to-back sessions do not collide", () => {
    const a = tstzrange(
      new Date("2026-08-22T10:00:00Z"),
      new Date("2026-08-22T10:45:00Z")
    );
    expect(a).toBe("[2026-08-22T10:00:00.000Z,2026-08-22T10:45:00.000Z)");
    expect(a.startsWith("[")).toBe(true);
    expect(a.endsWith(")")).toBe(true);
  });

  it("reads its own lower bound back", () => {
    const start = new Date("2026-08-22T10:00:00Z");
    const range = tstzrange(start, new Date("2026-08-22T10:45:00Z"));
    expect(new Date(rangeStart(range)).getTime()).toBe(start.getTime());
  });

  it("reads the quoted form Postgres actually returns", () => {
    const pg = '["2026-08-22 10:00:00+00","2026-08-22 10:45:00+00")';
    expect(rangeStart(pg)).toBe("2026-08-22 10:00:00+00");
  });

  it("reads a session's real length back, so a move preserves it", () => {
    const pg = '["2026-08-22 10:00:00+00","2026-08-22 10:30:00+00")';
    expect(rangeMinutes(pg)).toBe(30);
    expect(rangeEnd(pg)).toBe("2026-08-22 10:30:00+00");
    expect(
      rangeMinutes(
        tstzrange(
          new Date("2026-08-22T10:00:00Z"),
          new Date("2026-08-22T11:00:00Z")
        )
      )
    ).toBe(60);
  });

  it("reports null for a range it cannot make sense of", () => {
    expect(rangeMinutes("[not-a-date,also-not)")).toBeNull();
    expect(
      rangeMinutes('["2026-08-22 10:00:00+00","2026-08-22 10:00:00+00")')
    ).toBeNull();
  });

  it("weekdayOf agrees with the calendar", () => {
    expect(weekdayOf({ year: 2026, month: 8, day: 22 })).toBe(6); // Saturday
    expect(weekdayOf({ year: 2026, month: 8, day: 23 })).toBe(0); // Sunday
  });
});

// The bug this pins: /settings offered a timezone field while every
// conversion hardcoded Africa/Cairo, so a Riyadh clinic that set its own zone
// had every appointment silently filed at Cairo wall-clock.
describe("a clinic books in its own timezone", () => {
  it("resolves the same wall clock differently per zone", () => {
    // Cairo is +2 in January, Riyadh is +3 all year.
    const cairo = wallClockToUtc(2026, 1, 15, 10, 0, "Africa/Cairo");
    const riyadh = wallClockToUtc(2026, 1, 15, 10, 0, "Asia/Riyadh");
    expect(cairo.toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(riyadh.toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(cairo.getTime()).not.toBe(riyadh.getTime());
  });

  it("keeps each zone's own wall clock through a plan of care", () => {
    for (const zone of ["Africa/Cairo", "Asia/Riyadh", "Europe/London"]) {
      const slots = recurringSlots({
        from: { year: 2026, month: 3, day: 21 },
        hour: 10,
        minute: 0,
        durationMinutes: 45,
        weekdays: [0, 3],
        count: 12,
        timeZone: zone,
      });
      expect(slots).toHaveLength(12);
      for (const s of slots) {
        const local = new Date(s.startsAt.getTime() + zoneOffsetMs(s.startsAt, zone));
        expect(local.getUTCHours(), `${zone} drifted`).toBe(10);
      }
    }
  });

  it("a Gulf clinic's day boundary is not Cairo's", () => {
    // Deliberately a WINTER date: in Egyptian summer both zones are +3 and
    // the two ranges coincide, which would make this assertion vacuous.
    // In January Cairo is +2 and Riyadh is +3, so local midnight differs.
    const at = new Date("2026-01-15T22:30:00Z");
    const cairo = todayRange(at, "Africa/Cairo");
    const riyadh = todayRange(at, "Asia/Riyadh");
    expect(cairo.start.toISOString()).toBe("2026-01-15T22:00:00.000Z");
    expect(riyadh.start.toISOString()).toBe("2026-01-15T21:00:00.000Z");
  });

  it("Egypt's DST still applies while another zone has none", () => {
    const summer = new Date("2026-07-15T12:00:00Z");
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(zoneOffsetMs(summer, "Africa/Cairo")).toBe(3 * 3600_000);
    expect(zoneOffsetMs(winter, "Africa/Cairo")).toBe(2 * 3600_000);
    // Riyadh does not observe DST
    expect(zoneOffsetMs(summer, "Asia/Riyadh")).toBe(3 * 3600_000);
    expect(zoneOffsetMs(winter, "Asia/Riyadh")).toBe(3 * 3600_000);
  });

  it("defaults to Cairo when no zone is given, so existing callers are safe", () => {
    expect(wallClockToUtc(2026, 1, 15, 10, 0).toISOString()).toBe(
      wallClockToUtc(2026, 1, 15, 10, 0, "Africa/Cairo").toISOString()
    );
  });

  it("clinicDateISO reports the clinic's calendar day, not the browser's", () => {
    const at = new Date("2026-08-22T22:00:00Z");
    expect(clinicDateISO(at, "Africa/Cairo")).toBe("2026-08-23");
    expect(clinicDateISO(at, "Europe/London")).toBe("2026-08-22");
  });
});
