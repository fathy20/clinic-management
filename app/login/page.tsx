import { signIn } from "./actions";
import { t } from "@/lib/strings";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <form
        action={signIn}
        className="panel"
        style={{ width: "min(380px, 100%)", padding: 26 }}
      >
        <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
          <path
            d="M4 24 A 14 14 0 0 1 28 24"
            fill="none"
            stroke="var(--jade)"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <circle cx="16" cy="24" r="2.4" fill="var(--money)" />
        </svg>

        <h1 style={{ fontSize: "var(--step-3)", fontWeight: 800, marginTop: 14 }}>
          {t("signInTitle")}
        </h1>
        <p style={{ color: "var(--muted)", margin: "4px 0 22px" }}>
          {t("signInSubtitle")}
        </p>

        {error && (
          <p className="formerror" style={{ marginBottom: 14 }}>
            {error === "Invalid login credentials" ? t("badCredentials") : error}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="fieldlabel" htmlFor="email">
              {t("email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              dir="ltr"
              required
              autoComplete="username"
              className="field"
            />
          </div>

          <div>
            <label className="fieldlabel" htmlFor="password">
              {t("password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="field"
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            {t("signIn")}
          </button>
        </div>
      </form>
    </main>
  );
}
