"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { Sheet } from "@/components/ui/Sheet";
import { formatMoney } from "@/lib/money";
import { getPatientPackages, takePayment } from "./actions";
import type { DayRow } from "./types";
import { t } from "@/lib/strings";

type PackageOption = {
  id: string;
  sessions_total: number;
  sessions_used: number;
  price: number;
};

const METHODS = [
  { value: "cash", label: t("cash") },
  { value: "card", label: t("card") },
  { value: "wallet", label: t("wallet") },
];

export function PaymentSheet({
  clinicId,
  row,
  currency,
  onClose,
}: {
  clinicId: string;
  row: DayRow;
  currency: string;
  onClose: () => void;
}) {
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [packageId, setPackageId] = useState(row.packageId ?? "");
  const [tenders, setTenders] = useState([
    { method: "cash", amount: row.amountOwed > 0 ? String(row.amountOwed) : "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getPatientPackages(row.patientId)
      .then(setPackages)
      .catch(() => setPackages([]));
  }, [row.patientId]);

  const total = tenders.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);

  function submit() {
    setError(null);
    const rows = tenders
      .map((x) => ({ method: x.method, amount: Number(x.amount) }))
      .filter((x) => x.amount > 0);
    if (rows.length === 0) {
      setError(t("enterAnAmount"));
      return;
    }
    startTransition(async () => {
      try {
        await takePayment({
          clinicId,
          patientId: row.patientId,
          packageId: packageId || null,
          appointmentId: row.id,
          rows,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={t("paymentTitle")}
      subtitle={
        <>
          {row.patientName}
          {row.amountOwed > 0 && (
            <>
              {` · ${t("due")} `}
              <Money amount={row.amountOwed} currency={currency} />
            </>
          )}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="money" onClick={submit} disabled={pending}>
            {total > 0 ? `${t("take")} ${formatMoney(total, currency)}` : t("take")}
          </Button>
        </>
      }
    >
      <SelectField
        id="pkg"
        label={t("packageOptional")}
        hint={packageId ? t("paymentGoesToPackage") : undefined}
        value={packageId}
        onChange={(e) => setPackageId(e.target.value)}
      >
        <option value="">{t("noPackageSingleSession")}</option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {t("packageOf", { n: p.sessions_total })} ·{" "}
            {t("sessionsLeft", { n: p.sessions_total - p.sessions_used })} ·{" "}
            {p.price}
          </option>
        ))}
      </SelectField>

      {tenders.map((tender, i) => (
        <div key={i} className={tenders.length > 1 ? "tender removable" : "tender"}>
          <SelectField
            value={tender.method}
            aria-label={t("method")}
            onChange={(e) =>
              setTenders((ts) =>
                ts.map((x, j) => (j === i ? { ...x, method: e.target.value } : x))
              )
            }
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
          <Field
            amount
            inputMode="decimal"
            placeholder="0.00"
            aria-label={t("amount")}
            value={tender.amount}
            onChange={(e) =>
              setTenders((ts) =>
                ts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x))
              )
            }
          />
          {tenders.length > 1 && (
            <button
              type="button"
              className="rm"
              aria-label={t("removeMethod")}
              onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))}
            >
              ×
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        className="linkbtn"
        onClick={() => setTenders((ts) => [...ts, { method: "cash", amount: "" }])}
      >
        {t("addAnotherMethod")}
      </button>

      <div className="tally">
        <span className="lbl">{t("total")}</span>
        <Money amount={total} currency={currency} size="lg" withLabel />
      </div>

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
