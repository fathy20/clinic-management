import Link from "next/link";
import { Arc } from "@/components/ui/Arc";
import { Money } from "@/components/ui/Money";
import { adminClient, requirePlatformAdmin } from "@/lib/supabase/admin";
import { t } from "@/lib/strings";
import { ActivityFeed } from "./ActivityFeed";
import { buildActivity } from "./activity";

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="shell">{children}</main>;
}

export default async function AdminPage() {
  const gate = await requirePlatformAdmin();

  // Same shell either way, so a forbidden response is indistinguishable in
  // shape from a real one — no probing which emails are admins.
  if (!gate.ok) {
    return (
      <Shell>
        <p className="empty" style={{ marginTop: 48 }}>
          {gate.reason === "unconfigured"
            ? t("adminNotConfigured")
            : t("adminForbidden")}
        </p>
      </Shell>
    );
  }

  const db = adminClient();

  const [
    { data: clinics },
    { data: memberships },
    { data: profiles },
    { data: patients },
    { data: appointments },
    { data: payments },
    { data: refunds },
    { data: packages },
    { data: balances },
  ] = await Promise.all([
    db.from("clinics").select("id, name, created_at").order("created_at"),
    db.from("memberships").select("user_id, clinic_id, role"),
    db.from("profiles").select("id, full_name"),
    db.from("patients").select("id, clinic_id, created_at"),
    db.from("appointments").select("id, clinic_id, status, created_at, patient_id"),
    db.from("payments").select("id, clinic_id, amount, paid_at, taken_by"),
    db.from("refunds").select("id, clinic_id, amount, refunded_at, taken_by"),
    db.from("packages").select("id, clinic_id, sessions_total, created_at"),
    db.from("patient_balances").select("clinic_id, amount_owed"),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const refundedByPayment = new Map<string, number>();
  for (const r of refunds ?? []) {
    // refunds carry clinic_id, and the per-payment link is what nets a total
    refundedByPayment.set(
      r.id,
      (refundedByPayment.get(r.id) ?? 0) + Number(r.amount)
    );
  }

  const rows = (clinics ?? []).map((c) => {
    const staff = (memberships ?? []).filter((m) => m.clinic_id === c.id);
    const collected = (payments ?? [])
      .filter((p) => p.clinic_id === c.id)
      .reduce((s, p) => s + Number(p.amount), 0);
    const refundedTotal = (refunds ?? [])
      .filter((r) => r.clinic_id === c.id)
      .reduce((s, r) => s + Number(r.amount), 0);
    const owed = (balances ?? [])
      .filter((b) => b.clinic_id === c.id)
      .reduce((s, b) => s + Number(b.amount_owed), 0);
    const appts = (appointments ?? []).filter((a) => a.clinic_id === c.id);
    const attended = appts.filter((a) => a.status === "attended").length;

    return {
      id: c.id,
      name: c.name,
      createdAt: c.created_at,
      staff: staff.length,
      owners: staff.filter((s) => s.role === "owner").length,
      therapists: staff.filter((s) => s.role === "therapist").length,
      patients: (patients ?? []).filter((p) => p.clinic_id === c.id).length,
      appointments: appts.length,
      attended,
      collected: collected - refundedTotal,
      refunded: refundedTotal,
      owed,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      clinics: acc.clinics + 1,
      staff: acc.staff + r.staff,
      patients: acc.patients + r.patients,
      appointments: acc.appointments + r.appointments,
      collected: acc.collected + r.collected,
      owed: acc.owed + r.owed,
    }),
    { clinics: 0, staff: 0, patients: 0, appointments: 0, collected: 0, owed: 0 }
  );

  const activity = buildActivity({
    payments: payments ?? [],
    refunds: refunds ?? [],
    patients: patients ?? [],
    appointments: appointments ?? [],
    packages: packages ?? [],
    clinicNames: new Map((clinics ?? []).map((c) => [c.id, c.name])),
    memberships: memberships ?? [],
    nameById,
  });

  return (
    <>
      <header className="topbar">
        <div
          className="shell"
          style={{ display: "flex", alignItems: "center", gap: 16, padding: 0, width: "100%" }}
        >
          <div className="brand">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <path
                d="M4 24 A 14 14 0 0 1 28 24"
                fill="none"
                stroke="var(--jade)"
                strokeWidth="3.4"
                strokeLinecap="round"
              />
              <circle cx="16" cy="24" r="2.4" fill="var(--money)" />
            </svg>
            <div>
              <div className="brand-name">{t("adminTitle")}</div>
              <div className="brand-sub">{t("adminSubtitle")}</div>
            </div>
          </div>
          <Link
            href="/reception"
            className="searchcue"
            style={{ textDecoration: "none" }}
          >
            {t("backToClinic")}
          </Link>
          <div className="who">
            <div className="avatar">{gate.email.charAt(0).toUpperCase()}</div>
            <div>
              <div className="who-name">{gate.email}</div>
              <div className="who-role">{t("rolePlatformAdmin")}</div>
            </div>
          </div>
        </div>
      </header>

      <Shell>
        <div className="dayhead">
          <h1>{t("adminTitle")}</h1>
          <span className="date">{t("adminSubtitle")}</span>
        </div>

        <section className="strip">
          <div className="cell">
            <div className="label">{t("clinics")}</div>
            <div className="value num">{totals.clinics}</div>
          </div>
          <div className="cell">
            <div className="label">{t("staff")}</div>
            <div className="value num">{totals.staff}</div>
          </div>
          <div className="cell">
            <div className="label">{t("patients")}</div>
            <div className="value num">{totals.patients}</div>
          </div>
          <div className="cell">
            <div className="label">{t("appointments")}</div>
            <div className="value num">{totals.appointments}</div>
          </div>
          <div className="cell">
            <div className="label">{t("collected")}</div>
            <div className="value">
              <Money amount={totals.collected} size="lg" />
            </div>
          </div>
          <div className="cell">
            <div className="label">{t("outstanding")}</div>
            <div className="value">
              <Money amount={totals.owed} size="lg" />
            </div>
          </div>
        </section>

        <div className="cols">
          <div>
            <section className="band">
              <div className="bandhead">
                <h2>{t("clinics")}</h2>
                <span className="count">{rows.length}</span>
              </div>
              <div className="rows">
                {rows.length === 0 && <p className="empty">{t("noClinics")}</p>}
                {rows.map((r) => {
                  const pct = r.appointments
                    ? Math.round((r.attended / r.appointments) * 100)
                    : 0;
                  return (
                    <article className="row" key={r.id}>
                      <Arc
                        value={pct}
                        size="sm"
                        tone={pct < 50 ? "brick" : "jade"}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="pname">{r.name}</div>
                        <div className="pmeta">
                          <span>
                            <span className="num">{r.staff}</span> {t("staff")}
                          </span>
                          <span className="dot" />
                          <span>
                            <span className="num">{r.patients}</span>{" "}
                            {t("patients")}
                          </span>
                          <span className="dot" />
                          <span>
                            <span className="num">{r.attended}</span>/
                            <span className="num">{r.appointments}</span>{" "}
                            {t("appointments").toLowerCase()}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 2,
                        }}
                      >
                        <Money amount={r.collected} />
                        {r.owed > 0 && (
                          <span className="hint">
                            {t("outstanding")} <Money amount={r.owed} />
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <p className="note-inline">{t("phiNotice")}</p>
          </div>

          <ActivityFeed items={activity} />
        </div>
      </Shell>
    </>
  );
}
