import type { Metadata } from "next";
import { loadPortalView, verifyPortalToken } from "@/lib/portal";
import { clinicFormat } from "@/lib/clinic-time";
import { formatMoney, currencyLabel } from "@/lib/money";
import { LOCALE, t } from "@/lib/strings";

export const dynamic = "force-dynamic";

// Kept out of search engines and out of referrer headers: the URL is the
// credential, so it must not leak to whatever the patient taps next.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const LOC = LOCALE === "ar" ? "ar-EG" : "en-GB";

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const result = await verifyPortalToken(token);
  if (!result.ok) {
    return (
      <main className="portal">
        <p className="portal-error">
          {result.reason === "revoked"
            ? t("portalRevoked")
            : result.reason === "expired"
              ? t("portalExpired")
              : t("portalNotFound")}
        </p>
      </main>
    );
  }

  const view = await loadPortalView(result.session);
  if (!view) {
    return (
      <main className="portal">
        <p className="portal-error">{t("portalNotFound")}</p>
      </main>
    );
  }

  const when = clinicFormat("dateTime", LOC, view.timezone);

  return (
    <main className="portal">
      <header className="portal-head">
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
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
          <p className="portal-clinic">{view.clinicName}</p>
          <h1>{t("portalGreeting", { name: view.patientName })}</h1>
        </div>
      </header>

      <section className="portal-strip">
        <div>
          <span className="label">{t("sessionsRemaining")}</span>
          <strong className="num">{view.sessionsLeft}</strong>
        </div>
        {view.amountOwed > 0 && (
          <div>
            <span className="label">{t("yourBalance")}</span>
            <strong className="money">
              {formatMoney(view.amountOwed, view.currency)}{" "}
              <span style={{ fontSize: "0.7em" }}>
                {currencyLabel(view.currency)}
              </span>
            </strong>
          </div>
        )}
      </section>

      <section className="portal-block">
        <h2>{t("yourNextVisits")}</h2>
        {view.upcoming.length === 0 ? (
          <p className="portal-empty">{t("noUpcomingVisits")}</p>
        ) : (
          <ul className="portal-visits">
            {view.upcoming.map((v) => (
              <li key={v.id}>
                <span className="num">{when.format(new Date(v.startsAt))}</span>
                <span className="portal-with">{v.therapistName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="portal-block">
        <h2>{t("yourExercises")}</h2>
        {view.exercises.length === 0 ? (
          <p className="portal-empty">{t("noExercisesYet")}</p>
        ) : (
          <ol className="portal-exercises">
            {view.exercises.map((e) => (
              <li key={e.id}>
                <h3>{e.name}</h3>
                <p className="portal-dose num">
                  {e.sets && e.reps && t("setsReps", { sets: e.sets, reps: e.reps })}
                  {e.holdSeconds ? ` · ${t("holdFor", { n: e.holdSeconds })}` : ""}
                  {e.frequency ? ` · ${e.frequency}` : ""}
                </p>
                {e.instructions && <p className="portal-how">{e.instructions}</p>}
                {e.videoUrl && (
                  <a
                    className="portal-watch"
                    href={e.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {t("watchIt")} →
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="portal-privacy">{t("portalPrivacy")}</p>
    </main>
  );
}
