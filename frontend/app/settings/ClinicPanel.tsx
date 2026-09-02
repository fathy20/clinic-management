"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { t } from "@/lib/strings";
import { updateClinic } from "./actions";

// The currencies and zones a clinic in this market plausibly needs. A free
// text field would let a typo silently shift every appointment by hours; the
// server still validates the zone against the runtime's own database, so this
// list is convenience, not the guard.
const CURRENCIES = ["EGP", "SAR", "AED", "GBP", "USD", "KWD", "QAR", "JOD"];
const ZONES = [
  "Africa/Cairo",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Amman",
  "Europe/London",
];

export function ClinicPanel({
  name,
  currency,
  timezone,
  taxRatePercent,
  taxLabel,
}: {
  name: string;
  currency: string;
  timezone: string;
  taxRatePercent: number;
  taxLabel: string;
}) {
  const [form, setForm] = useState({
    name,
    currency,
    timezone,
    taxRatePercent: String(taxRatePercent),
    taxLabel,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    form.name !== name ||
    form.currency !== currency ||
    form.timezone !== timezone ||
    Number(form.taxRatePercent) !== taxRatePercent ||
    form.taxLabel !== taxLabel;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateClinic({
          name: form.name,
          currency: form.currency,
          timezone: form.timezone,
          taxRatePercent: Number(form.taxRatePercent) || 0,
          taxLabel: form.taxLabel,
        });
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <aside>
      <div className="panel">
        <div className="panelhead">
          <h3>{t("clinicHeading")}</h3>
          <p>{t("settingsSubtitle")}</p>
        </div>
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <Field
            label={t("clinicNameLabel")}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />

          <SelectField
            label={t("currencyLabel")}
            value={form.currency}
            onChange={(e) => set("currency", e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={t("timezoneLabel")}
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          >
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </SelectField>

          <Field
            amount
            label={t("taxRateLabel")}
            hint={t("taxRateHint")}
            inputMode="decimal"
            value={form.taxRatePercent}
            onChange={(e) => set("taxRatePercent", e.target.value)}
          />

          <Field
            label={t("taxLabelLabel")}
            placeholder="VAT"
            value={form.taxLabel}
            onChange={(e) => set("taxLabel", e.target.value)}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button
              variant="primary"
              small
              disabled={pending || !dirty}
              onClick={save}
            >
              {t("saveChanges")}
            </Button>
            {saved && !dirty && (
              <span className="hint" style={{ color: "var(--jade)" }}>
                {t("savedChanges")}
              </span>
            )}
          </div>

          {error && <p className="formerror">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
