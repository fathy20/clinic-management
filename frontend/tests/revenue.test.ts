import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clinicLedger,
  packageLedger,
  plainSessionLedger,
  sumLedgers,
} from "@/lib/revenue";

// This is the arithmetic an owner will argue with, so it is pinned case by
// case rather than spot-checked. Every number below is worked by hand in the
// comment above it.

describe("a package recognises revenue as sessions are delivered", () => {
  it("holds most of the cash as a liability early in a course", () => {
    // 2,000 for 10 sessions = 200 each. Three delivered, paid in full.
    // earned 600, deferred 1,400, receivable 0.
    expect(
      packageLedger({
        id: "k",
        price: 2000,
        sessionsTotal: 10,
        sessionsUsed: 3,
        collected: 2000,
      })
    ).toEqual({ earned: 600, deferred: 1400, receivable: 0, credit: 0 });
  });

  it("holds nothing once the course is finished", () => {
    expect(
      packageLedger({
        id: "k",
        price: 2000,
        sessionsTotal: 10,
        sessionsUsed: 10,
        collected: 2000,
      })
    ).toEqual({ earned: 2000, deferred: 0, receivable: 0, credit: 0 });
  });

  it("recognises nothing before the first session", () => {
    expect(
      packageLedger({
        id: "k",
        price: 2000,
        sessionsTotal: 10,
        sessionsUsed: 0,
        collected: 2000,
      })
    ).toEqual({ earned: 0, deferred: 2000, receivable: 0, credit: 0 });
  });

  // The case Jane cannot represent at all: it requires a package to be paid
  // in full before it can be redeemed. Egyptian clinics take a deposit.
  it("handles a package paid in instalments and part-delivered", () => {
    // 2,000 / 10 sessions. Eight delivered = 1,600 earned. Only 500 paid.
    // Nothing is deferred; 1,100 is owed for treatment already given.
    expect(
      packageLedger({
        id: "k",
        price: 2000,
        sessionsTotal: 10,
        sessionsUsed: 8,
        collected: 500,
      })
    ).toEqual({ earned: 1600, deferred: 0, receivable: 1100, credit: 0 });
  });

  it("never reports a liability and a receivable on the same package", () => {
    for (const used of [0, 1, 5, 9, 10]) {
      for (const collected of [0, 250, 1000, 2000]) {
        const l = packageLedger({
          id: "k",
          price: 2000,
          sessionsTotal: 10,
          sessionsUsed: used,
          collected,
        });
        expect(
          l.deferred === 0 || l.receivable === 0,
          `used=${used} collected=${collected} gave both`
        ).toBe(true);
      }
    }
  });

  // The bug this pins: the excess used to vanish. It stayed inside
  // `collected` but appeared in neither deferred nor receivable, so the
  // components stopped adding up to the cash and the owner believed the extra
  // was theirs to spend.
  it("reports an overpayment as the patient's credit, not as its own liability", () => {
    // 2,500 paid on a 2,000 package, five of ten delivered.
    const l = packageLedger({
      id: "k",
      price: 2000,
      sessionsTotal: 10,
      sessionsUsed: 5,
      collected: 2500,
    });
    expect(l.earned).toBe(1000);
    expect(l.deferred).toBe(1000); // 2,000 applied − 1,000 earned
    expect(l.credit).toBe(500); // and the excess is named, not dropped
    // every piastre of the 2,500 is accounted for
    expect(l.earned + l.deferred + l.credit).toBe(2500);
  });

  it("survives a price that does not divide evenly", () => {
    // 1,000 over 3 sessions = 333.333… each. Two delivered.
    const l = packageLedger({
      id: "k",
      price: 1000,
      sessionsTotal: 3,
      sessionsUsed: 2,
      collected: 1000,
    });
    expect(l.earned).toBe(666.67);
    expect(l.deferred).toBe(333.33);
    // and the two still add back up to the cash held
    expect(l.earned + l.deferred).toBeCloseTo(1000, 2);
  });

  it("refuses to divide by zero sessions", () => {
    expect(
      packageLedger({
        id: "k",
        price: 500,
        sessionsTotal: 0,
        sessionsUsed: 0,
        collected: 500,
      })
    ).toEqual({ earned: 0, deferred: 0, receivable: 0, credit: 0 });
  });

  it("clamps a used count that exceeds the total", () => {
    // The DB has a check constraint for this, so it should be impossible —
    // but if it ever happens the ledger must not invent revenue.
    const l = packageLedger({
      id: "k",
      price: 2000,
      sessionsTotal: 10,
      sessionsUsed: 14,
      collected: 2000,
    });
    expect(l.earned).toBe(2000);
    expect(l.deferred).toBe(0);
  });
});

describe("a single session", () => {
  it("is a liability while it is only booked", () => {
    expect(
      plainSessionLedger({ id: "a", price: 350, attended: false, collected: 350 })
    ).toEqual({ earned: 0, deferred: 350, receivable: 0, credit: 0 });
  });

  it("is earned once delivered", () => {
    expect(
      plainSessionLedger({ id: "a", price: 350, attended: true, collected: 350 })
    ).toEqual({ earned: 350, deferred: 0, receivable: 0, credit: 0 });
  });

  // This is the money-leak case, and the reason leaking_sessions exists.
  it("is a receivable when delivered and unpaid", () => {
    expect(
      plainSessionLedger({ id: "a", price: 350, attended: true, collected: 0 })
    ).toEqual({ earned: 350, deferred: 0, receivable: 350, credit: 0 });
  });

  it("is partly a receivable when part-paid", () => {
    expect(
      plainSessionLedger({ id: "a", price: 350, attended: true, collected: 200 })
    ).toEqual({ earned: 350, deferred: 0, receivable: 150, credit: 0 });
  });

  // The bug this pins: a walk-in inserted with no price defaulted to 0, so a
  // delivered session that took cash was booked as a liability that could
  // never be earned. The treatment was given; the cash is earned.
  it("earns the cash on a delivered session whose price was never recorded", () => {
    expect(
      plainSessionLedger({ id: "a", price: 0, attended: true, collected: 350 })
    ).toEqual({ earned: 350, deferred: 0, receivable: 0, credit: 0 });
  });

  it("still holds cash on an unattended session with no price", () => {
    expect(
      plainSessionLedger({ id: "a", price: 0, attended: false, collected: 350 })
    ).toEqual({ earned: 0, deferred: 350, receivable: 0, credit: 0 });
  });

  it("a genuinely free session earns nothing", () => {
    expect(
      plainSessionLedger({ id: "a", price: 0, attended: true, collected: 0 })
    ).toEqual({ earned: 0, deferred: 0, receivable: 0, credit: 0 });
  });

  it("contributes nothing when neither delivered nor paid", () => {
    expect(
      plainSessionLedger({ id: "a", price: 350, attended: false, collected: 0 })
    ).toEqual({ earned: 0, deferred: 0, receivable: 0, credit: 0 });
  });
});

describe("the clinic-wide ledger", () => {
  const input = {
    packages: [
      // paid up, barely started: a big liability
      { id: "k1", price: 2000, sessionsTotal: 10, sessionsUsed: 2, collected: 2000 },
      // deposit only, mostly delivered: a receivable
      { id: "k2", price: 1000, sessionsTotal: 5, sessionsUsed: 4, collected: 300 },
      // finished and settled: contributes only earned revenue
      { id: "k3", price: 500, sessionsTotal: 5, sessionsUsed: 5, collected: 500 },
    ],
    plainSessions: [
      { id: "a1", price: 350, attended: true, collected: 350 },
      { id: "a2", price: 350, attended: true, collected: 0 },
      { id: "a3", price: 400, attended: false, collected: 400 },
    ],
  };

  it("adds the three numbers up correctly", () => {
    const l = clinicLedger(input);
    // earned:    k1 400 + k2 800 + k3 500 + a1 350 + a2 350          = 2400
    // deferred:  k1 1600 +                          a3 400           = 2000
    // receivable:          k2 500 +                 a2 350           =  850
    expect(l.earned).toBe(2400);
    expect(l.deferred).toBe(2000);
    expect(l.receivable).toBe(850);
  });

  it("reports cash collected separately from revenue earned", () => {
    const l = clinicLedger(input);
    // 2000 + 300 + 500 + 350 + 0 + 400 = 3550 in the bank
    expect(l.collected).toBe(3550);
    // and the point of the whole exercise: cash on hand is not revenue
    expect(l.collected).not.toBe(l.earned);
  });

  it("states what share of the cash is not the clinic's to spend", () => {
    const l = clinicLedger(input);
    expect(l.deferredShare).toBeCloseTo(2000 / 3550, 4);
  });

  it("lists the packages carrying a balance, biggest liability first", () => {
    const l = clinicLedger(input);
    // k3 is settled, so it drops out entirely
    expect(l.packages.map((p) => p.id)).toEqual(["k1", "k2"]);
    expect(l.packages[0].deferred).toBe(1600);
    expect(l.packages[0].sessionsLeft).toBe(8);
  });

  it("is all zeroes for a clinic with nothing on the books", () => {
    const l = clinicLedger({ packages: [], plainSessions: [] });
    expect(l).toMatchObject({
      earned: 0,
      deferred: 0,
      receivable: 0,
      collected: 0,
      deferredShare: 0,
    });
    expect(l.packages).toEqual([]);
  });
});

describe("rounding holds across many rows", () => {
  it("does not drift when a hundred awkward packages are summed", () => {
    // 100 x (1,000 over 3 sessions, one delivered) = 100 x 333.33 earned
    const packages = Array.from({ length: 100 }, (_, i) => ({
      id: `k${i}`,
      price: 1000,
      sessionsTotal: 3,
      sessionsUsed: 1,
      collected: 1000,
    }));
    const l = clinicLedger({ packages, plainSessions: [] });
    expect(l.earned).toBe(33333);
    expect(l.deferred).toBe(66667);
    // every piastre is accounted for: nothing vanished into floating point
    expect(l.earned + l.deferred).toBe(100000);
  });

  it("sumLedgers is exact on values with two decimal places", () => {
    const parts = Array.from({ length: 3 }, () => ({
      earned: 0.1,
      deferred: 0.2,
      receivable: 0.3,
      credit: 0.05,
    }));
    expect(sumLedgers(parts)).toEqual({
      earned: 0.3,
      deferred: 0.6,
      receivable: 0.9,
      credit: 0.15,
    });
  });
});

// The identity that makes the finance screen trustworthy:
//
//     collected = (earned − receivable) + deferred + credit
//
// The receivable term matters: treatment given and never paid for is earned
// revenue with no cash behind it. An earlier version of this suite asserted
// the identity without it and correctly failed on the first unpaid session.
describe("cash always reconciles against the ledger", () => {
  it("reconciles when nobody has overpaid", () => {
    const l = clinicLedger({
      packages: [
        { id: "k1", price: 2000, sessionsTotal: 10, sessionsUsed: 3, collected: 2000 },
      ],
      plainSessions: [{ id: "a1", price: 350, attended: true, collected: 350 }],
    });
    expect(l.earned - l.receivable + l.deferred + l.credit).toBe(l.collected);
    expect(l.reconciles).toBe(true);
  });

  it("still reconciles when a patient has overpaid", () => {
    const l = clinicLedger({
      packages: [
        // 500 more than the package was worth
        { id: "k1", price: 2000, sessionsTotal: 10, sessionsUsed: 2, collected: 2500 },
      ],
      plainSessions: [
        // 100 more than the session was worth
        { id: "a1", price: 350, attended: true, collected: 450 },
      ],
    });
    expect(l.credit).toBe(600);
    expect(l.earned - l.receivable + l.deferred + l.credit).toBe(l.collected);
    expect(l.reconciles).toBe(true);
  });

  it("reconciles when treatment was given and never paid for", () => {
    // A receivable is the opposite of cash, so it does not enter the identity.
    const l = clinicLedger({
      packages: [],
      plainSessions: [{ id: "a1", price: 350, attended: true, collected: 0 }],
    });
    expect(l.receivable).toBe(350);
    expect(l.collected).toBe(0);
    // earned 350, receivable 350 — the two cancel, and no cash arrived.
    expect(l.earned - l.receivable + l.deferred + l.credit).toBe(0);
    expect(l.reconciles).toBe(true);
  });

  it("reconciles across a hundred awkward rows", () => {
    const l = clinicLedger({
      packages: Array.from({ length: 100 }, (_, i) => ({
        id: `k${i}`,
        price: 1000,
        sessionsTotal: 3,
        sessionsUsed: 1,
        collected: 1100, // everyone overpaid by 100
      })),
      plainSessions: [],
    });
    expect(l.credit).toBe(10000);
    expect(l.earned - l.receivable + l.deferred + l.credit).toBe(l.collected);
    expect(l.reconciles).toBe(true);
  });

  it("an unattended session's prepayment is a deferral, never credit", () => {
    const l = clinicLedger({
      packages: [],
      plainSessions: [{ id: "a1", price: 350, attended: false, collected: 350 }],
    });
    expect(l.deferred).toBe(350);
    expect(l.credit).toBe(0);
  });
});

// F10b. A payment may name at most one thing, not at least one — the check
// constraint is `not (package_id is not null and appointment_id is not null)`.
// Cash with neither link is therefore legal and used to fall through both
// branches of the aggregator, so the screen reported less money than the
// drawer held.
describe("cash that names nothing is still cash", () => {
  it("counts an unlinked payment as collected", () => {
    const l = clinicLedger({
      packages: [],
      plainSessions: [],
      unlinkedCollected: 500,
    });
    expect(l.collected).toBe(500);
    expect(l.reconciles).toBe(true);
  });

  it("treats it as credit, never as earned revenue", () => {
    // Unattributed money cannot be revenue: no treatment has been tied to it.
    const l = clinicLedger({
      packages: [],
      plainSessions: [],
      unlinkedCollected: 500,
    });
    expect(l.earned).toBe(0);
    expect(l.deferred).toBe(0);
    expect(l.credit).toBe(500);
  });

  it("adds to, rather than replaces, linked cash", () => {
    const linked = clinicLedger({
      packages: [{ id: "k", price: 1000, sessionsTotal: 10, sessionsUsed: 4, collected: 1000 }],
      plainSessions: [],
    });
    const withExtra = clinicLedger({
      packages: [{ id: "k", price: 1000, sessionsTotal: 10, sessionsUsed: 4, collected: 1000 }],
      plainSessions: [],
      unlinkedCollected: 250,
    });
    expect(withExtra.collected).toBe(linked.collected + 250);
    expect(withExtra.earned).toBe(linked.earned);
    expect(withExtra.reconciles).toBe(true);
  });

  it("defaults to zero when omitted, so every existing caller is unchanged", () => {
    const a = clinicLedger({ packages: [], plainSessions: [], unlinkedCollected: 0 });
    const b = clinicLedger({ packages: [], plainSessions: [] });
    expect(a).toEqual(b);
  });

  it("ignores a negative total rather than inventing a refund", () => {
    const l = clinicLedger({ packages: [], plainSessions: [], unlinkedCollected: -80 });
    expect(l.collected).toBe(0);
    expect(l.reconciles).toBe(true);
  });
});

describe("the finance screen hands every payment to the ledger", () => {
  const PAGE = readFileSync(
    join(import.meta.dirname, "..", "app/finance/page.tsx"),
    "utf8"
  );

  it("has no branch a payment can fall out of", () => {
    // The bug was an `else if` with no final `else`: a payment matching
    // neither condition was read from the database and then dropped.
    expect(PAGE).toContain("unlinkedCollected");
    const loop = PAGE.slice(PAGE.indexOf("for (const p of pays"), PAGE.indexOf("const packageInputs"));
    expect(loop).toContain("} else {");
  });

  it("nets refunds off before any bucket, not after", () => {
    const loop = PAGE.slice(PAGE.indexOf("for (const p of pays"), PAGE.indexOf("const packageInputs"));
    expect(loop).toContain("netOf(p.id");
    expect(loop).not.toMatch(/\+ Number\(p\.amount\)/);
  });
});
