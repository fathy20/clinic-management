import Link from "next/link";
import { Arc } from "@/components/ui/Arc";
import { ContextGate } from "@/components/ui/ContextGate";
import { Chip } from "@/components/ui/Chip";
import { Money } from "@/components/ui/Money";
import { NavBar } from "@/components/ui/NavBar";
import { recordPhiAccess } from "@/lib/audit";
import { loadClinicContext } from "@/lib/clinic-context";
import { gated, notMigratedMessage } from "@/lib/migration-gate";
import { rangeStart } from "@/lib/clinic-time";
import { canSeeMoney } from "@/lib/roles";
import { LOCALE, t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { SellPackageButton } from "./SellPackageSheet";
import { ConsentPanel, type ConsentRow } from "./ConsentPanel";
import { PortalPanel } from "./PortalPanel";
import { ReceiptButton } from "./ReceiptButton";

export const dynamic = "force-dynamic";

const LOC = LOCALE === "ar" ? "ar-EG" : "en-GB";
const DATE = new Intl.DateTimeFormat(LOC, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Cairo",
});
const DATETIME = new Intl.DateTimeFormat(LOC, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Cairo",
});

function fmt(value: string | null | undefined, f = DATE) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : f.format(d);
}

const STATUS_TONE: Record<string, string> = {
  attended: "var(--jade)",
  no_show: "var(--brick)",
  cancelled: "var(--muted)",
  booked: "var(--muted)",
};

export default async function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await loadClinicContext();
  if (!result.ok) return <ContextGate result={result} />;
  const { clinicId, clinicName, currency, role, userName, userId, nameById } =
    result.ctx;

  const supabase = await createClient();
  const showMoney = canSeeMoney(role);
  // Consent is part of the clinical relationship, so the till is not in it —
  // the same three roles the database policy admits.
  const canRecordConsent =
    role === "owner" || role === "reception" || role === "therapist";

  // clinic_id is in the filter as well as RLS. RLS is the real boundary; this
  // makes the intent explicit at the call site and keeps the query planner on
  // the (clinic_id, …) indexes.
  const { data: patient } = await supabase
    .from("patients")
    .select("id, name, phone, birth_date, consent_at, notes, created_at")
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .maybeSingle();

  if (!patient) {
    return (
      <>
        <NavBar
          clinicName={clinicName}
          userName={userName}
          role={role}
          active="reception"
          showMoney={showMoney}
        />
        <main className="shell">
          <p className="empty" style={{ marginTop: 48 }}>
            {t("patientNotFound")}
          </p>
        </main>
      </>
    );
  }

  // Opening a patient's record is a read of health data, so it is logged. Not
  // awaited for correctness — see lib/audit.ts on why a logging failure must
  // never take a clinical screen down.
  void recordPhiAccess({
    clinicId,
    userId,
    patientIds: [patient.id],
    surface: "patient_record",
  });

  type PortalTokenRow = {
    id: string;
    created_at: string;
    last_seen_at: string | null;
    revoked_at: string | null;
  };
  type ConsentRawRow = {
    id: string;
    purpose: ConsentRow["purpose"];
    method: ConsentRow["method"];
    granted_at: string;
    withdrawn_at: string | null;
  };
  type ExerciseRow = {
    id: string;
    name: string;
    frequency: string;
    sets: number | null;
    reps: number | null;
  };

  const [
    { data: appts },
    { data: pkgs },
    { data: pays },
    { data: balance },
    tokenGate,
    consentGate,
    exerciseGate,
    { data: refundsFor },
  ] = await Promise.all([
      supabase
        .from("appointments")
        .select("id, during, status, therapist_id, price, package_id")
        .eq("clinic_id", clinicId)
        .eq("patient_id", id)
        .order("during", { ascending: false }),
      // packages and payments are invisible to a therapist by RLS, so these
      // come back empty for them and the money sections simply don't render.
      supabase
        .from("packages")
        .select("id, sessions_total, sessions_used, price, expires_at, created_at")
        .eq("clinic_id", clinicId)
        .eq("patient_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select("id, amount, method, paid_at, package_id, appointment_id")
        .eq("clinic_id", clinicId)
        .eq("patient_id", id)
        .order("paid_at", { ascending: false }),
      supabase
        .from("patient_balances")
        .select("amount_owed")
        .eq("clinic_id", clinicId)
        .eq("patient_id", id)
        .maybeSingle(),
      // Both come back empty for a role the policy excludes, so the panels
      // simply do not render rather than showing an empty box. But empty is
      // also what an unapplied migration looks like, and those two states must
      // not read the same — gated() tells them apart. The rest of the record
      // still loads either way: a missing portal is no reason to withhold a
      // patient's clinical history.
      gated<PortalTokenRow[]>(
        "0007",
        supabase
          .from("patient_portal_tokens")
          .select("id, created_at, last_seen_at, revoked_at")
          .eq("clinic_id", clinicId)
          .eq("patient_id", id)
          .order("created_at", { ascending: false }),
        []
      ),
      gated<ConsentRawRow[]>(
        "0010",
        supabase
          .from("consents")
          .select("id, purpose, method, granted_at, withdrawn_at")
          .eq("clinic_id", clinicId)
          .eq("patient_id", id)
          .order("granted_at", { ascending: false }),
        []
      ),
      gated<ExerciseRow[]>(
        "0007",
        supabase
          .from("exercise_prescriptions")
          .select("id, name, frequency, sets, reps")
          .eq("clinic_id", clinicId)
          .eq("patient_id", id)
          .eq("active", true)
          .order("created_at", { ascending: true }),
        []
      ),
      // Refunds are keyed by payment, not patient, so they are fetched for the
      // clinic and matched in memory — a patient filter would need a join the
      // client cannot express.
      supabase
        .from("refunds")
        .select("payment_id, amount")
        .eq("clinic_id", clinicId),
    ]);

  // A portal that is not deployed yet says so once, in its own panel. It does
  // not take the rest of the record down with it, and it does not pretend the
  // patient simply has no link and no exercises.
  // Newest first, which is the order ConsentPanel and has_consent() both
  // depend on: the newest row for a purpose is the current answer.
  const consents: ConsentRow[] = (consentGate.ok ? consentGate.data : []).map((c) => ({
    id: c.id,
    purpose: c.purpose,
    method: c.method,
    grantedOn: fmt(c.granted_at) ?? "",
    withdrawnOn: c.withdrawn_at ? (fmt(c.withdrawn_at) ?? "") : null,
  }));
  const consentNotice = consentGate.ok
    ? null
    : consentGate.reason === "not_migrated"
      ? notMigratedMessage(consentGate.migration)
      : consentGate.message;

  const tokens = tokenGate.ok ? tokenGate.data : [];
  const exercises = exerciseGate.ok ? exerciseGate.data : [];
  const failed = [tokenGate, exerciseGate].find((g) => !g.ok);
  const portalNotice = !failed
    ? null
    : failed.ok
      ? null
      : failed.reason === "not_migrated"
        ? notMigratedMessage(failed.migration)
        : failed.message;


  const all = appts ?? [];
  const now = Date.now();
  const past = all.filter((a) => new Date(rangeStart(a.during)).getTime() <= now);
  const upcoming = all
    .filter(
      (a) =>
        new Date(rangeStart(a.during)).getTime() > now && a.status !== "cancelled"
    )
    .reverse();

  const attended = all.filter((a) => a.status === "attended");
  const missed = all.filter((a) => a.status === "no_show").length;
  const lastAttended = attended[0];

  // Net of refunds. Summing payments alone overstated "paid to date" for
  // every patient who had ever been refunded, which is the one number an
  // owner is most likely to quote back at a patient.
  const refundedByPayment = new Map<string, number>();
  for (const r of refundsFor ?? []) {
    refundedByPayment.set(
      r.payment_id,
      (refundedByPayment.get(r.payment_id) ?? 0) + Number(r.amount)
    );
  }
  const paidToDate = (pays ?? []).reduce(
    (sum, p) =>
      sum + Math.max(0, Number(p.amount) - (refundedByPayment.get(p.id) ?? 0)),
    0
  );
  const owed = Number(balance?.amount_owed ?? 0);

  return (
    <>
      <NavBar
        clinicName={clinicName}
        userName={userName}
        role={role}
        active="reception"
        showMoney={showMoney}
      />
      <main className="shell">
        <div className="dayhead">
          <h1>{patient.name}</h1>
          <span className="date num" dir="ltr">
            {patient.phone}
          </span>
          <Link
            href="/reception"
            className="btn btn-quiet btn-sm"
            style={{ marginInlineStart: "auto", textDecoration: "none" }}
          >
            {t("backToReception")}
          </Link>
        </div>

        {!patient.consent_at && (
          <p className="formerror" style={{ marginBottom: 18 }}>
            <strong>{t("consentMissing")}</strong> — {t("consentMissingWhy")}
          </p>
        )}

        <section className="strip">
          <div className="cell">
            <div className="label">{t("totalSessions")}</div>
            <div className="value num">{attended.length}</div>
            <div className="foot">
              <span className="num">{missed}</span> {t("missedSessions").toLowerCase()}
            </div>
          </div>
          <div className="cell">
            <div className="label">{t("lastSeen")}</div>
            <div className="value" style={{ fontSize: "var(--step-2)" }}>
              {lastAttended ? fmt(rangeStart(lastAttended.during)) : t("neverSeen")}
            </div>
            <div className="foot">
              {t("registered")} {fmt(patient.created_at)}
            </div>
          </div>
          {showMoney && (
            <>
              <div className="cell">
                <div className="label">{t("lifetimeValue")}</div>
                <div className="value">
                  <Money amount={paidToDate} currency={currency} size="lg" />
                </div>
                <div className="foot">
                  <span className="num">{(pays ?? []).length}</span>{" "}
                  {t("paymentsHeading").toLowerCase()}
                </div>
              </div>
              <div className="cell">
                <div className="label">{t("currentlyOwes")}</div>
                <div className="value">
                  <Money amount={owed} currency={currency} size="lg" />
                </div>
                {patient.consent_at && (
                  <div className="foot">{t("consentOn", { date: fmt(patient.consent_at) })}</div>
                )}
              </div>
            </>
          )}
        </section>

        <div className="cols">
          <div>
            {upcoming.length > 0 && (
              <section className="band">
                <div className="bandhead">
                  <h2>{t("upcomingHeading")}</h2>
                  <span className="count">{upcoming.length}</span>
                </div>
                <div className="rows">
                  {upcoming.map((a) => (
                    <article className="row" key={a.id}>
                      <div className="rtime">{fmt(rangeStart(a.during), DATETIME)}</div>
                      <div>
                        <div className="pmeta">
                          <span>{nameById.get(a.therapist_id) ?? "—"}</span>
                          {a.package_id && (
                            <>
                              <span className="dot" />
                              <span>{t("underPackage")}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div />
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="band">
              <div className="bandhead">
                <h2>{t("historyHeading")}</h2>
                <span className="count">{past.length}</span>
              </div>
              <div className="rows">
                {past.length === 0 && <p className="empty">{t("noHistory")}</p>}
                {past.map((a) => (
                  <article className="row" key={a.id}>
                    <div className="rtime">{fmt(rangeStart(a.during), DATETIME)}</div>
                    <div>
                      <div className="pmeta">
                        <span style={{ color: STATUS_TONE[a.status], fontWeight: 600 }}>
                          {a.status === "attended"
                            ? t("attended")
                            : a.status === "no_show"
                              ? t("noShow")
                              : a.status === "cancelled"
                                ? t("cancelled")
                                : t("bookedStatus")}
                        </span>
                        <span className="dot" />
                        <span>{nameById.get(a.therapist_id) ?? "—"}</span>
                      </div>
                    </div>
                    <div>
                      {showMoney && Number(a.price) > 0 && (
                        <Money amount={Number(a.price)} currency={currency} />
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside>
            {/* Consent sits above the link and the exercises because it is the
                thing that makes both of them lawful. */}
            {canRecordConsent && (
              <ConsentPanel
                patientId={patient.id}
                consents={consents}
                notice={consentNotice}
              />
            )}

            <PortalPanel
              patientId={patient.id}
              patientName={patient.name}
              patientPhone={patient.phone}
              notice={portalNotice}
              tokens={(tokens ?? []).map((tk) => ({
                id: tk.id,
                createdAt: tk.created_at,
                lastSeenAt: tk.last_seen_at,
                revoked: Boolean(tk.revoked_at),
              }))}
              exercises={(exercises ?? []).map((e) => ({
                id: e.id,
                name: e.name,
                frequency: e.frequency,
                sets: e.sets,
                reps: e.reps,
              }))}
              canPrescribe={role === "owner" || role === "therapist"}
            />

            {showMoney && (
              <>
                <div className="panel">
                  <div
                    className="panelhead"
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <h3 style={{ marginInlineEnd: "auto" }}>{t("packagesHeading")}</h3>
                    <SellPackageButton
                      patientId={patient.id}
                      patientName={patient.name}
                      currency={currency}
                    />
                  </div>
                  {(pkgs ?? []).length === 0 ? (
                    <p className="leak" style={{ color: "var(--muted)" }}>
                      {t("noPackages")}
                    </p>
                  ) : (
                    (pkgs ?? []).map((k) => {
                      const paidForThis = (pays ?? [])
                        .filter((p) => p.package_id === k.id)
                        .reduce((s, p) => s + Number(p.amount), 0);
                      const outstanding = Number(k.price) - paidForThis;
                      return (
                        <div className="leak" key={k.id}>
                          <Arc
                            value={k.sessions_used}
                            max={k.sessions_total}
                            size="sm"
                          />
                          <div className="leak-body">
                            <div className="leak-name">
                              {t("packageProgress", {
                                used: k.sessions_used,
                                total: k.sessions_total,
                              })}
                            </div>
                            <div className="leak-when">
                              {k.expires_at
                                ? new Date(k.expires_at).getTime() < now
                                  ? t("expiredOn", { date: fmt(k.expires_at) })
                                  : t("expiresOn", { date: fmt(k.expires_at) })
                                : fmt(k.created_at)}
                            </div>
                          </div>
                          {outstanding > 0.005 ? (
                            <Chip tone="owes">
                              {t("stillOwing", {
                                amount: outstanding.toFixed(2),
                              })}
                            </Chip>
                          ) : (
                            <span className="hint">{t("paidOff")}</span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="panel">
                  <div className="panelhead">
                    <h3>{t("paymentsHeading")}</h3>
                  </div>
                  {(pays ?? []).length === 0 ? (
                    <p className="leak" style={{ color: "var(--muted)" }}>
                      {t("noPaymentsRecorded")}
                    </p>
                  ) : (
                    (pays ?? []).slice(0, 12).map((p) => (
                      <div className="leak" key={p.id}>
                        <div className="leak-body">
                          <div className="leak-name">
                            {p.method === "cash"
                              ? t("cash")
                              : p.method === "card"
                                ? t("card")
                                : p.method === "wallet"
                                  ? t("wallet")
                                  : p.method}
                          </div>
                          <div className="leak-when">{fmt(p.paid_at)}</div>
                        </div>
                        <Money amount={Number(p.amount)} currency={currency} />
                        {/* Money already taken, so this issues a document
                            rather than moving anything. */}
                        <ReceiptButton paymentId={p.id} label={t("issueReceipt")} />
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
