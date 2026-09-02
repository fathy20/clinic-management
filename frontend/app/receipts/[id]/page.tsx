import type { Metadata } from "next";
import { clinicFormat } from "@/lib/clinic-time";
import { recordPhiAccess } from "@/lib/audit";
import { loadClinicContext } from "@/lib/clinic-context";
import { gated, notMigratedMessage } from "@/lib/migration-gate";
import { canSeeMoney } from "@/lib/roles";
import { LOCALE, t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { Money } from "@/components/ui/Money";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

// A receipt names a patient and an amount. It is not a page for search engines
// or referrer headers, even though reaching it requires a session.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const LOC = LOCALE === "ar" ? "ar-EG" : "en-GB";

type ReceiptRow = {
  id: string;
  number: number;
  issued_at: string;
  issued_by: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  currency: string;
  tax_rate: string;
  tax_label: string;
  patient_id: string;
  payment_id: string;
};

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await loadClinicContext();
  if (!result.ok) {
    return (
      <main className="doc">
        <p className="doc-error">{t("mustSignIn")}</p>
      </main>
    );
  }
  const { clinicId, clinicName, timezone, role, nameById, userName, userId } =
    result.ctx;

  // The receipts policy admits money roles only, so a therapist already gets
  // zero rows. Saying so is better than an empty document that looks broken.
  if (!canSeeMoney(role)) {
    return (
      <main className="doc">
        <p className="doc-error">{t("receiptsForbidden")}</p>
      </main>
    );
  }

  const supabase = await createClient();

  const receiptGate = await gated<ReceiptRow[]>(
    "0009",
    supabase
      .from("receipts")
      .select(
        "id, number, issued_at, issued_by, subtotal, tax_amount, total, currency, tax_rate, tax_label, patient_id, payment_id"
      )
      .eq("clinic_id", clinicId)
      .eq("id", id)
      .limit(1),
    []
  );

  if (!receiptGate.ok) {
    return (
      <main className="doc">
        <p className="doc-error">
          {receiptGate.reason === "not_migrated"
            ? notMigratedMessage(receiptGate.migration)
            : receiptGate.message}
        </p>
      </main>
    );
  }

  const receipt = receiptGate.data[0];
  if (!receipt) {
    return (
      <main className="doc">
        <p className="doc-error">{t("receiptNotFound")}</p>
      </main>
    );
  }

  // A receipt names a patient and an amount, so reading one is a read of the
  // record.
  void recordPhiAccess({
    clinicId,
    userId,
    patientIds: [receipt.patient_id],
    surface: "receipt",
  });

  const [{ data: patient }, { data: payment }] = await Promise.all([
    supabase
      .from("patients")
      .select("name, phone")
      .eq("clinic_id", clinicId)
      .eq("id", receipt.patient_id)
      .maybeSingle(),
    supabase
      .from("payments")
      .select("method, paid_at")
      .eq("clinic_id", clinicId)
      .eq("id", receipt.payment_id)
      .maybeSingle(),
  ]);

  const rate = Number(receipt.tax_rate);
  const taxed = rate > 0;
  const method = payment?.method as string | undefined;
  const methodLabel =
    method === "cash"
      ? t("cash")
      : method === "card"
        ? t("card")
        : method === "wallet"
          ? t("wallet")
          : (method ?? "—");

  // The clinic's own timezone, not the server's: a receipt dated a day off is
  // the kind of thing a tax inspector notices.
  const issued = clinicFormat("date", LOC, timezone).format(
    new Date(receipt.issued_at)
  );

  return (
    <main className="doc">
      <div className="doc-actions">
        <PrintButton label={t("printReceipt")} />
      </div>

      <article className="doc-sheet">
        <header className="doc-head">
          <div>
            <h1>{clinicName}</h1>
            <p className="doc-kind">{t("receipt")}</p>
          </div>
          {/* The number is the document's identity, so it is the one thing set
              in tabular figures and never abbreviated. */}
          <div className="doc-number" dir="ltr">
            {String(receipt.number).padStart(5, "0")}
          </div>
        </header>

        <dl className="doc-meta">
          <div>
            <dt>{t("patientLabel")}</dt>
            <dd>{patient?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("dateLabel")}</dt>
            <dd>{issued}</dd>
          </div>
          <div>
            <dt>{t("methodLabel")}</dt>
            <dd>{methodLabel}</dd>
          </div>
          <div>
            <dt>{t("byLabel")}</dt>
            <dd>
              {receipt.issued_by
                ? (nameById.get(receipt.issued_by) ?? userName)
                : userName}
            </dd>
          </div>
        </dl>

        <table className="doc-lines">
          <tbody>
            {/* Only shown when the clinic is actually taxable. A zero-rated
                clinic reading "VAT 0.00" invites the question of why. */}
            {taxed && (
              <>
                <tr>
                  <th scope="row">{t("subtotalLabel")}</th>
                  <td>
                    <Money amount={Number(receipt.subtotal)} currency={receipt.currency} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    {t("taxOnReceipt", {
                      label: receipt.tax_label || t("taxRateLabel"),
                      // 0.1500 reads as 15 to a human. Trailing zeros dropped
                      // so 5% is not shown as 5.00%.
                      rate: String(Number((rate * 100).toFixed(2))),
                    })}
                  </th>
                  <td>
                    <Money amount={Number(receipt.tax_amount)} currency={receipt.currency} />
                  </td>
                </tr>
              </>
            )}
            <tr className="doc-total">
              <th scope="row">{t("totalPaid")}</th>
              <td>
                <Money
                  amount={Number(receipt.total)}
                  currency={receipt.currency}
                  size="lg"
                  withLabel
                />
              </td>
            </tr>
          </tbody>
        </table>

        {/* Says what this document is not. Claiming statutory compliance we
            have not built would be worse than issuing nothing. */}
        <footer className="doc-foot">{t("notATaxInvoice")}</footer>
      </article>
    </main>
  );
}
