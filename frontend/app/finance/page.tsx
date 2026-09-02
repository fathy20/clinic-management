import Link from "next/link";
import { Arc } from "@/components/ui/Arc";
import { ContextGate } from "@/components/ui/ContextGate";
import { Money } from "@/components/ui/Money";
import { NavBar } from "@/components/ui/NavBar";
import { loadClinicContext } from "@/lib/clinic-context";
import { rangeStart } from "@/lib/clinic-time";
import { canSeeMoney } from "@/lib/roles";
import { clinicLedger, type PackageInput, type PlainSessionInput } from "@/lib/revenue";
import { LOCALE, t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { ExportPanel } from "./ExportPanel";

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Cairo",
});

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : DATE.format(d);
}

export default async function FinancePage() {
  const result = await loadClinicContext();
  if (!result.ok) return <ContextGate result={result} />;
  const { clinicId, clinicName, currency, role, userName } = result.ctx;

  // RLS would return empty tables for a therapist, which renders as a page of
  // zeroes and reads like a bug. Refusing outright is the honest answer.
  if (!canSeeMoney(role)) {
    return (
      <>
        <NavBar
          clinicName={clinicName}
          userName={userName}
          role={role}
          active="reception"
        />
        <main className="shell">
          <p className="empty" style={{ marginTop: 48 }}>
            {t("moneyForbidden")}
          </p>
        </main>
      </>
    );
  }

  const supabase = await createClient();

  const [{ data: leaks }, { data: pkgs }, { data: appts }, { data: pays }, { data: refunds }] =
    await Promise.all([
      supabase
        .from("leaking_sessions")
        .select("appointment_id, patient_id, name, session_date, amount_owed")
        .eq("clinic_id", clinicId)
        .order("session_date", { ascending: true }),
      supabase
        .from("packages")
        .select("id, patient_id, price, sessions_total, sessions_used")
        .eq("clinic_id", clinicId),
      supabase
        .from("appointments")
        .select("id, during, status, price, package_id")
        .eq("clinic_id", clinicId)
        .is("package_id", null),
      supabase
        .from("payments")
        .select("id, amount, package_id, appointment_id")
        .eq("clinic_id", clinicId),
      supabase.from("refunds").select("payment_id, amount").eq("clinic_id", clinicId),
    ]);

  // Refunds net off the payment they reverse, so a refunded payment stops
  // counting as collected rather than lingering as phantom cash.
  const refundedByPayment = new Map<string, number>();
  for (const r of refunds ?? []) {
    refundedByPayment.set(
      r.payment_id,
      (refundedByPayment.get(r.payment_id) ?? 0) + Number(r.amount)
    );
  }
  const netOf = (paymentId: string, amount: number) =>
    Math.max(0, amount - (refundedByPayment.get(paymentId) ?? 0));

  const collectedByPackage = new Map<string, number>();
  const collectedByAppointment = new Map<string, number>();
  // Cash that names neither a package nor a session. A payment may name at
  // most one thing, not at least one, so this bucket is legal — and it used to
  // fall through both branches below and disappear from the collected total.
  let unlinkedCollected = 0;
  for (const p of pays ?? []) {
    const net = netOf(p.id, Number(p.amount));
    if (p.package_id) {
      collectedByPackage.set(
        p.package_id,
        (collectedByPackage.get(p.package_id) ?? 0) + net
      );
    } else if (p.appointment_id) {
      collectedByAppointment.set(
        p.appointment_id,
        (collectedByAppointment.get(p.appointment_id) ?? 0) + net
      );
    } else {
      unlinkedCollected += net;
    }
  }

  const packageInputs: PackageInput[] = (pkgs ?? []).map((k) => ({
    id: k.id,
    price: Number(k.price),
    sessionsTotal: k.sessions_total,
    sessionsUsed: k.sessions_used,
    collected: collectedByPackage.get(k.id) ?? 0,
  }));

  const sessionInputs: PlainSessionInput[] = (appts ?? [])
    .filter((a) => a.status !== "cancelled" && a.status !== "no_show")
    .map((a) => ({
      id: a.id,
      price: Number(a.price),
      attended: a.status === "attended",
      collected: collectedByAppointment.get(a.id) ?? 0,
    }));

  const ledger = clinicLedger({
    packages: packageInputs,
    plainSessions: sessionInputs,
    unlinkedCollected,
  });

  const leakRows = leaks ?? [];
  const leakTotal = leakRows.reduce((s, l) => s + Number(l.amount_owed), 0);

  const pkgById = new Map((pkgs ?? []).map((k) => [k.id, k]));

  return (
    <>
      <NavBar
        clinicName={clinicName}
        userName={userName}
        role={role}
        active="finance"
        showMoney
      />
      <main className="shell">
        {/* The money leak is the headline, not a report in a menu. It is the
            product's argument for its own subscription, so it opens the page
            before any summary of anything else. */}
        <section className="leakhero">
          <div className="leakhero-head">
            <div>
              <p className="eyebrow">{t("leakTotal")}</p>
              <div className="leakhero-total">
                <Money amount={leakTotal} currency={currency} size="lg" withLabel />
              </div>
              <p className="leakhero-sub">
                {leakRows.length === 0
                  ? t("leakNone")
                  : t("leakHeadline", { n: leakRows.length })}
              </p>
            </div>
            {leakRows.length > 0 && (
              <Arc
                value={leakRows.length}
                max={Math.max(leakRows.length, sessionInputs.length || 1)}
                size="lg"
                tone="brick"
                label={String(leakRows.length)}
              />
            )}
          </div>

          {leakRows.length > 0 && (
            <div className="leaklist">
              {leakRows.map((l) => (
                <Link
                  key={l.appointment_id}
                  href={`/patients/${l.patient_id}`}
                  className="leakrow"
                >
                  <span className="leakrow-name">{l.name}</span>
                  <span className="leakrow-when">{fmt(l.session_date)}</span>
                  <Money amount={Number(l.amount_owed)} currency={currency} />
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Earned / deferred / receivable, which no competitor separates. */}
        <section className="strip">
          <div className="cell">
            <div className="label">{t("earned")}</div>
            <div className="value">
              <Money amount={ledger.earned} currency={currency} size="lg" />
            </div>
            <div className="foot">{t("earnedHint")}</div>
          </div>
          <div className="cell">
            <div className="label">{t("collectedCash")}</div>
            <div className="value">
              <Money amount={ledger.collected} currency={currency} size="lg" />
            </div>
            <div className="foot">{t("collectedHint")}</div>
          </div>
          <div className="cell">
            <div className="label">{t("deferred")}</div>
            <div className="value">
              <Money amount={ledger.deferred} currency={currency} size="lg" />
            </div>
            <div className="foot">{t("deferredHint")}</div>
          </div>
          <div className="cell">
            <div className="label">{t("receivable")}</div>
            <div className="value">
              <Money amount={ledger.receivable} currency={currency} size="lg" />
            </div>
            <div className="foot">{t("receivableHint")}</div>
          </div>
        </section>

        {ledger.deferred > 0 && (
          <p className="note-inline" style={{ marginTop: 0, marginBottom: 22 }}>
            {t("ofCashIsNotYours", {
              pct: Math.round(ledger.deferredShare * 100),
            })}
          </p>
        )}

        <div className="cols">
          <div>
            <section className="band">
              <div className="bandhead">
                <h2>{t("liabilityHeading")}</h2>
                <span className="count">{ledger.packages.length}</span>
              </div>
              <div className="rows">
                {ledger.packages.length === 0 && (
                  <p className="empty">{t("liabilityNone")}</p>
                )}
                {ledger.packages.map((p) => {
                  const src = pkgById.get(p.id);
                  return (
                    <article className="row" key={p.id}>
                      <Arc
                        value={src ? src.sessions_used : 0}
                        max={src ? src.sessions_total : 1}
                        size="sm"
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="pmeta">
                          <span>{t("sessionsLeftShort", { n: p.sessionsLeft })}</span>
                          <span className="dot" />
                          <span>
                            {t("earned")} <Money amount={p.earned} currency={currency} />
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                        }}
                      >
                        {p.deferred > 0 && (
                          <Money amount={p.deferred} currency={currency} />
                        )}
                        {p.receivable > 0 && (
                          <span className="hint" style={{ color: "var(--brick)" }}>
                            {t("receivable")}{" "}
                            <Money amount={p.receivable} currency={currency} />
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>

          <ExportPanel clinicId={clinicId} />
        </div>
      </main>
    </>
  );
}
