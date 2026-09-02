// A FEATURE THAT IS SWITCHED OFF MUST SAY SO.
//
// CLAUDE.md warns about the shape of this bug for RLS: "a table without a
// policy is invisible, which looks like a bug and gets fixed by disabling
// RLS." An unapplied migration fails exactly the same way, and worse — the
// clinical screen read soap_notes, dropped the error on the floor, and
// rendered "0 written up" for every patient. A therapist seeing that concludes
// their notes are being lost, and the next thing they do is stop writing them.
//
// So every read of a table introduced after the live baseline goes through
// here. A missing relation or column becomes one honest sentence naming the
// migration; anything else is a real error and is reported as itself.

/** Postgres and PostgREST codes for "that object is not there". */
const ABSENT = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "PGRST202", // function not found in the schema cache
  "PGRST204", // column not found in the schema cache
  "PGRST205", // table not found in the schema cache
]);

export type QueryError = { code?: string | null; message?: string | null } | null;

export function isMissingObject(error: QueryError): boolean {
  if (!error) return false;
  if (error.code && ABSENT.has(error.code)) return true;
  // PostgREST does not always set a code, and the wording differs between the
  // schema cache and Postgres itself.
  return /could not find the (table|column|function)|does not exist|schema cache/i.test(
    error.message ?? ""
  );
}

export type Gate<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_migrated"; migration: string }
  | { ok: false; reason: "error"; message: string };

/**
 * Wraps one read of a post-baseline table. `migration` is the file that
 * creates it, so the message can name the thing the operator has to do rather
 * than leaving them to guess from a Postgres code.
 */
export async function gated<T>(
  migration: string,
  query: PromiseLike<{ data: T | null; error: QueryError }>,
  empty: T
): Promise<Gate<T>> {
  const { data, error } = await query;
  if (isMissingObject(error)) return { ok: false, reason: "not_migrated", migration };
  if (error) return { ok: false, reason: "error", message: error.message ?? "query failed" };
  return { ok: true, data: data ?? empty };
}

/**
 * The same judgement for a write. A server action cannot render a banner, so
 * it throws a sentence the form will show — never the raw Postgres text, which
 * for a missing table reads like a typo in our code rather than a step nobody
 * has run yet.
 */
export function throwIfNotMigrated(error: QueryError, migration: string): void {
  if (!error) return;
  if (isMissingObject(error)) {
    throw new Error(notMigratedMessage(migration));
  }
  throw new Error(error.message ?? "write failed");
}

/**
 * An enum value added by a migration fails differently: the table and column
 * both exist, so nothing is "missing" — Postgres rejects the *value* with
 * 22P02, `invalid input value for enum clinic_role: "accountant"`. The
 * settings page offers that role in its dropdown, so before migration 0002 is
 * applied a clinic owner picking Accountant sees raw Postgres text.
 */
export function isMissingEnumValue(error: QueryError, enumName: string): boolean {
  if (!error) return false;
  return (
    error.code === "22P02" &&
    new RegExp(`invalid input value for enum ${enumName}`, "i").test(error.message ?? "")
  );
}

export function notMigratedMessage(migration: string): string {
  return `This is switched off until migration ${migration} is applied. Run the pending steps in supabase/apply_pending.sql, then reload.`;
}
