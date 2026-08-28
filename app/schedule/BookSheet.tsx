"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { LOCALE, t } from "@/lib/strings";
import {
  bookSessions,
  packagesWithCreditFor,
  previewSlots,
  searchPatientsForBooking,
  type BookOutcome,
  type SlotPreview,
} from "./actions";
import type { Therapist } from "./types";

type Hit = { id: string; name: string; phone: string };
type Pkg = { id: string; sessions_total: number; sessions_used: number };

const WHEN = new Intl.DateTimeFormat(LOCALE === "ar" ? "ar-EG" : "en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Cairo",
});

// Saturday-first, matching the Egyptian working week and the grid.
const WEEKDAYS = [
  { n: 6, key: "sat" },
  { n: 0, key: "sun" },
  { n: 1, key: "mon" },
  { n: 2, key: "tue" },
  { n: 3, key: "wed" },
  { n: 4, key: "thu" },
  { n: 5, key: "fri" },
] as const;

export function BookSheet({
  clinicId,
  currency,
  canSeeMoney,
  therapists,
  dateISO,
  onClose,
}: {
  clinicId: string;
  currency: string;
  canSeeMoney: boolean;
  therapists: Therapist[];
  dateISO: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [patient, setPatient] = useState<Hit | null>(null);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [packageId, setPackageId] = useState("");

  const [therapistId, setTherapistId] = useState(therapists[0]?.id ?? "");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(
    therapists[0]?.defaultSessionMinutes ?? 45
  );
  const [price, setPrice] = useState("");

  const [plan, setPlan] = useState(false);
  const [count, setCount] = useState(12);
  const [weekdays, setWeekdays] = useState<number[]>([]);

  const [preview, setPreview] = useState<SlotPreview[] | null>(null);
  const [result, setResult] = useState<BookOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim().length >= 2) {
        searchPatientsForBooking(clinicId, query)
          .then(setHits)
          .catch(() => setHits([]));
      } else setHits([]);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, clinicId]);

  useEffect(() => {
    if (!patient) {
      setPackages([]);
      setPackageId("");
      return;
    }
    packagesWithCreditFor(patient.id).then(setPackages).catch(() => setPackages([]));
  }, [patient]);

  // Any change to what would be booked invalidates a previous dry run.
  useEffect(() => {
    setPreview(null);
    setResult(null);
  }, [therapistId, time, duration, plan, count, weekdays, packageId]);

  const shared = {
    therapistId,
    dateISO,
    time,
    durationMinutes: duration,
    ...(plan ? { weekdays, count } : {}),
  };

  function run<T>(work: () => Promise<T>, then: (v: T) => void) {
    setError(null);
    startTransition(async () => {
      try {
        then(await work());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  const check = () => run(() => previewSlots(shared), setPreview);

  const commit = () =>
    run(
      () =>
        bookSessions({
          ...shared,
          clinicId,
          patientId: patient!.id,
          packageId: packageId || null,
          price: Number(price) || 0,
        }),
      (outcomes) => {
        setResult(outcomes);
        if (outcomes.every((o) => o.ok)) onClose();
      }
    );

  const clashes = preview?.filter((p) => p.clashesWith !== null).length ?? 0;
  const free = (preview?.length ?? 0) - clashes;
  const ready = Boolean(patient) && Boolean(therapistId) && (!plan || weekdays.length > 0);

  return (
    <Sheet
      title={plan ? t("bookPlanOfCare") : t("bookSession")}
      subtitle={WHEN.format(new Date(`${dateISO}T12:00:00Z`)).split(",")[0] + ` · ${dateISO}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          {preview === null ? (
            <Button variant="primary" onClick={check} disabled={pending || !ready}>
              {t("checkSlots")}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={commit}
              disabled={pending || free === 0}
            >
              {clashes > 0
                ? t("bookAnyway", { n: free })
                : t("bookAll", { n: free })}
            </Button>
          )}
        </>
      }
    >
      {patient ? (
        <div className="picked">
          <span>
            {patient.name} ·{" "}
            <span className="num" dir="ltr">
              {patient.phone}
            </span>
          </span>
          <button type="button" className="linkbtn" onClick={() => setPatient(null)}>
            {t("change")}
          </button>
        </div>
      ) : (
        <>
          <Field
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
                  onClick={() => setPatient(h)}
                >
                  {h.name} ·{" "}
                  <span className="num" dir="ltr">
                    {h.phone}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <SelectField
        label={t("therapist")}
        value={therapistId}
        onChange={(e) => {
          setTherapistId(e.target.value);
          const th = therapists.find((x) => x.id === e.target.value);
          if (th) setDuration(th.defaultSessionMinutes);
        }}
      >
        {therapists.length === 0 && <option value="">{t("noTherapists")}</option>}
        {therapists.map((th) => (
          <option key={th.id} value={th.id}>
            {th.name}
          </option>
        ))}
      </SelectField>

      <div className="tender">
        <Field
          label={t("time")}
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <Field
          amount
          label={t("sessionMinutes")}
          inputMode="numeric"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        />
      </div>

      {packages.length > 0 && (
        <SelectField
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

      {canSeeMoney && !packageId && (
        <Field
          amount
          label={t("pricePerSession")}
          hint={t("priceHint")}
          inputMode="decimal"
          placeholder="0.00"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      )}

      <div className="segmented" role="group">
        <button
          type="button"
          className={plan ? "seg" : "seg is-on"}
          onClick={() => setPlan(false)}
        >
          {t("oneSession")}
        </button>
        <button
          type="button"
          className={plan ? "seg is-on" : "seg"}
          onClick={() => setPlan(true)}
        >
          {t("planOfCare")}
        </button>
      </div>

      {plan && (
        <>
          <Field
            amount
            label={t("sessions")}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <div>
            <span className="fieldlabel">{t("repeatOn")}</span>
            <div className="daypicker">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  className={weekdays.includes(d.n) ? "day is-on" : "day"}
                  aria-pressed={weekdays.includes(d.n)}
                  onClick={() =>
                    setWeekdays((w) =>
                      w.includes(d.n) ? w.filter((x) => x !== d.n) : [...w, d.n]
                    )
                  }
                >
                  {t(d.key)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {preview && (
        <div className="previewbox">
          <p className={clashes > 0 ? "preview-warn" : "preview-ok"}>
            {clashes > 0
              ? t("slotsClash", { n: clashes, total: preview.length })
              : t("slotsClear", { n: preview.length })}
          </p>
          <ul className="previewlist">
            {preview.map((p) => (
              <li key={p.startsAt} className={p.clashesWith ? "is-clash" : undefined}>
                <span className="num">{WHEN.format(new Date(p.startsAt))}</span>
                {p.clashesWith && (
                  <span className="preview-why">
                    {t("clashesWith", { name: p.clashesWith })}
                  </span>
                )}
                {p.clashesWith === null && preview.some((x) => x.clashesWith) && (
                  <span className="preview-why" style={{ color: "var(--jade)" }}>
                    ✓
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <p className={result.every((r) => r.ok) ? "preview-ok" : "formerror"}>
          {result.some((r) => r.ok)
            ? t("bookedNOfM", {
                n: result.filter((r) => r.ok).length,
                total: result.length,
              })
            : t("noneBooked")}
        </p>
      )}

      {!patient && <p className="hint">{t("noPatientPicked")}</p>}
      {error && <p className="formerror">{error}</p>}
    </Sheet>
  );
}
