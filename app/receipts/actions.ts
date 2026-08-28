"use server";

import { loadClinicContext } from "@/lib/clinic-context";
import { throwIfNotMigrated } from "@/lib/migration-gate";
import { canSeeMoney } from "@/lib/roles";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";

// Issuing a receipt allocates a gapless number and freezes the tax basis, so
// all of it happens in Postgres (`issue_receipt`, migration 0009). This action
// exists to establish who is asking and to turn a Postgres failure into a
// sentence — it computes nothing.
//
// The rpc goes through the caller's OWN session, not the service key:
// issue_receipt is security definer and checks my_role(), which reads
// auth.uid(). Under the service key there is no authenticated user, so every
// call would be refused.

export type IssuedReceipt = { id: string; number: number };

export async function issueReceipt(paymentId: string): Promise<IssuedReceipt> {
  const result = await loadClinicContext();
  if (!result.ok) throw new Error(t("mustSignIn"));

  // The database checks this too, and the database is the boundary. Checking
  // here as well means the button can be disabled rather than failing on a
  // click, and the message is the clinic's language instead of a raise.
  if (!canSeeMoney(result.ctx.role)) throw new Error(t("receiptsForbidden"));

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("issue_receipt", { p_payment: paymentId })
    .single();

  if (error) throwIfNotMigrated(error, "0009");

  const row = data as { id: string; number: number } | null;
  if (!row) throw new Error(t("receiptNotFound"));

  return { id: row.id, number: Number(row.number) };
}
