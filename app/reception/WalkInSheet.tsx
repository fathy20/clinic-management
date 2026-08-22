"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { addWalkIn, getPatientPackages, searchPatients } from "./actions";
import type { Therapist } from "./types";
import { t } from "@/lib/strings";

type Hit = { id: string; name: string; phone: string };
type PackageOption = {
  id: string;
  sessions_total: number;
  sessions_used: number;
};

export function WalkInSheet({
  clinicId,
  therapists,
  onClose,
}: {
  clinicId: string;
  therapists: Therapist[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [therapistId, setTherapistId] = useState(therapists[0]?.id ?? "");
  const [duration, setDuration] = useState(
    therapists[0]?.defaultSessionMinutes ?? 45
  );
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [packageId, setPackageId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim().length >= 2) {
        searchPatients(clinicId, query).then(setHits).catch(() => setHits([]));
      } else {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, clinicId]);

  useEffect(() => {
    if (picked) {
      getPatientPackages(picked.id).then(setPackages).catch(() => setPackages([]));
    } else {
      setPackages([]);
      setPackageId("");
    }
  }, [picked]);

  function pickTherapist(id: string) {
    setTherapistId(id);
    const found = therapists.find((x) => x.id === id);
    if (found) setDuration(found.defaultSessionMinutes);
  }

  function submit() {
    setError(null);
    if (!picked && (!name.trim() || !phone.trim()))
      return setError(t("pickPatientOrEnterNew"));
    if (!picked && !consent)
      return setError(t("consentRequired"));
    if (!therapistId) return setError(t("pickTherapist"));
    if (!(duration > 0)) return setError(t("durationAboveZero"));

    startTransition(async () => {
      try {
        await addWalkIn({
          clinicId,
          therapistId,
          patientId: picked?.id,
          newPatient: picked
            ? undefined
            : { name: name.trim(), phone: phone.trim() },
          packageId: packageId || null,
          durationMinutes: duration,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Sheet
      title={t("walkInTitle")}
      subtitle={t("walkInSubtitle")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {t("addToQueue")}
          </Button>
        </>
      }
    >
      {picked ? (
        <div className="picked">
          <span>
            {picked.name} ·{" "}
            <span className="num" dir="ltr">
              {picked.phone}
            </span>
          </span>
          <button type="button" className="linkbtn" onClick={() => setPicked(null)}>
            {t("change")}
          </button>
        </div>
      ) : (
        <>
          <Field
            id="q"
            label={t("existingPatient")}
            placeholder={t("searchByNameOrPhone")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {hits.length > 0 && (
            <div className="results">
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="result"
                  onClick={() => setPicked(h)}
                >
                  {h.name} ·{" "}
                  <span className="num" dir="ltr">
                    {h.phone}
                  </span>
                </button>
              ))}
            </div>
          )}

          <Field
            id="nm"
            label={t("orNewPatient")}
            placeholder={t("name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            placeholder={t("phone")}
            dir="ltr"
            inputMode="tel"
            aria-label={t("phone")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <label className="checkline">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>{t("consentLabel")}</span>
          </label>
        </>
      )}

      <SelectField
        id="th"
        label={t("therapist")}
        value={therapistId}
        onChange={(e) => pickTherapist(e.target.value)}
      >
        {therapists.length === 0 && <option value="">{t("noTherapists")}</option>}
        {therapists.map((th) => (
          <option key={th.id} value={th.id}>
            {th.name}
          </option>
        ))}
      </SelectField>

      <Field
        id="dur"
        amount
        label={t("sessionMinutes")}
        inputMode="numeric"
        value={duration}
        onChange={(e) => setDuration(Number(e.target.value))}
      />

      {picked && packages.length > 0 && (
        <SelectField
          id="pk"
          label={t("underPackage")}
          value={packageId}
          onChange={(e) => setPackageId(e.target.value)}
        >
          <option value="">{t("noSingleSession")}</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {t("packageOf", { n: p.sessions_total })} ·{" "}
              {t("sessionsLeft", { n: p.sessions_total - p.sessions_used })}
            </option>
          ))}
        </SelectField>
      )}

      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
