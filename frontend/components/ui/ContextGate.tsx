import { t } from "@/lib/strings";
import type { ContextResult } from "@/lib/clinic-context";

// The two ways a clinic page can have nothing to render, worded the same on
// every page rather than re-typed per route.
export function ContextGate({ result }: { result: ContextResult }) {
  if (result.ok) return null;
  return (
    <main className="shell">
      <p className="empty" style={{ marginTop: 48 }}>
        {result.reason === "unauthenticated" ? t("mustSignIn") : t("notInAnyClinic")}
      </p>
    </main>
  );
}
