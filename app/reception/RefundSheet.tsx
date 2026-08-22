"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { Sheet } from "@/components/ui/Sheet";
import { getPatientPayments, issueRefund } from "./actions";
import type { DayRow } from "./types";
import { LOCALE, t } from "@/lib/strings";

type PaymentOption = {
  id: string;
  amount: number;
  method: string;
  paid_at: string;
  package_id: string | null;
};

const DATE_FMT = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Cairo",
});

const METHOD_LABEL: Record<string, string> = {
  cash: t("cash"),
  card: t("card"),
  wallet: t("wallet"),
};

export function RefundSheet({
  row,
  currency,
  onClose,
}: {
  row: DayRow;
  currency: string;
  onClose: () => void;
}) {
  const [payments, setPayments] = useState<PaymentOption[]>([]);
  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getPatientPayments(row.patientId)
      .then((p) => {
        setPayments(p);
        if (p.length) {
          setPaymentId(p[0].id);
          setAmount(String(p[0].amount));
        }
      })
      .catch(() => setPayments([]));
  }, [row.patientId]);

  const selected = payments.find((p) => p.id === paymentId);

  function submit() {
    setError(null);
    const value = Number(amount);
    if (!paymentId) return setError(t("pickAPayment"));
    if (!(value > 0)) return setError(t("amountAboveZero"));
    if (!reason.trim()) return setError(t("reasonRequired"));
    startTransition(async () => {
      try {
        await issueRefund({ paymentId, amount: value, reason: reason.trim() });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={t("refundTitle")}
      subtitle={row.patientName}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={pending || payments.length === 0}
          >
            {t("refundIt")}
          </Button>
        </>
      }
    >
      {payments.length === 0 ? (
        <p className="empty">{t("noPaymentsYet")}</p>
      ) : (
        <>
          <SelectField
            id="pay"
            label={t("payment")}
            value={paymentId}
            onChange={(e) => {
              setPaymentId(e.target.value);
              const p = payments.find((x) => x.id === e.target.value);
              if (p) setAmount(String(p.amount));
            }}
          >
            {payments.map((p) => (
              <option key={p.id} value={p.id}>
                {p.amount} · {METHOD_LABEL[p.method] ?? p.method} ·{" "}
                {DATE_FMT.format(new Date(p.paid_at))}
              </option>
            ))}
          </SelectField>

          <Field
            id="amt"
            amount
            label={t("refundAmount")}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={
              selected ? (
                <>
                  {t("maxRefundableBefore")}{" "}
                  <Money amount={selected.amount} currency={currency} />
                  {t("maxRefundableAfter")}
                </>
              ) : undefined
            }
          />

          <Field
            id="why"
            label={t("reason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
          />
        </>
      )}

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
