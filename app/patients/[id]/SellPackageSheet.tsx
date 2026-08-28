"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/lib/strings";
import { sellPackage } from "../actions";

export function SellPackageButton({
  patientId,
  patientName,
  currency,
}: {
  patientId: string;
  patientName: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="money" small onClick={() => setOpen(true)}>
        {t("sellPackage")}
      </Button>
      {open && (
        <SellSheet
          patientId={patientId}
          patientName={patientName}
          currency={currency}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SellSheet({
  patientId,
  patientName,
  currency,
  onClose,
}: {
  patientId: string;
  patientName: string;
  currency: string;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState("10");
  const [price, setPrice] = useState("");
  const [expires, setExpires] = useState("");
  const [deposit, setDeposit] = useState("");
  const [method, setMethod] = useState("cash");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const n = Number(sessions);
  const total = Number(price);
  const perSession = n > 0 && total > 0 ? total / n : 0;
  const valid = n >= 1 && n <= 200 && total >= 0 && price !== "";

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await sellPackage({
          patientId,
          sessionsTotal: n,
          price: total,
          expiresOn: expires || null,
          deposit: Number(deposit) || 0,
          depositMethod: method,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={t("sellPackage")}
      subtitle={`${patientName} · ${t("sellPackageSub")}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="money" onClick={submit} disabled={pending || !valid}>
            {t("sellIt")}
          </Button>
        </>
      }
    >
      <div className="tender">
        <Field
          amount
          label={t("sessionsInPackage")}
          inputMode="numeric"
          value={sessions}
          onChange={(e) => setSessions(e.target.value)}
        />
        <Field
          amount
          label={t("packagePrice")}
          inputMode="decimal"
          placeholder="0.00"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>

      {perSession > 0 && (
        <p className="hint">
          {t("perSessionWorks", { amount: perSession.toFixed(2) })}
        </p>
      )}

      <Field
        label={t("expiresOptional")}
        type="date"
        value={expires}
        onChange={(e) => setExpires(e.target.value)}
      />

      {/* The case Jane cannot represent: it requires a package to be paid in
          full before it can be redeemed. An Egyptian clinic takes a deposit. */}
      <div className="tender">
        <SelectField
          label={t("method")}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="cash">{t("cash")}</option>
          <option value="card">{t("card")}</option>
          <option value="wallet">{t("wallet")}</option>
        </SelectField>
        <Field
          amount
          label={t("depositNow")}
          hint=""
          inputMode="decimal"
          placeholder="0.00"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
        />
      </div>
      <p className="hint">{t("depositHint")}</p>

      {total > 0 && (
        <div className="tally">
          <span className="lbl">{t("packagePrice")}</span>
          <Money amount={total} currency={currency} size="lg" withLabel />
        </div>
      )}

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
