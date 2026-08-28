import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/strings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Mocked so these tests can drive the clinic timezone and prove it reaches the
// booking maths. `server-only` itself is aliased in vitest.config.mts.
let clinicTimezone = "Africa/Cairo";
vi.mock("@/lib/clinic-context", () => ({
  loadClinicContext: async () => ({
    ok: true,
    ctx: { clinicId: "c1", timezone: clinicTimezone },
  }),
}));

type Recorded = { table: string; op: string; payload?: unknown };

// Records what reaches Supabase without a live database, so the assertions
// are about the SQL we would run rather than about the mock.
function makeFake(opts: {
  insertErrors?: (Record<string, unknown> | null)[];
  existing?: { during: string; status: string; patients: { name: string } | null }[];
} = {}) {
  const calls: Recorded[] = [];
  let insertIndex = 0;

  function api(table: string) {
    const terminal = {
      data: opts.existing ?? [],
      error: null as unknown,
    };
    const chain: Record<string, unknown> = {
      then: (resolve: (v: typeof terminal) => void) => resolve(terminal),
      insert(payload: unknown) {
        calls.push({ table, op: "insert", payload });
        const err = opts.insertErrors?.[insertIndex] ?? null;
        insertIndex++;
        return Promise.resolve({ error: err });
      },
      update(payload: unknown) {
        calls.push({ table, op: "update", payload });
        return chain;
      },
      select() {
        return chain;
      },
      // Returns the chain rather than a promise: the chain is itself
      // awaitable via `then`, so both `.eq().neq().overlaps()` and a bare
      // `await ...update().eq()` work off the same object.
      eq() {
        return chain;
      },
      neq() {
        return chain;
      },
      overlaps(_col: string, range: string) {
        calls.push({ table, op: "overlaps", payload: range });
        return chain;
      },
      ilike() {
        return chain;
      },
      in() {
        return chain;
      },
      // Defaults to a package with plenty of credit, so the tests that care
      // about pricing and grouping are not also asserting the credit guard.
      maybeSingle: async () => ({
        data: { sessions_total: 100, sessions_used: 0 },
        error: null,
      }),
      limit() {
        return chain;
      },
      order() {
        return chain;
      },
    };
    return chain;
  }

  return {
    calls,
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-0000-0000-000000000009" } },
        error: null,
      }),
    },
    from: (table: string) => api(table),
  };
}

let fake: ReturnType<typeof makeFake>;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));

const BASE = {
  clinicId: "c1",
  patientId: "p1",
  therapistId: "th1",
  dateISO: "2026-08-24",
  time: "10:00",
  durationMinutes: 45,
};

describe("a session covered by a package is never charged again", () => {
  beforeEach(() => {
    fake = makeFake();
  });

  it("forces price to 0 when a package is attached, whatever the client sent", async () => {
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, packageId: "pkg1", price: 500 });

    const row = fake.calls.find((c) => c.op === "insert")!.payload as {
      price: number;
      package_id: string;
    };
    expect(row.price).toBe(0);
    expect(row.package_id).toBe("pkg1");
  });

  it("keeps the price for a session with no package", async () => {
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, price: 350 });

    const row = fake.calls.find((c) => c.op === "insert")!.payload as {
      price: number;
      package_id: string | null;
    };
    expect(row.price).toBe(350);
    expect(row.package_id).toBeNull();
  });

  it("never writes a negative price", async () => {
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, price: -100 });
    const row = fake.calls.find((c) => c.op === "insert")!.payload as {
      price: number;
    };
    expect(row.price).toBe(0);
  });
});

describe("a plan of care books one row per session", () => {
  beforeEach(() => {
    fake = makeFake();
  });

  it("inserts each session separately so one clash cannot lose the rest", async () => {
    const { bookSessions } = await import("@/app/schedule/actions");
    const out = await bookSessions({
      ...BASE,
      weekdays: [0, 3],
      count: 12,
      price: 200,
    });

    expect(fake.calls.filter((c) => c.op === "insert")).toHaveLength(12);
    expect(out).toHaveLength(12);
    expect(out.every((o) => o.ok)).toBe(true);
  });

  it("reports the clashes by name and still books the rest", async () => {
    fake = makeFake({
      insertErrors: [null, { code: "23P01" }, null, { code: "23P01" }],
    });
    const { bookSessions } = await import("@/app/schedule/actions");
    const out = await bookSessions({
      ...BASE,
      weekdays: [0, 3],
      count: 4,
    });

    expect(out.filter((o) => o.ok)).toHaveLength(2);
    expect(out.filter((o) => !o.ok)).toHaveLength(2);
    for (const failed of out.filter((o) => !o.ok)) {
      expect(failed.reason).toBe(t("therapistBusy"));
    }
  });

  it("all sessions share the same package, so the package is the plan", async () => {
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, weekdays: [1], count: 6, packageId: "pkg9" });

    const inserts = fake.calls.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(6);
    for (const i of inserts) {
      expect((i.payload as { package_id: string }).package_id).toBe("pkg9");
    }
  });

  it("writes half-open ranges so back-to-back sessions do not collide", async () => {
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, weekdays: [1], count: 2 });
    for (const i of fake.calls.filter((c) => c.op === "insert")) {
      const during = (i.payload as { during: string }).during;
      expect(during.startsWith("[")).toBe(true);
      expect(during.endsWith(")")).toBe(true);
    }
  });
});

describe("bad input is refused before anything is written", () => {
  beforeEach(() => {
    fake = makeFake();
  });

  const cases: [string, Record<string, unknown>, string][] = [
    ["a date that does not exist", { dateISO: "2026-02-31" }, t("badDateOrTime")],
    ["a malformed time", { time: "25:99" }, t("badDateOrTime")],
    ["a zero-length session", { durationMinutes: 0 }, t("durationAboveZero")],
    ["an absurd session count", { count: 500, weekdays: [1] }, t("tooManySessions")],
    ["a repeat with no weekdays", { count: 6, weekdays: [] }, t("pickWeekdays")],
  ];

  for (const [label, override, message] of cases) {
    it(`rejects ${label}`, async () => {
      const { bookSessions } = await import("@/app/schedule/actions");
      await expect(bookSessions({ ...BASE, ...override })).rejects.toThrow(message);
      expect(fake.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    });
  }
});

describe("the dry run reports clashes before committing", () => {
  it("names the patient a proposed slot collides with", async () => {
    // 2026-08-24 10:00 Cairo (+3 in summer) is 07:00Z.
    fake = makeFake({
      existing: [
        {
          during: '["2026-08-24 07:30:00+00","2026-08-24 08:15:00+00")',
          status: "booked",
          patients: { name: "Yassin Abdullah" },
        },
      ],
    });
    const { previewSlots } = await import("@/app/schedule/actions");
    const preview = await previewSlots({
      therapistId: "th1",
      dateISO: "2026-08-24",
      time: "10:00",
      durationMinutes: 45,
    });

    expect(preview).toHaveLength(1);
    expect(preview[0].clashesWith).toBe("Yassin Abdullah");
  });

  it("treats a session starting exactly when another ends as free", async () => {
    // existing 06:15Z–07:00Z, proposed 07:00Z–07:45Z: adjacent, not overlapping
    fake = makeFake({
      existing: [
        {
          during: '["2026-08-24 06:15:00+00","2026-08-24 07:00:00+00")',
          status: "booked",
          patients: { name: "Mona Salem" },
        },
      ],
    });
    const { previewSlots } = await import("@/app/schedule/actions");
    const preview = await previewSlots({
      therapistId: "th1",
      dateISO: "2026-08-24",
      time: "10:00",
      durationMinutes: 45,
    });

    expect(preview[0].clashesWith).toBeNull();
  });

  it("writes nothing at all", async () => {
    fake = makeFake();
    const { previewSlots } = await import("@/app/schedule/actions");
    await previewSlots({
      therapistId: "th1",
      dateISO: "2026-08-24",
      time: "10:00",
      durationMinutes: 45,
      weekdays: [0, 3],
      count: 12,
    });
    expect(fake.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
});

describe("cancelling and moving", () => {
  beforeEach(() => {
    fake = makeFake();
  });

  // Deleting the row would erase the evidence a slot was held, and would skip
  // the consume_package trigger that hands a package credit back.
  it("cancels by status, never by delete", async () => {
    const { cancelAppointment } = await import("@/app/schedule/actions");
    await cancelAppointment("a1");
    const call = fake.calls.find((c) => c.op === "update")!;
    expect(call.table).toBe("appointments");
    expect(call.payload).toEqual({ status: "cancelled" });
  });

  it("a move rewrites only the time range", async () => {
    const { moveAppointment } = await import("@/app/schedule/actions");
    await moveAppointment({
      appointmentId: "a1",
      dateISO: "2026-08-25",
      time: "14:30",
      durationMinutes: 45,
    });
    const payload = fake.calls.find((c) => c.op === "update")!.payload as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload)).toEqual(["during"]);
  });

  it("a move onto a taken slot surfaces the database's refusal", async () => {
    // moveAppointment goes through .update().eq(); make that eq report the
    // exclusion violation the constraint would raise.
    const failing = makeFake();
    failing.from = (table: string) =>
      ({
        update() {
          return {
            eq: async () => ({ error: { code: "23P01" } }),
          };
        },
        select() {
          return this;
        },
      }) as never;
    fake = failing;

    const { moveAppointment } = await import("@/app/schedule/actions");
    await expect(
      moveAppointment({
        appointmentId: "a1",
        dateISO: "2026-08-25",
        time: "14:30",
        durationMinutes: 45,
      })
    ).rejects.toThrow(t("therapistBusy"));
  });
});

// F5: a walk-in with no price is invisible to leaking_sessions, which filters
// on price > 0 — and the cash walk-in is the commonest transaction in an
// Egyptian clinic. The price has to reach the row.
describe("a walk-in carries a price", () => {
  beforeEach(() => {
    fake = makeFake();
  });

  it("writes the price reception agreed at the desk", async () => {
    const { addWalkIn } = await import("@/app/reception/actions");
    await addWalkIn({
      clinicId: "c1",
      therapistId: "th1",
      patientId: "p1",
      durationMinutes: 45,
      price: 350,
    });
    const row = fake.calls.find(
      (c) => c.table === "appointments" && c.op === "insert"
    )!.payload as { price: number };
    expect(row.price).toBe(350);
  });

  it("prices a packaged walk-in at zero, whatever the client sent", async () => {
    const { addWalkIn } = await import("@/app/reception/actions");
    await addWalkIn({
      clinicId: "c1",
      therapistId: "th1",
      patientId: "p1",
      durationMinutes: 45,
      packageId: "pkg1",
      price: 500,
    });
    const row = fake.calls.find(
      (c) => c.table === "appointments" && c.op === "insert"
    )!.payload as { price: number };
    expect(row.price).toBe(0);
  });

  it("never writes a negative price", async () => {
    const { addWalkIn } = await import("@/app/reception/actions");
    await addWalkIn({
      clinicId: "c1",
      therapistId: "th1",
      patientId: "p1",
      durationMinutes: 45,
      price: -50,
    });
    const row = fake.calls.find(
      (c) => c.table === "appointments" && c.op === "insert"
    )!.payload as { price: number };
    expect(row.price).toBe(0);
  });
});


// The timezone has to reach the computed instant, not just be read. A Riyadh
// clinic booking 10:00 must store 07:00Z in January, where Cairo stores 08:00Z.
describe("the clinic's timezone reaches the booked instant", () => {
  beforeEach(() => {
    fake = makeFake();
  });

  it("books a Cairo clinic at Cairo wall-clock", async () => {
    clinicTimezone = "Africa/Cairo";
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, dateISO: "2026-01-15", time: "10:00" });
    const during = (
      fake.calls.find((c) => c.op === "insert")!.payload as { during: string }
    ).during;
    expect(during.startsWith("[2026-01-15T08:00")).toBe(true);
  });

  it("books a Riyadh clinic an hour earlier in UTC for the same wall-clock", async () => {
    clinicTimezone = "Asia/Riyadh";
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, dateISO: "2026-01-15", time: "10:00" });
    const during = (
      fake.calls.find((c) => c.op === "insert")!.payload as { during: string }
    ).during;
    expect(during.startsWith("[2026-01-15T07:00")).toBe(true);
    clinicTimezone = "Africa/Cairo";
  });
});

// F9: booking more sessions than a package has credit for used to succeed, and
// fail later at the front desk when attendance number 11 hit the packages
// check constraint and surfaced a raw Postgres string.
describe("a plan of care cannot outbook its package", () => {
  function withPackage(total: number, used: number, alreadyBooked: number) {
    const f = makeFake();
    // maybeSingle answers the package lookup; the count answers the
    // already-booked lookup.
    const original = f.from;
    f.from = (table: string) => {
      const chain = original(table) as Record<string, unknown>;
      chain.maybeSingle = async () => ({
        data: { sessions_total: total, sessions_used: used },
        error: null,
      });
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: alreadyBooked });
      return chain;
    };
    return f;
  }

  it("refuses twelve sessions on a package with ten", async () => {
    fake = withPackage(10, 0, 0);
    const { bookSessions } = await import("@/app/schedule/actions");
    await expect(
      bookSessions({ ...BASE, packageId: "pkg1", weekdays: [0, 3], count: 12 })
    ).rejects.toThrow(t("packageOutOfCredit", { left: 10, asked: 12 }));
    expect(fake.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("counts sessions already booked against the package", async () => {
    // ten total, four already booked, so six left — asking for eight fails.
    fake = withPackage(10, 0, 4);
    const { bookSessions } = await import("@/app/schedule/actions");
    await expect(
      bookSessions({ ...BASE, packageId: "pkg1", weekdays: [1], count: 8 })
    ).rejects.toThrow(t("packageOutOfCredit", { left: 6, asked: 8 }));
  });

  it("says the package is finished rather than quoting zero", async () => {
    fake = withPackage(10, 10, 10);
    const { bookSessions } = await import("@/app/schedule/actions");
    await expect(
      bookSessions({ ...BASE, packageId: "pkg1" })
    ).rejects.toThrow(t("packageExhausted"));
  });

  it("allows a plan that exactly fills the remaining credit", async () => {
    fake = withPackage(10, 4, 4);
    const { bookSessions } = await import("@/app/schedule/actions");
    const out = await bookSessions({
      ...BASE,
      packageId: "pkg1",
      weekdays: [0, 3],
      count: 6,
    });
    expect(out).toHaveLength(6);
    expect(out.every((o) => o.ok)).toBe(true);
  });

  it("does not check credit for a session with no package", async () => {
    fake = makeFake();
    const { bookSessions } = await import("@/app/schedule/actions");
    await bookSessions({ ...BASE, weekdays: [1], count: 30, price: 200 });
    expect(fake.calls.filter((c) => c.op === "insert")).toHaveLength(30);
  });
});

describe("attendance explains an exhausted package in words", () => {
  it("maps the packages check constraint to a sentence", async () => {
    const failing = makeFake();
    failing.from = () =>
      ({
        update() {
          return {
            eq: async () => ({
              error: { code: "23514", message: 'new row violates check constraint' },
            }),
          };
        },
      }) as never;
    fake = failing;

    const { markAttended } = await import("@/app/reception/actions");
    await expect(markAttended("a1")).rejects.toThrow(t("packageExhausted"));
  });
});
