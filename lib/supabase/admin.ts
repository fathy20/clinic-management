import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { activeMembership } from "../active-clinic";
import { createClient } from "./server";

// ============================================================
// PLATFORM ADMIN — read this before touching anything here.
//
// This is the ONLY place in the codebase that bypasses RLS. It exists
// because a SaaS vendor genuinely cannot operate without seeing which
// clinics are active and whether money is flowing.
//
// Why a separate surface instead of an admin clause in the RLS policies:
// adding `or is_platform_admin()` to the eight tenant policies would put a
// bypass path inside the mechanism that keeps clinics apart. One mistake in
// any one of those policies leaks every clinic's data, and the mistake is
// invisible in normal use. Keeping the bypass in one server-only module
// means the tenant policies stay exactly as verified, and there is a single
// file to audit.
//
// The `import "server-only"` above is the hard guarantee: if any client
// component ever imports this, the build fails rather than shipping the
// secret key to a browser.
// ============================================================

const SECRET = process.env.SUPABASE_SECRET_KEY;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function adminEmails() {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function platformAdminsConfigured() {
  return adminEmails().length > 0 && Boolean(SECRET);
}

// Establishes who is asking using the ordinary, RLS-bound session client —
// never a value passed in from a caller. Returns the email only when it is
// on the allowlist, so a caller cannot act on an unverified identity.
export async function requirePlatformAdmin(): Promise<
  { ok: true; email: string } | { ok: false; reason: "unconfigured" | "forbidden" }
> {
  if (!platformAdminsConfigured()) return { ok: false, reason: "unconfigured" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase();
  if (!email || !adminEmails().includes(email)) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, email };
}

// Only ever call this after requirePlatformAdmin() has returned ok.
export function adminClient() {
  if (!SECRET || !URL) {
    throw new Error("platform admin is not configured");
  }
  return createSupabaseClient(URL, SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ============================================================
// CLINIC OWNER privileges — a narrower door than the platform gate above.
//
// Creating a login is the one thing a clinic owner needs that RLS cannot
// express: auth.users is not a tenant table and has no clinic_id. So this
// reaches for the same secret key, but the authority it grants is different
// and much smaller, which is why it does not reuse requirePlatformAdmin.
//
// The rule that makes it safe: the clinic is derived from the caller's own
// session, never accepted as an argument. An owner of clinic A physically
// cannot name clinic B, because no code path lets them say which clinic they
// mean. Every action in app/settings/actions.ts goes through here first.
// ============================================================

export type OwnerGate =
  | { ok: true; clinicId: string; userId: string }
  | { ok: false; reason: "unauthenticated" | "not_owner" | "unconfigured" };

export async function requireClinicOwner(): Promise<OwnerGate> {
  if (!SECRET || !URL) return { ok: false, reason: "unconfigured" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated" };

  // The same selection the page used to render the form, not a second query
  // that happens to look similar. Asking twice is how /settings came to show
  // one clinic's settings and save them to another; lib/active-clinic.ts has
  // the full account.
  const membership = await activeMembership(supabase, user.id);
  if (!membership) return { ok: false, reason: "not_owner" };
  if (membership.role !== "owner") return { ok: false, reason: "not_owner" };

  return { ok: true, clinicId: membership.clinicId, userId: user.id };
}
