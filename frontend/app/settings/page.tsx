import { ContextGate } from "@/components/ui/ContextGate";
import { NavBar } from "@/components/ui/NavBar";
import { loadClinicContext } from "@/lib/clinic-context";
import { canSeeMoney } from "@/lib/roles";
import { t } from "@/lib/strings";
import { requireClinicOwner } from "@/lib/supabase/admin";
import { ClinicPanel } from "./ClinicPanel";
import { TeamPanel } from "./TeamPanel";
import { listStaff } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const result = await loadClinicContext();
  if (!result.ok) return <ContextGate result={result} />;
  const { clinicName, currency, timezone, taxRate, taxLabel, role, userName } =
    result.ctx;

  // The same gate the actions use, so the page cannot show a form that every
  // submission would then reject.
  const owner = await requireClinicOwner();

  if (!owner.ok) {
    return (
      <>
        <NavBar
          clinicName={clinicName}
          userName={userName}
          role={role}
          active="settings"
          showMoney={canSeeMoney(role)}
        />
        <main className="shell">
          <p className="empty" style={{ marginTop: 48 }}>
            {owner.reason === "unconfigured"
              ? t("adminNotConfigured")
              : t("onlyOwners")}
          </p>
        </main>
      </>
    );
  }

  const staff = await listStaff();

  return (
    <>
      <NavBar
        clinicName={clinicName}
        userName={userName}
        role={role}
        active="settings"
        showMoney={canSeeMoney(role)}
      />
      <main className="shell">
        <div className="dayhead">
          <h1>{t("settings")}</h1>
          <span className="date">{t("settingsSubtitle")}</span>
        </div>

        <div className="cols">
          <TeamPanel staff={staff} />
          <ClinicPanel
            name={clinicName}
            currency={currency}
            timezone={timezone}
            taxRatePercent={Math.round(taxRate * 10000) / 100}
            taxLabel={taxLabel}
          />
        </div>
      </main>
    </>
  );
}
