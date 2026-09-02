// The money-truth ledger.
//
// Competitors in this category recognise revenue when cash arrives. That is
// wrong for a physiotherapy clinic and it is the single thing none of them
// gets right: a patient pays 2,000 for ten sessions and has had three, so the
// clinic has *earned* 600 and is *holding* 1,400 that it still owes in
// treatment. Booking the whole 2,000 as revenue makes a good month look great
// and a bad month invisible, and it hides the liability entirely.
//
// Three distinct numbers, and conflating any two of them is how an owner ends
// up believing they can afford something they cannot:
//
//   earned      — treatment actually delivered, at the price it was sold for
//   deferred    — cash held for treatment not yet delivered (a LIABILITY)
//   receivable  — treatment delivered that nobody has paid for (an ASSET)
//
// Every function here is pure so the arithmetic can be tested without a
// database. That is deliberate: an untested SQL view computing money is worse
// than a tested function, and this is the arithmetic an owner will argue with.

export type PackageInput = {
  id: string;
  price: number;
  sessionsTotal: number;
  sessionsUsed: number;
  /** payments against this package, net of refunds */
  collected: number;
};

export type PlainSessionInput = {
  id: string;
  /** the agreed price of this single session */
  price: number;
  /** true once the session has actually been delivered */
  attended: boolean;
  /** payments linked to this specific appointment, net of refunds */
  collected: number;
};

export type Ledger = {
  earned: number;
  deferred: number;
  receivable: number;
  /**
   * Cash taken beyond what this package or session was owed. It is the
   * patient's credit and therefore a liability, and it used to vanish: it
   * stayed inside `collected` but appeared in neither `deferred` nor
   * `receivable`, so earned + deferred + receivable quietly stopped
   * reconciling with cash and the owner believed the excess was theirs.
   */
  credit: number;
};

const ZERO: Ledger = { earned: 0, deferred: 0, receivable: 0, credit: 0 };

// Money is numeric(12,2) in Postgres. Rounding at every step keeps the
// components summing to the total instead of drifting by fractions of a
// piastre across a few hundred rows.
function money(n: number) {
  return Math.round(n * 100) / 100;
}

export function packageLedger(p: PackageInput): Ledger {
  if (p.sessionsTotal <= 0) return ZERO;

  const used = Math.min(Math.max(p.sessionsUsed, 0), p.sessionsTotal);
  const perSession = p.price / p.sessionsTotal;
  const earned = money(perSession * used);

  // Cash beyond the package price is not deferred *against this package* —
  // the package cannot owe more treatment than it sold. It is reported
  // separately as credit rather than dropped.
  const collected = Math.max(p.collected, 0);
  const appliedToPackage = Math.min(collected, p.price);

  return {
    earned,
    deferred: money(Math.max(0, appliedToPackage - earned)),
    receivable: money(Math.max(0, earned - appliedToPackage)),
    credit: money(Math.max(0, collected - p.price)),
  };
}

// A single session paid for in advance is deferred until it is delivered; a
// session delivered and unpaid is a receivable. Both happen at a front desk.
export function plainSessionLedger(s: PlainSessionInput): Ledger {
  const collected = Math.max(0, s.collected);
  if (!s.attended) {
    return { earned: 0, deferred: money(collected), receivable: 0, credit: 0 };
  }
  // A delivered session that took cash has earned that cash, even if its
  // price was never recorded. Falling back to `price` alone booked walk-in
  // takings as a liability that could never be earned — the treatment was
  // given, so there is nothing left owed in service.
  const earned = money(s.price > 0 ? s.price : collected);
  return {
    earned,
    // A delivered session cannot owe more treatment, so anything over its
    // price is credit rather than a deferral.
    deferred: 0,
    receivable: money(Math.max(0, earned - collected)),
    credit: money(Math.max(0, collected - earned)),
  };
}

export function sumLedgers(ledgers: Ledger[]): Ledger {
  return ledgers.reduce<Ledger>(
    (acc, l) => ({
      earned: money(acc.earned + l.earned),
      deferred: money(acc.deferred + l.deferred),
      receivable: money(acc.receivable + l.receivable),
      credit: money(acc.credit + l.credit),
    }),
    ZERO
  );
}

export type ClinicLedger = Ledger & {
  /** cash that actually came in, net of refunds — the bank's view */
  collected: number;
  /**
   * How much of the money on hand is not yet the clinic's to spend.
   * Presented as a share because the absolute number means nothing without
   * knowing the size of the clinic.
   */
  deferredShare: number;
  packages: (Ledger & { id: string; sessionsLeft: number })[];
  /**
   * Whether the three components account for every piastre collected. If this
   * is false the ledger has lost money somewhere and the screen should not be
   * trusted — which is exactly what an owner needs to know.
   */
  reconciles: boolean;
};

export function clinicLedger(input: {
  packages: PackageInput[];
  plainSessions: PlainSessionInput[];
  /**
   * Cash taken against neither a package nor a single session — a patient
   * paying down an outstanding balance, or a row entered before payments
   * carried an appointment_id. The schema permits it (a payment may name at
   * most one thing, not at least one), so the ledger has to account for it.
   *
   * It used to be silently dropped: the screen simply reported less cash than
   * the drawer held, which is the one number an owner will check by hand. It
   * is unattributed, so it cannot be earned — it is credit sitting on the
   * clinic's books until someone links it to treatment.
   */
  unlinkedCollected?: number;
}): ClinicLedger {
  const packageLedgers = input.packages.map((p) => ({
    id: p.id,
    sessionsLeft: Math.max(0, p.sessionsTotal - p.sessionsUsed),
    ...packageLedger(p),
  }));
  const sessionLedgers = input.plainSessions.map(plainSessionLedger);

  const unlinked = money(Math.max(0, input.unlinkedCollected ?? 0));

  const total = sumLedgers([
    ...packageLedgers.map(({ earned, deferred, receivable, credit }) => ({
      earned,
      deferred,
      receivable,
      credit,
    })),
    ...sessionLedgers,
    { earned: 0, deferred: 0, receivable: 0, credit: unlinked },
  ]);

  const collected = money(
    input.packages.reduce((s, p) => s + Math.max(0, p.collected), 0) +
      input.plainSessions.reduce((s, x) => s + Math.max(0, x.collected), 0) +
      unlinked
  );

  // The identity that makes this screen trustworthy:
  //
  //     collected = (earned − receivable) + deferred + credit
  //
  // `earned` is the value of treatment delivered, which is not the same as
  // cash: a session given and never paid for is earned *and* receivable, and
  // no money arrived. Subtracting the receivable leaves the part of earned
  // revenue that was actually collected. An earlier version of this check
  // omitted that term and failed on the first unpaid session.
  const accountedFor = money(
    total.earned - total.receivable + total.deferred + total.credit
  );
  const reconciles = Math.abs(accountedFor - collected) < 0.02;

  return {
    ...total,
    collected,
    reconciles,
    deferredShare: collected > 0 ? total.deferred / collected : 0,
    // Biggest liability first: that is the order an owner wants to see it in,
    // because those are the patients whose treatment is owed.
    packages: packageLedgers
      .filter((p) => p.deferred > 0 || p.receivable > 0)
      .sort((a, b) => b.deferred - a.deferred),
  };
}
