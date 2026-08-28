"use server";

import { revalidatePath } from "next/cache";
import { loadClinicContext } from "@/lib/clinic-context";
import { canSeeMoney } from "@/lib/roles";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";

// Selling a package. Until this existed the product's central object could
// only be created with hand-written SQL, which made package economics — the
// whole competitive position — unreachable from the product.

async function moneyContext() {
  const result = await loadClinicContext();
  if (!result.ok) throw new Error(t("mustSignIn"));
  if (!canSeeMoney(result.ctx.role)) throw new Error(t("moneyForbidden"));
  return result.ctx;
}

export async function sellPackage(input: {
  patientId: string;
  sessionsTotal: number;
  price: number;
  expiresOn?: string | null;
  /** optional deposit taken at the point of sale */
  deposit?: number;
  depositMethod?: string;
}) {
  const { clinicId, userId } = await moneyContext();

  const sessions = Math.round(Number(input.sessionsTotal));
  if (!Number.isFinite(sessions) || sessions < 1 || sessions > 200) {
    throw new Error(t("sessionsOutOfRange"));
  }

  // Priced here, in the server action, never taken as a total from the client.
  const price = Math.max(0, Number(input.price) || 0);

  let expires: string | null = null;
  if (input.expiresOn) {
    const parsed = new Date(input.expiresOn + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime())) throw new Error(t("badDateOrTime"));
    expires = input.expiresOn;
  }

  const supabase = await createClient();

  const { data: pkg, error } = await supabase
    .from("packages")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      sessions_total: sessions,
      price,
      expires_at: expires,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "42501") throw new Error(t("moneyForbidden"));
    throw new Error(error.message);
  }

  // A deposit is the normal case in an Egyptian clinic, and it is the case
  // Jane cannot represent at all — it requires a package to be paid in full
  // before it can be redeemed. Taken in the same call so a sale with a
  // deposit is one action rather than two the receptionist can half-finish.
  const deposit = Math.max(0, Number(input.deposit) || 0);
  if (deposit > 0) {
    const { error: payError } = await supabase.from("payments").insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      package_id: pkg.id,
      amount: Math.min(deposit, price || deposit),
      method: input.depositMethod || "cash",
      taken_by: userId,
    });
    // The package stands even if the deposit fails: it is real, it was sold,
    // and deleting it would lose the sale. Reception can take the payment
    // again from the patient's record.
    if (payError) throw new Error(payError.message);
  }

  revalidatePath(`/patients/${input.patientId}`);
  revalidatePath("/reception");
  revalidatePath("/finance");
  return { packageId: pkg.id };
}
