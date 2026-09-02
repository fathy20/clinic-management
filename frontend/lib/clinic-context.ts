import "server-only";

import { activeMembership } from "./active-clinic";
import { createClient } from "./supabase/server";
import type { ClinicRole } from "./types";

// Every clinic-facing page needs the same six things before it can render:
// who is asking, which clinic, what role, the clinic's name and currency, and
// the therapist roster. Reception and Schedule each had their own copy of this
// sequence; a third page would have made three. One place also means one place
// to fix when per-clinic locale or a clinic switcher lands.

export type Therapist = {
  id: string;
  name: string;
  defaultSessionMinutes: number;
};

export type ClinicContext = {
  userId: string;
  clinicId: string;
  clinicName: string;
  /**
   * Per-clinic settings, never constants. Every one of these becomes a rewrite
   * the day a clinic outside Cairo signs, so they are read here with fallbacks
   * and the fallbacks disappear once migration 0004 is applied. See
   * supabase/migrations/0004_clinic_locale_and_tax.sql.
   */
  currency: string;
  timezone: string;
  taxRate: number;
  taxLabel: string;
  role: ClinicRole;
  userName: string;
  therapists: Therapist[];
  nameById: Map<string, string>;
};

export type ContextResult =
  | { ok: true; ctx: ClinicContext }
  | { ok: false; reason: "unauthenticated" | "no_clinic" };

export async function loadClinicContext(): Promise<ContextResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated" };

  // Shared with requireClinicOwner, so the clinic on screen and the clinic a
  // form writes to are the same one. See lib/active-clinic.ts for why that has
  // to be a single function rather than the same query written twice.
  const membership = await activeMembership(supabase, user.id);
  if (!membership) return { ok: false, reason: "no_clinic" };

  const clinicId = membership.clinicId;

  const [{ data: clinic }, { data: staff }, { data: me }] = await Promise.all([
    // Every column, deliberately: naming `currency` explicitly makes the whole
    // row 400 with "column clinics.currency does not exist" until migration
    // 0002 is applied, and that would take the clinic *name* down with it.
    // Tighten to explicit columns once 0002 is live everywhere.
    supabase.from("clinics").select("*").eq("id", clinicId).single(),
    supabase
      .from("memberships")
      .select("user_id, default_session_minutes")
      .eq("clinic_id", clinicId)
      .eq("role", "therapist"),
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
  ]);

  const therapistIds = (staff ?? []).map((m) => m.user_id as string);
  const { data: profiles } = therapistIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", therapistIds)
    : { data: [] };

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id as string, p.full_name as string])
  );

  // Columns added by migrations that may not be applied yet. Reading them off
  // a widened row keeps the page working either way instead of 400-ing on a
  // missing column and taking the clinic name down with it.
  const settings = clinic as {
    currency?: string;
    timezone?: string;
    tax_rate?: number | string;
    tax_label?: string;
  } | null;

  return {
    ok: true,
    ctx: {
      userId: user.id,
      clinicId,
      clinicName: (clinic?.name as string) ?? "",
      currency: settings?.currency ?? "EGP",
      timezone: settings?.timezone ?? "Africa/Cairo",
      taxRate: Number(settings?.tax_rate ?? 0),
      taxLabel: settings?.tax_label ?? "",
      role: membership.role,
      userName: (me?.full_name as string) ?? "—",
      therapists: (staff ?? []).map((m) => ({
        id: m.user_id as string,
        name: nameById.get(m.user_id as string) ?? "—",
        defaultSessionMinutes: m.default_session_minutes as number,
      })),
      nameById,
    },
  };
}
