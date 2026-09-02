"use server";

import { revalidatePath } from "next/cache";
import { isMissingEnumValue, notMigratedMessage } from "@/lib/migration-gate";
import { adminClient, requireClinicOwner } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/strings";
import type { ClinicRole } from "@/lib/types";

// Team management. Every action here starts with requireClinicOwner(), which
// derives the clinic from the caller's own session — no action takes a
// clinicId, so an owner of one clinic has no way to name another.
//
// This is the only place outside /admin that touches the service-role key,
// because creating a login means writing to auth.users, which is not a tenant
// table and has no clinic_id for RLS to key on.

const ASSIGNABLE: ClinicRole[] = ["owner", "reception", "therapist", "accountant"];

async function gate() {
  const owner = await requireClinicOwner();
  if (!owner.ok) throw new Error(t("onlyOwners"));
  return owner;
}

export type StaffMember = {
  userId: string;
  name: string;
  email: string;
  role: ClinicRole;
  isSelf: boolean;
  defaultSessionMinutes: number;
};

export async function listStaff(): Promise<StaffMember[]> {
  const owner = await gate();
  const db = adminClient();

  const { data: members, error } = await db
    .from("memberships")
    .select("user_id, role, default_session_minutes")
    .eq("clinic_id", owner.clinicId);
  if (error) throw new Error(error.message);

  const ids = (members ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length
    ? await db.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id as string, p.full_name as string])
  );

  // auth.users is not exposed to PostgREST, so emails come from the admin auth
  // API. It pages, and a single call silently truncated: once the deployment
  // passed 200 accounts, staff further down the list showed "—" for an email
  // with no indication anything was missing. Page until every member of THIS
  // clinic is found, or the pages run out.
  const wanted = new Set(ids);
  const emailById = new Map<string, string>();
  const PER_PAGE = 200;
  for (let page = 1; page <= 50 && emailById.size < wanted.size; page++) {
    const { data: authList } = await db.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    const users = authList?.users ?? [];
    for (const u of users) {
      if (u.email && wanted.has(u.id)) emailById.set(u.id, u.email);
    }
    if (users.length < PER_PAGE) break;
  }

  return (members ?? [])
    .map((m) => ({
      userId: m.user_id as string,
      name: nameById.get(m.user_id as string) ?? "—",
      email: emailById.get(m.user_id as string) ?? "—",
      role: m.role as ClinicRole,
      isSelf: m.user_id === owner.userId,
      defaultSessionMinutes: (m.default_session_minutes as number) ?? 45,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A generated password shown once, rather than an emailed invite link.
// Supabase's built-in mail is rate-limited and needs SMTP configured to be
// usable; a receptionist standing next to the owner can be told a password.
// Swap for inviteUserByEmail once real SMTP is set up — the ceiling is that
// this relies on the two of them being in the same room.
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function addStaff(input: {
  email: string;
  fullName: string;
  role: ClinicRole;
}): Promise<{ password: string }> {
  const owner = await gate();
  if (!ASSIGNABLE.includes(input.role)) throw new Error("unknown role");

  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!email || !fullName) throw new Error(t("pickPatientOrEnterNew"));

  const db = adminClient();
  const password = temporaryPassword();

  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    // Supabase reports an existing address as a 422; the raw message is not
    // something to put in front of a clinic owner.
    if (/already|registered|exists/i.test(error.message)) {
      throw new Error(t("emailTaken"));
    }
    throw new Error(error.message);
  }

  const userId = created.user!.id;

  // The handle_new_user trigger creates the profile from user_metadata. Set
  // it explicitly too: if that trigger is ever missing the name would
  // silently fall back to the email address on every screen.
  await db.from("profiles").upsert({ id: userId, full_name: fullName });

  const { error: memberError } = await db.from("memberships").insert({
    user_id: userId,
    clinic_id: owner.clinicId,
    role: input.role,
  });

  if (memberError) {
    // Leaving an auth user with no membership would be a login that reaches
    // nothing and blocks the address from being reused.
    await db.auth.admin.deleteUser(userId);
    // The Accountant option in the dropdown arrives with migration 0002. Until
    // it is applied Postgres rejects the value itself, and the raw text reads
    // like the role name is misspelled in our code.
    if (isMissingEnumValue(memberError, "clinic_role")) {
      throw new Error(notMigratedMessage("0002"));
    }
    throw new Error(memberError.message);
  }

  revalidatePath("/settings");
  return { password };
}

export async function changeStaffRole(input: {
  userId: string;
  role: ClinicRole;
}) {
  const owner = await gate();
  if (!ASSIGNABLE.includes(input.role)) throw new Error("unknown role");

  // A clinic with no owner cannot be administered again without SQL access.
  //
  // Counting and then updating is a race: two owners demoting each other at
  // the same moment both read 2 and both succeed, leaving nobody. The guard
  // has to be part of the write, so Postgres resolves it. `demote_member`
  // (migration 0008) does the count and the update in one statement and
  // returns false if it would have removed the last owner.
  if (input.role !== "owner") {
    // Through the caller's OWN session, not the service-role client. The
    // function is security definer and checks my_role() — which reads
    // auth.uid(). Under the service key there is no authenticated user, so
    // auth.uid() is NULL and the function refuses every call. Nothing here
    // needs the service key anyway: demote_member is the privileged part.
    const rls = await createClient();
    const { data, error } = await rls.rpc("demote_member", {
      p_clinic: owner.clinicId,
      p_user: input.userId,
      p_role: input.role,
    });
    if (error) {
      if (isMissingEnumValue(error, "clinic_role")) {
        throw new Error(notMigratedMessage("0002"));
      }
      // demote_member itself arrives with 0008.
      if (/could not find the function|does not exist/i.test(error.message)) {
        throw new Error(notMigratedMessage("0008"));
      }
      throw new Error(error.message);
    }
    if (data === false) throw new Error(t("cannotDemoteLastOwner"));
    revalidatePath("/settings");
    return;
  }

  // Promotion to owner adds authority rather than removing the last of it, so
  // there is nothing to race against.
  const { error } = await adminClient()
    .from("memberships")
    .update({ role: input.role })
    .eq("clinic_id", owner.clinicId)
    .eq("user_id", input.userId);
  if (error) {
    if (isMissingEnumValue(error, "clinic_role")) {
      throw new Error(notMigratedMessage("0002"));
    }
    throw new Error(error.message);
  }

  revalidatePath("/settings");
}

export async function removeStaff(userId: string) {
  const owner = await gate();
  if (userId === owner.userId) throw new Error(t("cannotRemoveSelf"));

  const db = adminClient();

  // Only the membership goes. The auth user survives so that payments and
  // notes recorded under taken_by keep resolving to a name — deleting the
  // user would orphan the financial record.
  const { error } = await db
    .from("memberships")
    .delete()
    .eq("clinic_id", owner.clinicId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
}

export async function updateTherapistDuration(input: {
  userId: string;
  minutes: number;
}) {
  const owner = await gate();
  const minutes = Math.round(input.minutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
    throw new Error(t("durationAboveZero"));
  }

  const db = adminClient();
  const { error } = await db
    .from("memberships")
    .update({ default_session_minutes: minutes })
    .eq("clinic_id", owner.clinicId)
    .eq("user_id", input.userId);
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
}

export async function updateClinic(input: {
  name: string;
  currency: string;
  timezone: string;
  taxRatePercent: number;
  taxLabel: string;
}) {
  const owner = await gate();

  const name = input.name.trim();
  if (!name) throw new Error(t("clinicNameLabel"));

  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a 3-letter code");

  // Validated against the runtime's own zone database rather than a list we
  // would have to maintain — an unknown zone would silently shift every
  // appointment on the schedule.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    throw new Error("unknown time zone");
  }

  const pct = Number(input.taxRatePercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error("tax rate must be between 0 and 100");
  }

  const db = adminClient();
  const { error } = await db
    .from("clinics")
    .update({
      name,
      currency,
      timezone: input.timezone,
      // Stored as a fraction; the form talks in percent because that is how a
      // clinic owner thinks about VAT.
      tax_rate: pct / 100,
      tax_label: input.taxLabel.trim(),
    })
    .eq("id", owner.clinicId);

  if (error) {
    // The three settings columns land in migration 0004. Until it is applied
    // this fails on a missing column, and saying so is more use than the raw
    // Postgres text.
    if (/column .* does not exist/i.test(error.message)) {
      throw new Error(t("settingsNeedMigration"));
    }
    throw new Error(error.message);
  }

  revalidatePath("/settings");
  revalidatePath("/reception");
}
