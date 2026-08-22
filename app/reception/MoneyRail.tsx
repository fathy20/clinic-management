import { Arc } from "@/components/ui/Arc";
import { Money } from "@/components/ui/Money";
import { createClient } from "@/lib/supabase/server";
import { LOCALE, t } from "@/lib/strings";

const DATE_FMT = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Cairo",
});

function fmt(d: string | null) {
  if (!d) return t("notStartedYet");
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FMT.format(parsed);
}

// Server component: reads the two views that answer "where is my money".
// Both are security_invoker, so a therapist reaching this code path gets
// zero rows rather than another clinic's numbers.
export async function MoneyRail({ clinicId }: { clinicId: string }) {
  const supabase = await createClient();

  const [{ data: leaks }, { data: stale }] = await Promise.all([
    supabase
      .from("leaking_sessions")
      .select("appointment_id, name, session_date, amount_owed")
      .eq("clinic_id", clinicId)
      .order("session_date", { ascending: true })
      .limit(8),
    supabase
      .from("stale_packages")
      .select("package_id, name, sessions_left, last_session")
      .eq("clinic_id", clinicId)
      .limit(6),
  ]);

  const total = (leaks ?? []).reduce((s, l) => s + Number(l.amount_owed), 0);

  return (
    <aside>
      <div className="panel">
        <div className="panelhead">
          <h3>{t("leakingTitle")}</h3>
          <p>{t("leakingSubtitle")}</p>
        </div>

        {(leaks ?? []).length === 0 ? (
          <p className="leak" style={{ color: "var(--muted)" }}>
            {t("nothingLeaking")}
          </p>
        ) : (
          (leaks ?? []).map((l) => (
            <div className="leak" key={l.appointment_id}>
              <div className="leak-body">
                <div className="leak-name">{l.name}</div>
                <div className="leak-when">
                  {t("sessionOn", { date: fmt(l.session_date) })}
                </div>
              </div>
              <Money amount={Number(l.amount_owed)} />
            </div>
          ))
        )}

        {total > 0 && (
          <div className="paneltotal">
            <span className="lbl">{t("totalOwed")}</span>
            <Money amount={total} size="lg" withLabel />
          </div>
        )}
      </div>

      {(stale ?? []).length > 0 && (
        <div className="panel">
          <div className="panelhead">
            <h3>{t("stalePackagesTitle")}</h3>
            <p>{t("stalePackagesSubtitle")}</p>
          </div>
          {(stale ?? []).map((p) => (
            <div className="leak" key={p.package_id}>
              <div className="leak-body">
                <div className="leak-name">{p.name}</div>
                <div className="leak-when">
                  {t("lastSessionOn", {
                    date: fmt(p.last_session),
                    n: p.sessions_left,
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
