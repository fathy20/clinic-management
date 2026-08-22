import { canSeeMoney } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { DayBoard } from "./DayBoard";
import { MoneyRail } from "./MoneyRail";
import { TopBar } from "./TopBar";
import type { DayRow, Therapist } from "./types";
import { t } from "@/lib/strings";

export const dynamic = "force-dynamic";

// No per-clinic timezone setting yet; every clinic is in Egypt. Egypt
// reinstated DST in 2023, so the offset is +2 in winter and +3 in summer —
// a hardcoded offset silently puts late-evening appointments on the wrong
// day twice a year, so the offset is read from the zone database instead.
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
  const get = (part: string) =>
    Number(parts.find((p) => p.type === part)!.value);
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

function todayRangeInClinicTz() {
  const now = new Date();
  const offset = zoneOffsetMs(now);
  const local = new Date(now.getTime() + offset);
  const midnightUTC = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  // The offset can differ on either side of a DST switch, so each boundary is
  // resolved against its own offset rather than reusing the current one.
  const startGuess = new Date(midnightUTC - offset);
  const start = new Date(midnightUTC - zoneOffsetMs(startGuess));
  const endGuess = new Date(midnightUTC + 24 * 3600_000 - offset);
  const end = new Date(midnightUTC + 24 * 3600_000 - zoneOffsetMs(endGuess));
  return { start: start.toISOString(), end: end.toISOString() };
}

function lowerBound(during: string) {
  const inner = during.slice(1);
  return inner.slice(0, inner.indexOf(",")).replace(/^"|"$/g, "");
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="shell">{children}</main>;
}

export default async function ReceptionPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Shell>
        <p className="empty" style={{ marginTop: 48 }}>
          {t("mustSignIn")}
        </p>
      </Shell>
    );
  }

  // A staff member with more than one clinic membership (not a supported
  // workflow yet — see SPEC.md) should at least always land on the *same*
  // one, not a different one per page load. There's no created_at column to
  // order by, so clinic_id is the deterministic tie-breaker.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("clinic_id, role")
    .eq("user_id", user.id)
    .order("clinic_id")
    .limit(1);

  const membership = memberships?.[0];
  if (!membership) {
    return (
      <Shell>
        <p className="empty" style={{ marginTop: 48 }}>
          {t("notInAnyClinic")}
        </p>
      </Shell>
    );
  }

  const { clinic_id: clinicId, role } = membership;

  const [{ data: clinic }, { data: staff }, { data: myProfile }] =
    await Promise.all([
      // Every column, deliberately: naming `currency` explicitly makes the
      // whole row 400 with "column clinics.currency does not exist" until
      // migration 0002 is applied, which takes the clinic *name* down with
      // it. Tighten this to explicit columns once 0002 is live everywhere.
      supabase.from("clinics").select("*").eq("id", clinicId).single(),
      supabase
        .from("memberships")
        .select("user_id, default_session_minutes")
        .eq("clinic_id", clinicId)
        .eq("role", "therapist"),
      supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    ]);

  const therapistIds = (staff ?? []).map((m) => m.user_id);
  const { data: profiles } = therapistIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", therapistIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const therapists: Therapist[] = (staff ?? []).map((m) => ({
    id: m.user_id,
    name: nameById.get(m.user_id) ?? "—",
    defaultSessionMinutes: m.default_session_minutes,
  }));

  const { start, end } = todayRangeInClinicTz();

  const { data: appointments, error: apptError } = await supabase
    .from("appointments")
    .select("*, patients(name, phone)")
    .eq("clinic_id", clinicId)
    .overlaps("during", `[${start},${end})`)
    .order("during", { ascending: true });

  if (apptError) {
    return (
      <Shell>
        <p className="formerror" style={{ marginTop: 48 }}>
          {apptError.message}
        </p>
      </Shell>
    );
  }

  const { data: balances } = await supabase
    .from("patient_balances")
    .select("patient_id, amount_owed")
    .eq("clinic_id", clinicId);
  const owedByPatient = new Map(
    (balances ?? []).map((b) => [b.patient_id, Number(b.amount_owed)])
  );

  const { data: risk } = await supabase
    .from("noshow_risk")
    .select("patient_id, rate, history")
    .eq("clinic_id", clinicId);
  const riskByPatient = new Map(
    (risk ?? [])
      .filter((r) => Number(r.history) >= 3 && Number(r.rate) >= 0.34)
      .map((r) => [r.patient_id, Number(r.rate)])
  );

  // Packages are invisible to a therapist by RLS, so this returns zero rows
  // for them and the progress arc simply doesn't render — no error, no gap.
  const { data: packages } = await supabase
    .from("packages")
    .select("id, patient_id, sessions_total, sessions_used")
    .eq("clinic_id", clinicId);
  const pkgById = new Map((packages ?? []).map((p) => [p.id, p]));

  const nameOfTherapist = new Map(therapists.map((th) => [th.id, th.name]));

  const rows: DayRow[] = (appointments ?? []).map((a) => {
    const patient = (
      a as unknown as { patients: { name: string; phone: string } }
    ).patients;
    const pkg = a.package_id ? pkgById.get(a.package_id) : undefined;
    return {
      id: a.id,
      patientId: a.patient_id,
      patientName: patient?.name ?? "—",
      patientPhone: patient?.phone ?? "—",
      therapistName: nameOfTherapist.get(a.therapist_id) ?? "—",
      startsAt: lowerBound(a.during),
      status: a.status,
      packageId: a.package_id,
      price: Number(a.price),
      amountOwed: owedByPatient.get(a.patient_id) ?? 0,
      noShowRate: riskByPatient.get(a.patient_id) ?? null,
      packageUsed: pkg ? pkg.sessions_used : null,
      packageTotal: pkg ? pkg.sessions_total : null,
    };
  });

  // Currency comes off the clinic row. The fallback covers the window between
  // deploying this code and applying migration 0002 — after that the column is
  // not null.
  const currency = (clinic as { currency?: string } | null)?.currency ?? "EGP";
  const showMoney = canSeeMoney(role);

  const attended = rows.filter((r) => r.status === "attended").length;
  const missed = rows.filter((r) => r.status === "no_show").length;
  const waiting = rows.filter((r) => r.status === "booked").length;

  return (
    <>
      <TopBar
        clinicName={clinic?.name ?? t("appName")}
        userName={myProfile?.full_name ?? "—"}
        role={role}
      />
      <Shell>
        <div className="cols">
          <div>
            <DayBoard
              rows={rows}
              therapists={therapists}
              clinicId={clinicId}
              canSeeMoney={showMoney}
              currency={currency}
              counts={{ waiting, attended, missed, total: rows.length }}
            />
          </div>
          {showMoney && <MoneyRail clinicId={clinicId} currency={currency} />}
        </div>
      </Shell>
    </>
  );
}
