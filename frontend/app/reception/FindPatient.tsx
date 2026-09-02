"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/strings";
import { formatMoney } from "@/lib/money";
import { findPatients, type PatientHit } from "./actions";

// The day board filters today's column. This searches the whole clinic —
// "when did Mrs Hassan last come in?" is a question about a patient who is
// not on today's list, and until now there was no way to ask it.
export function FindPatient({
  clinicId,
  canSeeMoney,
  currency,
}: {
  clinicId: string;
  canSeeMoney: boolean;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits(null);
      return;
    }
    // A slow response for an earlier query must not overwrite a later one.
    const mine = ++seq.current;
    const handle = setTimeout(() => {
      findPatients(clinicId, trimmed)
        .then((r) => {
          if (mine === seq.current) setHits(r);
        })
        .catch((e) => {
          if (mine === seq.current) {
            setError(e instanceof Error ? e.message : "Something went wrong");
          }
        });
    }, 220);
    return () => clearTimeout(handle);
  }, [query, clinicId, open]);

  // Shift+F rather than a bare key: reception types into the day filter
  // constantly, and a single-letter shortcut would fire mid-name.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing =
        document.activeElement instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
      if (e.key === "F" && e.shiftKey && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button small onClick={() => setOpen(true)}>
        {t("findPatient")}
      </Button>

      {open && (
        <Sheet
          title={t("findPatient")}
          subtitle={t("findPatientHint")}
          onClose={() => setOpen(false)}
          footer={<Button onClick={() => setOpen(false)}>{t("cancel")}</Button>}
        >
          <Field
            placeholder={t("searchByNameOrPhone")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {hits === null && <p className="hint">{t("typeToSearch")}</p>}
          {hits !== null && hits.length === 0 && (
            <p className="empty">{t("noMatches")}</p>
          )}

          {hits !== null && hits.length > 0 && (
            <>
              <p className="hint">{t("searchResults", { n: hits.length })}</p>
              <div className="results">
                {hits.map((h) => (
                  <Link
                    key={h.id}
                    href={`/patients/${h.id}`}
                    className="result result-row"
                  >
                    <span>
                      <span style={{ fontWeight: 600 }}>{h.name}</span>{" "}
                      <span className="num" dir="ltr" style={{ color: "var(--muted)" }}>
                        {h.phone}
                      </span>
                    </span>
                    {canSeeMoney && h.amountOwed > 0 && (
                      <span className="money">
                        {t("owes")} {formatMoney(h.amountOwed, currency)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </>
          )}

          {error && <p className="formerror">{error}</p>}
        </Sheet>
      )}
    </>
  );
}
