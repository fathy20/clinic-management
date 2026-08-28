"use server";

import { loadClinicContext } from "@/lib/clinic-context";
import { canSeeMoney } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

// Freedom to leave, as a feature. Lock-in is the loudest complaint in this
// category, so a clinic can take everything at any time without asking us and
// without a support ticket.
//
// Read through the ordinary RLS-bound client on purpose: an export can only
// ever contain rows the caller was already allowed to see. Using the admin
// client here would turn a convenience into a cross-tenant leak.

// Typed as plain strings, not `as const`: supabase-js infers a return type per
// literal table+column pair, and the union across five tables is large enough
// that tsc gives up with "union type too complex to represent".
const TABLES: { name: string; columns: string }[] = [
  { name: "patients", columns: "id, name, phone, birth_date, consent_at, notes, created_at" },
  {
    name: "appointments",
    columns: "id, patient_id, therapist_id, during, status, package_id, price, created_at",
  },
  { name: "packages", columns: "id, patient_id, sessions_total, sessions_used, price, expires_at, created_at" },
  {
    name: "payments",
    columns: "id, patient_id, package_id, appointment_id, amount, method, paid_at, taken_by, group_id",
  },
  { name: "refunds", columns: "id, payment_id, amount, reason, refunded_at, taken_by" },
];

export type ExportBundle = Record<string, Record<string, unknown>[]>;

async function collect(): Promise<
  { ok: true; clinicName: string; bundle: ExportBundle } | { ok: false; error: string }
> {
  const result = await loadClinicContext();
  if (!result.ok) return { ok: false, error: "not authorised" };
  const { clinicId, clinicName, role } = result.ctx;

  // The bundle carries payments and refunds, so it is gated the same way the
  // finance screen is rather than being open to any signed-in member.
  if (!canSeeMoney(role)) return { ok: false, error: "not authorised" };

  const supabase = await createClient();
  const bundle: ExportBundle = {};

  for (const table of TABLES) {
    const { data, error } = await supabase
      .from(table.name)
      .select(table.columns)
      .eq("clinic_id", clinicId);
    if (error) return { ok: false, error: error.message };
    // A dynamic column list gives supabase-js no literal to infer from, so it
    // widens to its GenericStringError shape. The rows are plain objects at
    // runtime; go through unknown rather than pretend the two types overlap.
    bundle[table.name] = (data ?? []) as unknown as Record<string, unknown>[];
  }

  return { ok: true, clinicName, bundle };
}

export async function exportJson() {
  const r = await collect();
  if (!r.ok) throw new Error(r.error);
  return {
    filename: `${slug(r.clinicName)}-export.json`,
    body: JSON.stringify(
      { clinic: r.clinicName, exportedAt: new Date().toISOString(), ...r.bundle },
      null,
      2
    ),
  };
}

export async function exportCsv() {
  const r = await collect();
  if (!r.ok) throw new Error(r.error);

  // One file, with each table as its own titled block. A zip would need a
  // dependency for something a spreadsheet opens fine as sections.
  const parts: string[] = [];
  for (const [table, rows] of Object.entries(r.bundle)) {
    parts.push(`# ${table} (${rows.length})`);
    if (rows.length === 0) {
      parts.push("");
      continue;
    }
    const headers = Object.keys(rows[0]);
    parts.push(headers.map(csvCell).join(","));
    for (const row of rows) {
      parts.push(headers.map((h) => csvCell(row[h])).join(","));
    }
    parts.push("");
  }

  return {
    filename: `${slug(r.clinicName)}-export.csv`,
    body: parts.join("\r\n"),
  };
}

function slug(name: string) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // A clinic named only in Arabic slugs to nothing, and a filename of ".csv"
  // is worse than a generic one.
  return cleaned || "clinic";
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Patient
  // names and free-text reasons are user input, so prefix them out of harm.
  const injection = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(injection) ? `"${injection.replace(/"/g, '""')}"` : injection;
}
