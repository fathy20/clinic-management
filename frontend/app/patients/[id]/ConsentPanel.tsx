"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/lib/strings";
import {
  recordConsent,
  withdrawConsent,
  type ConsentMethod,
  type ConsentPurpose,
} from "../consent-actions";

// Consent shown as four separate questions, because that is what the PDPL makes
// them. A single "consented ✓" cannot say whether this patient agreed to be
// messaged on WhatsApp, and reception needs that answer before it sends
// anything.

const PURPOSES: ConsentPurpose[] = [
  "treatment",
  "records_storage",
  "whatsapp_messaging",
  "insurance_disclosure",
];

const METHODS: ConsentMethod[] = [
  "in_person_signature",
  "verbal_witnessed",
  "portal",
];

export type ConsentRow = {
  id: string;
  purpose: ConsentPurpose;
  method: ConsentMethod;
  /**
   * Already formatted in the clinic's own timezone. A server component cannot
   * hand a formatter to a client component, and the timezone lives on the
   * server side anyway — so the date arrives as text rather than an instant
   * plus a function to render it.
   */
  grantedOn: string;
  withdrawnOn: string | null;
};

export function ConsentPanel({
  patientId,
  consents,
  notice,
}: {
  patientId: string;
  /** Newest first. Only the newest row per purpose is the current answer. */
  consents: ConsentRow[];
  notice: string | null;
}) {
  const [adding, setAdding] = useState<ConsentPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The newest row per purpose wins — the same rule as has_consent() in the
  // database, so the screen and the policy cannot disagree.
  const current = new Map<ConsentPurpose, ConsentRow>();
  for (const c of consents) {
    if (!current.has(c.purpose)) current.set(c.purpose, c);
  }

  return (
    <>
      <div className="panel">
        <div className="panelhead">
          <h3>{t("consentHeading")}</h3>
          <p>{t("consentSub")}</p>
        </div>

        {notice ? (
          <p className="leak formerror" style={{ margin: 0 }}>
            {notice}
          </p>
        ) : (
          PURPOSES.map((purpose) => {
            const row = current.get(purpose);
            const given = row && !row.withdrawnOn;
            return (
              <div className="leak" key={purpose}>
                <div className="leak-body">
                  <div className="leak-name">{t(`purpose_${purpose}`)}</div>
                  <div className="leak-when">
                    {!row
                      ? t("consentNotGiven")
                      : row.withdrawnOn
                        ? t("consentWithdrawnOn", { date: row.withdrawnOn })
                        : `${t("consentGivenOn", { date: row.grantedOn })} · ${t(
                            `method_${row.method}`
                          )}`}
                  </div>
                </div>
                {given ? (
                  <Button
                    small
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        try {
                          await withdrawConsent({ consentId: row.id, patientId });
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Something went wrong");
                        }
                      });
                    }}
                  >
                    {t("withdrawConsent")}
                  </Button>
                ) : (
                  <Button small variant="quiet" onClick={() => setAdding(purpose)}>
                    {t("recordConsent")}
                  </Button>
                )}
              </div>
            );
          })
        )}

        {error && (
          <p className="formerror" style={{ margin: "10px 16px" }}>
            {error}
          </p>
        )}
      </div>

      {adding && (
        <ConsentSheet
          patientId={patientId}
          purpose={adding}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  );
}

function ConsentSheet({
  patientId,
  purpose,
  onClose,
}: {
  patientId: string;
  purpose: ConsentPurpose;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<ConsentMethod>("in_person_signature");
  const [wording, setWording] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Sheet
      title={t("consentHeading")}
      subtitle={t(`purpose_${purpose}`)}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="primary"
            disabled={pending || !wording.trim()}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  await recordConsent({ patientId, purpose, method, wording });
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Something went wrong");
                }
              });
            }}
          >
            {t("recordConsent")}
          </Button>
        </>
      }
    >
      <SelectField
        label={t("consentMethodLabel")}
        value={method}
        onChange={(e) => setMethod(e.target.value as ConsentMethod)}
      >
        {METHODS.map((m) => (
          <option key={m} value={m}>
            {t(`method_${m}`)}
          </option>
        ))}
      </SelectField>

      <div>
        <label className="fieldlabel" htmlFor="consent-wording">
          {t("consentWordingLabel")}
        </label>
        <textarea
          id="consent-wording"
          className="field textarea"
          rows={4}
          value={wording}
          onChange={(e) => setWording(e.target.value)}
        />
        {/* The wording is stored, not a version number pointing at a document
            that may since have changed. */}
        <p className="hint">{t("consentWordingHint")}</p>
      </div>

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
